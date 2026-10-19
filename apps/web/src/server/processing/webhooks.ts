import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Funder webhooks. Each delivery is a POST with a JSON body and these headers:
 *   Seenit-Event: submission.processed
 *   Seenit-Delivery: <job id, stable across retries>
 *   Seenit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>
 * Receivers should check the signature and reject timestamps older than ~5 minutes.
 */

/** Associated data binding an encrypted webhook secret to its funder. */
export const webhookSecretContext = (funderId: string) => `webhook-secret:${funderId}`;

export function signWebhook(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

/** Syntactic checks done when the funder registers a URL. */
export function checkWebhookUrl(raw: string, opts: { allowHttp: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
    throw new UnsafeWebhookUrlError("Webhook URL must use https");
  }
  if (url.username || url.password)
    throw new UnsafeWebhookUrlError("Webhook URL must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !opts.allowHttp &&
    (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
  ) {
    throw new UnsafeWebhookUrlError("Webhook URL must be publicly reachable");
  }
  if (isIP(host) && isPrivateAddress(host) && !opts.allowHttp) {
    throw new UnsafeWebhookUrlError("Webhook URL must be publicly reachable");
  }
  return url;
}

/** Loopback, private, link-local, CGNAT, multicast and other non-public ranges (v4 and v6). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

export interface WebhookSender {
  /** POSTs `body`; resolves with the HTTP status. Rejects on network errors or unsafe targets. */
  post(url: string, headers: Record<string, string>, body: string): Promise<{ status: number }>;
}

/** fetch-based sender: re-checks the resolved addresses, no redirects, 10 s timeout. */
export class FetchWebhookSender implements WebhookSender {
  constructor(
    private readonly opts: { allowHttp: boolean; timeoutMs?: number },
    private readonly resolve: (host: string) => Promise<string[]> = async (host) =>
      (await lookup(host, { all: true })).map((a) => a.address),
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async post(rawUrl: string, headers: Record<string, string>, body: string) {
    const url = checkWebhookUrl(rawUrl, this.opts);
    if (!this.opts.allowHttp) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host) ? [host] : await this.resolve(host);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        throw new UnsafeWebhookUrlError("Webhook host resolves to a non-public address");
      }
    }
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Seenit-Webhooks/1",
        ...headers,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    await res.body?.cancel();
    return { status: res.status };
  }
}
