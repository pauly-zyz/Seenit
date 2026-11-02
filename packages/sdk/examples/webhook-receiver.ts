/**
 * Minimal webhook receiver (Node). Register it once with:
 *   const { secret } = await seenit.webhooks.set("https://your.host/seenit");
 * and run with SEENIT_WEBHOOK_SECRET=<secret> npx tsx examples/webhook-receiver.ts
 */
import { createServer } from "node:http";

import { parseWebhook } from "seenit-sdk";

const secret = process.env.SEENIT_WEBHOOK_SECRET!;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString("utf8"); // verify the raw body, before any JSON parsing
  try {
    const event = await parseWebhook({
      secret,
      signatureHeader: req.headers["seenit-signature"] as string,
      body,
    });
    // Deliveries can repeat after retries: de-duplicate on event.id (also sent as Seenit-Delivery).
    console.log(
      event.event,
      event.data.submissionId,
      event.data.needsReview ? "needs review" : "ready",
      event.data.answer,
    );
    res.writeHead(204).end();
  } catch {
    res.writeHead(401).end();
  }
}).listen(8080);
