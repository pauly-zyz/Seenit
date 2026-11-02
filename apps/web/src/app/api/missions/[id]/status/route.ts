import { getMissionStatus } from "@/server/domain/funder-missions";
import { route } from "@/server/route";

/** Funder view: status, slots, submission counts, payouts, and funding transactions while unfunded. */
export const GET = route<"funder", undefined, { id: string }>(
  { name: "missions.status", auth: "funder", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ params, auth, services }) => getMissionStatus(services, auth.funder.id, params.id),
);
