// @vitest-environment node
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { eq, funders, jobs, submissions } from "@seenit/db";
import { OUTPUT_SCHEMA_TEMPLATES } from "@seenit/shared";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { archiveContext, archiveKey, blurredFrameKey } from "../domain/processing";
import { enqueueJob, JOB_AI_PROCESS, JOB_PURGE_ORIGINAL, JOB_WEBHOOK } from "../jobs";
import { webhookSecretContext } from "../processing/webhooks";
import {
  createHarness,
  seedActiveMission,
  seedContributor,
  seedFunder,
  type Harness,
} from "../testing/harness";
import {
  blurryJpeg,
  darkJpeg,
  dummyVideo,
  FACE_BOX,
  PLATE_BOX,
  storefrontJpeg,
  storefrontJpegWithExif,
} from "../testing/media-fixtures";
import { createWorkerHarness, FakeVision } from "../testing/processing-fakes";
import { runNextJob } from "../worker";

let h: Harness;
let w: ReturnType<typeof createWorkerHarness>;

beforeAll(async () => {
  h = await createHarness();
  w = createWorkerHarness(h);
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  w.reset();
});

let seq = 0;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A recorded (status processing) submission with its upload in storage and the AI job queued. */
async function seedRecorded(
  opts: {
    bytes?: Buffer;
    mediaType?: "photo" | "video";
    mission?: Parameters<typeof seedActiveMission>[3];
    webhook?: boolean;
  } = {},
) {
  const { funder, key } = await seedFunder(h.db);
  if (opts.webhook) {
    await h.db
      .update(funders)
      .set({
        webhookUrl: "https://hooks.acme.test/seenit",
        webhookSecretEnc: h.services.cipher!.encryptString(
          "whsec_test",
          webhookSecretContext(funder.id),
        ),
      })
      .where(eq(funders.id, funder.id));
  }
  const mission = await seedActiveMission(h.db, funder.id, h.now, {
    mediaType: opts.mediaType ?? "photo",
    ...opts.mission,
  });
  const c = await seedContributor(h.db, h.now);
  seq++;
  const bytes = opts.bytes ?? (await storefrontJpeg({ text: `LUNA BAKERY ${seq}` }));
  const mediaKey = `submissions/${mission.id}/${c.user.id}/original`;
  h.storage.put(mediaKey, bytes, opts.mediaType === "video" ? "video/mp4" : "image/jpeg");
  const [sub] = await h.db
    .insert(submissions)
    .values({
      missionId: mission.id,
      contributorId: c.user.id,
      mediaKey,
      mediaHash: sha(bytes),
      mediaType: opts.mediaType ?? "photo",
      lat: mission.lat,
      lng: mission.lng,
      capturedAt: h.now,
      status: "processing",
      onchainId: BigInt(1000 + seq),
      recordTxHash: "0xrec",
      reviewDeadline: new Date(h.now.getTime() + 3 * 86_400_000),
    })
    .returning();
  await enqueueJob(h.db, JOB_AI_PROCESS, { submissionId: sub!.id }, h.now);
  return { funder, key, mission, contributor: c, sub: sub!, bytes, mediaKey };
}

const reload = async (id: string) =>
  (await h.db.query.submissions.findFirst({ where: eq(submissions.id, id) }))!;
const ai = (row: { aiResult: unknown }) => row.aiResult as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("processSubmission (photo)", () => {
  it("blurs faces and plates, extracts the answer and marks the submission ready", async () => {
    w.privacy.next = [
      { frame: 0, kind: "face", box: FACE_BOX },
      { frame: 0, kind: "license_plate", box: PLATE_BOX },
    ];
    w.vision.next = FakeVision.answer({ is_open: true }, { confidence: 0.95 });
    const { sub, bytes, mediaKey } = await seedRecorded({ bytes: await storefrontJpegWithExif() });

    const res = await runNextJob(w.ws);
    expect(res).toMatchObject({ type: JOB_AI_PROCESS, ok: true, result: { outcome: "ready" } });

    const row = await reload(sub.id);
    expect(row.status).toBe("ready");
    expect(row.aiConfidence).toBeCloseTo(0.95);
    expect(ai(row)).toMatchObject({
      answer: { is_open: true },
      needsReview: false,
      reviewReasons: [],
      privacy: { faces: 1, licensePlates: 1, checked: true },
      media: { frames: 1, durationSeconds: null },
      model: "claude-opus-5-5",
    });

    // The funder copy is blurred and has no metadata; the model only ever saw blurred frames.
    expect(row.blurredMediaKey).toBe(blurredFrameKey(sub.id, 0));
    expect(row.blurredFrameKeys).toEqual([blurredFrameKey(sub.id, 0)]);
    const blurred = h.storage.objects.get(blurredFrameKey(sub.id, 0))!.bytes;
    expect((await sharp(blurred).metadata()).exif).toBeUndefined();
    expect(w.vision.calls[0]!.frames[0]!.jpeg.equals(blurred)).toBe(true);
    expect(w.privacy.calls[0]![0]!.jpeg.equals(blurred)).toBe(false);

    // The plaintext upload is gone; an encrypted copy remains for disputes and decrypts to the original.
    expect(h.storage.objects.has(mediaKey)).toBe(false);
    expect(row.originalArchiveKey).toBe(archiveKey(sub.id));
    const archived = h.storage.objects.get(archiveKey(sub.id))!.bytes;
    expect(archived.includes(bytes.subarray(0, 64))).toBe(false);
    expect(sha(h.services.cipher!.decrypt(archived, archiveContext(sub.id)))).toBe(sub.mediaHash);
    expect(row.originalPurgeAt).toEqual(new Date(h.now.getTime() + 30 * 86_400_000));

    const queued = await h.db.select().from(jobs).where(eq(jobs.type, JOB_PURGE_ORIGINAL));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.runAfter).toEqual(row.originalPurgeAt);
  });

  it.each([
    [
      "low confidence",
      () => FakeVision.answer({ is_open: true }, { confidence: 0.4 }),
      ["low_confidence"],
    ],
    [
      "no answer",
      () => FakeVision.answer(null, { confidence: 0.2 }),
      ["no_answer", "low_confidence"],
    ],
    [
      "screen recapture",
      () =>
        FakeVision.answer(
          { is_open: true },
          {
            quality: {
              relevant: true,
              blurry: false,
              too_dark: false,
              screen_capture: true,
              notes: "Moiré",
            },
          },
        ),
      ["screen_capture"],
    ],
    [
      "irrelevant capture",
      () =>
        FakeVision.answer(
          { is_open: false },
          {
            quality: {
              relevant: false,
              blurry: false,
              too_dark: false,
              screen_capture: false,
              notes: "",
            },
          },
        ),
      ["not_relevant"],
    ],
    ["invalid answer", () => FakeVision.answer({ is_open: "maybe" }), ["answer_invalid"]],
    [
      "refusal",
      () => ({ kind: "refused" as const, category: null, model: "claude-opus-5-5" }),
      ["ai_refused"],
    ],
  ])("flags %s as needs_review", async (_name, outcome, reasons) => {
    w.vision.next = outcome();
    const { sub } = await seedRecorded();
    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.status).toBe("needs_review");
    expect(ai(row).needsReview).toBe(true);
    expect(ai(row).reviewReasons).toEqual(expect.arrayContaining(reasons));
  });

  it("flags blurry and dark captures from its own measurements, even if the model doesn't", async () => {
    const blurry = await seedRecorded({ bytes: await blurryJpeg() });
    await runNextJob(w.ws);
    expect(ai(await reload(blurry.sub.id)).reviewReasons).toContain("blurry");

    const dark = await seedRecorded({ bytes: await darkJpeg() });
    await runNextJob(w.ws);
    const row = await reload(dark.sub.id);
    expect(row.status).toBe("needs_review");
    expect(ai(row).reviewReasons).toContain("too_dark");
    expect(ai(row).quality.frames[0].meanLuma).toBeLessThan(35);
  });

  it("validates answers against the funder's schema constraints and drops nulls for optional fields", async () => {
    const schema = OUTPUT_SCHEMA_TEMPLATES.stock_check.outputSchema;
    w.vision.next = FakeVision.answer({
      product_visible: true,
      stock_level: "low",
      facings_count: 3,
      price_text: "Rp 12.500",
      notes: null,
    });
    const ok = await seedRecorded({ mission: { outputSchema: schema } });
    await runNextJob(w.ws);
    const okRow = await reload(ok.sub.id);
    expect(okRow.status).toBe("ready");
    expect(ai(okRow).answer).toEqual({
      product_visible: true,
      stock_level: "low",
      facings_count: 3,
      price_text: "Rp 12.500",
    });

    w.vision.next = FakeVision.answer({
      product_visible: true,
      stock_level: "low",
      facings_count: -2,
      price_text: null,
      notes: null,
    });
    const bad = await seedRecorded({ mission: { outputSchema: schema } });
    await runNextJob(w.ws);
    expect(ai(await reload(bad.sub.id)).reviewReasons).toContain("answer_invalid"); // minimum: 0
  });

  it("fails closed when face/plate detection is declined: nothing is published or analyzed", async () => {
    w.privacy.next = null;
    const { sub, mediaKey } = await seedRecorded();
    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.status).toBe("needs_review");
    expect(ai(row).reviewReasons).toContain("privacy_check_unavailable");
    expect(row.blurredMediaKey).toBeNull();
    expect(row.blurredFrameKeys).toEqual([]);
    expect(w.vision.calls).toHaveLength(0);
    expect([...h.storage.objects.keys()].filter((k) => k.startsWith("blurred/"))).toEqual([]);
    expect(h.storage.objects.has(mediaKey)).toBe(false); // still archived encrypted
  });

  it("flags unreadable media and a hash that doesn't match the on-chain record", async () => {
    const { sub } = await seedRecorded({ bytes: Buffer.from("not an image at all".repeat(20)) });
    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.status).toBe("needs_review");
    expect(ai(row).reviewReasons).toEqual(["unreadable_media"]);

    const other = await seedRecorded();
    h.storage.put(other.mediaKey, await storefrontJpeg({ text: "SWAPPED" }));
    await runNextJob(w.ws);
    expect(ai(await reload(other.sub.id)).reviewReasons).toContain("media_hash_mismatch");
  });

  it("is idempotent and doesn't override a decision already made on-chain", async () => {
    const { sub } = await seedRecorded();
    await h.db.update(submissions).set({ status: "accepted" }).where(eq(submissions.id, sub.id));
    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.status).toBe("accepted");
    expect(ai(row).answer).toEqual({ is_open: true });

    await enqueueJob(h.db, JOB_AI_PROCESS, { submissionId: sub.id }, h.now);
    expect(await runNextJob(w.ws)).toMatchObject({
      ok: true,
      result: { outcome: "already_processed" },
    });
    expect(w.vision.calls).toHaveLength(1);
  });

  it("only archives the original when the funder rejected before processing", async () => {
    const { sub, mediaKey } = await seedRecorded();
    await h.db.update(submissions).set({ status: "rejected" }).where(eq(submissions.id, sub.id));
    expect(await runNextJob(w.ws)).toMatchObject({ result: { outcome: "archived_only" } });
    const row = await reload(sub.id);
    expect(row.status).toBe("rejected");
    expect(row.aiResult).toBeNull();
    expect(row.originalArchiveKey).toBe(archiveKey(sub.id));
    expect(h.storage.objects.has(mediaKey)).toBe(false);
    expect(w.privacy.calls).toHaveLength(0);
  });
});

describe("processSubmission (video)", () => {
  it("analyzes blurred key frames and checks the real duration", async () => {
    const path = join(w.ws.tmpDir, "clip.mp4");
    await dummyVideo(path, 12);
    const bytes = await readFile(path);
    w.privacy.next = [{ frame: 1, kind: "face", box: FACE_BOX }];
    w.vision.next = FakeVision.answer({
      crowd_level: "light",
      estimated_people: 4,
      queue_present: false,
      estimated_wait_minutes: null,
    });
    const { sub } = await seedRecorded({
      bytes,
      mediaType: "video",
      mission: {
        mediaType: "video",
        maxVideoSeconds: 8,
        outputSchema: OUTPUT_SCHEMA_TEMPLATES.crowd_level.outputSchema,
      },
    });

    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.blurredFrameKeys).toEqual([0, 1, 2].map((i) => blurredFrameKey(sub.id, i)));
    expect(w.vision.calls[0]!.frames.map((f) => f.atSeconds)).toEqual([2, 6, 10]);
    expect(ai(row).media).toMatchObject({ frames: 3 });
    expect(ai(row).media.durationSeconds).toBeCloseTo(12, 0);
    expect(ai(row).answer).toEqual({
      crowd_level: "light",
      estimated_people: 4,
      queue_present: false,
    });
    expect(ai(row).reviewReasons).toEqual(["video_too_long"]); // 12 s for an 8 s mission
  });
});

describe("worker retries", () => {
  it("retries model errors with backoff and needs_review after the last attempt", async () => {
    w.vision.next = new Error("overloaded");
    const { sub, mediaKey } = await seedRecorded();

    const first = await runNextJob(w.ws);
    expect(first).toMatchObject({ ok: false, gaveUp: false, error: "overloaded" });
    // Nothing was archived or deleted by the failed attempt... except the blurred frames, re-written next time.
    expect(h.storage.objects.has(mediaKey)).toBe(true);
    expect((await reload(sub.id)).status).toBe("processing");

    for (let i = 0; i < 4; i++) {
      h.advance(24 * 3600_000);
      await runNextJob(w.ws);
    }
    const row = await reload(sub.id);
    expect(row.status).toBe("needs_review");
    expect(ai(row).reviewReasons).toEqual(["processing_failed"]);
    const [job] = await h.db.select().from(jobs).where(eq(jobs.type, JOB_AI_PROCESS));
    expect(job).toMatchObject({ status: "failed", attempts: 5 });
  });

  it("recovers from the encrypted archive when the plaintext was already removed", async () => {
    const { sub, mediaKey, bytes } = await seedRecorded();
    // Simulate a crash after archiving: plaintext gone, archive present, row not finished.
    h.storage.objects.set(archiveKey(sub.id), {
      bytes: h.services.cipher!.encrypt(bytes, archiveContext(sub.id)),
      contentType: "application/octet-stream",
    });
    h.storage.objects.delete(mediaKey);
    await runNextJob(w.ws);
    const row = await reload(sub.id);
    expect(row.status).toBe("ready");
    expect(ai(row).reviewReasons).toEqual([]);
  });
});

describe("purge and webhooks", () => {
  it("deletes the encrypted original when the retention period ends", async () => {
    const { sub } = await seedRecorded();
    await runNextJob(w.ws);
    expect(await runNextJob(w.ws)).toBeNull(); // purge job is not due yet

    h.advance(30 * 86_400_000);
    expect(await runNextJob(w.ws)).toMatchObject({
      type: JOB_PURGE_ORIGINAL,
      result: { outcome: "purged" },
    });
    const row = await reload(sub.id);
    expect(row.originalArchiveKey).toBeNull();
    expect(row.originalPurgedAt).toEqual(h.now);
    expect(h.storage.objects.has(archiveKey(sub.id))).toBe(false);
    expect(h.storage.objects.has(blurredFrameKey(sub.id, 0))).toBe(true); // funder copy stays
  });

  it("notifies the funder with a signed webhook and retries failures", async () => {
    const { sub, mission } = await seedRecorded({ webhook: true });
    await runNextJob(w.ws); // AI job → queues the webhook

    w.webhooks.status = 503;
    expect(await runNextJob(w.ws)).toMatchObject({ type: JOB_WEBHOOK, ok: false });
    h.advance(10 * 60_000);
    w.webhooks.status = 204;
    expect(await runNextJob(w.ws)).toMatchObject({ type: JOB_WEBHOOK, ok: true });

    const sent = w.webhooks.sent.at(-1)!;
    expect(sent.url).toBe("https://hooks.acme.test/seenit");
    expect(sent.headers["seenit-event"]).toBe("submission.processed");
    const body = JSON.parse(sent.body);
    expect(body.data).toMatchObject({
      submissionId: sub.id,
      missionId: mission.id,
      status: "ready",
      needsReview: false,
      answer: { is_open: true },
    });
    expect(sent.body).not.toContain("original");
    // Receiver-side verification.
    const [, t, v1] = sent.headers["seenit-signature"]!.match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    expect(createHmac("sha256", "whsec_test").update(`${t}.${sent.body}`).digest("hex")).toBe(v1);
    expect(w.webhooks.sent[0]!.headers["seenit-delivery"]).toBe(sent.headers["seenit-delivery"]);
  });

  it("queues no webhook when the funder has none", async () => {
    await seedRecorded();
    await runNextJob(w.ws);
    expect(await h.db.select().from(jobs).where(eq(jobs.type, JOB_WEBHOOK))).toHaveLength(0);
  });
});
