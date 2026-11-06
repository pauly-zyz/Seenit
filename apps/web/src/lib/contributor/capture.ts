import type { CaptureMetadata } from "@seenit/shared";

import type { ContributorApi } from "./api";

/** A GPS fix taken at the shutter. */
export interface ShutterFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
  altitudeMeters?: number | null;
  timestamp: number;
}

export interface CapturedMedia {
  blob: Blob;
  contentType: string;
  mediaType: "photo" | "video";
  shutterAt: number;
  fix: ShutterFix;
  durationSeconds?: number;
}

/** MediaRecorder types the API accepts, in order of preference (MP4 first: Safari, recent Chrome). */
export const VIDEO_TYPES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** First recorder type this browser supports, or null if it can't record video at all. */
export function pickVideoType(isSupported: (type: string) => boolean): string | null {
  return VIDEO_TYPES.find((t) => isSupported(t)) ?? null;
}

/** The Content-Type sent to storage: the container only ("video/mp4;codecs=avc1" -> "video/mp4"). */
export function baseContentType(type: string): string {
  return type.split(";")[0]!.trim().toLowerCase();
}

export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Chrome 131 on Android" style facts for the capture record (no fingerprinting beyond that). */
export function browserInfo(userAgent: string): { model?: string; osVersion?: string } {
  const os =
    /Android [\d.]+/.exec(userAgent)?.[0] ??
    /iPhone OS [\d_]+/.exec(userAgent)?.[0]?.replace(/_/g, ".") ??
    /Mac OS X [\d_.]+/.exec(userAgent)?.[0]?.replace(/_/g, ".") ??
    /Windows NT [\d.]+/.exec(userAgent)?.[0];
  const browser =
    /(?:Edg|Firefox|CriOS|FxiOS|Chrome)\/\d+/.exec(userAgent)?.[0] ??
    (/Version\/\d+.*Safari/.test(userAgent)
      ? `Safari/${/Version\/(\d+)/.exec(userAgent)![1]}`
      : undefined);
  return {
    ...(browser ? { model: browser.slice(0, 100) } : {}),
    ...(os ? { osVersion: os.slice(0, 50) } : {}),
  };
}

export function buildCaptureMetadata(input: {
  missionId: string;
  media: CapturedMedia;
  mediaSha256: string;
  appVersion: string;
  userAgent: string;
}): CaptureMetadata {
  const { media } = input;
  return {
    missionId: input.missionId,
    source: "in_app_camera",
    mediaType: media.mediaType,
    mediaSha256: input.mediaSha256,
    capturedAt: new Date(media.shutterAt).toISOString(),
    gps: {
      lat: media.fix.lat,
      lng: media.fix.lng,
      accuracyMeters: media.fix.accuracyMeters,
      ...(media.fix.altitudeMeters != null ? { altitudeMeters: media.fix.altitudeMeters } : {}),
      fixAt: new Date(media.fix.timestamp).toISOString(),
    },
    ...(media.durationSeconds !== undefined
      ? { videoDurationSeconds: Math.max(media.durationSeconds, 0.1) }
      : {}),
    device: { platform: "web", appVersion: input.appVersion, ...browserInfo(input.userAgent) },
  };
}

/** Browsers set Content-Length themselves (from the blob) and refuse to let scripts set it. */
export function browserHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-length"),
  );
}

export type SubmitStep = "hashing" | "requesting" | "uploading" | "finalizing";

/**
 * Hash → signed upload URL → PUT to storage → finalize. The server re-checks the GPS at each step
 * and recomputes the hash from storage. Web captures are uploaded right away (no offline queue).
 */
export async function submitCapture(deps: {
  api: Pick<ContributorApi, "uploadUrl" | "finalize">;
  missionId: string;
  media: CapturedMedia;
  appVersion: string;
  userAgent: string;
  put?: (url: string, headers: Record<string, string>, body: Blob) => Promise<Response>;
  onStep?: (step: SubmitStep) => void;
}) {
  const { api, media } = deps;
  const put =
    deps.put ??
    ((url: string, headers: Record<string, string>, body: Blob) =>
      fetch(url, { method: "PUT", headers: browserHeaders(headers), body }));
  deps.onStep?.("hashing");
  const mediaSha256 = await sha256Hex(media.blob);
  const capture = buildCaptureMetadata({
    missionId: deps.missionId,
    media,
    mediaSha256,
    appVersion: deps.appVersion,
    userAgent: deps.userAgent,
  });
  deps.onStep?.("requesting");
  const { submissionId, upload } = await api.uploadUrl({
    missionId: deps.missionId,
    mediaType: media.mediaType,
    contentType: media.contentType,
    contentLength: media.blob.size,
    gps: { lat: media.fix.lat, lng: media.fix.lng, accuracyMeters: media.fix.accuracyMeters },
  });
  deps.onStep?.("uploading");
  let res: Response;
  try {
    res = await put(upload.url, upload.headers, media.blob);
  } catch {
    throw new Error("Upload failed. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Please try again.`);
  deps.onStep?.("finalizing");
  return api.finalize({ submissionId, capture });
}
