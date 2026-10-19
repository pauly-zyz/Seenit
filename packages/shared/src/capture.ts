import { z } from "zod";

import { haversineMeters } from "./geo.js";
import { geoPointSchema, mediaTypeSchema, type MissionSpec } from "./mission.js";

export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase hex SHA-256 digest");

/**
 * Metadata the mobile app sends with every capture. `source` is a literal:
 * only the in-app camera is accepted, gallery uploads are not.
 */
export const captureMetadataSchema = z.object({
  missionId: z.string().min(1),
  source: z.literal("in_app_camera"),
  mediaType: mediaTypeSchema,
  /** SHA-256 of the original, unblurred media bytes. Anchored on-chain. */
  mediaSha256: sha256HexSchema,
  capturedAt: z.iso.datetime({ offset: true }),
  gps: geoPointSchema.extend({
    accuracyMeters: z.number().positive(),
    altitudeMeters: z.number().optional(),
    /** Time of the GPS fix itself, which may lag the shutter. */
    fixAt: z.iso.datetime({ offset: true }),
    /** Android reports mock locations; reject when true. */
    isMocked: z.boolean().optional(),
  }),
  videoDurationSeconds: z.number().positive().optional(),
  device: z.object({
    platform: z.enum(["ios", "android"]),
    appVersion: z.string().min(1),
    model: z.string().max(100).optional(),
    osVersion: z.string().max(50).optional(),
  }),
});

/** Capture rules shared by the app (to gate the record button) and the API (to verify). */
export const CAPTURE_RULES = {
  /** Max GPS accuracy radius at the shutter. */
  maxGpsAccuracyMeters: 50,
  /** Default max time between capture and server check (lets the app queue on bad signal). */
  maxCaptureAgeMs: 6 * 60 * 60_000,
} as const;
export type CaptureMetadata = z.infer<typeof captureMetadataSchema>;

export interface CaptureCheckOptions {
  /** Server receive time. */
  now: Date;
  /** Max GPS accuracy radius allowed. Default 50 m. */
  maxGpsAccuracyMeters?: number;
  /** Max time between capture and the server check. Default 6 h (offline queue). */
  maxCaptureAgeMs?: number;
  /** Max gap between GPS fix and shutter. Default 2 min. */
  maxFixSkewMs?: number;
  /** Allowed device clock drift into the future. Default 2 min. */
  maxClockSkewMs?: number;
}

export type CaptureRejection =
  | "media_type_mismatch"
  | "outside_radius"
  | "gps_inaccurate"
  | "gps_mocked"
  | "gps_fix_stale"
  | "captured_in_future"
  | "capture_too_old"
  | "after_deadline"
  | "video_too_long"
  | "video_duration_missing";

export interface CaptureCheckResult {
  ok: boolean;
  reasons: CaptureRejection[];
  distanceMeters: number;
}

/**
 * Server-side anti-cheat checks for a capture against its mission. Pure and
 * deterministic so it can be unit-tested and reused by the API and workers.
 */
export function checkCapture(
  mission: Pick<
    MissionSpec,
    "mediaType" | "location" | "radiusMeters" | "deadline" | "maxVideoSeconds"
  >,
  capture: CaptureMetadata,
  opts: CaptureCheckOptions,
): CaptureCheckResult {
  const maxAccuracy = opts.maxGpsAccuracyMeters ?? CAPTURE_RULES.maxGpsAccuracyMeters;
  const maxAge = opts.maxCaptureAgeMs ?? CAPTURE_RULES.maxCaptureAgeMs;
  const maxFixSkew = opts.maxFixSkewMs ?? 2 * 60_000;
  const maxClockSkew = opts.maxClockSkewMs ?? 2 * 60_000;

  const reasons: CaptureRejection[] = [];
  const now = opts.now.getTime();
  const capturedAt = Date.parse(capture.capturedAt);
  const fixAt = Date.parse(capture.gps.fixAt);
  const deadline = Date.parse(mission.deadline);
  const distanceMeters = haversineMeters(mission.location, capture.gps);

  if (capture.mediaType !== mission.mediaType) reasons.push("media_type_mismatch");
  if (distanceMeters > mission.radiusMeters) reasons.push("outside_radius");
  if (capture.gps.accuracyMeters > maxAccuracy) reasons.push("gps_inaccurate");
  if (capture.gps.isMocked) reasons.push("gps_mocked");
  if (Math.abs(capturedAt - fixAt) > maxFixSkew) reasons.push("gps_fix_stale");
  if (capturedAt > now + maxClockSkew) reasons.push("captured_in_future");
  if (now - capturedAt > maxAge) reasons.push("capture_too_old");
  if (capturedAt > deadline) reasons.push("after_deadline");

  if (mission.mediaType === "video") {
    if (capture.videoDurationSeconds === undefined) reasons.push("video_duration_missing");
    else if (
      mission.maxVideoSeconds !== undefined &&
      capture.videoDurationSeconds > mission.maxVideoSeconds
    ) {
      reasons.push("video_too_long");
    }
  }

  return { ok: reasons.length === 0, reasons, distanceMeters };
}

/** SHA-256 hex digest -> bytes32 for MissionEscrow.recordSubmission. */
export function sha256ToBytes32(hex: string): `0x${string}` {
  return `0x${sha256HexSchema.parse(hex)}`;
}
