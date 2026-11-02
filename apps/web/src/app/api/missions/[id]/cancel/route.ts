import { z } from "zod";

import { cancelMission } from "@/server/domain/funder-missions";
import { route } from "@/server/route";

const body = z.object({
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

/**
 * Cancel a mission. Unfunded drafts close immediately. Funded missions return the cancelMission
 * transaction to sign; call again with its txHash once mined.
 */
export const POST = route<"funder", z.infer<typeof body>, { id: string }>(
  { name: "missions.cancel", auth: "funder", body, rateLimit: { limit: 30, windowSeconds: 60 } },
  async ({ params, body, auth, services }) =>
    cancelMission(services, auth.funder.id, params.id, body.txHash as `0x${string}` | undefined),
);
