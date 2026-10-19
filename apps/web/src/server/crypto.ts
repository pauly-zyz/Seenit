import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256Hex = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");

/** URL-safe random token. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
