import { acceptSubmission } from "@/server/domain/submissions";
import { route } from "@/server/route";

/** Funder accepts: the operator sends acceptSubmission on-chain and the contributor is paid. */
export const POST = route<"funder", undefined, { id: string }>(
  { name: "submissions.accept", auth: "funder", rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ params, auth, services }) => acceptSubmission(services, auth.funder.id, params.id),
);
