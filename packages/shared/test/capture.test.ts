import { describe, expect, it } from "vitest";

import {
  CAPTURE_RULES,
  captureMetadataSchema,
  checkCapture,
  sha256ToBytes32,
  type CaptureMetadata,
} from "../src/index.js";

const mission = {
  mediaType: "photo" as const,
  location: { lat: -6.175392, lng: 106.827153 },
  radiusMeters: 100,
  deadline: "2026-12-01T00:00:00Z",
  maxVideoSeconds: undefined,
};

const now = new Date("2026-10-19T10:05:00Z");

function capture(patch: Partial<CaptureMetadata> = {}, gps: Partial<CaptureMetadata["gps"]> = {}) {
  return captureMetadataSchema.parse({
    missionId: "m_1",
    source: "in_app_camera",
    mediaType: "photo",
    mediaSha256: "a".repeat(64),
    capturedAt: "2026-10-19T10:00:00Z",
    device: { platform: "android", appVersion: "0.1.0" },
    ...patch,
    gps: {
      lat: -6.17545,
      lng: 106.82718,
      accuracyMeters: 8,
      fixAt: "2026-10-19T09:59:50Z",
      ...gps,
    },
  });
}

describe("captureMetadataSchema", () => {
  it("only accepts in-app camera captures", () => {
    expect(() => capture({ source: "gallery" as never })).toThrow();
  });

  it("requires a lowercase sha256 digest", () => {
    expect(() => capture({ mediaSha256: "A".repeat(64) })).toThrow();
    expect(() => capture({ mediaSha256: "a".repeat(63) })).toThrow();
  });
});

describe("checkCapture", () => {
  it("passes a good capture", () => {
    const r = checkCapture(mission, capture(), { now });
    expect(r).toMatchObject({ ok: true, reasons: [] });
    expect(r.distanceMeters).toBeLessThan(10);
  });

  it.each<[string, Partial<CaptureMetadata>, Partial<CaptureMetadata["gps"]>, string]>([
    ["wrong media type", { mediaType: "video" }, {}, "media_type_mismatch"],
    ["outside radius", {}, { lat: -6.19 }, "outside_radius"],
    ["poor accuracy", {}, { accuracyMeters: 200 }, "gps_inaccurate"],
    ["mocked location", {}, { isMocked: true }, "gps_mocked"],
    ["stale fix", {}, { fixAt: "2026-10-19T09:50:00Z" }, "gps_fix_stale"],
    [
      "future capture",
      { capturedAt: "2026-10-19T10:30:00Z" },
      { fixAt: "2026-10-19T10:30:00Z" },
      "captured_in_future",
    ],
    [
      "old capture",
      { capturedAt: "2026-10-19T03:00:00Z" },
      { fixAt: "2026-10-19T03:00:00Z" },
      "capture_too_old",
    ],
  ])("rejects %s", (_, patch, gps, reason) => {
    const r = checkCapture(mission, capture(patch, gps), { now });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(reason);
  });

  it("rejects captures after the mission deadline", () => {
    const r = checkCapture({ ...mission, deadline: "2026-10-19T09:00:00Z" }, capture(), { now });
    expect(r.reasons).toEqual(["after_deadline"]);
  });

  it("checks video duration", () => {
    const videoMission = { ...mission, mediaType: "video" as const, maxVideoSeconds: 30 };
    expect(checkCapture(videoMission, capture({ mediaType: "video" }), { now }).reasons).toEqual([
      "video_duration_missing",
    ]);
    expect(
      checkCapture(videoMission, capture({ mediaType: "video", videoDurationSeconds: 31 }), { now })
        .reasons,
    ).toEqual(["video_too_long"]);
    expect(
      checkCapture(videoMission, capture({ mediaType: "video", videoDurationSeconds: 30 }), { now })
        .ok,
    ).toBe(true);
  });

  it("respects custom thresholds", () => {
    const r = checkCapture(mission, capture({}, { accuracyMeters: 40 }), {
      now,
      maxGpsAccuracyMeters: 20,
    });
    expect(r.reasons).toEqual(["gps_inaccurate"]);
  });
});

describe("sha256ToBytes32", () => {
  it("prefixes a valid digest", () => {
    expect(sha256ToBytes32("b".repeat(64))).toBe(`0x${"b".repeat(64)}`);
  });
  it("rejects invalid digests", () => {
    expect(() => sha256ToBytes32("0x" + "b".repeat(64))).toThrow();
  });
});

describe("CAPTURE_RULES", () => {
  it("allows queued uploads up to 6 hours and caps GPS accuracy at 50 m", () => {
    expect(CAPTURE_RULES).toEqual({ maxGpsAccuracyMeters: 50, maxCaptureAgeMs: 6 * 3600_000 });
  });

  it("keeps optional device details", () => {
    const parsed = captureMetadataSchema.parse({
      missionId: "m",
      source: "in_app_camera",
      mediaType: "photo",
      mediaSha256: "a".repeat(64),
      capturedAt: "2026-10-19T10:00:00Z",
      gps: { lat: 0, lng: 0, accuracyMeters: 5, fixAt: "2026-10-19T10:00:00Z" },
      device: { platform: "ios", appVersion: "1.0.0", model: "iPhone 17", osVersion: "26.1" },
    });
    expect(parsed.device).toMatchObject({ model: "iPhone 17", osVersion: "26.1" });
  });
});
