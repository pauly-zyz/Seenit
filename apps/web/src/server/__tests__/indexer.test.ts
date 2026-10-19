// @vitest-environment node
import { chainEvents, eq, indexerState, jobs, missions, payouts, submissions } from "@seenit/db";
import { stringToHex, type Hex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as cron } from "@/app/api/cron/indexer/route";

import type { EscrowEvent } from "../chain/types";
import { syncEscrowEvents } from "../domain/indexer";
import { decodeReason } from "../domain/sync";
import {
  call,
  createHarness,
  seedActiveMission,
  seedContributor,
  seedFunder,
  testConfig,
  type Harness,
} from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const tx = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
let logIndex = 0;
function ev<E extends EscrowEvent["name"]>(
  name: E,
  args: Extract<EscrowEvent, { name: E }>["args"],
  block: bigint,
  txHash: Hex = tx(++logIndex),
): EscrowEvent {
  return { name, args, txHash, logIndex: logIndex++, blockNumber: block } as EscrowEvent;
}

describe("syncEscrowEvents", () => {
  it("activates missions created on-chain and closes cancelled ones", async () => {
    const { funder } = await seedFunder(h.db);
    const pending = await seedActiveMission(h.db, funder.id, h.now, {
      status: "pending_funding",
      onchainId: null,
    });
    const other = await seedActiveMission(h.db, funder.id, h.now, { onchainId: 55n });
    h.chain.events.push(
      ev(
        "MissionCreated",
        {
          missionId: 9n,
          funder: "0x00000000000000000000000000000000000000f1",
          rewardPerCapture: 2_000_000n,
          maxCaptures: 3,
          deadline: 0n,
          minTier: 2,
          feeBps: 250,
          specHash: pending.specHash as Hex,
        },
        5n,
      ),
      ev("MissionCancelled", { missionId: 55n, refunded: 6_000_000n }, 6n),
    );
    h.chain.blockNumber = 10n;

    const r = await syncEscrowEvents(h.services);
    expect(r).toMatchObject({ fromBlock: 0n, toBlock: 10n, applied: 2, caughtUp: true });

    const m = await h.db.query.missions.findFirst({ where: eq(missions.id, pending.id) });
    expect(m).toMatchObject({ status: "active", onchainId: 9n, minTier: 2, feeBps: 250 });
    const c = await h.db.query.missions.findFirst({ where: eq(missions.id, other.id) });
    expect(c!.status).toBe("cancelled");
  });

  it("records payouts for permissionless finalize and is idempotent", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c = await seedContributor(h.db, h.now);
    const [s] = await h.db
      .insert(submissions)
      .values({
        missionId: m.id,
        contributorId: c.user.id,
        mediaKey: "k",
        mediaType: "photo",
        status: "processing",
        onchainId: 4n,
      })
      .returning();
    const accepted = ev(
      "SubmissionAccepted",
      {
        submissionId: 4n,
        missionId: m.onchainId!,
        contributor: c.account.address,
        payout: 1_900_000n,
        fee: 100_000n,
        finalized: true,
      },
      3n,
    );
    h.chain.events.push(accepted);
    h.chain.blockNumber = 3n;
    await syncEscrowEvents(h.services);

    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, s!.id) });
    expect(row!.status).toBe("accepted");
    const [p] = await h.db.select().from(payouts);
    expect(p).toMatchObject({ finalized: true, amount: "1900000" });

    // Re-scan the same range (cursor reset): nothing applied twice.
    await h.db.delete(indexerState);
    const again = await syncEscrowEvents(h.services);
    expect(again.applied).toBe(0);
    expect(await h.db.select().from(payouts)).toHaveLength(1);
    expect(await h.db.select().from(chainEvents)).toHaveLength(1);
  });

  it("reconciles a submission whose API request died after the tx", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c = await seedContributor(h.db, h.now);
    const hash = "c".repeat(64);
    const [s] = await h.db
      .insert(submissions)
      .values({
        missionId: m.id,
        contributorId: c.user.id,
        mediaKey: "k",
        mediaType: "photo",
        status: "chain_failed",
        mediaHash: hash,
      })
      .returning();
    h.chain.events.push(
      ev(
        "SubmissionRecorded",
        {
          submissionId: 12n,
          missionId: m.onchainId!,
          contributor: c.account.address,
          mediaHash: `0x${hash}`,
          reviewDeadline: 2_000_000_000n,
        },
        1n,
      ),
    );
    h.chain.blockNumber = 1n;
    await syncEscrowEvents(h.services);
    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, s!.id) });
    expect(row).toMatchObject({ status: "processing", onchainId: 12n });
    expect(await h.db.select().from(jobs)).toHaveLength(1);
  });

  it("applies rejections with a readable reason", async () => {
    const { funder } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const c = await seedContributor(h.db, h.now);
    const [s] = await h.db
      .insert(submissions)
      .values({
        missionId: m.id,
        contributorId: c.user.id,
        mediaKey: "k",
        mediaType: "photo",
        status: "ready",
        onchainId: 8n,
      })
      .returning();
    h.chain.events.push(
      ev(
        "SubmissionRejected",
        {
          submissionId: 8n,
          missionId: m.onchainId!,
          reason: stringToHex("blurry", { size: 32 }),
          refunded: 0n,
        },
        2n,
      ),
    );
    h.chain.blockNumber = 2n;
    await syncEscrowEvents(h.services);
    const row = await h.db.query.submissions.findFirst({ where: eq(submissions.id, s!.id) });
    expect(row).toMatchObject({ status: "rejected", rejectionReasons: ["blurry"] });
  });

  it("walks the chain in batches and remembers the cursor", async () => {
    h.chain.blockNumber = 25n;
    const first = await syncEscrowEvents(h.services, { maxBlocks: 10n });
    expect(first).toMatchObject({ fromBlock: 0n, toBlock: 9n, caughtUp: false });
    const second = await syncEscrowEvents(h.services, { maxBlocks: 10n });
    expect(second).toMatchObject({ fromBlock: 10n, toBlock: 19n });
    const third = await syncEscrowEvents(h.services, { maxBlocks: 10n });
    expect(third).toMatchObject({ fromBlock: 20n, toBlock: 25n, caughtUp: true });
    const idle = await syncEscrowEvents(h.services, { maxBlocks: 10n });
    expect(idle.caughtUp).toBe(true);
    expect(idle.applied).toBe(0);
  });

  it("starts from the configured block", async () => {
    h.services.config = { ...testConfig, indexerStartBlock: 100n };
    h.chain.blockNumber = 120n;
    const r = await syncEscrowEvents(h.services);
    expect(r.fromBlock).toBe(100n);
    h.services.config = testConfig;
  });

  it("decodes bytes32 reasons", () => {
    expect(decodeReason(stringToHex("ok", { size: 32 }))).toBe("ok");
    expect(decodeReason(stringToHex("x".repeat(32), { size: 32 }))).toBe("x".repeat(32));
  });
});

describe("GET /api/cron/indexer", () => {
  it("requires the cron secret", async () => {
    expect((await call(cron, { path: "/api/cron/indexer" })).status).toBe(401);
    expect(
      (await call(cron, { path: "/api/cron/indexer", headers: { authorization: "Bearer wrong" } }))
        .status,
    ).toBe(401);
  });

  it("runs the indexer until caught up", async () => {
    h.chain.blockNumber = 5n;
    const res = await call(cron, {
      path: "/api/cron/indexer",
      headers: { authorization: `Bearer ${testConfig.cronSecret}` },
    });
    expect(res.status).toBe(200);
    expect(res.json.runs.at(-1).caughtUp).toBe(true);
    const state = await h.db.select().from(indexerState);
    expect(state[0]!.lastBlock).toBe(5n);
  });
});
