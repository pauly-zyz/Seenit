import { getPersonhoodStatus } from "@/server/domain/personhood";
import { route } from "@/server/route";

/** Your tier, attestations, and which missions each tier opens. */
export const GET = route(
  { name: "personhood.status", auth: "contributor", rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ auth, services, now }) => getPersonhoodStatus(services, auth.user, now),
);
