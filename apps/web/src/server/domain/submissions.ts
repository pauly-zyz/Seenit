import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  missions,
  or,
  personhoodAttestations,
  sql,
  submissions,
  type Database,
  type InferSelectModel,
  type users,
} from "@seenit/db";
import {
  checkCapture,
  haversineMeters,
  sha256ToBytes32,
  type CaptureMetadata,
} from "@seenit/shared";
import { getAddress, stringToHex } from "viem";

import { ChainRevertError } from "../chain/types";
import { AppError, notFound } from "../errors";
import { enqueueJob, JOB_AI_PROCESS } from "../jobs";
import type { Logger } from "../logger";
import type { Services } from "../services";
import { getFunderMission, type MissionRow, SLOT_HOLDING } from "./missions";
import { applySubmissionAccepted, applySubmissionRejected } from "./sync";

type User = InferSelectModel<typeof users>;
type SubmissionRow = InferSelectModel<typeof submissions>;

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const MAX_GPS_ACCURACY_METERS = 50;
export const MAX_BYTES = { photo: 25 * 1024 * 1024, video: 300 * 1024 * 1024 } as const;
export const CONTENT_TYPES = {
  photo: ["image/jpeg", "image/heic", "image/png"],
  video: ["video/mp4", "video/quicktime"],
} as const;

/** Highest valid personhood tier from the attestation records (expiry and revocation aware). */
export async function effectiveTier(db: Database, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ tier: sql<number | null>`max(${personhoodAttestations.tier})` })
    .from(personhoodAttestations)
    .where(
      and(
        eq(personhoodAttestations.userId, userId),
        isNull(personhoodAttestations.revokedAt),
        gt(personhoodAttestations.expiresAt, now),
      ),
    );
  return row?.tier ?? 0;
}

async function loadActiveMission(db: Database, missionId: string, now: Date) {
  const m = await db.query.missions.findFirst({ where: eq(missions.id, missionId) });
  if (!m) throw notFound("Mission");
  if (m.status !== "active" || !m.onchainId)
    throw new AppError("conflict", "Mission is not active");
  if (m.deadline <= now) throw new AppError("conflict", "Mission deadline has passed");
  return m;
}

export function publicSubmission(s: SubmissionRow) {
  return {
    id: s.id,
    missionId: s.missionId,
    status: s.status,
    mediaType: s.mediaType,
    mediaHash: s.mediaHash,
    capturedAt: s.capturedAt,
    rejectionReasons: s.rejectionReasons,
    onchainId: s.onchainId,
    recordTxHash: s.recordTxHash,
    resolveTxHash: s.resolveTxHash,
    reviewDeadline: s.reviewDeadline,
    createdAt: s.createdAt,
  };
}

// ------------------------------------------------------------------------------------------------
// Upload URL
// ------------------------------------------------------------------------------------------------

export interface UploadUrlInput {
  missionId: string;
  mediaType: "photo" | "video";
  contentType: string;
  contentLength: number;
  gps: { lat: number; lng: number; accuracyMeters: number };
}

/**
 * Issues a short-lived signed PUT URL, only if the contributor is inside the mission radius
 * right now, has the required tier, and the mission still has a free slot.
 */
export async function issueUploadUrl(s: Services, user: User, input: UploadUrlInput, now: Date) {
  const mission = await loadActiveMission(s.db, input.missionId, now);

  if (input.mediaType !== mission.mediaType) {
    throw new AppError("bad_request", `This mission needs a ${mission.mediaType}`);
  }
  if (!(CONTENT_TYPES[input.mediaType] as readonly string[]).includes(input.contentType)) {
    throw new AppError("bad_request", `Unsupported content type for ${input.mediaType}`);
  }
  if (input.contentLength > MAX_BYTES[input.mediaType]) {
    throw new AppError("bad_request", "File is too large");
  }

  const tier = await effectiveTier(s.db, user.id, now);
  if (tier < mission.minTier) {
    throw new AppError("forbidden", `This mission needs personhood tier ${mission.minTier}`, {
      requiredTier: mission.minTier,
      yourTier: tier,
    });
  }
  if (input.gps.accuracyMeters > MAX_GPS_ACCURACY_METERS) {
    throw new AppError("forbidden", "GPS accuracy is too low, move to open sky and retry", {
      maxAccuracyMeters: MAX_GPS_ACCURACY_METERS,
    });
  }
  const distance = haversineMeters({ lat: mission.lat, lng: mission.lng }, input.gps);
  if (distance > mission.radiusMeters) {
    throw new AppError("forbidden", "You are outside the mission area", {
      distanceMeters: Math.round(distance),
      radiusMeters: mission.radiusMeters,
    });
  }

  const existing = await s.db.query.submissions.findFirst({
    where: and(eq(submissions.missionId, mission.id), eq(submissions.contributorId, user.id)),
  });
  const retryable = ["awaiting_upload", "rejected_precheck", "chain_failed"];
  if (existing && !retryable.includes(existing.status)) {
    throw new AppError("conflict", "You already submitted to this mission");
  }

  // Slots: on-chain holders plus recent upload reservations from other contributors.
  const recent = new Date(now.getTime() - UPLOAD_URL_TTL_SECONDS * 1000 * 1.5);
  const [{ taken } = { taken: 0 }] = await s.db
    .select({ taken: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.missionId, mission.id),
        sql`${submissions.contributorId} <> ${user.id}`,
        or(
          inArray(submissions.status, [...SLOT_HOLDING]),
          and(eq(submissions.status, "awaiting_upload"), gt(submissions.updatedAt, recent)),
        ),
      ),
    );
  if (taken >= mission.maxCaptures) throw new AppError("conflict", "Mission is full");

  let row: SubmissionRow;
  if (existing) {
    [row] = (await s.db
      .update(submissions)
      .set({
        status: "awaiting_upload",
        mediaType: input.mediaType,
        mediaHash: null,
        rejectionReasons: null,
        lat: input.gps.lat,
        lng: input.gps.lng,
        gpsAccuracyMeters: input.gps.accuracyMeters,
        updatedAt: now,
      })
      .where(eq(submissions.id, existing.id))
      .returning()) as [SubmissionRow];
  } else {
    const id = crypto.randomUUID();
    [row] = (await s.db
      .insert(submissions)
      .values({
        id,
        missionId: mission.id,
        contributorId: user.id,
        mediaKey: `submissions/${mission.id}/${id}/original`,
        mediaType: input.mediaType,
        lat: input.gps.lat,
        lng: input.gps.lng,
        gpsAccuracyMeters: input.gps.accuracyMeters,
        updatedAt: now,
      })
      .returning()) as [SubmissionRow];
  }

  const upload = await s.storage.presignUpload(row.mediaKey, {
    contentType: input.contentType,
    contentLength: input.contentLength,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return { submissionId: row.id, upload };
}

// ------------------------------------------------------------------------------------------------
// Finalize
// ------------------------------------------------------------------------------------------------

/**
 * Finalizes an upload: the stored file must hash to the claimed SHA-256, GPS and timestamps must
 * pass `checkCapture`, then the hash is anchored on-chain (recordSubmission) and AI work is queued.
 */
export async function finalizeSubmission(
  s: Services,
  user: User,
  input: { submissionId: string; capture: CaptureMetadata },
  now: Date,
  log: Logger,
) {
  const sub = await s.db.query.submissions.findFirst({
    where: and(eq(submissions.id, input.submissionId), eq(submissions.contributorId, user.id)),
  });
  if (!sub) throw notFound("Submission");
  if (sub.status !== "awaiting_upload") {
    throw new AppError("conflict", `Submission is ${sub.status}, request a new upload URL`);
  }
  if (input.capture.missionId !== sub.missionId) {
    throw new AppError("bad_request", "capture.missionId does not match the submission");
  }
  const mission = await loadActiveMission(s.db, sub.missionId, now);

  const stored = await s.storage.sha256(sub.mediaKey);
  if (!stored)
    throw new AppError("bad_request", "Upload not found, PUT the file to the upload URL first");

  const reasons: string[] = [];
  if (stored.sha256 !== input.capture.mediaSha256) reasons.push("media_hash_mismatch");
  const check = checkCapture(
    {
      mediaType: mission.mediaType,
      location: { lat: mission.lat, lng: mission.lng },
      radiusMeters: mission.radiusMeters,
      deadline: mission.deadline.toISOString(),
      maxVideoSeconds: mission.maxVideoSeconds ?? undefined,
    },
    input.capture,
    { now, maxGpsAccuracyMeters: MAX_GPS_ACCURACY_METERS },
  );
  reasons.push(...check.reasons);

  const captureFields = {
    lat: input.capture.gps.lat,
    lng: input.capture.gps.lng,
    gpsAccuracyMeters: input.capture.gps.accuracyMeters,
    capturedAt: new Date(input.capture.capturedAt),
    deviceInfo: { ...input.capture.device, gpsFixAt: input.capture.gps.fixAt },
  };

  if (reasons.length > 0) {
    await s.db
      .update(submissions)
      .set({ ...captureFields, status: "rejected_precheck", rejectionReasons: reasons })
      .where(eq(submissions.id, sub.id));
    throw new AppError("precheck_failed", "Capture failed verification", { reasons });
  }

  const duplicate = await s.db.query.submissions.findFirst({
    where: eq(submissions.mediaHash, stored.sha256),
  });
  if (duplicate) throw new AppError("conflict", "This media was already submitted");

  await s.db
    .update(submissions)
    .set({ ...captureFields, mediaHash: stored.sha256 })
    .where(eq(submissions.id, sub.id));

  let recorded;
  try {
    recorded = await s.chain.recordSubmission(
      mission.onchainId!,
      getAddress(user.wallet),
      sha256ToBytes32(stored.sha256),
    );
  } catch (err) {
    log.warn({ err, submissionId: sub.id }, "recordSubmission failed");
    await s.db
      .update(submissions)
      .set({ status: "chain_failed" })
      .where(eq(submissions.id, sub.id));
    const name = err instanceof ChainRevertError ? err.errorName : undefined;
    throw new AppError("chain_error", "Could not record the submission on-chain", {
      errorName: name,
    });
  }

  const updated = await s.db.transaction(async (tx) => {
    const [row] = await tx
      .update(submissions)
      .set({
        status: "processing",
        onchainId: recorded.submissionId,
        recordTxHash: recorded.txHash,
        reviewDeadline: new Date(Number(recorded.reviewDeadline) * 1000),
      })
      .where(and(eq(submissions.id, sub.id), eq(submissions.status, "awaiting_upload")))
      .returning();
    if (row) await enqueueJob(tx, JOB_AI_PROCESS, { submissionId: row.id });
    return row;
  });
  // If the indexer got there first the row is already processing; return the current state.
  return publicSubmission(
    updated ?? (await s.db.query.submissions.findFirst({ where: eq(submissions.id, sub.id) }))!,
  );
}

// ------------------------------------------------------------------------------------------------
// Accept / reject (funder)
// ------------------------------------------------------------------------------------------------

async function loadFunderSubmission(db: Database, funderId: string, submissionId: string) {
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!sub) throw notFound("Submission");
  await getFunderMission(db, funderId, sub.missionId); // 404 if not the funder's mission
  return sub;
}

function mapResolveError(err: unknown): never {
  if (err instanceof ChainRevertError) {
    if (err.errorName === "NotPending")
      throw new AppError("conflict", "Submission was already resolved");
    if (err.errorName === "ReviewWindowOver")
      throw new AppError("conflict", "Review window is over");
    if (err.errorName === "EnforcedPause") throw new AppError("conflict", "Escrow is paused");
    throw new AppError("chain_error", "Transaction failed", { errorName: err.errorName });
  }
  throw new AppError("chain_error", "Transaction failed");
}

export async function acceptSubmission(s: Services, funderId: string, submissionId: string) {
  const sub = await loadFunderSubmission(s.db, funderId, submissionId);
  if (!["processing", "ready"].includes(sub.status) || sub.onchainId === null) {
    throw new AppError("conflict", `Submission is ${sub.status} and cannot be accepted`);
  }
  let res;
  try {
    res = await s.chain.acceptSubmission(sub.onchainId);
  } catch (err) {
    mapResolveError(err);
  }
  await applySubmissionAccepted(s.db, {
    submissionId: sub.onchainId,
    payout: res.payout,
    fee: res.fee,
    finalized: false,
    txHash: res.txHash,
  });
  const updated = await s.db.query.submissions.findFirst({ where: eq(submissions.id, sub.id) });
  return {
    submission: publicSubmission(updated!),
    payout: { amount: res.payout, fee: res.fee, txHash: res.txHash },
  };
}

export async function rejectSubmission(
  s: Services,
  funderId: string,
  submissionId: string,
  reason: string,
  now: Date,
) {
  const sub = await loadFunderSubmission(s.db, funderId, submissionId);
  if (!["processing", "ready"].includes(sub.status) || sub.onchainId === null) {
    throw new AppError("conflict", `Submission is ${sub.status} and cannot be rejected`);
  }
  if (sub.reviewDeadline && sub.reviewDeadline < now) {
    throw new AppError(
      "conflict",
      "Review window is over; the submission will be paid on finalize",
    );
  }
  let res;
  try {
    res = await s.chain.rejectSubmission(sub.onchainId, stringToHex(reason, { size: 32 }));
  } catch (err) {
    mapResolveError(err);
  }
  await applySubmissionRejected(s.db, { submissionId: sub.onchainId, reason, txHash: res.txHash });
  const updated = await s.db.query.submissions.findFirst({ where: eq(submissions.id, sub.id) });
  return { submission: publicSubmission(updated!) };
}

// ------------------------------------------------------------------------------------------------
// Results (funder)
// ------------------------------------------------------------------------------------------------

export const RESULT_URL_TTL_SECONDS = 15 * 60;

/**
 * Accepted answers with proof. Media is only ever the blurred copy; the original key never
 * leaves the server.
 */
export async function getResults(s: Services, funderId: string, missionId: string) {
  const mission: MissionRow = await getFunderMission(s.db, funderId, missionId);
  const rows = await s.db.query.submissions.findMany({
    where: and(eq(submissions.missionId, mission.id), eq(submissions.status, "accepted")),
    orderBy: (t, { asc }) => [asc(t.capturedAt)],
  });

  const results = await Promise.all(
    rows.map(async (r) => ({
      submissionId: r.id,
      capturedAt: r.capturedAt,
      answer: r.aiResult,
      confidence: r.aiConfidence,
      media: r.blurredMediaKey
        ? {
            type: r.mediaType,
            ...(await s.storage.presignDownload(r.blurredMediaKey, RESULT_URL_TTL_SECONDS)),
          }
        : null,
      proof: {
        mediaSha256: r.mediaHash,
        onchainSubmissionId: r.onchainId,
        recordTxHash: r.recordTxHash,
        acceptTxHash: r.resolveTxHash,
      },
    })),
  );

  return {
    mission: {
      id: mission.id,
      title: mission.title,
      status: mission.status,
      maxCaptures: mission.maxCaptures,
    },
    results,
  };
}
