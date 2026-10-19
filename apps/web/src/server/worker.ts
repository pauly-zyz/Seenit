import type { InferSelectModel, jobs } from "@seenit/db";
import { z } from "zod";

import {
  deliverWebhook,
  markProcessingFailed,
  processSubmission,
  purgeOriginal,
} from "./domain/processing";
import {
  claimJob,
  completeJob,
  failJob,
  JOB_AI_PROCESS,
  JOB_PURGE_ORIGINAL,
  JOB_WEBHOOK,
  requeueStaleJobs,
} from "./jobs";
import type { WorkerServices } from "./processing/services";

type Job = InferSelectModel<typeof jobs>;

interface Handler {
  maxAttempts: number;
  run(ws: WorkerServices, job: Job): Promise<unknown>;
  /** Called once when the job has failed for good. */
  onGiveUp?(ws: WorkerServices, job: Job, error: string): Promise<void>;
}

const submissionPayload = z.object({ submissionId: z.uuid() });
const webhookPayload = z.object({
  funderId: z.uuid(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const JOB_HANDLERS: Record<string, Handler> = {
  [JOB_AI_PROCESS]: {
    maxAttempts: 5,
    run: (ws, job) => processSubmission(ws, submissionPayload.parse(job.payload).submissionId),
    onGiveUp: (ws, job, error) =>
      markProcessingFailed(ws, submissionPayload.parse(job.payload).submissionId, error),
  },
  [JOB_WEBHOOK]: {
    maxAttempts: 8,
    run: (ws, job) => deliverWebhook(ws, job.id, webhookPayload.parse(job.payload)),
  },
  [JOB_PURGE_ORIGINAL]: {
    maxAttempts: 10,
    run: (ws, job) => purgeOriginal(ws, submissionPayload.parse(job.payload).submissionId),
  },
};

/** A job is considered lost if it has been "running" this long (no job takes nearly this long). */
export const STALE_JOB_MS = 30 * 60_000;

/** Claims and runs one ready job (any type, in handler order). Returns null when idle. */
export async function runNextJob(ws: WorkerServices) {
  for (const [type, handler] of Object.entries(JOB_HANDLERS)) {
    const job = await claimJob(ws.db, type, ws.now());
    if (!job) continue;
    const log = ws.logger.child({ jobId: job.id, type, attempt: job.attempts });
    try {
      const result = await handler.run(ws, job);
      await completeJob(ws.db, job.id);
      log.info({ result }, "job done");
      return { id: job.id, type, ok: true as const, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const gaveUp = await failJob(ws.db, job.id, message, ws.now(), handler.maxAttempts);
      log.warn({ err: message, gaveUp }, "job failed");
      if (gaveUp && handler.onGiveUp) await handler.onGiveUp(ws, job, message);
      return { id: job.id, type, ok: false as const, error: message, gaveUp };
    }
  }
  return null;
}

/**
 * Long-running loop with `concurrency` parallel slots. Each slot polls when idle.
 * Resolves after `signal` aborts and in-flight jobs finish.
 */
export async function runWorker(
  ws: WorkerServices,
  opts: { concurrency: number; pollMs: number; signal: AbortSignal },
) {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      opts.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });
  let lastStaleCheck = 0;
  const slot = async () => {
    while (!opts.signal.aborted) {
      try {
        if (Date.now() - lastStaleCheck > 60_000) {
          lastStaleCheck = Date.now();
          const n = await requeueStaleJobs(ws.db, ws.now(), STALE_JOB_MS);
          if (n) ws.logger.warn({ count: n }, "requeued stale jobs");
        }
        if (!(await runNextJob(ws))) await sleep(opts.pollMs);
      } catch (err) {
        ws.logger.error({ err }, "worker iteration failed");
        await sleep(opts.pollMs * 2);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, slot));
}
