import { z } from "zod";

import { confirmFunding } from "@/server/domain/missions";
import { route } from "@/server/route";

const body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** Sync a mission after its createMission tx is mined (the indexer does the same in the background). */
export const POST = route<"funder", z.infer<typeof body>, { id: string }>(
  { name: "missions.confirm", auth: "funder", body, rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ params, body, auth, services }) => ({
    mission: await confirmFunding(
      services,
      auth.funder.id,
      params.id,
      body.txHash as `0x${string}`,
    ),
  }),
);
