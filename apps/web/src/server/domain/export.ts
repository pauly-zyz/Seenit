import { and, eq, inArray, submissions } from "@seenit/db";

import type { Services } from "../services";
import { getFunderMission } from "./missions";
import type { AiResult } from "./processing";
import { RESULT_URL_TTL_SECONDS } from "./submissions";

export type ExportScope = "accepted" | "all";

const SCOPES: Record<
  ExportScope,
  ("processing" | "ready" | "needs_review" | "accepted" | "rejected")[]
> = {
  accepted: ["accepted"],
  all: ["processing", "ready", "needs_review", "accepted", "rejected"],
};

/**
 * Rows for a mission export: one per submission, answer fields flattened. Media links are the
 * blurred copy only and expire after RESULT_URL_TTL_SECONDS.
 */
export async function exportRows(
  s: Services,
  funderId: string,
  missionId: string,
  scope: ExportScope,
) {
  const mission = await getFunderMission(s.db, funderId, missionId);
  const rows = await s.db.query.submissions.findMany({
    where: and(eq(submissions.missionId, mission.id), inArray(submissions.status, SCOPES[scope])),
    orderBy: (t, { asc }) => [asc(t.capturedAt)],
  });
  const fields = Object.keys((mission.outputSchema.properties as Record<string, unknown>) ?? {});
  const items = await Promise.all(
    rows.map(async (r) => {
      const ai =
        r.aiResult && "reviewReasons" in r.aiResult ? (r.aiResult as unknown as AiResult) : null;
      const keys = r.blurredFrameKeys?.length
        ? r.blurredFrameKeys
        : r.blurredMediaKey
          ? [r.blurredMediaKey]
          : [];
      const media = await Promise.all(
        keys.map((k) => s.storage.presignDownload(k, RESULT_URL_TTL_SECONDS)),
      );
      return {
        submissionId: r.id,
        status: r.status,
        capturedAt: r.capturedAt?.toISOString() ?? null,
        location:
          r.lat !== null && r.lng !== null
            ? { lat: r.lat, lng: r.lng, accuracyMeters: r.gpsAccuracyMeters }
            : null,
        answer: (ai?.answer as Record<string, unknown> | null) ?? null,
        confidence: ai?.confidence ?? null,
        reasoning: ai?.reasoning ?? null,
        reviewReasons: ai?.reviewReasons ?? [],
        media: media.map((m) => m.url),
        mediaExpiresAt: media[0]?.expiresAt.toISOString() ?? null,
        proof: {
          mediaSha256: r.mediaHash,
          onchainSubmissionId: r.onchainId?.toString() ?? null,
          recordTxHash: r.recordTxHash,
          resolveTxHash: r.resolveTxHash,
        },
      };
    }),
  );
  return { mission, fields, items };
}

export function toJson(data: Awaited<ReturnType<typeof exportRows>>) {
  const { mission, items } = data;
  return {
    mission: {
      id: mission.id,
      title: mission.title,
      status: mission.status,
      outputSchema: mission.outputSchema,
    },
    exportedAt: new Date().toISOString(),
    count: items.length,
    results: items,
  };
}

/** RFC 4180 CSV. Answer fields become `answer.<field>` columns. */
export function toCsv(data: Awaited<ReturnType<typeof exportRows>>): string {
  const head = [
    "submission_id",
    "status",
    "captured_at",
    "lat",
    "lng",
    "gps_accuracy_m",
    ...data.fields.map((f) => `answer.${f}`),
    "confidence",
    "reasoning",
    "review_reasons",
    "media_url",
    "media_expires_at",
    "media_sha256",
    "onchain_submission_id",
    "record_tx",
    "resolve_tx",
  ];
  const lines = [head.map(cell).join(",")];
  for (const it of data.items) {
    lines.push(
      [
        it.submissionId,
        it.status,
        it.capturedAt,
        it.location?.lat,
        it.location?.lng,
        it.location?.accuracyMeters,
        ...data.fields.map((f) => it.answer?.[f]),
        it.confidence,
        it.reasoning,
        it.reviewReasons.join(";"),
        it.media.join(" "),
        it.mediaExpiresAt,
        it.proof.mediaSha256,
        it.proof.onchainSubmissionId,
        it.proof.recordTxHash,
        it.proof.resolveTxHash,
      ]
        .map(cell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * One CSV cell. Answers come from contributors' captures via the AI, so cells that a spreadsheet
 * would run as a formula (= + - @, tab, CR) are prefixed with an apostrophe.
 */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof v === "number")) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
