import { assertUuid, getMissionForContributor } from "@/server/domain/contributor";
import { route } from "@/server/route";

/** Mission detail for the contributor app (with tier lock and your own submission). */
export const GET = route<"contributor", undefined, { id: string }>(
  { name: "missions.detail", auth: "contributor", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ params, auth, services, now }) => {
    assertUuid(params.id);
    return getMissionForContributor(services, auth.user, params.id, now);
  },
);
