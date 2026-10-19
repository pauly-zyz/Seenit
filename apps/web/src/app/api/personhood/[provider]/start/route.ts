import { startVerification } from "@/server/domain/personhood";
import { route } from "@/server/route";

/**
 * Start verification with a provider (human_passport, self, ...).
 * Instant providers answer `verified` (or 422 with what is missing); redirect providers answer
 * `pending` with a URL to open and a sessionId to poll.
 */
export const POST = route<"contributor", undefined, { provider: string }>(
  { name: "personhood.start", auth: "contributor", rateLimit: { limit: 10, windowSeconds: 60 } },
  async ({ params, auth, services, now, log }) =>
    startVerification(services, auth.user, params.provider, now, log),
);
