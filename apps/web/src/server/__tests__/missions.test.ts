// @vitest-environment node
import { apiKeys, eq, missions, submissions } from "@seenit/db";
import { canonicalJson, missionEscrowAbi } from "@seenit/shared";
import { decodeFunctionData, erc20Abi, keccak256, stringToBytes, type Hex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as confirm } from "@/app/api/missions/[id]/confirm/route";
import { GET as results } from "@/app/api/missions/[id]/results/route";
import { GET as nearby } from "@/app/api/missions/nearby/route";
import { POST as createMission } from "@/app/api/missions/route";

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

const spec = (overrides: Record<string, unknown> = {}) => ({
  title: "Is Luna Bakery open?",
  instructions: "Take one photo of the entrance and any posted notice.",
  mediaType: "photo",
  location: { lat: -6.175392, lng: 106.827153 },
  radiusMeters: 100,
  rewardPerSubmission: "1500000",
  maxSubmissions: 3,
  deadline: new Date(h.now.getTime() + 6 * 3600_000).toISOString(),
  outputSchema: { type: "object", properties: { is_open: { type: "boolean" } } },
  ...overrides,
});

describe("POST /api/missions", () => {
  it("requires a valid API key", async () => {
    expect((await call(createMission, { path: "/api/missions", body: spec() })).status).toBe(401);
    const bad = await call(createMission, {
      path: "/api/missions",
      apiKey: "sk_nope",
      body: spec(),
    });
    expect(bad.status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    const { key, funder } = await seedFunder(h.db);
    await h.db.update(apiKeys).set({ revokedAt: h.now }).where(eq(apiKeys.funderId, funder.id));
    expect(
      (await call(createMission, { path: "/api/missions", apiKey: key, body: spec() })).status,
    ).toBe(401);
  });

  it("stores only the hash of API keys", async () => {
    const { key } = await seedFunder(h.db);
    const [row] = await h.db.select().from(apiKeys);
    expect(row!.keyHash).not.toContain(key);
    expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.startsWith(row!.prefix)).toBe(true);
  });

  it("validates the body with Zod", async () => {
    const { key } = await seedFunder(h.db);
    const res = await call(createMission, {
      path: "/api/missions",
      apiKey: key,
      body: spec({ radiusMeters: 1, rewardPerSubmission: "0" }),
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("validation_failed");
    expect(JSON.stringify(res.json.error.details)).toMatch(/radiusMeters/);
  });

  it("rejects deadlines too soon or too far", async () => {
    const { key } = await seedFunder(h.db);
    const soon = new Date(h.now.getTime() + 60_000).toISOString();
    const far = new Date(h.now.getTime() + 100 * 86_400_000).toISOString();
    expect(
      (
        await call(createMission, {
          path: "/api/missions",
          apiKey: key,
          body: spec({ deadline: soon }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(createMission, {
          path: "/api/missions",
          apiKey: key,
          body: spec({ deadline: far }),
        })
      ).status,
    ).toBe(400);
  });

  it("saves the mission and returns the funding transactions", async () => {
    const { key, funder } = await seedFunder(h.db);
    const body = spec();
    const res = await call(createMission, { path: "/api/missions", apiKey: key, body });
    expect(res.status).toBe(201);
    const m = res.json.mission;
    expect(m.status).toBe("pending_funding");
    expect(m.minTier).toBe(1);

    const row = await h.db.query.missions.findFirst({ where: eq(missions.id, m.id) });
    expect(row!.funderId).toBe(funder.id);
    expect(row!.reward).toBe("1500000");

    // spec hash = keccak(canonical spec + id)
    const parsedSpec = { ...body, minTier: 1 };
    expect(m.specHash).toBe(keccak256(stringToBytes(canonicalJson({ ...parsedSpec, id: m.id }))));

    const f = res.json.funding;
    expect(f.total).toBe("4500000");
    expect(f.chainId).toBe(31337);
    const [approve, create] = f.transactions;
    expect(approve.to).toBe(h.chain.tokenAddress);
    const a = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    expect(a.functionName).toBe("approve");
    expect(a.args).toEqual([h.chain.escrowAddress, 4_500_000n]);

    expect(create.to).toBe(h.chain.escrowAddress);
    const c = decodeFunctionData({ abi: missionEscrowAbi, data: create.data });
    expect(c.functionName).toBe("createMission");
    expect(c.args).toEqual([
      1_500_000n,
      3,
      BigInt(Math.floor(new Date(body.deadline).getTime() / 1000)),
      1,
      m.specHash,
    ]);
  });

  it("applies the tier rule (reward above the Tier 1 cap needs Tier 2)", async () => {
    const { key } = await seedFunder(h.db);
    const res = await call(createMission, {
      path: "/api/missions",
      apiKey: key,
      body: spec({ rewardPerSubmission: "12000000" }),
    });
    expect(res.json.mission.minTier).toBe(2);
  });

  it("is rate limited per funder", async () => {
    const { key } = await seedFunder(h.db);
    for (let i = 0; i < 30; i++)
      await call(createMission, { path: "/api/missions", apiKey: key, body: spec({ title: "x" }) });
    const res = await call(createMission, { path: "/api/missions", apiKey: key, body: spec() });
    expect(res.status).toBe(429);
  });
});

describe("POST /api/missions/:id/confirm", () => {
  async function pending() {
    const f = await seedFunder(h.db);
    const res = await call(createMission, { path: "/api/missions", apiKey: f.key, body: spec() });
    return { ...f, mission: res.json.mission };
  }

  function mine(specHash: Hex, txHash: Hex = `0x${"cd".repeat(32)}`) {
    h.chain.minedMissions.set(txHash, {
      txHash,
      missionId: 7n,
      funder: "0x00000000000000000000000000000000000000f1",
      rewardPerCapture: 1_500_000n,
      maxCaptures: 3,
      deadline: 0n,
      minTier: 1,
      feeBps: 500,
      specHash,
    });
    return txHash;
  }

  it("activates the mission from the mined transaction", async () => {
    const { key, mission } = await pending();
    const txHash = mine(mission.specHash);
    const res = await call(confirm, { apiKey: key, params: { id: mission.id }, body: { txHash } });
    expect(res.status).toBe(200);
    expect(res.json.mission.status).toBe("active");
    expect(res.json.mission.onchainId).toBe("7");
    expect(res.json.mission.chainTxHash).toBe(txHash);
    const row = await h.db.query.missions.findFirst({ where: eq(missions.id, mission.id) });
    expect(row!.feeBps).toBe(500);
  });

  it("returns 409 when the tx is not mined yet", async () => {
    const { key, mission } = await pending();
    const res = await call(confirm, {
      apiKey: key,
      params: { id: mission.id },
      body: { txHash: `0x${"ee".repeat(32)}` },
    });
    expect(res.status).toBe(409);
  });

  it("returns 409 when the tx funded a different mission", async () => {
    const { key, mission } = await pending();
    const txHash = mine(`0x${"11".repeat(32)}`);
    const res = await call(confirm, { apiKey: key, params: { id: mission.id }, body: { txHash } });
    expect(res.status).toBe(409);
    expect(res.json.error.message).toMatch(/spec hash/);
  });

  it("hides other funders' missions", async () => {
    const { mission } = await pending();
    const other = await seedFunder(h.db, "Other");
    const res = await call(confirm, {
      apiKey: other.key,
      params: { id: mission.id },
      body: { txHash: mine(mission.specHash) },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/missions/nearby", () => {
  const monas = { lat: -6.175392, lng: 106.827153 };

  it("lists active missions within the radius, closest first", async () => {
    const { funder } = await seedFunder(h.db);
    const near = await seedActiveMission(h.db, funder.id, h.now, {
      title: "near",
      lat: monas.lat + 0.001,
      lng: monas.lng,
    });
    const closer = await seedActiveMission(h.db, funder.id, h.now, {
      title: "closer",
      lat: monas.lat,
      lng: monas.lng + 0.0001,
    });
    await seedActiveMission(h.db, funder.id, h.now, {
      title: "far",
      lat: monas.lat + 0.2,
      lng: monas.lng,
    }); // ~22 km
    await seedActiveMission(h.db, funder.id, h.now, {
      title: "pending",
      status: "pending_funding",
      onchainId: null,
    });
    await seedActiveMission(h.db, funder.id, h.now, {
      title: "expired",
      deadline: new Date(h.now.getTime() - 1000),
    });
    await seedActiveMission(h.db, funder.id, h.now, { title: "cancelled", status: "cancelled" });

    const res = await call(nearby, {
      path: `/api/missions/nearby?lat=${monas.lat}&lng=${monas.lng}`,
    });
    expect(res.status).toBe(200);
    expect(res.json.missions.map((m: { id: string }) => m.id)).toEqual([closer.id, near.id]);
    expect(res.json.missions[0].distanceMeters).toBeLessThan(20);
    expect(res.json.missions[1].distanceMeters).toBeGreaterThan(100);
    expect(res.json.missions[1].withinMissionRadius).toBe(false);
    expect(res.json.missions[0].withinMissionRadius).toBe(true);
    expect(res.json.missions[0].slotsLeft).toBe(3);
  });

  it("honours radiusKm and hides full missions", async () => {
    const { funder } = await seedFunder(h.db);
    const far = await seedActiveMission(h.db, funder.id, h.now, {
      lat: monas.lat + 0.2,
      lng: monas.lng,
    });
    const full = await seedActiveMission(h.db, funder.id, h.now, { maxCaptures: 1 });
    const c = await seedContributor(h.db, h.now);
    await h.db.insert(submissions).values({
      missionId: full.id,
      contributorId: c.user.id,
      mediaKey: "k",
      mediaType: "photo",
      status: "processing",
    });
    const res = await call(nearby, {
      path: `/api/missions/nearby?lat=${monas.lat}&lng=${monas.lng}&radiusKm=30`,
    });
    expect(res.json.missions.map((m: { id: string }) => m.id)).toEqual([far.id]);
  });

  it("validates the query", async () => {
    expect((await call(nearby, { path: "/api/missions/nearby?lat=abc&lng=1" })).status).toBe(400);
    expect((await call(nearby, { path: "/api/missions/nearby?lat=1" })).status).toBe(400);
    expect(
      (await call(nearby, { path: "/api/missions/nearby?lat=1&lng=1&radiusKm=500" })).status,
    ).toBe(400);
  });
});

describe("GET /api/missions/:id/results", () => {
  it("returns only accepted answers with blurred media and proof", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c1 = await seedContributor(h.db, h.now);
    const c2 = await seedContributor(h.db, h.now);
    const c3 = await seedContributor(h.db, h.now);
    const base = { missionId: m.id, mediaType: "photo" as const, capturedAt: h.now };
    await h.db.insert(submissions).values([
      {
        ...base,
        contributorId: c1.user.id,
        mediaKey: "submissions/a/original",
        blurredMediaKey: "submissions/a/blurred.jpg",
        mediaHash: "a".repeat(64),
        status: "accepted",
        aiResult: {
          answer: { is_open: false, sign_text: "Closed for renovation" },
          confidence: 0.97,
          reasoning: "The door has a closed notice.",
          needsReview: false,
          reviewReasons: [],
        },
        aiConfidence: 0.97,
        onchainId: 1n,
        recordTxHash: "0xrec",
        resolveTxHash: "0xacc",
      },
      {
        ...base,
        contributorId: c2.user.id,
        mediaKey: "submissions/b/original",
        status: "accepted",
        onchainId: 2n,
      },
      {
        ...base,
        contributorId: c3.user.id,
        mediaKey: "submissions/c/original",
        status: "processing",
        onchainId: 3n,
      },
    ]);

    const res = await call(results, { apiKey: key, params: { id: m.id } });
    expect(res.status).toBe(200);
    expect(res.json.results).toHaveLength(2);
    const [first, second] = res.json.results;
    expect(first.answer).toEqual({ is_open: false, sign_text: "Closed for renovation" });
    expect(first.confidence).toBeCloseTo(0.97);
    expect(first.media.url).toContain("blurred.jpg");
    expect(first.reasoning).toBe("The door has a closed notice.");
    expect(first.proof).toMatchObject({
      mediaSha256: "a".repeat(64),
      recordTxHash: "0xrec",
      acceptTxHash: "0xacc",
    });
    expect(second.media).toBeNull(); // no blurred copy yet: never fall back to the original
    expect(JSON.stringify(res.json)).not.toContain("/original");
    expect(JSON.stringify(res.json)).not.toContain(c1.user.wallet);
  });

  it("hides other funders' missions", async () => {
    const owner = await seedFunder(h.db);
    const other = await seedFunder(h.db, "Other");
    const m = await seedActiveMission(h.db, owner.funder.id, h.now);
    expect((await call(results, { apiKey: other.key, params: { id: m.id } })).status).toBe(404);
    expect((await call(results, { params: { id: m.id } })).status).toBe(401);
  });
});
