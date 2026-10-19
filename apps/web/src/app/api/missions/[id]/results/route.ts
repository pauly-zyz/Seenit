import { getResults } from "@/server/domain/submissions";
import { route } from "@/server/route";

/** Accepted answers: structured JSON + short-lived URLs to the blurred media + on-chain proof. */
export const GET = route<"funder", undefined, { id: string }>(
  { name: "missions.results", auth: "funder", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ params, auth, services }) => getResults(services, auth.funder.id, params.id),
);
