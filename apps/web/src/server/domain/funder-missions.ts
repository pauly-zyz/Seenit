import { and, eq, missions, payouts, sql, submissions } from "@seenit/db";
import type { Hex } from "viem";

import { buildCancelTransaction } from "../chain/funding";
import { AppError } from "../errors";
import type { Services } from "../services";
import { fundingFor, getFunderMission, publicMission } from "./missions";
import { SLOT_HOLDING } from "./statuses";
import { applyMissionClosed } from "./sync";

/** Public chain/token facts clients need to fund missions and format amounts. */
export function getMeta(s: Services) {
  return {
    chainId: s.chain.chainId,
    escrow: s.chain.escrowAddress,
    token: {
      address: s.chain.tokenAddress,
      symbol: s.config.tokenSymbol,
      decimals: s.config.tokenDecimals,
    },
    /** Rewards above this (base units) need Tier 2 contributors. */
    tier1MaxReward: s.config.tier1MaxReward.toString(),
    limits: {
      minDeadlineMinutes: 10,
      maxDeadlineDays: 90,
      maxRadiusMeters: 5000,
      maxCaptures: 1000,
    },
  };
}

/** Where a mission stands: funding, slots, submissions by status and payouts. */
export async function getMissionStatus(s: Services, funderId: string, missionId: string) {
  const m = await getFunderMission(s.db, funderId, missionId);
  const counts = await s.db
    .select({ status: submissions.status, n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(eq(submissions.missionId, m.id))
    .groupBy(submissions.status);
  const by = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>;
  const holding = SLOT_HOLDING.reduce((sum, st) => sum + (by[st] ?? 0), 0);
  const [paid] = await s.db
    .select({
      amount: sql<string>`coalesce(sum(${payouts.amount}), 0)::text`,
      fee: sql<string>`coalesce(sum(${payouts.fee}), 0)::text`,
    })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(eq(submissions.missionId, m.id));

  return {
    mission: publicMission(m),
    escrow: {
      total: (BigInt(m.reward) * BigInt(m.maxCaptures)).toString(),
      paidToContributors: paid?.amount ?? "0",
      platformFees: paid?.fee ?? "0",
    },
    slots: { total: m.maxCaptures, used: holding, left: Math.max(m.maxCaptures - holding, 0) },
    submissions: {
      processing: by.processing ?? 0,
      ready: by.ready ?? 0,
      needsReview: by.needs_review ?? 0,
      accepted: by.accepted ?? 0,
      rejected: by.rejected ?? 0,
    },
    funding: m.status === "pending_funding" ? fundingFor(s, m) : null,
  };
}

/**
 * Cancels a mission.
 * - pending_funding (never funded): closed right away, nothing on-chain.
 * - active, no txHash: returns the funder's cancelMission transaction to sign.
 * - active + txHash of that mined transaction: verified and applied (unused slots were refunded).
 */
export async function cancelMission(
  s: Services,
  funderId: string,
  missionId: string,
  txHash?: Hex,
) {
  const m = await getFunderMission(s.db, funderId, missionId);
  if (m.status === "cancelled" || m.status === "refunded") {
    return { mission: publicMission(m), cancelled: true, transactions: [] };
  }
  if (m.status === "pending_funding") {
    const [row] = await s.db
      .update(missions)
      .set({ status: "cancelled" })
      .where(and(eq(missions.id, m.id), eq(missions.status, "pending_funding")))
      .returning();
    return { mission: publicMission(row ?? m), cancelled: true, transactions: [] };
  }
  if (m.onchainId === null) throw new AppError("conflict", "Mission has no on-chain id yet");
  if (!txHash) {
    return {
      mission: publicMission(m),
      cancelled: false,
      chainId: s.chain.chainId,
      transactions: [
        buildCancelTransaction({ escrow: s.chain.escrowAddress, onchainId: m.onchainId }),
      ],
      next: `POST /api/missions/${m.id}/cancel with {"txHash"} once the cancelMission tx is mined`,
    };
  }
  const ev = await s.chain.getMissionCancelled(txHash);
  if (!ev) {
    throw new AppError(
      "conflict",
      "Transaction not found, not mined yet, or has no MissionCancelled event",
    );
  }
  if (ev.missionId !== m.onchainId)
    throw new AppError("conflict", "Transaction cancelled a different mission");
  await applyMissionClosed(s.db, ev.missionId, "cancelled");
  const updated = await getFunderMission(s.db, funderId, missionId);
  return {
    mission: publicMission(updated),
    cancelled: true,
    refunded: ev.refunded.toString(),
    transactions: [],
  };
}
