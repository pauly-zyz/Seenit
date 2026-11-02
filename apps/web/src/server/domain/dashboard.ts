import {
  and,
  apiKeys,
  desc,
  eq,
  funders,
  inArray,
  isNull,
  missions,
  payouts,
  sql,
  submissions,
  type Database,
} from "@seenit/db";
import type { Hex } from "viem";

import { createApiKey } from "../auth/api-keys";
import { verifySiweSignature } from "../auth/siwe";
import { ChainRevertError } from "../chain/types";
import { AppError, notFound } from "../errors";
import type { Services } from "../services";
import { getFunderMission, publicMission, type MissionRow } from "./missions";
import { AWAITING_DECISION, SLOT_HOLDING } from "./statuses";
import { applyMissionClosed } from "./sync";

// ------------------------------------------------------------------------------------------------
// Sign-in
// ------------------------------------------------------------------------------------------------

/** SIWE for the dashboard: the signing wallet is the funder (created on first sign-in). */
export async function signInFunder(
  s: Services,
  input: { message: string; signature: Hex },
  now: Date,
) {
  const address = await verifySiweSignature(
    { db: s.db, chain: s.chain, domain: s.config.siweDomain, chainId: s.config.chainId, now },
    input,
  );
  const wallet = address.toLowerCase();
  const existing = await s.db.query.funders.findFirst({
    where: eq(funders.wallet, wallet),
    orderBy: (f, { asc }) => [asc(f.createdAt)],
  });
  if (existing) return existing;
  const [created] = await s.db
    .insert(funders)
    .values({ name: `Funder ${address.slice(0, 6)}…${address.slice(-4)}`, wallet })
    .returning();
  return created!;
}

export const publicFunder = (f: { id: string; name: string; wallet: string }) => ({
  id: f.id,
  name: f.name,
  wallet: f.wallet,
});

// ------------------------------------------------------------------------------------------------
// API keys
// ------------------------------------------------------------------------------------------------

export async function listApiKeys(db: Database, funderId: string) {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.funderId, funderId))
    .orderBy(desc(apiKeys.createdAt));
  return { keys: rows };
}

const MAX_ACTIVE_KEYS = 20;

/** Creates a key; the full key is in this response only. */
export async function issueApiKey(db: Database, funderId: string, name: string) {
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.funderId, funderId), isNull(apiKeys.revokedAt)))) as [{ n: number }];
  if (n >= MAX_ACTIVE_KEYS)
    throw new AppError("conflict", `At most ${MAX_ACTIVE_KEYS} active API keys`);
  const { key, id, prefix } = await createApiKey(db, funderId, name);
  return { id, name, prefix, key };
}

export async function revokeApiKey(db: Database, funderId: string, keyId: string, now: Date) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.funderId, funderId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix, revokedAt: apiKeys.revokedAt });
  if (!row) {
    const exists = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, keyId), eq(apiKeys.funderId, funderId)),
    });
    if (!exists) throw notFound("API key");
    return { id: exists.id, prefix: exists.prefix, revokedAt: exists.revokedAt };
  }
  return row;
}

// ------------------------------------------------------------------------------------------------
// Missions + escrow
// ------------------------------------------------------------------------------------------------

/**
 * Where the escrow of one mission stands (token base units, as strings).
 * funded: reward × captures once on-chain. paidOut: payouts + fees.
 * inReview: rewards held for submissions awaiting a decision.
 * unused: free slots (refundable after the deadline, already returned if cancelled/refunded).
 */
export function escrowSummary(
  m: MissionRow,
  counts: Record<string, number>,
  paid: { amount: bigint; fee: bigint },
  now: Date,
) {
  const reward = BigInt(m.reward);
  const funded = m.status === "pending_funding" ? 0n : reward * BigInt(m.maxCaptures);
  const holding = SLOT_HOLDING.reduce((sum, st) => sum + (counts[st] ?? 0), 0);
  const awaiting = AWAITING_DECISION.reduce((sum, st) => sum + (counts[st] ?? 0), 0);
  const unused =
    m.status === "pending_funding" ? 0n : reward * BigInt(Math.max(m.maxCaptures - holding, 0));
  const closed = m.status === "cancelled" || m.status === "refunded";
  const expired = m.deadline.getTime() <= now.getTime();
  return {
    funded: funded.toString(),
    paidOut: (paid.amount + paid.fee).toString(),
    paidToContributors: paid.amount.toString(),
    platformFees: paid.fee.toString(),
    inReview: (reward * BigInt(awaiting)).toString(),
    unused: unused.toString(),
    returned: (closed ? unused : 0n).toString(),
    /** Still locked in the contract for this mission. */
    held: ((closed ? 0n : unused) + reward * BigInt(awaiting)).toString(),
    expired,
    refundable: m.status === "active" && expired && unused > 0n,
  };
}

async function countsAndPayouts(db: Database, missionIds: string[]) {
  if (missionIds.length === 0) return { counts: new Map(), paid: new Map() };
  const countRows = await db
    .select({
      missionId: submissions.missionId,
      status: submissions.status,
      n: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .where(inArray(submissions.missionId, missionIds))
    .groupBy(submissions.missionId, submissions.status);
  const paidRows = await db
    .select({
      missionId: submissions.missionId,
      amount: sql<string>`coalesce(sum(${payouts.amount}), 0)::text`,
      fee: sql<string>`coalesce(sum(${payouts.fee}), 0)::text`,
    })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(inArray(submissions.missionId, missionIds))
    .groupBy(submissions.missionId);
  const counts = new Map<string, Record<string, number>>();
  for (const r of countRows) {
    const c = counts.get(r.missionId) ?? {};
    c[r.status] = r.n;
    counts.set(r.missionId, c);
  }
  const paid = new Map(
    paidRows.map((r) => [r.missionId, { amount: BigInt(r.amount), fee: BigInt(r.fee) }]),
  );
  return { counts, paid };
}

/** The funder's missions, newest first, with submission counts and escrow state. */
export async function listFunderMissions(s: Services, funderId: string, now: Date) {
  const rows = await s.db.query.missions.findMany({
    where: eq(missions.funderId, funderId),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 200,
  });
  const { counts, paid } = await countsAndPayouts(
    s.db,
    rows.map((m) => m.id),
  );
  return {
    token: { symbol: s.config.tokenSymbol, decimals: s.config.tokenDecimals },
    missions: rows.map((m) => {
      const c = (counts.get(m.id) ?? {}) as Record<string, number>;
      return {
        ...publicMission(m),
        funderWallet: m.funderWallet,
        submissions: {
          processing: c.processing ?? 0,
          ready: c.ready ?? 0,
          needsReview: c.needs_review ?? 0,
          accepted: c.accepted ?? 0,
          rejected: c.rejected ?? 0,
        },
        escrow: escrowSummary(m, c, paid.get(m.id) ?? { amount: 0n, fee: 0n }, now),
      };
    }),
  };
}

/**
 * Returns unused slots of an expired mission to the funder. `refund` is permissionless on-chain,
 * so the operator sends it (no funder signature or gas needed).
 */
export async function refundExpiredMission(
  s: Services,
  funderId: string,
  missionId: string,
  now: Date,
) {
  const m = await getFunderMission(s.db, funderId, missionId);
  if (m.status === "refunded" || m.status === "cancelled") {
    return { mission: publicMission(m), refunded: null, txHash: null };
  }
  if (m.status !== "active" || m.onchainId === null) {
    throw new AppError("conflict", `Mission is ${m.status} and has nothing to refund`);
  }
  if (m.deadline.getTime() > now.getTime()) {
    throw new AppError("conflict", "The deadline hasn't passed yet; cancel the mission instead");
  }
  let res;
  try {
    res = await s.chain.refundMission(m.onchainId);
  } catch (err) {
    if (err instanceof ChainRevertError) {
      if (err.errorName === "DeadlineNotReached")
        throw new AppError("conflict", "The deadline hasn't passed on-chain yet");
      if (err.errorName === "MissionNotOpen")
        throw new AppError("conflict", "Mission is already closed on-chain");
      throw new AppError("chain_error", "Refund transaction failed", { errorName: err.errorName });
    }
    throw err;
  }
  await applyMissionClosed(s.db, m.onchainId, "refunded");
  const updated = await getFunderMission(s.db, funderId, missionId);
  return { mission: publicMission(updated), refunded: res.refunded.toString(), txHash: res.txHash };
}
