import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseWebhook, verifyWebhookSignature } from "../src/index.js";

// Same scheme as the server (apps/web/src/server/processing/webhooks.ts → signWebhook).
const sign = (secret: string, t: number, body: string) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

const now = new Date("2026-11-02T10:00:00Z");
const t = Math.floor(now.getTime() / 1000);
const body = JSON.stringify({
  id: "j1",
  event: "submission.processed",
  data: { submissionId: "s1" },
});

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", async () => {
    expect(
      await verifyWebhookSignature({
        secret: "whsec_a",
        signatureHeader: sign("whsec_a", t, body),
        body,
        now,
      }),
    ).toBe(true);
    expect(
      (
        await parseWebhook({
          secret: "whsec_a",
          signatureHeader: sign("whsec_a", t, body),
          body,
          now,
        })
      ).id,
    ).toBe("j1");
  });

  it.each([
    ["wrong secret", sign("whsec_b", t, body), body],
    ["tampered body", sign("whsec_a", t, body), body.replace("s1", "s2")],
    ["stale timestamp", sign("whsec_a", t - 600, body), body],
    ["garbage header", "nope", body],
  ])("rejects %s", async (_n, header, b) => {
    expect(
      await verifyWebhookSignature({ secret: "whsec_a", signatureHeader: header, body: b, now }),
    ).toBe(false);
  });

  it("throws in parseWebhook when invalid", async () => {
    await expect(parseWebhook({ secret: "x", signatureHeader: null, body, now })).rejects.toThrow(
      /Invalid/,
    );
  });
});
