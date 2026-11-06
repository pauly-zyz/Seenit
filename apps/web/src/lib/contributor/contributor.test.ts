// @vitest-environment node
import { captureMetadataSchema, CAPTURE_RULES, checkCapture } from "@seenit/shared";
import { describe, expect, it } from "vitest";

import { ContributorApiError, createContributorApi } from "./api";
import {
  baseContentType,
  browserHeaders,
  browserInfo,
  buildCaptureMetadata,
  pickVideoType,
  sha256Hex,
  submitCapture,
  type CapturedMedia,
} from "./capture";

function fake(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("contributor API client", () => {
  it("uses same-origin cookies and sends the CSRF header on writes only", async () => {
    const f = fake();
    const api = createContributorApi(f.fn);
    await api.personhood();
    await api.startVerification("human_passport");
    expect(f.calls[0]!.init.credentials).toBe("same-origin");
    expect(header(f.calls[0]!.init, "x-seenit-csrf")).toBeUndefined();
    expect(f.calls[1]!.url).toBe("/api/personhood/human_passport/start");
    expect(header(f.calls[1]!.init, "x-seenit-csrf")).toBe("1");
  });

  it("encodes the nearby query", async () => {
    const f = fake(200, { missions: [] });
    await createContributorApi(f.fn).nearby({ lat: -6.2, lng: 106.8, radiusKm: 10 });
    expect(f.calls[0]!.url).toBe("/api/missions/nearby?lat=-6.2&lng=106.8&radiusKm=10&limit=100");
  });

  it("turns error bodies, empty 500s and network failures into ContributorApiError", async () => {
    const err = await createContributorApi(
      fake(422, {
        error: { code: "precheck_failed", message: "Too far", details: { reason: "x" } },
      }).fn,
    )
      .uploadUrl({
        missionId: "m",
        mediaType: "photo",
        contentType: "image/jpeg",
        contentLength: 1,
        gps: { lat: 0, lng: 0, accuracyMeters: 5 },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ContributorApiError);
    expect(err).toMatchObject({ status: 422, code: "precheck_failed", details: { reason: "x" } });

    const html = await createContributorApi(fake(500, "<html>oops</html>").fn)
      .history()
      .catch((e) => e);
    expect(html).toMatchObject({ status: 500, code: "http_error" });

    const offline = await createContributorApi((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch)
      .history()
      .catch((e) => e);
    expect(offline).toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("capture helpers", () => {
  it("prefers MP4 and falls back to WebM; null when nothing records", () => {
    expect(pickVideoType(() => true)).toBe("video/mp4;codecs=avc1");
    expect(pickVideoType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickVideoType(() => false)).toBeNull();
    expect(baseContentType("video/webm;codecs=vp9")).toBe("video/webm");
  });

  it("drops Content-Length (the browser sets it) but keeps the signed Content-Type", () => {
    expect(browserHeaders({ "content-type": "image/jpeg", "content-length": "10" })).toEqual({
      "content-type": "image/jpeg",
    });
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("reads coarse browser facts from the user agent", () => {
    expect(
      browserInfo(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      ),
    ).toEqual({ model: "Chrome/131", osVersion: "Android 14" });
    expect(
      browserInfo(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ model: "Safari/18", osVersion: "iPhone OS 18.1" });
  });
});

const now = Date.parse("2026-11-06T10:00:00Z");
const mission = {
  id: "11111111-1111-4111-8111-111111111111",
  mediaType: "video" as const,
  location: { lat: -6.2, lng: 106.8 },
  radiusMeters: 100,
  deadline: "2026-11-07T00:00:00Z",
  maxVideoSeconds: 30,
};
const media: CapturedMedia = {
  blob: new Blob(["video-bytes"], { type: "video/webm" }),
  contentType: "video/webm",
  mediaType: "video",
  shutterAt: now - 5_000,
  fix: { lat: -6.2001, lng: 106.8001, accuracyMeters: 8, timestamp: now - 6_000 },
  durationSeconds: 7.5,
};

describe("capture metadata", () => {
  it("is valid for the API and passes the server's capture check", () => {
    const capture = buildCaptureMetadata({
      missionId: mission.id,
      media,
      mediaSha256: "a".repeat(64),
      appVersion: "web-1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0",
    });
    expect(captureMetadataSchema.parse(capture).device.platform).toBe("web");
    expect(capture.gps).not.toHaveProperty("isMocked");
    const result = checkCapture(
      {
        location: mission.location,
        radiusMeters: mission.radiusMeters,
        mediaType: mission.mediaType,
        deadline: mission.deadline,
        maxVideoSeconds: mission.maxVideoSeconds,
      },
      capture,
      { now: new Date(now), maxCaptureAgeMs: CAPTURE_RULES.maxCaptureAgeMs },
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe("submitCapture", () => {
  it("hashes, requests the URL, uploads with the signed headers, then finalizes", async () => {
    const steps: string[] = [];
    const puts: { url: string; headers: Record<string, string>; size: number }[] = [];
    const calls: unknown[] = [];
    const api = {
      uploadUrl: async (body: unknown) => {
        calls.push(body);
        return {
          submissionId: "s1",
          upload: {
            url: "https://r2.example/put",
            method: "PUT" as const,
            headers: { "content-type": "video/webm", "content-length": "11" },
            expiresAt: "",
          },
        };
      },
      finalize: async (body: { submissionId: string; capture: { mediaSha256: string } }) => {
        calls.push(body);
        return { submission: { id: body.submissionId, status: "processing" as const } };
      },
    };
    const res = await submitCapture({
      api,
      missionId: mission.id,
      media,
      appVersion: "web-1",
      userAgent: "test",
      put: async (url, headers, body) => {
        puts.push({ url, headers, size: body.size });
        return new Response(null, { status: 200 });
      },
      onStep: (s) => steps.push(s),
    });
    expect(steps).toEqual(["hashing", "requesting", "uploading", "finalizing"]);
    expect(calls[0]).toMatchObject({
      missionId: mission.id,
      contentType: "video/webm",
      contentLength: 11,
      gps: { accuracyMeters: 8 },
    });
    expect(puts[0]).toMatchObject({ url: "https://r2.example/put", size: 11 });
    expect((calls[1] as { capture: { mediaSha256: string } }).capture.mediaSha256).toBe(
      await sha256Hex(media.blob),
    );
    expect(res.submission.status).toBe("processing");
  });

  it("stops before finalizing when storage refuses the upload", async () => {
    let finalized = false;
    const err = await submitCapture({
      api: {
        uploadUrl: async () => ({
          submissionId: "s1",
          upload: { url: "u", method: "PUT" as const, headers: {}, expiresAt: "" },
        }),
        finalize: async () => {
          finalized = true;
          return { submission: { id: "s1", status: "processing" as const } };
        },
      },
      missionId: mission.id,
      media,
      appVersion: "web-1",
      userAgent: "test",
      put: async () => new Response(null, { status: 403 }),
    }).catch((e) => e);
    expect(err.message).toMatch(/403/);
    expect(finalized).toBe(false);
  });
});
