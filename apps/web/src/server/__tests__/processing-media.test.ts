// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_MEDIA_OPTIONS,
  FfmpegMediaToolkit,
  UnreadableMediaError,
} from "../processing/media";
import {
  blurryJpeg,
  darkJpeg,
  dummyVideo,
  FACE_BOX,
  PLATE_BOX,
  SCENE,
  storefrontJpeg,
  storefrontJpegWithExif,
} from "../testing/media-fixtures";

const media = new FfmpegMediaToolkit({ ...DEFAULT_MEDIA_OPTIONS, blurThreshold: 30 });
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "seenit-media-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function file(name: string, bytes: Buffer) {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

/** Fine detail (Laplacian variance) inside a 0–1000 box. */
async function regionDetail(jpeg: Buffer, b: { x0: number; y0: number; x1: number; y1: number }) {
  const { width, height } = await sharp(jpeg).metadata();
  const region = {
    left: Math.round((b.x0 * width!) / 1000),
    top: Math.round((b.y0 * height!) / 1000),
    width: Math.round(((b.x1 - b.x0) * width!) / 1000),
    height: Math.round(((b.y1 - b.y0) * height!) / 1000),
  };
  return (await media.measure(await sharp(jpeg).extract(region).jpeg().toBuffer())).sharpness;
}

describe("FfmpegMediaToolkit.extract", () => {
  it("normalizes a photo into one JPEG frame without metadata", async () => {
    const p = await file("photo.jpg", await storefrontJpegWithExif());
    expect((await sharp(p).metadata()).exif).toBeDefined();
    const { frames, durationSeconds } = await media.extract(p, "photo");
    expect(durationSeconds).toBeNull();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      index: 0,
      atSeconds: null,
      width: SCENE.width,
      height: SCENE.height,
    });
    const meta = await sharp(frames[0]!.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("bounds large photos to the max edge and applies EXIF rotation", async () => {
    const big = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: "#777" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const { frames } = await media.extract(await file("big.jpg", big), "photo");
    expect(frames[0]!.width).toBe(784);
    expect(frames[0]!.height).toBe(1568);
  });

  it("takes evenly spaced key frames from a video", async () => {
    const p = join(dir, "clip.mp4");
    await dummyVideo(p, 12);
    const { frames, durationSeconds } = await media.extract(p, "video");
    expect(durationSeconds).toBeCloseTo(12, 0);
    expect(frames).toHaveLength(3); // ceil(12 / 4)
    expect(frames.map((f) => f.atSeconds)).toEqual([2, 6, 10]);
    expect(frames.map((f) => f.index)).toEqual([0, 1, 2]);
    for (const f of frames) expect((await sharp(f.jpeg).metadata()).width).toBe(640);
  });

  it("caps the number of video frames", async () => {
    const p = join(dir, "long.mp4");
    await dummyVideo(p, 60);
    const { frames } = await media.extract(p, "video");
    expect(frames).toHaveLength(DEFAULT_MEDIA_OPTIONS.maxVideoFrames);
  });

  it("rejects files that are not what they claim to be", async () => {
    const junk = await file("junk.bin", Buffer.from("definitely not media".repeat(50)));
    await expect(media.extract(junk, "photo")).rejects.toBeInstanceOf(UnreadableMediaError);
    await expect(media.extract(junk, "video")).rejects.toBeInstanceOf(UnreadableMediaError);
    const photo = await file("photo-as-video.jpg", await storefrontJpeg());
    await expect(media.extract(photo, "video")).rejects.toBeInstanceOf(UnreadableMediaError);
  });
});

describe("FfmpegMediaToolkit.measure", () => {
  it("passes a clear, well-lit frame", async () => {
    const q = await media.measure(await storefrontJpeg());
    expect(q).toMatchObject({ dark: false, blurry: false });
    expect(q.meanLuma).toBeGreaterThan(100);
  });

  it("flags blurry frames", async () => {
    expect((await media.measure(await blurryJpeg())).blurry).toBe(true);
  });

  it("flags dark frames", async () => {
    expect((await media.measure(await darkJpeg())).dark).toBe(true);
  });
});

describe("FfmpegMediaToolkit.redact", () => {
  it("destroys detail inside each box and leaves the rest alone", async () => {
    const src = await storefrontJpeg();
    const out = await media.redact(src, [FACE_BOX, PLATE_BOX]);
    expect((await sharp(out).metadata()).width).toBe(SCENE.width);
    // Plate text and face features lose almost all fine detail...
    expect(await regionDetail(out, PLATE_BOX)).toBeLessThan(
      (await regionDetail(src, PLATE_BOX)) * 0.1,
    );
    expect(await regionDetail(out, FACE_BOX)).toBeLessThan(
      (await regionDetail(src, FACE_BOX)) * 0.1,
    );
    // ...while the shop sign elsewhere keeps it.
    const sign = { x0: 120, y0: 60, x1: 700, y1: 180 };
    expect(await regionDetail(out, sign)).toBeGreaterThan((await regionDetail(src, sign)) * 0.8);
  });

  it("ignores degenerate boxes and handles boxes at the edge", async () => {
    const src = await storefrontJpeg();
    const out = await media.redact(src, [
      { x0: 500, y0: 500, x1: 500, y1: 500 },
      { x0: 950, y0: 950, x1: 1000, y1: 1000 },
    ]);
    expect((await sharp(out).metadata()).height).toBe(SCENE.height);
  });
});
