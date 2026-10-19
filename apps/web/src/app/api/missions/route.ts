import { missionSpecSchema } from "@seenit/shared";

import { createMission } from "@/server/domain/missions";
import { json } from "@/server/json";
import { route } from "@/server/route";

/**
 * Create a mission (funder / agent, API key). Returns the mission plus the two transactions to
 * sign (approve + createMission). Status stays pending_funding until the tx is confirmed.
 */
export const POST = route(
  {
    name: "missions.create",
    auth: "funder",
    body: missionSpecSchema,
    rateLimit: { limit: 30, windowSeconds: 60 },
  },
  async ({ body, auth, services, now }) =>
    json(await createMission(services, auth.funder, body, now), { status: 201 }),
);
