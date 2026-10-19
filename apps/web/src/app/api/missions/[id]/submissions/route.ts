import { listMissionSubmissions } from "@/server/domain/submissions";
import { route } from "@/server/route";

const FILTERS = ["processing", "ready", "needs_review", "accepted", "rejected"] as const;

/** Funder review queue: AI answers, quality flags and blurred frames. ?status=needs_review to filter. */
export const GET = route<"funder", undefined, { id: string }>(
  { name: "missions.submissions", auth: "funder", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ params, url, auth, services }) => {
    const status = url.searchParams.get("status");
    const filter = FILTERS.find((f) => f === status);
    return listMissionSubmissions(services, auth.funder.id, params.id, filter);
  },
);
