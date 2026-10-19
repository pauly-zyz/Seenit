/**
 * Submission processing worker (frames, blur, Claude vision, dispute archive, webhooks).
 *   pnpm -F @seenit/web worker
 * Needs ffmpeg/ffprobe on PATH, MEDIA_ENCRYPTION_KEYS and Claude API credentials.
 * Run as many instances as you like: jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
import { createWorkerServicesFromEnv } from "../processing/services";
import { runWorker } from "../worker";

async function main() {
  const { concurrency, pollMs, ...ws } = createWorkerServicesFromEnv();
  const controller = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      ws.logger.info({ sig }, "worker stopping after in-flight jobs");
      controller.abort();
    });
  }
  ws.logger.info(
    { concurrency, pollMs, model: process.env.AI_MODEL ?? "claude-opus-5-5" },
    "worker started",
  );
  await runWorker(ws, { concurrency, pollMs, signal: controller.signal });
  ws.logger.info("worker stopped");
  process.exit(0);
}

void main();
