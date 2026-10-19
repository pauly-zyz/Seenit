import { spawn } from "node:child_process";

import sharp, { type OverlayOptions, type Sharp } from "sharp";

/** A still image handed to the vision model and (blurred) to the funder. */
export interface Frame {
  index: number;
  /** Position in the video, null for photos. */
  atSeconds: number | null;
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface ExtractedMedia {
  frames: Frame[];
  /** Actual duration from the container (videos only). */
  durationSeconds: number | null;
}

export interface FrameQuality {
  /** Mean brightness 0–255. */
  meanLuma: number;
  /** Variance of the Laplacian at 512 px wide: low = blurry. */
  sharpness: number;
  dark: boolean;
  blurry: boolean;
}

/** Box in a 0–1000 grid relative to the frame (resolution independent). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MediaToolkit {
  extract(path: string, mediaType: "photo" | "video"): Promise<ExtractedMedia>;
  measure(jpeg: Buffer): Promise<FrameQuality>;
  /** Pixelates and blurs each box (with padding). Output has no metadata (no EXIF/GPS). */
  redact(jpeg: Buffer, boxes: Box[]): Promise<Buffer>;
}

/** The file isn't a readable photo/video of the declared type. */
export class UnreadableMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableMediaError";
  }
}

export interface MediaOptions {
  ffmpegPath: string;
  ffprobePath: string;
  /** Longest edge of frames sent to the model and to funders. */
  maxEdge: number;
  /** Max key frames taken from a video. */
  maxVideoFrames: number;
  darkThreshold: number;
  blurThreshold: number;
  /** Padding added around each redaction box, as a fraction of its size. */
  redactPadding: number;
}

export const DEFAULT_MEDIA_OPTIONS: MediaOptions = {
  ffmpegPath: "ffmpeg",
  ffprobePath: "ffprobe",
  maxEdge: 1568,
  maxVideoFrames: 8,
  darkThreshold: 35,
  blurThreshold: 40,
  redactPadding: 0.15,
};

const JPEG = { quality: 88, mozjpeg: true } as const;

export class FfmpegMediaToolkit implements MediaToolkit {
  constructor(private readonly opts: MediaOptions = DEFAULT_MEDIA_OPTIONS) {}

  async extract(path: string, mediaType: "photo" | "video"): Promise<ExtractedMedia> {
    if (mediaType === "photo") {
      const frame = await this.normalize(() => sharp(path, { failOn: "error" }), 0, null).catch(
        (err) => {
          throw new UnreadableMediaError(`Photo could not be decoded: ${(err as Error).message}`);
        },
      );
      return { frames: [frame], durationSeconds: null };
    }
    const duration = await this.probeVideo(path);
    const count = Math.min(this.opts.maxVideoFrames, Math.max(2, Math.ceil(duration / 4)));
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const at = Math.min(((i + 0.5) * duration) / count, Math.max(duration - 0.05, 0));
      const raw = await run(this.opts.ffmpegPath, [
        "-v",
        "error",
        "-ss",
        at.toFixed(3),
        "-i",
        path,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ]).catch((err) => {
        throw new UnreadableMediaError(
          `Frame at ${at.toFixed(1)}s could not be read: ${(err as Error).message}`,
        );
      });
      if (raw.length === 0) continue;
      frames.push(await this.normalize(() => sharp(raw), frames.length, Number(at.toFixed(2))));
    }
    if (frames.length === 0)
      throw new UnreadableMediaError("No frames could be read from the video");
    return { frames, durationSeconds: duration };
  }

  /** Applies EXIF rotation, bounds the size, re-encodes as JPEG and drops all metadata. */
  private async normalize(
    load: () => Sharp,
    index: number,
    atSeconds: number | null,
  ): Promise<Frame> {
    const { data, info } = await load()
      .rotate()
      .resize({
        width: this.opts.maxEdge,
        height: this.opts.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#000000" })
      .jpeg(JPEG)
      .toBuffer({ resolveWithObject: true });
    return { index, atSeconds, jpeg: data, width: info.width, height: info.height };
  }

  private async probeVideo(path: string): Promise<number> {
    const out = await run(this.opts.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]).catch((err) => {
      throw new UnreadableMediaError(`Video could not be probed: ${(err as Error).message}`);
    });
    const info = JSON.parse(out.toString("utf8")) as {
      streams?: { codec_type?: string; duration?: string }[];
      format?: { duration?: string };
    };
    const video = info.streams?.find((s) => s.codec_type === "video");
    if (!video) throw new UnreadableMediaError("File has no video stream");
    const duration = Number(info.format?.duration ?? video.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new UnreadableMediaError("Video has no duration");
    return duration;
  }

  async measure(jpeg: Buffer): Promise<FrameQuality> {
    // Fixed-size greyscale first (sharp applies colourspace late, so do it in its own pass).
    const { data, info } = await sharp(jpeg)
      .resize({ width: 512 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { meanLuma, sharpness } = lumaAndLaplacian(data, info.width, info.height);
    return {
      meanLuma: round(meanLuma),
      sharpness: round(sharpness),
      dark: meanLuma < this.opts.darkThreshold,
      blurry: sharpness < this.opts.blurThreshold,
    };
  }

  async redact(jpeg: Buffer, boxes: Box[]): Promise<Buffer> {
    const base = sharp(jpeg);
    const { width, height } = await base.metadata();
    if (!width || !height) throw new UnreadableMediaError("Frame has no dimensions");
    const overlays: OverlayOptions[] = [];
    for (const b of boxes) {
      const r = toPixels(b, width, height, this.opts.redactPadding);
      if (!r) continue;
      // Pixelate (downscale to ~8 blocks across, scale back with nearest) and blur the result.
      const blocksW = Math.max(1, Math.min(8, Math.round(r.width / 6)));
      const blocksH = Math.max(1, Math.round((blocksW * r.height) / r.width));
      const small = await sharp(jpeg)
        .extract(r)
        .resize(blocksW, blocksH, { kernel: "cubic" })
        .toBuffer();
      const patch = await sharp(small)
        .resize(r.width, r.height, { kernel: "nearest" })
        .blur(Math.max(2, Math.min(r.width, r.height) / 10))
        .toBuffer();
      overlays.push({ input: patch, left: r.left, top: r.top });
    }
    return sharp(jpeg).composite(overlays).jpeg(JPEG).toBuffer();
  }
}

function toPixels(b: Box, width: number, height: number, pad: number) {
  const x0 = Math.min(b.x0, b.x1);
  const x1 = Math.max(b.x0, b.x1);
  const y0 = Math.min(b.y0, b.y1);
  const y1 = Math.max(b.y0, b.y1);
  const padX = ((x1 - x0) * pad * width) / 1000 + 2;
  const padY = ((y1 - y0) * pad * height) / 1000 + 2;
  const left = Math.max(0, Math.floor((x0 * width) / 1000 - padX));
  const top = Math.max(0, Math.floor((y0 * height) / 1000 - padY));
  const right = Math.min(width, Math.ceil((x1 * width) / 1000 + padX));
  const bottom = Math.min(height, Math.ceil((y1 * height) / 1000 + padY));
  if (right - left < 2 || bottom - top < 2) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** Mean brightness and variance of the 4-neighbour Laplacian over a greyscale buffer. */
function lumaAndLaplacian(px: Buffer, w: number, h: number) {
  let luma = 0;
  for (let i = 0; i < px.length; i++) luma += px[i]!;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = px[i - 1]! + px[i + 1]! + px[i - w]! + px[i + w]! - 4 * px[i]!;
      sum += l;
      sq += l * l;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  return { meanLuma: luma / Math.max(px.length, 1), sharpness: n ? sq / n - mean * mean : 0 };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Runs a binary and returns stdout. Rejects on non-zero exit or after `timeoutMs`. */
function run(
  cmd: string,
  args: string[],
  timeoutMs = 60_000,
  maxBytes = 64 * 1024 * 1024,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error(`${cmd} output too large`));
      } else chunks.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      if (stderr.length < 2000) stderr += c.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}
