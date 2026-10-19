import { z } from "zod";

import { deleteWebhook, getWebhook, setWebhook } from "@/server/domain/webhooks";
import { route } from "@/server/route";

const body = z.object({ url: z.string().max(2000) });

/** Current webhook URL (the secret is never shown again). */
export const GET = route<"funder">(
  { name: "webhook.get", auth: "funder" },
  async ({ auth, services }) => getWebhook(services, auth.funder.id),
);

/** Set the webhook URL; returns a fresh signing secret once. */
export const PUT = route<"funder", z.infer<typeof body>>(
  { name: "webhook.set", auth: "funder", body, rateLimit: { limit: 10, windowSeconds: 60 } },
  async ({ auth, body, services }) => setWebhook(services, auth.funder.id, body.url),
);

export const DELETE = route<"funder">(
  { name: "webhook.delete", auth: "funder" },
  async ({ auth, services }) => deleteWebhook(services, auth.funder.id),
);
