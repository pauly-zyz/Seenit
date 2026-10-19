import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  gt,
  inArray,
  missions,
  sql,
  submissions,
  type Database,
  type InferSelectModel,
} from "@seenit/db";
import { canonicalJson, requiredTier, type MissionSpec } from "@seenit/shared";
import { keccak256, stringToBytes, type Hex } from "viem";

import { buildFundingTransactions } from "../chain/funding";
import { AppError, notFound } from "../errors";
import type { Services } from "../services";
import { applyMissionCreated } from "./sync";

export type MissionRow = InferSelectModel<typeof missions>;

/** Submissions that hold (or are about to hold) a slot. */
export const SLOT_HOLDING = ["processing", "ready", "accepted"] as const;

/** Spec hash anchored on-chain. Including the mission id makes it unique per mission. */
export function computeSpecHash(id: string, spec: MissionSpec): Hex {
  return keccak256(stringToBytes(canonicalJson({ ...spec, id })));
}

export function publicMission(m: MissionRow, extra: Record<string, unknown> = {}) {
  return {
    id: m.id,
    title: m.title,
    instructions: m.instructions,
    mediaType: m.mediaType,
    maxVideoSeconds: m.maxVideoSeconds,
    location: { lat: m.lat, lng: m.lng },
    radiusMeters: m.radiusMeters,
    reward: m.reward,
    maxCaptures: m.maxCaptures,
    minTier: m.minTier,
    deadline: m.deadline,
    status: m.status,
    outputSchema: m.outputSchema,
    specHash: m.specHash,
    onchainId: m.onchainId,
    chainTxHash: m.chainTxHash,
    createdAt: m.createdAt,
    ...extra,
  };
}

const MIN_LEAD_MS = 10 * 60 * 1000;
const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;

export async function createMission(
  s: Services,
  funder: { id: string },
  spec: MissionSpec,
  now: Date,
) {
  const deadline = new Date(spec.deadline);
  if (deadline.getTime() < now.getTime() + MIN_LEAD_MS) {
    throw new AppError("validation_failed", "deadline must be at least 10 minutes from now");
  }
  if (deadline.getTime() > now.getTime() + MAX_LEAD_MS) {
    throw new AppError("validation_failed", "deadline must be within 90 days");
  }

  const id = randomUUID();
  const reward = BigInt(spec.rewardPerSubmission);
  const minTier = requiredTier(reward, s.config.tier1MaxReward, spec.minTier);
  const specHash = computeSpecHash(id, spec);

  const [mission] = await s.db
    .insert(missions)
    .values({
      id,
      funderId: funder.id,
      title: spec.title,
      instructions: spec.instructions,
      mediaType: spec.mediaType,
      maxVideoSeconds: spec.maxVideoSeconds ?? null,
      lat: spec.location.lat,
      lng: spec.location.lng,
      radiusMeters: spec.radiusMeters,
      reward: reward.toString(),
      maxCaptures: spec.maxSubmissions,
      minTier,
      deadline,
      outputSchema: spec.outputSchema,
      specHash: specHash.toLowerCase(),
    })
    .returning();

  const funding = buildFundingTransactions({
    escrow: s.chain.escrowAddress,
    token: s.chain.tokenAddress,
    rewardPerCapture: reward,
    maxCaptures: spec.maxSubmissions,
    deadline: BigInt(Math.floor(deadline.getTime() / 1000)),
    minTier,
    specHash,
  });

  return {
    mission: publicMission(mission!),
    funding: {
      chainId: s.chain.chainId,
      escrow: s.chain.escrowAddress,
      token: s.chain.tokenAddress,
      total: funding.total,
      transactions: funding.transactions,
      next: `POST /api/missions/${id}/confirm with the createMission txHash once it is mined`,
    },
  };
}

export async function getFunderMission(db: Database, funderId: string, missionId: string) {
  const m = await db.query.missions.findFirst({
    where: and(eq(missions.id, missionId), eq(missions.funderId, funderId)),
  });
  if (!m) throw notFound("Mission");
  return m;
}

/** Links a mined createMission tx to the mission (fast path; the indexer does the same later). */
export async function confirmFunding(
  s: Services,
  funderId: string,
  missionId: string,
  txHash: Hex,
) {
  const mission = await getFunderMission(s.db, funderId, missionId);
  if (mission.status !== "pending_funding") return publicMission(mission);

  const ev = await s.chain.getMissionCreated(txHash);
  if (!ev)
    throw new AppError(
      "conflict",
      "Transaction not found, not mined yet, or has no MissionCreated event",
    );
  if (ev.specHash.toLowerCase() !== mission.specHash) {
    throw new AppError("conflict", "Transaction created a different mission (spec hash mismatch)");
  }
  const updated = await applyMissionCreated(s.db, ev);
  return publicMission(updated ?? (await getFunderMission(s.db, funderId, missionId)));
}

/** Active missions near a point, closest first, with free slots only. */
export async function findNearby(
  db: Database,
  q: { lat: number; lng: number; radiusKm: number; limit: number },
  now: Date,
) {
  const radiusM = q.radiusKm * 1000;
  const dLat = q.radiusKm / 111.32;
  const cosLat = Math.max(Math.cos((q.lat * Math.PI) / 180), 0.01);
  const dLng = Math.min(q.radiusKm / (111.32 * cosLat), 180);

  // Haversine in SQL, after a cheap bounding-box filter that can use missions_geo_idx.
  const distance = sql<number>`(2 * 6371008.8 * asin(least(1, sqrt(
      power(sin(radians(${missions.lat} - ${q.lat}) / 2), 2) +
      cos(radians(${q.lat})) * cos(radians(${missions.lat})) *
      power(sin(radians(${missions.lng} - ${q.lng}) / 2), 2)))))`;
  const taken = sql<number>`(select count(*)::int from ${submissions}
      where ${submissions.missionId} = ${missions.id}
      and ${inArray(submissions.status, [...SLOT_HOLDING])})`;

  const rows = await db
    .select({ mission: missions, distance, taken })
    .from(missions)
    .where(
      and(
        eq(missions.status, "active"),
        gt(missions.deadline, now),
        sql`${missions.lat} between ${q.lat - dLat} and ${q.lat + dLat}`,
        sql`${missions.lng} between ${q.lng - dLng} and ${q.lng + dLng}`,
        sql`${distance} <= ${radiusM}`,
        sql`${taken} < ${missions.maxCaptures}`,
      ),
    )
    .orderBy(distance)
    .limit(q.limit);

  return rows.map((r) => ({
    ...publicMission(r.mission),
    distanceMeters: Math.round(r.distance),
    withinMissionRadius: r.distance <= r.mission.radiusMeters,
    slotsLeft: r.mission.maxCaptures - r.taken,
  }));
}
