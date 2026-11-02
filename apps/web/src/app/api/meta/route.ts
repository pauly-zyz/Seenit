import { getMeta } from "@/server/domain/funder-missions";
import { route } from "@/server/route";

/** Chain id, escrow and reward token (address, symbol, decimals), tier threshold and limits. */
export const GET = route(
  { name: "meta", auth: "none", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ services }) => getMeta(services),
);
