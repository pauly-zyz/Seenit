import { tmpdir } from "node:os";

import Anthropic from "@anthropic-ai/sdk";

import { parseEnv } from "../config";
import { buildServices, type Services } from "../services";
import type { MediaCipher } from "./cipher";
import { DEFAULT_MEDIA_OPTIONS, FfmpegMediaToolkit, type MediaToolkit } from "./media";
import {
  ClaudePrivacyDetector,
  ClaudeVisionAnalyzer,
  type PrivacyDetector,
  type VisionAnalyzer,
} from "./vision";
import { FetchWebhookSender, type WebhookSender } from "./webhooks";

export interface ProcessingConfig {
  /** Below this confidence → needs_review. */
  reviewConfidence: number;
  /** Days the encrypted original is kept for disputes. */
  retentionDays: number;
  /** Tolerance on a video's real duration vs the mission's limit. */
  videoOverrunSeconds: number;
}

/** What the worker needs on top of the API services. */
export interface WorkerServices extends Services {
  cipher: MediaCipher;
  media: MediaToolkit;
  vision: VisionAnalyzer;
  privacy: PrivacyDetector;
  webhooks: WebhookSender;
  processing: ProcessingConfig;
  /** Scratch space for downloads and frames (cleaned per job). */
  tmpDir: string;
}

export function createWorkerServicesFromEnv(): WorkerServices & {
  concurrency: number;
  pollMs: number;
} {
  const env = parseEnv();
  const base = buildServices(env);
  if (!base.cipher) throw new Error("MEDIA_ENCRYPTION_KEYS is required to run the worker");
  // Credentials come from ANTHROPIC_API_KEY (or another source the SDK supports).
  const client = new Anthropic();
  const ai = { model: env.AI_MODEL, effort: env.AI_EFFORT, serverFallback: env.AI_SERVER_FALLBACK };
  return {
    ...base,
    cipher: base.cipher,
    media: new FfmpegMediaToolkit({
      ...DEFAULT_MEDIA_OPTIONS,
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
      blurThreshold: env.MEDIA_BLUR_THRESHOLD,
      darkThreshold: env.MEDIA_DARK_THRESHOLD,
    }),
    vision: new ClaudeVisionAnalyzer(client, ai),
    privacy: new ClaudePrivacyDetector(client, ai),
    webhooks: new FetchWebhookSender({ allowHttp: env.WEBHOOK_ALLOW_HTTP }),
    processing: {
      reviewConfidence: env.AI_REVIEW_CONFIDENCE,
      retentionDays: env.ORIGINAL_RETENTION_DAYS,
      videoOverrunSeconds: 2,
    },
    tmpDir: tmpdir(),
    concurrency: env.WORKER_CONCURRENCY,
    pollMs: env.WORKER_POLL_MS,
  };
}
