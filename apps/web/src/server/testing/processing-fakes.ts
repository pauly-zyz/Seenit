import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MEDIA_OPTIONS, FfmpegMediaToolkit } from "../processing/media";
import type { WorkerServices } from "../processing/services";
import type {
  PrivacyDetector,
  PrivacyRegion,
  VisionAnalyzer,
  VisionFrame,
  VisionMission,
  VisionOutcome,
} from "../processing/vision";
import type { WebhookSender } from "../processing/webhooks";
import type { Harness } from "./harness";

/** Scripted vision model. Records what it was shown. */
export class FakeVision implements VisionAnalyzer {
  calls: { mission: VisionMission; frames: VisionFrame[] }[] = [];
  next: VisionOutcome | Error = FakeVision.answer({ is_open: true });

  static answer(
    answer: unknown,
    over: Partial<Extract<VisionOutcome, { kind: "answer" }>> = {},
  ): VisionOutcome {
    return {
      kind: "answer",
      answer,
      confidence: 0.92,
      reasoning: "Frame 1 shows the door open with an OPEN sign.",
      quality: { relevant: true, blurry: false, too_dark: false, screen_capture: false, notes: "" },
      model: "claude-opus-5-5",
      ...over,
    };
  }

  async analyze(input: { mission: VisionMission; frames: VisionFrame[] }) {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export class FakePrivacy implements PrivacyDetector {
  calls: VisionFrame[][] = [];
  next: PrivacyRegion[] | null | Error = [];

  async detect(frames: VisionFrame[]) {
    this.calls.push(frames);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export class FakeWebhooks implements WebhookSender {
  sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  status = 200;

  async post(url: string, headers: Record<string, string>, body: string) {
    this.sent.push({ url, headers, body });
    return { status: this.status };
  }
}

/** Worker services on top of the API harness: real ffmpeg/sharp, fake model and webhooks. */
export function createWorkerHarness(h: Harness) {
  const vision = new FakeVision();
  const privacy = new FakePrivacy();
  const webhooks = new FakeWebhooks();
  const ws: WorkerServices = {
    ...h.services,
    cipher: h.services.cipher!,
    media: new FfmpegMediaToolkit({ ...DEFAULT_MEDIA_OPTIONS, blurThreshold: 30 }),
    vision,
    privacy,
    webhooks,
    processing: { reviewConfidence: 0.7, retentionDays: 30, videoOverrunSeconds: 2 },
    tmpDir: mkdtempSync(join(tmpdir(), "seenit-test-")),
  };
  return {
    ws,
    vision,
    privacy,
    webhooks,
    reset() {
      vision.calls = [];
      vision.next = FakeVision.answer({ is_open: true });
      privacy.calls = [];
      privacy.next = [];
      webhooks.sent = [];
      webhooks.status = 200;
    },
  };
}
