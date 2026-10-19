import type { CaptureMetadata } from "@seenit/shared";

import { ApiError, type SeenitApi } from "./api";

/**
 * Persistent upload queue. Each capture goes:
 *   queued -> uploading (signed PUT, with progress) -> finalizing (server verifies + records on-chain)
 *   -> done | rejected | failed
 * Network problems back off and retry; the queue pauses while offline or signed out.
 */

export type QueueState = "queued" | "uploading" | "finalizing" | "done" | "rejected" | "failed";

export interface QueueItem {
  id: string;
  missionId: string;
  missionTitle: string;
  /** Local file (copied into the app's document directory). */
  fileUri: string;
  contentType: string;
  size: number;
  capture: CaptureMetadata;
  state: QueueState;
  /** 0..1 while uploading. */
  progress: number;
  attempts: number;
  nextAttemptAt: number;
  /** File is already in storage for `submissionId`; a retry can skip the PUT. */
  uploaded: boolean;
  submissionId?: string;
  lastError?: string;
  createdAt: number;
}

export interface QueueStore {
  load(): Promise<QueueItem[]>;
  save(items: QueueItem[]): Promise<void>;
}

export interface QueueDeps {
  store: QueueStore;
  api: Pick<SeenitApi, "requestUploadUrl" | "finalizeSubmission">;
  uploadFile(args: {
    fileUri: string;
    url: string;
    headers: Record<string, string>;
    onProgress: (fraction: number) => void;
  }): Promise<{ status: number }>;
  deleteFile(uri: string): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const MAX_ATTEMPTS = 8;
export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 10 * 60_000;

export const backoffMs = (attempt: number) =>
  Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempt - 1, 0), MAX_BACKOFF_MS);

class UploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed (${status})`);
  }
}

export class UploadQueue {
  private items: QueueItem[] = [];
  private listeners = new Set<() => void>();
  private current: Promise<void> | null = null;
  private timer: unknown = null;
  private online = true;
  private authPaused = false;
  private snapshot: readonly QueueItem[] = [];

  constructor(private readonly deps: QueueDeps) {}

  // ---- state for React (useSyncExternalStore) -------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  get isOnline() {
    return this.online;
  }

  get needsSignIn() {
    return this.authPaused;
  }

  private emit() {
    this.snapshot = this.items.map((i) => ({ ...i }));
    for (const fn of this.listeners) fn();
  }

  private async persist() {
    this.emit();
    await this.deps.store.save(this.items);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  async init() {
    const saved = await this.deps.store.load();
    // Anything interrupted mid-flight (app killed) goes back to the queue.
    this.items = saved.map((i) =>
      i.state === "uploading" || i.state === "finalizing"
        ? { ...i, state: "queued", progress: 0 }
        : i,
    );
    await this.persist();
    this.kick();
  }

  async enqueue(
    item: Omit<
      QueueItem,
      "state" | "progress" | "attempts" | "nextAttemptAt" | "uploaded" | "createdAt"
    >,
  ) {
    this.items.push({
      ...item,
      state: "queued",
      progress: 0,
      attempts: 0,
      nextAttemptAt: 0,
      uploaded: false,
      createdAt: this.deps.now(),
    });
    await this.persist();
    this.kick();
  }

  setOnline(online: boolean) {
    this.online = online;
    this.emit();
    if (online) this.kick();
  }

  /** Call after the user signs in again. */
  resume() {
    this.authPaused = false;
    this.emit();
    this.kick();
  }

  async retry(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || (item.state !== "failed" && item.state !== "queued")) return;
    Object.assign(item, { state: "queued", attempts: 0, nextAttemptAt: 0, lastError: undefined });
    await this.persist();
    this.kick();
  }

  async remove(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.state === "uploading" || item.state === "finalizing") return;
    if (item.state !== "done") this.deps.deleteFile(item.fileUri);
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
  }

  /** Drops finished items (their files are already gone). */
  async clearDone() {
    this.items = this.items.filter((i) => i.state !== "done");
    await this.persist();
  }

  // ---- worker ----------------------------------------------------------------------------------

  kick() {
    if (this.current) return;
    if (this.timer) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    void this.run();
  }

  /** Resolves when the worker has nothing runnable left (for tests and app background tasks). */
  async drain() {
    do {
      await this.run();
    } while (this.hasRunnable());
  }

  private hasRunnable() {
    const now = this.deps.now();
    return (
      this.online &&
      !this.authPaused &&
      this.items.some((i) => i.state === "queued" && i.nextAttemptAt <= now)
    );
  }

  /** Single worker: concurrent callers share the same run. */
  private run(): Promise<void> {
    this.current ??= this.loop().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async loop() {
    while (this.online && !this.authPaused) {
      const now = this.deps.now();
      const next = this.items.find((i) => i.state === "queued" && i.nextAttemptAt <= now);
      if (!next) {
        const waiting = this.items.filter((i) => i.state === "queued").map((i) => i.nextAttemptAt);
        if (waiting.length > 0) {
          const delay = Math.max(Math.min(...waiting) - now, 0);
          if (this.timer) this.deps.clearTimer(this.timer);
          this.timer = this.deps.setTimer(() => {
            this.timer = null;
            this.kick();
          }, delay);
        }
        return;
      }
      await this.process(next);
    }
  }

  private async process(item: QueueItem) {
    try {
      item.state = "uploading";
      item.progress = item.uploaded ? 1 : 0;
      await this.persist();

      // Always ask for a fresh URL: it also resets a server-side retryable state (chain_failed).
      const { submissionId, upload } = await this.deps.api.requestUploadUrl({
        missionId: item.missionId,
        mediaType: item.capture.mediaType,
        contentType: item.contentType,
        contentLength: item.size,
        gps: {
          lat: item.capture.gps.lat,
          lng: item.capture.gps.lng,
          accuracyMeters: item.capture.gps.accuracyMeters,
          isMocked: item.capture.gps.isMocked,
        },
      });
      if (item.submissionId !== submissionId) item.uploaded = false;
      item.submissionId = submissionId;

      if (!item.uploaded) {
        const res = await this.deps.uploadFile({
          fileUri: item.fileUri,
          url: upload.url,
          headers: upload.headers,
          onProgress: (f) => {
            item.progress = Math.min(Math.max(f, 0), 1);
            this.emit();
          },
        });
        if (res.status < 200 || res.status >= 300) throw new UploadHttpError(res.status);
        item.uploaded = true;
        item.progress = 1;
      }

      item.state = "finalizing";
      await this.persist();
      try {
        await this.deps.api.finalizeSubmission({ submissionId, capture: item.capture });
      } catch (err) {
        // Storage lost the object (e.g. expired): upload again on the next attempt.
        if (
          err instanceof ApiError &&
          err.status === 400 &&
          /upload not found/i.test(err.message)
        ) {
          item.uploaded = false;
        }
        throw err;
      }

      item.state = "done";
      item.lastError = undefined;
      this.deps.deleteFile(item.fileUri);
      await this.persist();
    } catch (err) {
      await this.handleError(item, err);
    }
  }

  private async handleError(item: QueueItem, err: unknown) {
    item.progress = 0;
    if (err instanceof ApiError && err.status === 401) {
      // Session expired: wait for sign-in, then continue where we left off.
      item.state = "queued";
      item.lastError = "Sign in again to finish uploading.";
      this.authPaused = true;
      await this.persist();
      return;
    }
    const retryable =
      err instanceof UploadHttpError ||
      !(err instanceof ApiError) ||
      err.retryable ||
      (err.status === 400 && /upload not found/i.test(err.message));
    if (!retryable) {
      // The server looked at the capture and said no (outside area, too old, mocked, full...).
      item.state = "rejected";
      item.lastError = rejectionMessage(err as ApiError);
      this.deps.deleteFile(item.fileUri);
      await this.persist();
      return;
    }
    item.attempts += 1;
    item.lastError = err instanceof Error ? err.message : "Upload failed";
    if (item.attempts >= MAX_ATTEMPTS) {
      item.state = "failed";
    } else {
      item.state = "queued";
      item.nextAttemptAt = this.deps.now() + backoffMs(item.attempts);
    }
    await this.persist();
  }
}

const REASONS: Record<string, string> = {
  outside_radius: "you were outside the mission area",
  gps_inaccurate: "GPS was not precise enough",
  gps_mocked: "the location looked simulated",
  gps_fix_stale: "the GPS fix was too old",
  captured_in_future: "the device clock looks wrong",
  capture_too_old: "it was uploaded too long after capture",
  after_deadline: "it was captured after the deadline",
  media_hash_mismatch: "the file changed after capture",
  media_type_mismatch: "the wrong media type was captured",
  video_too_long: "the video is too long",
};

export function rejectionMessage(err: ApiError): string {
  const reasons = (err.details.reasons as string[] | undefined) ?? [];
  if (reasons.length > 0) {
    return `Not accepted: ${reasons.map((r) => REASONS[r] ?? r.replaceAll("_", " ")).join(", ")}.`;
  }
  return err.message;
}
