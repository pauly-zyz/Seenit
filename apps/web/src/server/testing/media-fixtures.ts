import { execFile } from "node:child_process";
import { promisify } from "node:util";

import sharp from "sharp";

/**
 * Dummy media for tests, generated on the fly (no binary fixtures in the repo).
 * The "storefront" has a sign, a door, a person-like head at a known spot and a licence plate.
 */
export const SCENE = { width: 1200, height: 900 } as const;
/** Where the fake face and plate are, on the 0–1000 grid. */
export const FACE_BOX = { x0: 700, y0: 450, x1: 800, y1: 600 } as const;
export const PLATE_BOX = { x0: 150, y0: 800, x1: 350, y1: 870 } as const;

function svgScene(text = "LUNA BAKERY") {
  const { width: W, height: H } = SCENE;
  const px = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: (b.x0 * W) / 1000,
    y: (b.y0 * H) / 1000,
    w: ((b.x1 - b.x0) * W) / 1000,
    h: ((b.y1 - b.y0) * H) / 1000,
  });
  const f = px(FACE_BOX);
  const p = px(PLATE_BOX);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#8fb3c4"/>
    <rect x="80" y="180" width="1040" height="560" fill="#e8e2d0" stroke="#2b2b2b" stroke-width="10"/>
    <text x="160" y="150" font-size="96" font-family="sans-serif" fill="#111">${text}</text>
    <rect x="420" y="360" width="240" height="380" fill="#5a3a2a"/>
    <text x="440" y="330" font-size="40" font-family="sans-serif" fill="#a00">OPEN</text>
    <ellipse cx="${f.x + f.w / 2}" cy="${f.y + f.h / 2}" rx="${f.w / 2}" ry="${f.h / 2}" fill="#f1c27d" stroke="#333" stroke-width="4"/>
    <circle cx="${f.x + f.w * 0.33}" cy="${f.y + f.h * 0.4}" r="7" fill="#000"/>
    <circle cx="${f.x + f.w * 0.67}" cy="${f.y + f.h * 0.4}" r="7" fill="#000"/>
    <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#fff" stroke="#000" stroke-width="4"/>
    <text x="${p.x + 12}" y="${p.y + p.h * 0.75}" font-size="44" font-family="monospace" fill="#000">B 1234 XYZ</text>
  </svg>`;
}

export async function storefrontJpeg(opts: { text?: string } = {}) {
  return sharp(Buffer.from(svgScene(opts.text)))
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Same scene, carrying EXIF (GPS-ish fields and a rotation flag) that must be stripped. */
export async function storefrontJpegWithExif() {
  return sharp(Buffer.from(svgScene()))
    .withExif({ IFD0: { Make: "SeenitPhone", Model: "TestCam", Copyright: "secret-device-123" } })
    .jpeg()
    .toBuffer();
}

export async function darkJpeg() {
  return sharp(await storefrontJpeg())
    .modulate({ brightness: 0.1 })
    .jpeg()
    .toBuffer();
}

export async function blurryJpeg() {
  return sharp(await storefrontJpeg())
    .blur(12)
    .jpeg()
    .toBuffer();
}

const exec = promisify(execFile);

/** A short H.264 MP4 (ffmpeg test pattern) written to `path`. */
export async function dummyVideo(path: string, seconds = 8) {
  await exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=640x360:rate=15:duration=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    path,
  ]);
}
