import { z } from "zod";

import { issueApiKey, listApiKeys } from "@/server/domain/dashboard";
import { json } from "@/server/json";
import { route } from "@/server/route";

/** API keys of the signed-in funder (prefix only; the full key is shown once at creation). */
export const GET = route(
  { name: "funder.api-keys.list", auth: "funderSession" },
  async ({ auth, services }) => listApiKeys(services.db, auth.funder.id),
);

const body = z.object({ name: z.string().trim().min(1).max(60) });

export const POST = route<"funderSession", z.infer<typeof body>>(
  {
    name: "funder.api-keys.create",
    auth: "funderSession",
    body,
    rateLimit: { limit: 10, windowSeconds: 60 },
  },
  async ({ auth, body, services }) =>
    json(await issueApiKey(services.db, auth.funder.id, body.name), { status: 201 }),
);
