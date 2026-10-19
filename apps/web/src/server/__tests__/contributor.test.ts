// @vitest-environment node
import { createHash } from "node:crypto";

import { payouts, submissions } from "@seenit/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as missionDetail } from "@/app/api/missions/[id]/route";
import { GET as mySubmissions } from "@/app/api/me/submissions/route";
import { POST as finalize } from "@/app/api/submissions/route";
import { POST as uploadUrl } from "@/app/api/submissions/upload-url/route";

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

describe("GET /api/missions/:id", () => {
  it("returns details, slots, tier lock and my submission", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now, { minTier: 2, maxCaptures: 2 });
    const c = await seedContributor(h.db, h.now, { tier: 1 });
    const other = await seedContributor(h.db, h.now, { tier: 2 });
    await h.db.insert(submissions).values({
      missionId: m.id,
      contributorId: other.user.id,
      mediaKey: "k",
      mediaType: "photo",
      status: "processing",
    });

    const res = await call(missionDetail, { token: c.token, params: { id: m.id } });
    expect(res.status).toBe(200);
    expect(res.json.mission).toMatchObject({
      id: m.id,
      slotsLeft: 1,
      open: true,
      outputSchema: m.outputSchema,
    });
    expect(res.json.access).toEqual({ yourTier: 1, requiredTier: 2, locked: true });
    expect(res.json.mySubmission).toBeNull();

    const mine = await call(missionDetail, { token: other.token, params: { id: m.id } });
    expect(mine.json.mySubmission).toMatchObject({ status: "processing" });
    expect(mine.json.access.locked).toBe(false);
  });

  it("marks full or expired missions as not open", async () => {
    const { funder } = await seedFunder(h.db);
    const expired = await seedActiveMission(h.db, funder.id, h.now, {
      deadline: new Date(h.now.getTime() - 1000),
    });
    const c = await seedContributor(h.db, h.now);
    const res = await call(missionDetail, { token: c.token, params: { id: expired.id } });
    expect(res.json.mission.open).toBe(false);
  });

  it("hides unfunded missions, unknown ids and requires a session", async () => {
    const { funder } = await seedFunder(h.db);
    const pending = await seedActiveMission(h.db, funder.id, h.now, {
      status: "pending_funding",
      onchainId: null,
    });
    const c = await seedContributor(h.db, h.now);
    expect((await call(missionDetail, { token: c.token, params: { id: pending.id } })).status).toBe(
      404,
    );
    expect(
      (await call(missionDetail, { token: c.token, params: { id: crypto.randomUUID() } })).status,
    ).toBe(404);
    expect(
      (await call(missionDetail, { token: c.token, params: { id: "not-a-uuid" } })).status,
    ).toBe(404);
    expect((await call(missionDetail, { params: { id: pending.id } })).status).toBe(401);
  });
});

describe("GET /api/me/submissions", () => {
  it("lists my submissions with payouts and totals", async () => {
    const { funder } = await seedFunder(h.db);
    const m1 = await seedActiveMission(h.db, funder.id, h.now, {
      title: "Accepted one",
      feeBps: 500,
    });
    const m2 = await seedActiveMission(h.db, funder.id, h.now, { title: "In review", feeBps: 500 });
    const m3 = await seedActiveMission(h.db, funder.id, h.now, { title: "Rejected one" });
    const m4 = await seedActiveMission(h.db, funder.id, h.now, { title: "Not uploaded" });
    const c = await seedContributor(h.db, h.now);
    const someoneElse = await seedContributor(h.db, h.now);
    const base = { contributorId: c.user.id, mediaKey: "k", mediaType: "photo" as const };

    const [accepted] = await h.db
      .insert(submissions)
      .values({
        ...base,
        missionId: m1.id,
        status: "accepted",
        resolveTxHash: "0xacc",
        recordTxHash: "0xrec",
      })
      .returning();
    await h.db.insert(payouts).values({
      submissionId: accepted!.id,
      contributorId: c.user.id,
      amount: "1900000",
      fee: "100000",
      txHash: "0xpay",
    });
    await h.db.insert(submissions).values([
      {
        ...base,
        missionId: m2.id,
        status: "processing",
        createdAt: new Date(h.now.getTime() + 1000),
      },
      { ...base, missionId: m3.id, status: "rejected", rejectionReasons: ["blurry"] },
      { ...base, missionId: m4.id, status: "awaiting_upload" },
      { ...base, contributorId: someoneElse.user.id, missionId: m1.id, status: "accepted" },
    ]);

    const res = await call(mySubmissions, { token: c.token });
    expect(res.status).toBe(200);
    expect(res.json.wallet).toBe(c.user.wallet);
    expect(
      res.json.items.map((i: { mission: { title: string } }) => i.mission.title).sort(),
    ).toEqual(["Accepted one", "In review", "Rejected one"]);
    const acc = res.json.items.find((i: { status: string }) => i.status === "accepted");
    expect(acc.payout).toMatchObject({ amount: "1900000", txHash: "0xpay" });
    expect(acc.resolveTxHash).toBe("0xacc");
    expect(res.json.summary).toMatchObject({
      earned: "1900000",
      pending: "1900000", // 2.00 reward minus 5% fee
      accepted: 1,
      inReview: 1,
      rejected: 1,
      token: { symbol: "USDG", decimals: 6 },
    });
  });

  it("is empty for a new contributor", async () => {
    const c = await seedContributor(h.db, h.now);
    const res = await call(mySubmissions, { token: c.token });
    expect(res.json.items).toEqual([]);
    expect(res.json.summary.earned).toBe("0");
  });
});

describe("offline queue support", () => {
  const PHOTO = Buffer.from("queued capture");
  const SHA = createHash("sha256").update(PHOTO).digest("hex");

  it("upload-url rejects a mocked location", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c = await seedContributor(h.db, h.now);
    const res = await call(uploadUrl, {
      token: c.token,
      body: {
        missionId: m.id,
        mediaType: "photo",
        contentType: "image/jpeg",
        contentLength: 10,
        gps: { lat: m.lat, lng: m.lng, accuracyMeters: 5, isMocked: true },
      },
    });
    expect(res.status).toBe(403);
    expect(res.json.error.details.reason).toBe("gps_mocked");
  });

  it("accepts a capture queued for hours (within the configured max age)", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c = await seedContributor(h.db, h.now);
    const capturedAt = new Date(h.now.getTime() - 3 * 3600_000).toISOString();

    const up = await call(uploadUrl, {
      token: c.token,
      body: {
        missionId: m.id,
        mediaType: "photo",
        contentType: "image/jpeg",
        contentLength: PHOTO.length,
        gps: { lat: m.lat, lng: m.lng, accuracyMeters: 5 },
      },
    });
    h.storage.put(h.storage.presigned.at(-1)!.key, PHOTO);
    const res = await call(finalize, {
      token: c.token,
      body: {
        submissionId: up.json.submissionId,
        capture: {
          missionId: m.id,
          source: "in_app_camera",
          mediaType: "photo",
          mediaSha256: SHA,
          capturedAt,
          gps: { lat: m.lat, lng: m.lng, accuracyMeters: 5, fixAt: capturedAt },
          device: { platform: "android", appVersion: "1.0.0", model: "Pixel 9", osVersion: "16" },
        },
      },
    });
    expect(res.status).toBe(201);
    const [row] = await h.db.select().from(submissions);
    expect(row!.deviceInfo).toMatchObject({ model: "Pixel 9", osVersion: "16" });
  });
});
