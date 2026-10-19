import { listMySubmissions } from "@/server/domain/contributor";
import { route } from "@/server/route";

/** Your submissions, payouts and reward totals. */
export const GET = route(
  { name: "me.submissions", auth: "contributor", rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ auth, services }) => listMySubmissions(services, auth.user),
);
