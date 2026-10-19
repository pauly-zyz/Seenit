import { ApiError } from "./api";
import {
  backoffMs,
  MAX_ATTEMPTS,
  type QueueItem,
  type QueueStore,
  UploadQueue,
} from "./upload-queue";

const capture = {
  missionId: "m1",
  source: "in_app_camera" as const,
  mediaType: "photo" as const,
  mediaSha256: "a".repeat(64),
  capturedAt: "2026-10-19T10:00:00.000Z",
  gps: {
    lat: -6.17,
    lng: 106.82,
    accuracyMeters: 6,
    fixAt: "2026-10-19T10:00:00.000Z",
    isMocked: false,
  },
  device: { platform: "android" as const, appVersion: "0.1.0" },
};

function setup(opts: { saved?: QueueItem[] } = {}) {
  let now = 1_000_000;
  let saved: QueueItem[] = opts.saved ?? [];
  const timers: { fn: () => void; at: number }[] = [];
  const store: QueueStore = {
    load: async () => saved,
    save: async (items) => {
      saved = JSON.parse(JSON.stringify(items));
    },
  };
  const api = {
    requestUploadUrl: jest.fn(async () => ({
      submissionId: "sub-1",
      upload: {
        url: "https://r2/put",
        method: "PUT" as const,
        headers: { "content-type": "image/jpeg" },
        expiresAt: "",
      },
    })),
    finalizeSubmission: jest.fn(async () => ({
      submission: { id: "sub-1", status: "processing" as const },
    })),
  };
  const uploadFile = jest.fn(async ({ onProgress }: { onProgress: (f: number) => void }) => {
    onProgress(0.5);
    onProgress(1);
    return { status: 200 };
  });
  const deleteFile = jest.fn();
  const queue = new UploadQueue({
    store,
    api,
    uploadFile,
    deleteFile,
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as never);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.splice(0).filter((t) => t.at <= now)) t.fn();
    await queue.drain();
  };
  return {
    queue,
    api,
    uploadFile,
    deleteFile,
    advance,
    saved: () => saved,
    setNow: (n: number) => (now = n),
  };
}

const add = (q: UploadQueue, id = "c1") =>
  q.enqueue({
    id,
    missionId: "m1",
    missionTitle: "Bakery",
    fileUri: `file:///c/${id}.jpg`,
    contentType: "image/jpeg",
    size: 1234,
    capture,
  });

describe("UploadQueue", () => {
  it("uploads, finalizes, deletes the local file and persists", async () => {
    const t = setup();
    await t.queue.init();
    const progress: number[] = [];
    t.queue.subscribe(() => {
      const item = t.queue.getSnapshot()[0];
      if (item?.state === "uploading") progress.push(item.progress);
    });
    await add(t.queue);
    await t.queue.drain();

    const [item] = t.queue.getSnapshot();
    expect(item).toMatchObject({
      state: "done",
      submissionId: "sub-1",
      uploaded: true,
      progress: 1,
    });
    expect(progress).toEqual(expect.arrayContaining([0, 0.5, 1]));
    expect(t.api.requestUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "m1",
        contentLength: 1234,
        gps: expect.objectContaining({ isMocked: false }),
      }),
    );
    expect(t.api.finalizeSubmission).toHaveBeenCalledWith({ submissionId: "sub-1", capture });
    expect(t.deleteFile).toHaveBeenCalledWith("file:///c/c1.jpg");
    expect(t.saved()[0]!.state).toBe("done");
  });

  it("retries network errors with exponential backoff", async () => {
    const t = setup();
    await t.queue.init();
    t.api.requestUploadUrl.mockRejectedValueOnce(new ApiError(0, "network_error", "offline"));
    t.api.requestUploadUrl.mockRejectedValueOnce(new ApiError(503, "upstream_error", "busy"));
    await add(t.queue);
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]).toMatchObject({ state: "queued", attempts: 1 });

    await t.advance(backoffMs(1) - 1);
    expect(t.api.requestUploadUrl).toHaveBeenCalledTimes(1); // not yet
    await t.advance(1);
    expect(t.queue.getSnapshot()[0]).toMatchObject({ state: "queued", attempts: 2 });
    await t.advance(backoffMs(2));
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("gives up after MAX_ATTEMPTS and keeps the file for a manual retry", async () => {
    const t = setup();
    await t.queue.init();
    t.api.requestUploadUrl.mockRejectedValue(new ApiError(0, "network_error", "offline"));
    await add(t.queue);
    await t.queue.drain();
    for (let i = 1; i < MAX_ATTEMPTS; i++) await t.advance(backoffMs(i));
    expect(t.queue.getSnapshot()[0]).toMatchObject({ state: "failed", attempts: MAX_ATTEMPTS });
    expect(t.deleteFile).not.toHaveBeenCalled();

    t.api.requestUploadUrl.mockReset();
    t.api.requestUploadUrl.mockResolvedValue({
      submissionId: "sub-1",
      upload: { url: "u", method: "PUT", headers: { "content-type": "image/jpeg" }, expiresAt: "" },
    });
    await t.queue.retry("c1");
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("does not re-upload when only finalize failed", async () => {
    const t = setup();
    await t.queue.init();
    t.api.finalizeSubmission.mockRejectedValueOnce(new ApiError(502, "chain_error", "chain busy"));
    await add(t.queue);
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]).toMatchObject({ state: "queued", uploaded: true });
    await t.advance(backoffMs(1));
    expect(t.uploadFile).toHaveBeenCalledTimes(1);
    expect(t.api.requestUploadUrl).toHaveBeenCalledTimes(2); // fresh URL resets server state
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("re-uploads when storage lost the file", async () => {
    const t = setup();
    await t.queue.init();
    t.api.finalizeSubmission.mockRejectedValueOnce(
      new ApiError(400, "bad_request", "Upload not found, PUT the file to the upload URL first"),
    );
    await add(t.queue);
    await t.queue.drain();
    await t.advance(backoffMs(1));
    expect(t.uploadFile).toHaveBeenCalledTimes(2);
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("treats a failed PUT (e.g. expired URL) as retryable", async () => {
    const t = setup();
    await t.queue.init();
    t.uploadFile.mockResolvedValueOnce({ status: 403 });
    await add(t.queue);
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]).toMatchObject({
      state: "queued",
      attempts: 1,
      uploaded: false,
    });
    await t.advance(backoffMs(1));
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("marks server rejections as rejected with a readable reason and deletes the file", async () => {
    const t = setup();
    await t.queue.init();
    t.api.finalizeSubmission.mockRejectedValueOnce(
      new ApiError(422, "precheck_failed", "Capture failed verification", {
        reasons: ["outside_radius", "gps_mocked"],
      }),
    );
    await add(t.queue);
    await t.queue.drain();
    const [item] = t.queue.getSnapshot();
    expect(item!.state).toBe("rejected");
    expect(item!.lastError).toBe(
      "Not accepted: you were outside the mission area, the location looked simulated.",
    );
    expect(t.deleteFile).toHaveBeenCalled();
  });

  it("pauses while offline and resumes when back online", async () => {
    const t = setup();
    await t.queue.init();
    t.queue.setOnline(false);
    await add(t.queue);
    await t.queue.drain();
    expect(t.api.requestUploadUrl).not.toHaveBeenCalled();
    expect(t.queue.getSnapshot()[0]!.state).toBe("queued");
    t.queue.setOnline(true);
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("pauses on an expired session until resume()", async () => {
    const t = setup();
    await t.queue.init();
    t.api.requestUploadUrl.mockRejectedValueOnce(new ApiError(401, "unauthorized", "Sign in"));
    await add(t.queue);
    await t.queue.drain();
    expect(t.queue.needsSignIn).toBe(true);
    expect(t.queue.getSnapshot()[0]).toMatchObject({ state: "queued", attempts: 0 });
    await t.queue.drain();
    expect(t.api.requestUploadUrl).toHaveBeenCalledTimes(1);
    t.queue.resume();
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("restores interrupted uploads after an app restart", async () => {
    const interrupted = {
      id: "c9",
      missionId: "m1",
      missionTitle: "Bakery",
      fileUri: "file:///c/c9.jpg",
      contentType: "image/jpeg",
      size: 10,
      capture,
      state: "uploading" as const,
      progress: 0.4,
      attempts: 0,
      nextAttemptAt: 0,
      uploaded: false,
      createdAt: 1,
    };
    const t = setup({ saved: [interrupted] });
    await t.queue.init();
    await t.queue.drain();
    expect(t.queue.getSnapshot()[0]!.state).toBe("done");
  });

  it("processes items in order and can remove / clear them", async () => {
    const t = setup();
    await t.queue.init();
    t.queue.setOnline(false);
    await add(t.queue, "a");
    await add(t.queue, "b");
    await t.queue.remove("a");
    expect(t.deleteFile).toHaveBeenCalledWith("file:///c/a.jpg");
    t.queue.setOnline(true);
    await t.queue.drain();
    expect(t.queue.getSnapshot().map((i) => [i.id, i.state])).toEqual([["b", "done"]]);
    await t.queue.clearDone();
    expect(t.queue.getSnapshot()).toEqual([]);
  });
});

describe("backoffMs", () => {
  it("doubles from 5 s and caps at 10 min", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(20)).toBe(600_000);
  });
});
