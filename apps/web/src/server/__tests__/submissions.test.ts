// @vitest-environment node
import { createHash } from "node:crypto";

import { eq, jobs, payouts, personhoodAttestations, submissions, users } from "@seenit/db";
import { hexToString } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as accept } from "@/app/api/submissions/[id]/accept/route";
import { POST as reject } from "@/app/api/submissions/[id]/reject/route";
import { POST as finalize } from "@/app/api/submissions/route";
import { POST as uploadUrl } from "@/app/api/submissions/upload-url/route";

import { JOB_AI_PROCESS } from "../jobs";
import {
  call,
  createHarness,
  seedActiveMission,
  seedContributor,
  seedFunder,
  type Harness,
} from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const SPOT = { lat: -6.175392, lng: 106.827153 };
const PHOTO = Buffer.from("fake jpeg bytes of the bakery entrance");
const PHOTO_SHA = createHash("sha256").update(PHOTO).digest("hex");

async function setup(
  opts: { tier?: 0 | 1 | 2; mission?: Parameters<typeof seedActiveMission>[3] } = {},
) {
  const funder = await seedFunder(h.db);
  const mission = await seedActiveMission(h.db, funder.funder.id, h.now, opts.mission);
  const contributor = await seedContributor(h.db, h.now, { tier: opts.tier ?? 1 });
  return { funder, mission, contributor };
}

const uploadBody = (
  missionId: string,
  gps: Partial<{ lat: number; lng: number; accuracyMeters: number }> = {},
) => ({
  missionId,
  mediaType: "photo",
  contentType: "image/jpeg",
  contentLength: PHOTO.length,
  gps: { lat: SPOT.lat + 0.0002, lng: SPOT.lng, accuracyMeters: 8, ...gps },
});

function capture(
  missionId: string,
  overrides: Record<string, unknown> = {},
  gps: Record<string, unknown> = {},
) {
  return {
    missionId,
    source: "in_app_camera",
    mediaType: "photo",
    mediaSha256: PHOTO_SHA,
    capturedAt: new Date(h.now.getTime() - 60_000).toISOString(),
    device: { platform: "android", appVersion: "0.1.0" },
    ...overrides,
    gps: {
      lat: SPOT.lat + 0.0002,
      lng: SPOT.lng,
      accuracyMeters: 8,
      fixAt: new Date(h.now.getTime() - 65_000).toISOString(),
      ...gps,
    },
  };
}

/** Upload URL + simulated PUT. */
async function upload(missionId: string, token: string, bytes = PHOTO) {
  const res = await call(uploadUrl, {
    path: "/api/submissions/upload-url",
    token,
    body: uploadBody(missionId),
  });
  expect(res.status).toBe(200);
  const key = h.storage.presigned.at(-1)!.key;
  h.storage.put(key, bytes);
  return res.json.submissionId as string;
}

async function recorded() {
  const s = await setup();
  const submissionId = await upload(s.mission.id, s.contributor.token);
  const res = await call(finalize, {
    token: s.contributor.token,
    body: { submissionId, capture: capture(s.mission.id) },
  });
  expect(res.status).toBe(201);
  return { ...s, submissionId };
}

// ------------------------------------------------------------------------------------------------

describe("POST /api/submissions/upload-url", () => {
  it("issues a signed URL inside the radius with enough tier", async () => {
    const { mission, contributor } = await setup();
    const res = await call(uploadUrl, { token: contributor.token, body: uploadBody(mission.id) });
    expect(res.status).toBe(200);
    expect(res.json.upload.method).toBe("PUT");
    expect(res.json.upload.url).toContain(
      `submissions/${mission.id}/${res.json.submissionId}/original`,
    );
    expect(res.json.upload.headers["content-type"]).toBe("image/jpeg");
    const row = await h.db.query.submissions.findFirst({
      where: eq(submissions.id, res.json.submissionId),
    });
    expect(row!.status).toBe("awaiting_upload");
  });

  it("requires a session", async () => {
    const { mission } = await setup();
    expect((await call(uploadUrl, { body: uploadBody(mission.id) })).status).toBe(401);
  });

  it("refuses contributors outside the mission radius", async () => {
    const { mission, contributor } = await setup();
    const res = await call(uploadUrl, {
      token: contributor.token,
      body: uploadBody(mission.id, { lat: SPOT.lat + 0.01 }),
    });
    expect(res.status).toBe(403);
    expect(res.json.error.details.distanceMeters).toBeGreaterThan(1000);
    expect(h.storage.presigned).toHaveLength(0);
  });

  it("refuses poor GPS accuracy", async () => {
    const { mission, contributor } = await setup();
    const res = await call(uploadUrl, {
      token: contributor.token,
      body: uploadBody(mission.id, { accuracyMeters: 300 }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses an insufficient personhood tier", async () => {
    const { mission, contributor } = await setup({ tier: 1, mission: { minTier: 2 } });
    const res = await call(uploadUrl, { token: contributor.token, body: uploadBody(mission.id) });
    expect(res.status).toBe(403);
    expect(res.json.error.details).toEqual({ requiredTier: 2, yourTier: 1 });
  });

  it("ignores expired or revoked attestations", async () => {
    const { mission, contributor } = await setup();
    await h.db
      .update(personhoodAttestations)
      .set({ revokedAt: h.now })
      .where(eq(personhoodAttestations.userId, contributor.user.id));
    expect(
      (await call(uploadUrl, { token: contributor.token, body: uploadBody(mission.id) })).status,
    ).toBe(403);
  });

  it("refuses inactive, expired or unknown missions", async () => {
    const { funder, contributor } = await setup();
    const pending = await seedActiveMission(h.db, funder.funder.id, h.now, {
      status: "pending_funding",
      onchainId: null,
    });
    const expired = await seedActiveMission(h.db, funder.funder.id, h.now, {
      deadline: new Date(h.now.getTime() - 1),
    });
    expect(
      (await call(uploadUrl, { token: contributor.token, body: uploadBody(pending.id) })).status,
    ).toBe(409);
    expect(
      (await call(uploadUrl, { token: contributor.token, body: uploadBody(expired.id) })).status,
    ).toBe(409);
    expect(
      (await call(uploadUrl, { token: contributor.token, body: uploadBody(crypto.randomUUID()) }))
        .status,
    ).toBe(404);
  });

  it("refuses the wrong media type, content type or size", async () => {
    const { mission, contributor } = await setup();
    const t = contributor.token;
    expect(
      (
        await call(uploadUrl, {
          token: t,
          body: { ...uploadBody(mission.id), mediaType: "video", contentType: "video/mp4" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(uploadUrl, {
          token: t,
          body: { ...uploadBody(mission.id), contentType: "application/pdf" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(uploadUrl, {
          token: t,
          body: { ...uploadBody(mission.id), contentLength: 100 * 1024 * 1024 },
        })
      ).status,
    ).toBe(400);
  });

  it("refuses when the mission is full", async () => {
    const { mission, funder } = await setup({ mission: { maxCaptures: 1 } });
    const other = await seedContributor(h.db, h.now);
    await h.db.insert(submissions).values({
      missionId: mission.id,
      contributorId: other.user.id,
      mediaKey: "x",
      mediaType: "photo",
      status: "processing",
    });
    const late = await seedContributor(h.db, h.now);
    expect(funder).toBeTruthy();
    expect(
      (await call(uploadUrl, { token: late.token, body: uploadBody(mission.id) })).status,
    ).toBe(409);
  });

  it("lets a contributor retry an unfinished upload but not submit twice", async () => {
    const { mission, contributor } = await recorded();
    expect(mission).toBeTruthy();
    const again = await call(uploadUrl, { token: contributor.token, body: uploadBody(mission.id) });
    expect(again.status).toBe(409);

    const s2 = await setup();
    const first = await call(uploadUrl, {
      token: s2.contributor.token,
      body: uploadBody(s2.mission.id),
    });
    const retry = await call(uploadUrl, {
      token: s2.contributor.token,
      body: uploadBody(s2.mission.id),
    });
    expect(retry.status).toBe(200);
    expect(retry.json.submissionId).toBe(first.json.submissionId);
  });
});

// ------------------------------------------------------------------------------------------------

describe("POST /api/submissions (finalize)", () => {
  it("verifies, records on-chain and queues AI processing", async () => {
    const { mission, contributor } = await setup();
    const submissionId = await upload(mission.id, contributor.token);
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId, capture: capture(mission.id) },
    });

    expect(res.status).toBe(201);
    expect(res.json.submission.status).toBe("processing");
    expect(res.json.submission.mediaHash).toBe(PHOTO_SHA);
    expect(res.json.submission.onchainId).toBe("1");

    const [rec] = h.chain.callsTo("recordSubmission");
    expect(rec!.args).toEqual([mission.onchainId, expect.stringMatching(/^0x/), `0x${PHOTO_SHA}`]);
    expect((rec!.args[1] as string).toLowerCase()).toBe(contributor.user.wallet);

    const queued = await h.db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: JOB_AI_PROCESS,
      payload: { submissionId },
      status: "queued",
    });

    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
    expect(row!.capturedAt).toBeInstanceOf(Date);
    expect(row!.lat).toBeCloseTo(SPOT.lat + 0.0002);
    expect(row!.deviceInfo).toMatchObject({ platform: "android" });
    expect(row!.reviewDeadline!.getTime()).toBe(h.now.getTime() + 3 * 86_400_000);
  });

  it("rejects when the uploaded file does not match the claimed hash", async () => {
    const { mission, contributor } = await setup();
    const submissionId = await upload(mission.id, contributor.token, Buffer.from("something else"));
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId, capture: capture(mission.id) },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.details.reasons).toContain("media_hash_mismatch");
    expect(h.chain.callsTo("recordSubmission")).toHaveLength(0);
    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
    expect(row!.status).toBe("rejected_precheck");
  });

  it("rejects implausible GPS and timestamps", async () => {
    const { mission, contributor } = await setup();
    const submissionId = await upload(mission.id, contributor.token);
    const bad = capture(
      mission.id,
      { capturedAt: new Date(h.now.getTime() - 7 * 3600_000).toISOString() },
      {
        lat: SPOT.lat + 0.01,
        isMocked: true,
        fixAt: new Date(h.now.getTime() - 7 * 3600_000).toISOString(),
      },
    );
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId, capture: bad },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.details.reasons).toEqual(
      expect.arrayContaining(["outside_radius", "gps_mocked", "capture_too_old"]),
    );
  });

  it("rejects gallery uploads at the schema level", async () => {
    const { mission, contributor } = await setup();
    const submissionId = await upload(mission.id, contributor.token);
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId, capture: capture(mission.id, { source: "gallery" }) },
    });
    expect(res.status).toBe(400);
  });

  it("asks for the upload first when the file is missing", async () => {
    const { mission, contributor } = await setup();
    const res0 = await call(uploadUrl, { token: contributor.token, body: uploadBody(mission.id) });
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId: res0.json.submissionId, capture: capture(mission.id) },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/Upload not found/);
  });

  it("marks chain_failed and returns 502 when recordSubmission fails", async () => {
    const { mission, contributor } = await setup();
    const submissionId = await upload(mission.id, contributor.token);
    h.chain.failNext("recordSubmission", "MissionFull");
    const res = await call(finalize, {
      token: contributor.token,
      body: { submissionId, capture: capture(mission.id) },
    });
    expect(res.status).toBe(502);
    expect(res.json.error.details.errorName).toBe("MissionFull");
    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
    expect(row!.status).toBe("chain_failed");
    expect(await h.db.select().from(jobs)).toHaveLength(0);
  });

  it("refuses media that was already submitted elsewhere", async () => {
    const first = await recorded();
    expect(first).toBeTruthy();
    const s = await setup();
    const submissionId = await upload(s.mission.id, s.contributor.token);
    const res = await call(finalize, {
      token: s.contributor.token,
      body: { submissionId, capture: capture(s.mission.id) },
    });
    expect(res.status).toBe(409);
  });

  it("hides other contributors' submissions and refuses double finalize", async () => {
    const { submissionId, mission, contributor } = await recorded();
    const intruder = await seedContributor(h.db, h.now);
    expect(
      (
        await call(finalize, {
          token: intruder.token,
          body: { submissionId, capture: capture(mission.id) },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(finalize, {
          token: contributor.token,
          body: { submissionId, capture: capture(mission.id) },
        })
      ).status,
    ).toBe(409);
  });
});

// ------------------------------------------------------------------------------------------------

describe("POST /api/submissions/:id/accept", () => {
  it("accepts on-chain, records the payout and bumps reputation", async () => {
    const { submissionId, funder, contributor } = await recorded();
    const res = await call(accept, { apiKey: funder.key, params: { id: submissionId }, body: {} });
    expect(res.status).toBe(200);
    expect(res.json.submission.status).toBe("accepted");
    expect(res.json.payout).toMatchObject({ amount: "1900000", fee: "100000" });
    expect(h.chain.callsTo("acceptSubmission")[0]!.args).toEqual([1n]);

    const [p] = await h.db.select().from(payouts);
    expect(p).toMatchObject({
      amount: "1900000",
      fee: "100000",
      finalized: false,
      contributorId: contributor.user.id,
    });
    const u = await h.db.query.users.findFirst({ where: eq(users.id, contributor.user.id) });
    expect(u!.reputation).toBe(1);
  });

  it("only the mission's funder can accept", async () => {
    const { submissionId } = await recorded();
    const other = await seedFunder(h.db, "Other");
    expect(
      (await call(accept, { apiKey: other.key, params: { id: submissionId }, body: {} })).status,
    ).toBe(404);
    expect((await call(accept, { params: { id: submissionId }, body: {} })).status).toBe(401);
    expect(h.chain.callsTo("acceptSubmission")).toHaveLength(0);
  });

  it("double accept returns 409 without a second transaction", async () => {
    const { submissionId, funder } = await recorded();
    await call(accept, { apiKey: funder.key, params: { id: submissionId }, body: {} });
    const again = await call(accept, {
      apiKey: funder.key,
      params: { id: submissionId },
      body: {},
    });
    expect(again.status).toBe(409);
    expect(h.chain.callsTo("acceptSubmission")).toHaveLength(1);
    expect(await h.db.select().from(payouts)).toHaveLength(1);
  });

  it("maps an on-chain NotPending revert to 409", async () => {
    const { submissionId, funder } = await recorded();
    h.chain.failNext("acceptSubmission", "NotPending");
    const res = await call(accept, { apiKey: funder.key, params: { id: submissionId }, body: {} });
    expect(res.status).toBe(409);
  });

  it("cannot accept a submission that never went on-chain", async () => {
    const s = await setup();
    const submissionId = await upload(s.mission.id, s.contributor.token);
    const res = await call(accept, {
      apiKey: s.funder.key,
      params: { id: submissionId },
      body: {},
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/submissions/:id/reject", () => {
  it("rejects on-chain with the reason as bytes32", async () => {
    const { submissionId, funder } = await recorded();
    const res = await call(reject, {
      apiKey: funder.key,
      params: { id: submissionId },
      body: { reason: "sign not visible" },
    });
    expect(res.status).toBe(200);
    expect(res.json.submission.status).toBe("rejected");
    expect(res.json.submission.rejectionReasons).toEqual(["sign not visible"]);
    const [call0] = h.chain.callsTo("rejectSubmission");
    expect(hexToString(call0!.args[1] as `0x${string}`, { size: 32 })).toBe("sign not visible");
  });

  it("refuses after the review window", async () => {
    const { submissionId, funder } = await recorded();
    h.advance(3 * 86_400_000 + 1000);
    const res = await call(reject, {
      apiKey: funder.key,
      params: { id: submissionId },
      body: { reason: "late" },
    });
    expect(res.status).toBe(409);
    expect(h.chain.callsTo("rejectSubmission")).toHaveLength(0);
  });

  it("validates the reason and ownership", async () => {
    const { submissionId, funder } = await recorded();
    const other = await seedFunder(h.db, "Other");
    expect(
      (
        await call(reject, {
          apiKey: funder.key,
          params: { id: submissionId },
          body: { reason: "x".repeat(33) },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(reject, {
          apiKey: other.key,
          params: { id: submissionId },
          body: { reason: "no" },
        })
      ).status,
    ).toBe(404);
  });

  it("cannot reject an accepted submission", async () => {
    const { submissionId, funder } = await recorded();
    await call(accept, { apiKey: funder.key, params: { id: submissionId }, body: {} });
    const res = await call(reject, {
      apiKey: funder.key,
      params: { id: submissionId },
      body: { reason: "too late" },
    });
    expect(res.status).toBe(409);
  });
});
