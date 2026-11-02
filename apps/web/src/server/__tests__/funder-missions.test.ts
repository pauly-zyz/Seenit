// @vitest-environment node
import { eq, missions, payouts, submissions } from "@seenit/db";
import { missionEscrowAbi } from "@seenit/shared";
import { decodeFunctionData, erc20Abi } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as meta } from "@/app/api/meta/route";
import { POST as cancel } from "@/app/api/missions/[id]/cancel/route";
import { GET as status } from "@/app/api/missions/[id]/status/route";
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
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const spec = (deadline: Date) => ({
  title: "Is Luna Bakery open?",
  instructions: "Photograph the entrance and any notice.",
  mediaType: "photo",
  location: { lat: -6.175, lng: 106.827 },
  radiusMeters: 100,
  rewardPerSubmission: "2000000",
  maxSubmissions: 3,
  deadline: deadline.toISOString(),
  outputSchema: {
    type: "object",
    properties: { is_open: { type: "boolean" } },
    required: ["is_open"],
  },
});

describe("GET /api/meta", () => {
  it("returns chain, escrow and token facts", async () => {
    const res = await call(meta);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      chainId: 31337,
      escrow: h.chain.escrowAddress,
      token: { address: h.chain.tokenAddress, symbol: "USDG", decimals: 6 },
      tier1MaxReward: "5000000",
    });
  });
});

describe("GET /api/missions/:id/status", () => {
  it("shows funding transactions while the mission is a draft", async () => {
    const { key } = await seedFunder(h.db);
    const created = await call(createMission, {
      apiKey: key,
      body: spec(new Date(h.now.getTime() + 86_400_000)),
    });
    const res = await call(status, { apiKey: key, params: { id: created.json.mission.id } });
    expect(res.status).toBe(200);
    expect(res.json.mission.status).toBe("pending_funding");
    expect(res.json.escrow.total).toBe("6000000");
    expect(res.json.funding.transactions).toHaveLength(2);
    expect(res.json.funding.transactions).toEqual(created.json.funding.transactions);
  });

  it("counts slots, submissions and payouts for a live mission", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const [a, b] = [await seedContributor(h.db, h.now), await seedContributor(h.db, h.now)];
    const [acc] = await h.db
      .insert(submissions)
      .values([
        {
          missionId: m.id,
          contributorId: a.user.id,
          mediaKey: "k1",
          mediaType: "photo",
          status: "accepted",
          onchainId: 1n,
        },
        {
          missionId: m.id,
          contributorId: b.user.id,
          mediaKey: "k2",
          mediaType: "photo",
          status: "needs_review",
          onchainId: 2n,
        },
      ])
      .returning();
    await h.db.insert(payouts).values({
      submissionId: acc!.id,
      contributorId: a.user.id,
      amount: "1900000",
      fee: "100000",
      txHash: "0xp",
    });

    const res = await call(status, { apiKey: key, params: { id: m.id } });
    expect(res.json).toMatchObject({
      slots: { total: 3, used: 2, left: 1 },
      submissions: { accepted: 1, needsReview: 1, ready: 0, processing: 0, rejected: 0 },
      escrow: { total: "6000000", paidToContributors: "1900000", platformFees: "100000" },
      funding: null,
    });
    const other = await seedFunder(h.db, "Other");
    expect((await call(status, { apiKey: other.key, params: { id: m.id } })).status).toBe(404);
  });
});

describe("POST /api/missions/:id/cancel", () => {
  it("closes an unfunded draft immediately", async () => {
    const { key } = await seedFunder(h.db);
    const created = await call(createMission, {
      apiKey: key,
      body: spec(new Date(h.now.getTime() + 86_400_000)),
    });
    const res = await call(cancel, {
      apiKey: key,
      params: { id: created.json.mission.id },
      body: {},
    });
    expect(res.json).toMatchObject({
      cancelled: true,
      mission: { status: "cancelled" },
      transactions: [],
    });
  });

  it("returns the cancelMission transaction, then verifies the mined tx", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const first = await call(cancel, { apiKey: key, params: { id: m.id }, body: {} });
    expect(first.json.cancelled).toBe(false);
    const [tx] = first.json.transactions;
    expect(tx.to).toBe(h.chain.escrowAddress);
    expect(decodeFunctionData({ abi: missionEscrowAbi, data: tx.data })).toMatchObject({
      functionName: "cancelMission",
      args: [m.onchainId],
    });
    expect(() => decodeFunctionData({ abi: erc20Abi, data: tx.data })).toThrow();

    const txHash = `0x${"ce".repeat(32)}`;
    const notMined = await call(cancel, { apiKey: key, params: { id: m.id }, body: { txHash } });
    expect(notMined.status).toBe(409);

    h.chain.minedCancels.set(txHash, { missionId: 999n, refunded: 1n });
    expect(
      (await call(cancel, { apiKey: key, params: { id: m.id }, body: { txHash } })).status,
    ).toBe(409);

    h.chain.minedCancels.set(txHash, { missionId: m.onchainId!, refunded: 6_000_000n });
    const done = await call(cancel, { apiKey: key, params: { id: m.id }, body: { txHash } });
    expect(done.json).toMatchObject({
      cancelled: true,
      refunded: "6000000",
      mission: { status: "cancelled" },
    });
    expect((await h.db.query.missions.findFirst({ where: eq(missions.id, m.id) }))!.status).toBe(
      "cancelled",
    );
  });

  it("rejects bad tx hashes and other funders", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    expect(
      (await call(cancel, { apiKey: key, params: { id: m.id }, body: { txHash: "0x12" } })).status,
    ).toBe(400);
    const other = await seedFunder(h.db, "Other");
    expect((await call(cancel, { apiKey: other.key, params: { id: m.id }, body: {} })).status).toBe(
      404,
    );
  });
});
