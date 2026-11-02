import type { WebhookEvent } from "./types.js";

/**
 * Verifies a webhook delivery. Pass the raw request body (exactly as received) and the
 * `Seenit-Signature` header (`t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`).
 * Works in Node 20+, Deno, Bun and edge runtimes (Web Crypto).
 */
export async function verifyWebhookSignature(args: {
  secret: string;
  signatureHeader: string | null | undefined;
  body: string;
  /** Reject deliveries older (or newer) than this. Default 300 s. */
  toleranceSeconds?: number;
  now?: Date;
}): Promise<boolean> {
  const parts = Object.fromEntries(
    (args.signatureHeader ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const nowSec = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - t) > (args.toleranceSeconds ?? 300)) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${args.body}`)),
  );
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

/** Verifies and parses a delivery; throws if the signature is not valid. */
export async function parseWebhook(
  args: Parameters<typeof verifyWebhookSignature>[0],
): Promise<WebhookEvent> {
  if (!(await verifyWebhookSignature(args))) throw new Error("Invalid Seenit webhook signature");
  return JSON.parse(args.body) as WebhookEvent;
}
