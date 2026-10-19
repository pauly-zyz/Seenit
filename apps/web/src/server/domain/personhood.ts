import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  missions,
  personhoodAttestations,
  sql,
  users,
  verificationSessions,
  type Database,
  type InferSelectModel,
} from "@seenit/db";
import {
  describeTierAccess,
  PERSONHOOD_PROVIDER_IDS,
  type PersonhoodProviderId,
} from "@seenit/shared";
import { getAddress, keccak256, stringToBytes, type Hex } from "viem";

import { ChainRevertError } from "../chain/types";
import { AppError, notFound } from "../errors";
import type { Logger } from "../logger";
import {
  PersonhoodProviderError,
  type PersonhoodProvider,
  type VerifiedIdentity,
} from "../personhood";
import type { Services } from "../services";

type User = InferSelectModel<typeof users>;
type Attestation = InferSelectModel<typeof personhoodAttestations>;

export const SESSION_TTL_MS = 15 * 60 * 1000;

/** On-chain / stored identifier: keccak256 of the provider-scoped nullifier. Raw value is never kept. */
export function nullifierHash(providerId: PersonhoodProviderId, nullifier: string): Hex {
  return keccak256(stringToBytes(`seenit:${providerId}:${nullifier}`));
}

function getProvider(s: Services, id: string): PersonhoodProvider {
  if (!(PERSONHOOD_PROVIDER_IDS as readonly string[]).includes(id)) throw notFound("Provider");
  const p = s.personhood.get(id as PersonhoodProviderId);
  if (!p || !s.registry) throw new AppError("not_found", `${id} verification is not enabled`);
  return p;
}

/** Highest tier from attestations that are on-chain, unexpired and not revoked. */
export async function effectiveTier(db: Database, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ tier: sql<number | null>`max(${personhoodAttestations.tier})` })
    .from(personhoodAttestations)
    .where(
      and(
        eq(personhoodAttestations.userId, userId),
        isNull(personhoodAttestations.revokedAt),
        isNotNull(personhoodAttestations.txHash),
        gt(personhoodAttestations.expiresAt, now),
      ),
    );
  return row?.tier ?? 0;
}

// ------------------------------------------------------------------------------------------------
// Recording a verified identity (shared by every provider)
// ------------------------------------------------------------------------------------------------

/**
 * Binds a verified identity to the user: anti-Sybil checks, store the hash only, attest on-chain.
 * Re-verifying with the same identity renews the attestation.
 */
export async function recordVerification(
  s: Services,
  user: User,
  provider: PersonhoodProvider,
  identity: VerifiedIdentity,
  now: Date,
  log: Logger,
): Promise<Attestation> {
  if (identity.wallet.toLowerCase() !== user.wallet) {
    throw new AppError("forbidden", "Proof is bound to a different wallet", {
      reason: "wallet_mismatch",
    });
  }
  const hash = nullifierHash(provider.id, identity.nullifier);

  const holder = await s.db.query.personhoodAttestations.findFirst({
    where: eq(personhoodAttestations.nullifierHash, hash),
  });
  if (holder && holder.userId !== user.id) {
    log.warn(
      { userId: user.id, provider: provider.id, reason: "nullifier_in_use" },
      "personhood rejected",
    );
    throw new AppError("conflict", "This identity is already linked to another account", {
      reason: "nullifier_in_use",
    });
  }
  const current = await s.db.query.personhoodAttestations.findFirst({
    where: and(
      eq(personhoodAttestations.userId, user.id),
      eq(personhoodAttestations.provider, provider.id),
    ),
  });
  if (current && current.nullifierHash !== hash) {
    throw new AppError(
      "conflict",
      `This account is already verified with a different ${provider.displayName} identity`,
      {
        reason: "different_identity",
      },
    );
  }
  if (current?.revokedAt) {
    throw new AppError("forbidden", "This verification was revoked", { reason: "revoked" });
  }

  const values = {
    userId: user.id,
    provider: provider.id,
    tier: provider.tier,
    nullifierHash: hash,
    expiresAt: identity.expiresAt,
    verifiedAt: now,
    result: identity.summary,
    txHash: null,
  };
  let row: Attestation;
  try {
    [row] = (await s.db
      .insert(personhoodAttestations)
      .values(values)
      .onConflictDoUpdate({
        target: [personhoodAttestations.userId, personhoodAttestations.provider],
        set: { expiresAt: values.expiresAt, verifiedAt: now, result: values.result, txHash: null },
      })
      .returning()) as [Attestation];
  } catch {
    // Unique index on nullifier_hash lost a race with another account.
    throw new AppError("conflict", "This identity is already linked to another account", {
      reason: "nullifier_in_use",
    });
  }

  let txHash: Hex;
  try {
    ({ txHash } = await s.registry!.attest(
      getAddress(user.wallet),
      provider.onchainProvider,
      hash,
      BigInt(Math.floor(identity.expiresAt.getTime() / 1000)),
    ));
  } catch (err) {
    const name = err instanceof ChainRevertError ? err.errorName : undefined;
    log.warn({ userId: user.id, provider: provider.id, errorName: name }, "attest failed");
    if (name === "NullifierBoundToOtherWallet" || name === "ProviderHasDifferentNullifier") {
      await s.db.delete(personhoodAttestations).where(eq(personhoodAttestations.id, row.id));
      throw new AppError("conflict", "This identity is already linked to another account", {
        reason: "nullifier_in_use",
      });
    }
    if (name === "AttestationRevoked") {
      await s.db
        .update(personhoodAttestations)
        .set({ revokedAt: now })
        .where(eq(personhoodAttestations.id, row.id));
      throw new AppError("forbidden", "This verification was revoked", { reason: "revoked" });
    }
    throw new AppError(
      "chain_error",
      "Verified, but writing the attestation on-chain failed. Try again.",
      {
        reason: "attest_failed",
        errorName: name,
      },
    );
  }

  [row] = (await s.db
    .update(personhoodAttestations)
    .set({ txHash })
    .where(eq(personhoodAttestations.id, row.id))
    .returning()) as [Attestation];
  const tier = await effectiveTier(s.db, user.id, now);
  await s.db.update(users).set({ tier }).where(eq(users.id, user.id));
  log.info({ userId: user.id, provider: provider.id, tier }, "personhood verified");
  return row;
}

// ------------------------------------------------------------------------------------------------
// Start / callback / session
// ------------------------------------------------------------------------------------------------

function publicAttestation(a: Attestation, now: Date) {
  const state = a.revokedAt
    ? "revoked"
    : !a.txHash
      ? "pending_onchain"
      : a.expiresAt <= now
        ? "expired"
        : "active";
  return {
    provider: a.provider,
    tier: a.tier,
    state,
    verifiedAt: a.verifiedAt,
    expiresAt: a.expiresAt,
    txHash: a.txHash,
    result: a.result,
  };
}

export async function startVerification(
  s: Services,
  user: User,
  providerId: string,
  now: Date,
  log: Logger,
) {
  const provider = getProvider(s, providerId);

  // One live session per user + provider.
  await s.db
    .update(verificationSessions)
    .set({ status: "expired", completedAt: now })
    .where(
      and(
        eq(verificationSessions.userId, user.id),
        eq(verificationSessions.provider, provider.id),
        eq(verificationSessions.status, "pending"),
      ),
    );
  const [session] = await s.db
    .insert(verificationSessions)
    .values({
      userId: user.id,
      provider: provider.id,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();

  const finish = (status: "verified" | "failed", error?: string) =>
    s.db
      .update(verificationSessions)
      .set({ status, error: error ?? null, completedAt: now })
      .where(eq(verificationSessions.id, session!.id));

  let result;
  try {
    result = await provider.start({ wallet: getAddress(user.wallet), sessionId: session!.id, now });
  } catch (err) {
    if (err instanceof PersonhoodProviderError) {
      await finish("failed", err.reason);
      throw new AppError(err.unavailable ? "upstream_error" : "bad_request", err.message, {
        reason: err.reason,
      });
    }
    throw err;
  }

  if (result.kind === "redirect") {
    return {
      status: "pending" as const,
      sessionId: session!.id,
      url: result.url,
      expiresAt: session!.expiresAt,
    };
  }
  if (result.kind === "not_eligible") {
    await finish("failed", result.reason);
    throw new AppError("precheck_failed", "Not eligible yet", {
      reason: result.reason,
      ...result.details,
    });
  }
  try {
    const attestation = await recordVerification(s, user, provider, result.identity, now, log);
    await finish("verified");
    return {
      status: "verified" as const,
      sessionId: session!.id,
      attestation: publicAttestation(attestation, now),
      tier: await effectiveTier(s.db, user.id, now),
    };
  } catch (err) {
    await finish(
      "failed",
      err instanceof AppError ? String((err.details as { reason?: string })?.reason) : "error",
    );
    throw err;
  }
}

/**
 * Callback from a redirect-flow provider (no user session: the provider calls us).
 * Always answers in the provider's expected format.
 */
export async function handleCallback(
  s: Services,
  providerId: string,
  payload: unknown,
  now: Date,
  log: Logger,
) {
  const provider = getProvider(s, providerId);
  if (!provider.handleCallback || !provider.callbackResponse) throw notFound("Callback");
  const respond = (ok: boolean, reason?: string) => ({
    ok,
    body: provider.callbackResponse!(ok, reason),
  });

  let identity: VerifiedIdentity;
  try {
    identity = await provider.handleCallback(payload, now);
  } catch (err) {
    const reason = err instanceof PersonhoodProviderError ? err.reason : "invalid_proof";
    log.info({ provider: provider.id, reason }, "personhood callback rejected");
    return respond(false, reason);
  }

  const user = await s.db.query.users.findFirst({ where: eq(users.wallet, identity.wallet) });
  if (!user) return respond(false, "unknown_wallet");
  const session = await s.db.query.verificationSessions.findFirst({
    where: and(
      eq(verificationSessions.userId, user.id),
      eq(verificationSessions.provider, provider.id),
      eq(verificationSessions.status, "pending"),
      gt(verificationSessions.expiresAt, now),
    ),
    orderBy: desc(verificationSessions.createdAt),
  });
  if (!session) return respond(false, "no_pending_session");

  try {
    await recordVerification(s, user, provider, identity, now, log);
    await s.db
      .update(verificationSessions)
      .set({ status: "verified", completedAt: now })
      .where(eq(verificationSessions.id, session.id));
    return respond(true);
  } catch (err) {
    const reason =
      err instanceof AppError
        ? ((err.details as { reason?: string })?.reason ?? err.code)
        : "internal_error";
    await s.db
      .update(verificationSessions)
      .set({ status: "failed", error: reason, completedAt: now })
      .where(eq(verificationSessions.id, session.id));
    if (!(err instanceof AppError)) log.error({ err }, "personhood callback failed");
    return respond(false, reason);
  }
}

export async function getSession(s: Services, user: User, id: string, now: Date) {
  const session = await s.db.query.verificationSessions.findFirst({
    where: and(eq(verificationSessions.id, id), eq(verificationSessions.userId, user.id)),
  });
  if (!session) throw notFound("Session");
  const status =
    session.status === "pending" && session.expiresAt <= now ? "expired" : session.status;
  return {
    id: session.id,
    provider: session.provider,
    status,
    error: session.error,
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
    tier: await effectiveTier(s.db, user.id, now),
  };
}

// ------------------------------------------------------------------------------------------------
// Status page data
// ------------------------------------------------------------------------------------------------

export async function getPersonhoodStatus(s: Services, user: User, now: Date) {
  const tier = await effectiveTier(s.db, user.id, now);
  const attestations = await s.db.query.personhoodAttestations.findMany({
    where: eq(personhoodAttestations.userId, user.id),
  });

  const counts = await s.db
    .select({ minTier: missions.minTier, n: sql<number>`count(*)::int` })
    .from(missions)
    .where(
      and(
        eq(missions.status, "active"),
        gt(missions.deadline, now),
        inArray(missions.minTier, [1, 2]),
      ),
    )
    .groupBy(missions.minTier);
  const byTier = Object.fromEntries(counts.map((c) => [c.minTier, c.n])) as Record<number, number>;
  const tier1 = byTier[1] ?? 0;
  const tier2 = byTier[2] ?? 0;

  return {
    wallet: user.wallet,
    tier,
    attestations: attestations.map((a) => publicAttestation(a, now)),
    tiers: describeTierAccess(tier, {
      tier1MaxReward: s.config.tier1MaxReward,
      decimals: s.config.tokenDecimals,
      symbol: s.config.tokenSymbol,
    }).map((t) => ({
      ...t,
      provider: [...s.personhood.values()].find((p) => p.tier === t.tier)?.id ?? null,
      activeMissions: t.tier === 1 ? tier1 : tier1 + tier2,
    })),
    missionsOpenToYou: tier >= 2 ? tier1 + tier2 : tier >= 1 ? tier1 : 0,
    providers: [...s.personhood.values()].map((p) => ({
      id: p.id,
      name: p.displayName,
      tier: p.tier,
      flow: p.flow,
    })),
  };
}
