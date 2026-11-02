import { refundExpiredMission } from "@/server/domain/dashboard";
import { route } from "@/server/route";

/** After the deadline: return unused slots to the funder (operator sends the permissionless refund tx). */
export const POST = route<"funder", undefined, { id: string }>(
  { name: "missions.refund", auth: "funder", rateLimit: { limit: 10, windowSeconds: 60 } },
  async ({ params, auth, services, now }) =>
    refundExpiredMission(services, auth.funder.id, params.id, now),
);
