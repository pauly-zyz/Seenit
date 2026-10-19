import { handleCallback } from "@/server/domain/personhood";
import { json } from "@/server/json";
import { route } from "@/server/route";

/**
 * Called by the provider (e.g. the Self app posts the zero-knowledge proof here).
 * Answers in the provider's format: 200 on success, 400 on rejection.
 */
export const POST = route<"none", undefined, { provider: string }>(
  { name: "personhood.callback", auth: "none", rateLimit: { limit: 30, windowSeconds: 60 } },
  async ({ req, params, services, now, log }) => {
    const payload = await req.json().catch(() => null);
    const { ok, body } = await handleCallback(services, params.provider, payload, now, log);
    return json(body, { status: ok ? 200 : 400 });
  },
);
