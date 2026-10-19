// @vitest-environment node
import { jobs, rateLimits } from "@seenit/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseEnv } from "../config";
import { AppError } from "../errors";
import { claimJob, completeJob, enqueueJob, failJob } from "../jobs";
import { enforceRateLimit } from "../rate-limit";
import { createHarness, type Harness } from "../testing/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

describe("rate limiting", () => {
  it("allows up to the limit per window, then 429 with Retry-After", async () => {
    const rule = { limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i++) await enforceRateLimit(h.db, "k", rule, h.now);
    const err = await enforceRateLimit(h.db, "k", rule, h.now).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(429);
    expect(Number(err.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(err.headers["retry-after"])).toBeLessThanOrEqual(60);
  });

  it("resets in the next window and keys are independent", async () => {
    const rule = { limit: 1, windowSeconds: 60 };
    await enforceRateLimit(h.db, "a", rule, h.now);
    await expect(enforceRateLimit(h.db, "a", rule, h.now)).rejects.toThrow();
    await enforceRateLimit(h.db, "b", rule, h.now);
    await enforceRateLimit(h.db, "a", rule, new Date(h.now.getTime() + 60_000));
    expect((await h.db.select().from(rateLimits)).length).toBe(3);
  });
});

describe("job queue", () => {
  it("claims each job once, in order, and respects run_after", async () => {
    const a = await enqueueJob(h.db, "t", { n: 1 });
    await enqueueJob(h.db, "other", { n: 2 });
    const first = await claimJob(h.db, "t", h.now);
    expect(first!.id).toBe(a.id);
    expect(first!.status).toBe("running");
    expect(first!.attempts).toBe(1);
    expect(await claimJob(h.db, "t", h.now)).toBeNull();
    await completeJob(h.db, a.id);
    expect((await h.db.select().from(jobs)).find((j) => j.id === a.id)!.status).toBe("done");
  });

  it("retries with backoff then fails permanently", async () => {
    const j = await enqueueJob(h.db, "t", {});
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await claimJob(
        h.db,
        "t",
        new Date(h.now.getTime() + attempt * 10 * 86_400_000),
      );
      expect(claimed!.attempts).toBe(attempt);
      await failJob(h.db, j.id, "boom", h.now, 3);
    }
    const [row] = await h.db.select().from(jobs);
    expect(row).toMatchObject({ status: "failed", lastError: "boom", attempts: 3 });
  });

  it("does not hand out a retried job before its backoff", async () => {
    const j = await enqueueJob(h.db, "t", {});
    await claimJob(h.db, "t", h.now);
    await failJob(h.db, j.id, "boom", h.now);
    expect(await claimJob(h.db, "t", h.now)).toBeNull();
    expect(await claimJob(h.db, "t", new Date(h.now.getTime() + 61_000))).not.toBeNull();
  });
});

describe("config", () => {
  const valid = {
    DATABASE_URL: "postgres://x",
    RPC_URL: "https://rpc.example",
    MISSION_ESCROW_ADDRESS: `0x${"1".repeat(40)}`,
    PERSONHOOD_REGISTRY_ADDRESS: `0x${"2".repeat(40)}`,
    REWARD_TOKEN_ADDRESS: `0x${"3".repeat(40)}`,
    OPERATOR_PRIVATE_KEY: `0x${"4".repeat(64)}`,
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "b",
    R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "d",
    SIWE_DOMAIN: "seenit.test",
    CRON_SECRET: "x".repeat(32),
  };

  it("parses a complete environment with defaults", () => {
    const env = parseEnv(valid);
    expect(env.CHAIN_ID).toBe(46630);
    expect(env.TIER1_MAX_REWARD).toBe(5_000_000n);
  });

  it("names every missing or invalid variable without echoing secrets", () => {
    expect(() =>
      parseEnv({ ...valid, OPERATOR_PRIVATE_KEY: "0xshort", R2_BUCKET: undefined }),
    ).toThrow(/OPERATOR_PRIVATE_KEY.*R2_BUCKET|R2_BUCKET.*OPERATOR_PRIVATE_KEY/);
    expect(() => parseEnv({ ...valid, OPERATOR_PRIVATE_KEY: "0xshort" })).not.toThrow(/0xshort/);
  });
});
