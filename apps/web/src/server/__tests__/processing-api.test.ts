// @vitest-environment node
import { eq, funders, jobs, submissions } from "@seenit/db";
import { OUTPUT_TEMPLATE_IDS } from "@seenit/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as templates } from "@/app/api/mission-templates/route";
import { GET as reviewList } from "@/app/api/missions/[id]/submissions/route";
import {
  DELETE as delWebhook,
  GET as getWebhook,
  PUT as putWebhook,
} from "@/app/api/webhook/route";

import { blurredFrameKey } from "../domain/processing";
import { enqueueJob, JOB_AI_PROCESS, requeueStaleJobs } from "../jobs";
import {
  checkWebhookUrl,
  FetchWebhookSender,
  isPrivateAddress,
  signWebhook,
  webhookSecretContext,
} from "../processing/webhooks";
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

describe("webhook URL safety", () => {
  it.each([
    ["https://hooks.acme.com/seenit", true],
    ["http://hooks.acme.com/seenit", false],
    ["https://localhost/x", false],
    ["https://127.0.0.1/x", false],
    ["https://10.1.2.3/x", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://[::1]/x", false],
    ["https://user:pass@hooks.acme.com/", false],
    ["not a url", false],
  ])("%s → allowed=%s", (url, ok) => {
    if (ok) expect(() => checkWebhookUrl(url, { allowHttp: false })).not.toThrow();
    else expect(() => checkWebhookUrl(url, { allowHttp: false })).toThrow();
  });

  it("classifies private addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::ffff:127.0.0.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"])
      expect(isPrivateAddress(ip)).toBe(false);
  });

  it("refuses hosts that resolve to private addresses (DNS rebinding) and never follows redirects", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = (async (_u: URL, init: RequestInit) => {
      seen.push(init);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const evil = new FetchWebhookSender({ allowHttp: false }, async () => ["10.0.0.5"], fetchFn);
    await expect(evil.post("https://hooks.evil.test/x", {}, "{}")).rejects.toThrow(/non-public/);
    expect(seen).toHaveLength(0);

    const good = new FetchWebhookSender(
      { allowHttp: false },
      async () => ["93.184.216.34"],
      fetchFn,
    );
    expect(await good.post("https://hooks.acme.test/x", { "seenit-event": "e" }, "{}")).toEqual({
      status: 204,
    });
    expect(seen[0]).toMatchObject({ method: "POST", redirect: "manual", body: "{}" });
  });

  it("signs payloads with a timestamped HMAC", () => {
    expect(signWebhook("s", 1700000000, '{"a":1}')).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(signWebhook("s", 1700000000, '{"a":1}')).not.toBe(
      signWebhook("s", 1700000001, '{"a":1}'),
    );
  });
});

describe("/api/webhook", () => {
  it("sets a webhook, returns the secret once, and stores it encrypted", async () => {
    const { funder, key } = await seedFunder(h.db);
    const res = await call(putWebhook, {
      method: "PUT",
      apiKey: key,
      body: { url: "https://hooks.acme.com/seenit" },
    });
    expect(res.status).toBe(200);
    expect(res.json.secret).toMatch(/^whsec_/);

    const row = (await h.db.query.funders.findFirst({ where: eq(funders.id, funder.id) }))!;
    expect(row.webhookUrl).toBe("https://hooks.acme.com/seenit");
    expect(row.webhookSecretEnc).not.toContain(res.json.secret);
    expect(
      h.services.cipher!.decryptString(row.webhookSecretEnc!, webhookSecretContext(funder.id)),
    ).toBe(res.json.secret);

    const got = await call(getWebhook, { apiKey: key });
    expect(got.json).toEqual({
      url: "https://hooks.acme.com/seenit",
      events: ["submission.processed"],
    });
    expect(JSON.stringify(got.json)).not.toContain("whsec_");

    await call(delWebhook, { method: "DELETE", apiKey: key });
    expect((await call(getWebhook, { apiKey: key })).json.url).toBeNull();
  });

  it("rejects unsafe URLs and requires an API key", async () => {
    const { key } = await seedFunder(h.db);
    const bad = await call(putWebhook, {
      method: "PUT",
      apiKey: key,
      body: { url: "https://169.254.169.254/" },
    });
    expect(bad.status).toBe(400);
    expect((await call(putWebhook, { method: "PUT", body: { url: "https://a.com" } })).status).toBe(
      401,
    );
  });
});

describe("GET /api/missions/:id/submissions (review queue)", () => {
  it("lists AI results with blurred frames, needs_review first, and never exposes originals", async () => {
    const { funder, key } = await seedFunder(h.db);
    const m = await seedActiveMission(h.db, funder.id, h.now);
    const [c1, c2, c3] = [
      await seedContributor(h.db, h.now),
      await seedContributor(h.db, h.now),
      await seedContributor(h.db, h.now),
    ];
    const base = { missionId: m.id, mediaType: "photo" as const, capturedAt: h.now };
    const [ready, review] = await h.db
      .insert(submissions)
      .values([
        {
          ...base,
          contributorId: c1.user.id,
          mediaKey: "submissions/x/original",
          mediaHash: "1".repeat(64),
          status: "ready",
          onchainId: 501n,
          blurredMediaKey: "blurred/r/frame-0.jpg",
          blurredFrameKeys: ["blurred/r/frame-0.jpg"],
          aiResult: {
            answer: { is_open: true },
            confidence: 0.9,
            reasoning: "Open sign",
            needsReview: false,
            reviewReasons: [],
          },
          aiConfidence: 0.9,
        },
        {
          ...base,
          contributorId: c2.user.id,
          mediaKey: "submissions/y/original",
          mediaHash: "2".repeat(64),
          status: "needs_review",
          onchainId: 502n,
          aiResult: {
            answer: null,
            confidence: 0.3,
            reasoning: "Too dark",
            needsReview: true,
            reviewReasons: ["too_dark", "low_confidence"],
          },
          aiConfidence: 0.3,
        },
        {
          ...base,
          contributorId: c3.user.id,
          mediaKey: "submissions/z/original",
          status: "awaiting_upload",
        },
      ])
      .returning();

    const res = await call(reviewList, { apiKey: key, params: { id: m.id } });
    expect(res.status).toBe(200);
    expect(res.json.submissions.map((s: { submissionId: string }) => s.submissionId)).toEqual([
      review!.id,
      ready!.id,
    ]);
    const [first, second] = res.json.submissions;
    expect(first.ai).toMatchObject({
      needsReview: true,
      reviewReasons: ["too_dark", "low_confidence"],
    });
    expect(first.media).toBeNull();
    expect(second.media.frames[0].url).toContain("blurred/r/frame-0.jpg");
    expect(second.ai.answer).toEqual({ is_open: true });
    expect(JSON.stringify(res.json)).not.toContain("/original");
    expect(JSON.stringify(res.json)).not.toContain(c1.user.wallet);

    const filtered = await call(reviewList, {
      apiKey: key,
      params: { id: m.id },
      path: "/?status=needs_review",
    });
    expect(filtered.json.submissions).toHaveLength(1);

    const other = await seedFunder(h.db, "Other");
    expect((await call(reviewList, { apiKey: other.key, params: { id: m.id } })).status).toBe(404);
    expect(blurredFrameKey("r", 0)).toBe("blurred/r/frame-0.jpg");
  });
});

describe("GET /api/mission-templates", () => {
  it("returns the five ready-made output schemas", async () => {
    const res = await call(templates);
    expect(res.status).toBe(200);
    expect(res.json.templates.map((t: { id: string }) => t.id)).toEqual([...OUTPUT_TEMPLATE_IDS]);
    expect(OUTPUT_TEMPLATE_IDS).toEqual([
      "stock_check",
      "store_open",
      "construction_progress",
      "billboard_proof",
      "crowd_level",
    ]);
  });
});

describe("requeueStaleJobs", () => {
  it("puts back jobs a dead worker left running", async () => {
    const job = await enqueueJob(
      h.db,
      JOB_AI_PROCESS,
      { submissionId: crypto.randomUUID() },
      h.now,
    );
    await h.db
      .update(jobs)
      .set({ status: "running", lockedAt: new Date(h.now.getTime() - 3600_000) })
      .where(eq(jobs.id, job.id));
    expect(await requeueStaleJobs(h.db, h.now, 30 * 60_000)).toBe(1);
    expect((await h.db.query.jobs.findFirst({ where: eq(jobs.id, job.id) }))!.status).toBe(
      "queued",
    );
    expect(await requeueStaleJobs(h.db, h.now, 30 * 60_000)).toBe(0);
  });
});
