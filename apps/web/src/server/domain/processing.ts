import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  and,
  eq,
  funders,
  isNull,
  missions,
  sql,
  submissions,
  type Database,
  type InferSelectModel,
} from "@seenit/db";
import { dropNullOptionals } from "@seenit/shared";
import { z } from "zod";

import { enqueueJob, JOB_PURGE_ORIGINAL, JOB_WEBHOOK } from "../jobs";
import { UnreadableMediaError, type Frame, type FrameQuality } from "../processing/media";
import type { WorkerServices } from "../processing/services";
import type { PrivacyRegion, VisionOutcome } from "../processing/vision";
import { signWebhook, webhookSecretContext } from "../processing/webhooks";

type SubmissionRow = InferSelectModel<typeof submissions>;
type MissionRow = InferSelectModel<typeof missions>;

/** Why a submission needs a human look. */
export type ReviewReason =
  | "low_confidence"
  | "no_answer"
  | "answer_invalid"
  | "not_relevant"
  | "blurry"
  | "too_dark"
  | "screen_capture"
  | "video_too_long"
  | "unreadable_media"
  | "media_hash_mismatch"
  | "privacy_check_unavailable"
  | "ai_refused"
  | "processing_failed";

/** Stored in `submissions.ai_result`. Funders see it; it never contains the original media. */
export interface AiResult {
  answer: unknown;
  confidence: number | null;
  reasoning: string | null;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  quality: {
    relevant: boolean | null;
    blurry: boolean;
    tooDark: boolean;
    screenCapture: boolean;
    notes: string | null;
    frames: { index: number; atSeconds: number | null; meanLuma: number; sharpness: number }[];
  };
  privacy: { faces: number; licensePlates: number; checked: boolean };
  media: { frames: number; durationSeconds: number | null };
  model: string | null;
  processedAt: string;
}

/** Statuses still waiting for (or already past) a funder decision that get AI processing. */
const ANALYZE_STATUSES = new Set(["processing", "ready", "needs_review", "accepted"]);

export const blurredFrameKey = (submissionId: string, index: number) =>
  `blurred/${submissionId}/frame-${index}.jpg`;
export const archiveKey = (submissionId: string) => `disputes/${submissionId}.enc`;
export const archiveContext = (submissionId: string) => `submission:${submissionId}`;

/**
 * Turns one recorded submission into a funder-ready result:
 *  1. fetch the original and check it against the on-chain hash
 *  2. key frames (video) or the photo, normalized and stripped of metadata
 *  3. faces/plates detected and blurred; only blurred frames are stored for the funder
 *  4. Claude extracts the mission's answer from the blurred frames (structured output + Zod)
 *  5. quality checks → ready or needs_review
 *  6. original encrypted into the dispute archive (deleted after the retention period), the
 *     plaintext upload is deleted, and the funder's webhook is queued
 * Idempotent: a processed submission is skipped; a retry reuses the archive if the plaintext is gone.
 */
export async function processSubmission(ws: WorkerServices, submissionId: string) {
  const row = await ws.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!row) return { outcome: "missing" as const };
  if (row.processedAt) return { outcome: "already_processed" as const };
  const mission = await ws.db.query.missions.findFirst({ where: eq(missions.id, row.missionId) });
  if (!mission) return { outcome: "missing" as const };

  const dir = await mkdtemp(join(ws.tmpDir, "seenit-"));
  try {
    const original = join(dir, "original");
    if (!(await fetchOriginal(ws, row, original, dir))) {
      await finish(
        ws,
        row,
        mission,
        failedResult(ws, ["unreadable_media"], "Original media is missing"),
        [],
        null,
      );
      return { outcome: "missing_media" as const };
    }
    const hashOk = row.mediaHash !== null && (await sha256File(original)) === row.mediaHash;

    if (!ANALYZE_STATUSES.has(row.status)) {
      // Rejected (or otherwise closed) before processing: keep only the encrypted original for disputes.
      const archived = await archiveOriginal(ws, row, original, dir);
      await finish(ws, row, mission, null, [], archived);
      return { outcome: "archived_only" as const };
    }

    const result = await analyze(ws, row, mission, original, hashOk);
    const archived = await archiveOriginal(ws, row, original, dir);
    await finish(ws, row, mission, result.ai, result.frameKeys, archived);
    return {
      outcome: result.ai.needsReview ? ("needs_review" as const) : ("ready" as const),
      result: result.ai,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function analyze(
  ws: WorkerServices,
  row: SubmissionRow,
  mission: MissionRow,
  original: string,
  hashOk: boolean,
) {
  const reasons = new Set<ReviewReason>();
  if (!hashOk) reasons.add("media_hash_mismatch");

  let frames: Frame[];
  let durationSeconds: number | null;
  try {
    ({ frames, durationSeconds } = await ws.media.extract(original, row.mediaType));
  } catch (err) {
    if (!(err instanceof UnreadableMediaError)) throw err;
    ws.logger.warn({ submissionId: row.id, err: err.message }, "unreadable media");
    return { ai: failedResult(ws, [...reasons, "unreadable_media"], err.message), frameKeys: [] };
  }
  if (
    row.mediaType === "video" &&
    mission.maxVideoSeconds &&
    durationSeconds !== null &&
    durationSeconds > mission.maxVideoSeconds + ws.processing.videoOverrunSeconds
  ) {
    reasons.add("video_too_long");
  }

  const metrics: FrameQuality[] = [];
  for (const f of frames) metrics.push(await ws.media.measure(f.jpeg));

  // Privacy first: nothing leaves this function unblurred. If detection is unavailable we fail
  // closed: no frames are stored for the funder and nothing is sent for analysis.
  const regions = await ws.privacy.detect(
    frames.map((f) => ({ jpeg: f.jpeg, atSeconds: f.atSeconds })),
  );
  const frameKeys: string[] = [];
  let outcome: VisionOutcome | null = null;
  if (regions === null) {
    reasons.add("privacy_check_unavailable");
  } else {
    const blurred: Frame[] = [];
    for (const f of frames) {
      const boxes = regions.filter((r) => r.frame === f.index).map((r) => r.box);
      blurred.push({ ...f, jpeg: await ws.media.redact(f.jpeg, boxes) });
    }
    for (const f of blurred) {
      const key = blurredFrameKey(row.id, f.index);
      await ws.storage.upload(key, f.jpeg, "image/jpeg");
      frameKeys.push(key);
    }
    outcome = await ws.vision.analyze({
      mission: {
        title: mission.title,
        instructions: mission.instructions,
        mediaType: mission.mediaType,
        outputSchema: mission.outputSchema,
      },
      frames: blurred.map((f) => ({ jpeg: f.jpeg, atSeconds: f.atSeconds })),
    });
  }

  const majority = (flags: boolean[]) =>
    flags.filter(Boolean).length * 2 >= flags.length && flags.length > 0;
  const metricBlurry = majority(metrics.map((m) => m.blurry));
  const metricDark = majority(metrics.map((m) => m.dark));

  let answer: unknown = null;
  let confidence: number | null = null;
  let reasoning: string | null = null;
  let model: string | null = null;
  let modelQuality: {
    relevant: boolean | null;
    blurry: boolean;
    tooDark: boolean;
    screenCapture: boolean;
    notes: string | null;
  } = {
    relevant: null,
    blurry: false,
    tooDark: false,
    screenCapture: false,
    notes: null,
  };

  if (outcome?.kind === "refused") {
    reasons.add("ai_refused");
    model = outcome.model;
  } else if (outcome?.kind === "answer") {
    model = outcome.model;
    confidence = outcome.confidence;
    reasoning = outcome.reasoning;
    modelQuality = {
      relevant: outcome.quality.relevant,
      blurry: outcome.quality.blurry,
      tooDark: outcome.quality.too_dark,
      screenCapture: outcome.quality.screen_capture,
      notes: outcome.quality.notes || null,
    };
    if (outcome.answer === null) {
      reasons.add("no_answer");
    } else {
      answer = dropNullOptionals(mission.outputSchema, outcome.answer);
      if (!validateAnswer(mission.outputSchema, answer)) reasons.add("answer_invalid");
    }
    if (outcome.confidence < ws.processing.reviewConfidence) reasons.add("low_confidence");
    if (!outcome.quality.relevant) reasons.add("not_relevant");
    if (outcome.quality.screen_capture) reasons.add("screen_capture");
  }
  const blurry = metricBlurry || modelQuality.blurry;
  const tooDark = metricDark || modelQuality.tooDark;
  if (blurry) reasons.add("blurry");
  if (tooDark) reasons.add("too_dark");

  const reviewReasons = [...reasons];
  const ai: AiResult = {
    answer,
    confidence,
    reasoning,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    quality: {
      relevant: modelQuality.relevant,
      blurry,
      tooDark,
      screenCapture: modelQuality.screenCapture,
      notes: modelQuality.notes,
      frames: frames.map((f, i) => ({
        index: f.index,
        atSeconds: f.atSeconds,
        meanLuma: metrics[i]!.meanLuma,
        sharpness: metrics[i]!.sharpness,
      })),
    },
    privacy: countRegions(regions),
    media: { frames: frames.length, durationSeconds },
    model,
    processedAt: ws.now().toISOString(),
  };
  return { ai, frameKeys };
}

function countRegions(regions: PrivacyRegion[] | null) {
  return {
    faces: regions?.filter((r) => r.kind === "face").length ?? 0,
    licensePlates: regions?.filter((r) => r.kind === "license_plate").length ?? 0,
    checked: regions !== null,
  };
}

/** Checks the answer against the funder's original schema (including constraints the model can't enforce). */
export function validateAnswer(outputSchema: Record<string, unknown>, answer: unknown): boolean {
  try {
    return z
      .fromJSONSchema(outputSchema as Parameters<typeof z.fromJSONSchema>[0])
      .safeParse(answer).success;
  } catch {
    return false;
  }
}

function failedResult(ws: WorkerServices, reasons: ReviewReason[], note: string): AiResult {
  return {
    answer: null,
    confidence: null,
    reasoning: null,
    needsReview: true,
    reviewReasons: [...new Set(reasons)],
    quality: {
      relevant: null,
      blurry: false,
      tooDark: false,
      screenCapture: false,
      notes: note.slice(0, 500),
      frames: [],
    },
    privacy: { faces: 0, licensePlates: 0, checked: false },
    media: { frames: 0, durationSeconds: null },
    model: null,
    processedAt: ws.now().toISOString(),
  };
}

/** Plain upload if still there, else the encrypted archive from an earlier attempt. */
async function fetchOriginal(ws: WorkerServices, row: SubmissionRow, dest: string, dir: string) {
  if (await ws.storage.download(row.mediaKey, dest)) return true;
  // An earlier attempt may have archived it (and deleted the plaintext) before failing.
  const enc = join(dir, "archive.enc");
  if (!(await ws.storage.download(row.originalArchiveKey ?? archiveKey(row.id), enc))) return false;
  await ws.cipher.decryptFile(enc, dest, archiveContext(row.id));
  return true;
}

/** Encrypts the original into the dispute archive; returns its key. */
async function archiveOriginal(
  ws: WorkerServices,
  row: SubmissionRow,
  original: string,
  dir: string,
) {
  if (row.originalArchiveKey) return row.originalArchiveKey;
  const key = archiveKey(row.id);
  const enc = join(dir, "archive-out.enc");
  await ws.cipher.encryptFile(original, enc, archiveContext(row.id));
  await ws.storage.upload(key, { path: enc }, "application/octet-stream");
  return key;
}

/** Saves the result, schedules the purge and the webhook, then deletes the plaintext upload. */
async function finish(
  ws: WorkerServices,
  row: SubmissionRow,
  mission: MissionRow,
  ai: AiResult | null,
  frameKeys: string[],
  archived: string | null,
) {
  const now = ws.now();
  const purgeAt = new Date(now.getTime() + ws.processing.retentionDays * 86_400_000);
  const nextStatus = ai ? (ai.needsReview ? "needs_review" : "ready") : null;

  const updated = await ws.db.transaction(async (tx) => {
    const [u] = await tx
      .update(submissions)
      .set({
        // Only move forward from "processing"; accepted/rejected stay as the chain decided.
        status: nextStatus
          ? sql`case when ${submissions.status} = 'processing' then ${nextStatus}::submission_status else ${submissions.status} end`
          : undefined,
        aiResult: ai ? (ai as unknown as Record<string, unknown>) : undefined,
        aiConfidence: ai?.confidence ?? null,
        blurredMediaKey: frameKeys[0] ?? null,
        blurredFrameKeys: frameKeys,
        originalArchiveKey: archived,
        originalPurgeAt: archived ? purgeAt : null,
        processedAt: now,
      })
      .where(and(eq(submissions.id, row.id), isNull(submissions.processedAt)))
      .returning();
    if (!u) return null;
    if (archived) await enqueueJob(tx, JOB_PURGE_ORIGINAL, { submissionId: row.id }, purgeAt);
    if (ai) await queueWebhook(tx, mission.funderId, u, ai, now);
    return u;
  });

  // The plaintext upload goes away once the encrypted copy and the result are saved.
  if (updated && archived && row.mediaKey !== archived) await ws.storage.delete(row.mediaKey);
  if (updated) {
    ws.logger.info(
      { submissionId: row.id, status: updated.status, reviewReasons: ai?.reviewReasons ?? [] },
      "submission processed",
    );
  }
}

async function queueWebhook(
  tx: Database,
  funderId: string,
  sub: SubmissionRow,
  ai: AiResult,
  now: Date,
) {
  const funder = await tx.query.funders.findFirst({ where: eq(funders.id, funderId) });
  if (!funder?.webhookUrl) return;
  await enqueueJob(
    tx,
    JOB_WEBHOOK,
    {
      funderId,
      event: "submission.processed",
      data: {
        submissionId: sub.id,
        missionId: sub.missionId,
        status: sub.status,
        needsReview: ai.needsReview,
        reviewReasons: ai.reviewReasons,
        answer: ai.answer,
        confidence: ai.confidence,
        reviewDeadline: sub.reviewDeadline?.toISOString() ?? null,
        processedAt: ai.processedAt,
      },
    },
    now,
  );
}

/** Job: delete the encrypted original once its retention period is over. */
export async function purgeOriginal(
  ws: Pick<WorkerServices, "db" | "storage" | "now" | "logger">,
  submissionId: string,
) {
  const row = await ws.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!row?.originalArchiveKey || !row.originalPurgeAt)
    return { outcome: "nothing_to_purge" as const };
  if (row.originalPurgeAt.getTime() > ws.now().getTime()) return { outcome: "not_due" as const };
  await ws.storage.delete(row.originalArchiveKey);
  await ws.db
    .update(submissions)
    .set({ originalArchiveKey: null, originalPurgedAt: ws.now() })
    .where(eq(submissions.id, submissionId));
  ws.logger.info({ submissionId }, "encrypted original purged");
  return { outcome: "purged" as const };
}

/** Job: POST a signed event to the funder's webhook. Throws on non-2xx so the job retries. */
export async function deliverWebhook(
  ws: Pick<WorkerServices, "db" | "cipher" | "webhooks" | "now">,
  jobId: string,
  payload: { funderId: string; event: string; data: Record<string, unknown> },
) {
  const funder = await ws.db.query.funders.findFirst({ where: eq(funders.id, payload.funderId) });
  if (!funder?.webhookUrl || !funder.webhookSecretEnc) return { outcome: "no_webhook" as const };
  const secret = ws.cipher.decryptString(funder.webhookSecretEnc, webhookSecretContext(funder.id));
  const body = JSON.stringify({
    id: jobId,
    event: payload.event,
    createdAt: ws.now().toISOString(),
    data: payload.data,
  });
  const t = Math.floor(ws.now().getTime() / 1000);
  const res = await ws.webhooks.post(
    funder.webhookUrl,
    {
      "seenit-event": payload.event,
      "seenit-delivery": jobId,
      "seenit-signature": signWebhook(secret, t, body),
    },
    body,
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`Webhook responded ${res.status}`);
  return { outcome: "delivered" as const };
}

/** Called when AI processing gave up after all retries: a human must review it. */
export async function markProcessingFailed(
  ws: WorkerServices,
  submissionId: string,
  error: string,
) {
  const row = await ws.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!row || row.processedAt) return;
  const mission = await ws.db.query.missions.findFirst({ where: eq(missions.id, row.missionId) });
  if (!mission) return;
  // No frames are published (privacy unknown); the original stays where it is for a manual retry.
  await ws.db
    .update(submissions)
    .set({
      status: sql`case when ${submissions.status} = 'processing' then 'needs_review'::submission_status else ${submissions.status} end`,
      aiResult: failedResult(ws, ["processing_failed"], error) as unknown as Record<
        string,
        unknown
      >,
    })
    .where(eq(submissions.id, submissionId));
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
