import { z } from "zod";

import { rejectSubmission } from "@/server/domain/submissions";
import { route } from "@/server/route";

const body = z.object({
  /** Stored on-chain as bytes32, so at most 32 bytes of UTF-8. */
  reason: z
    .string()
    .min(1)
    .refine((r) => Buffer.byteLength(r, "utf8") <= 32, "reason must fit in 32 bytes"),
});

/** Funder rejects within the review window: the operator sends rejectSubmission on-chain. */
export const POST = route<"funder", z.infer<typeof body>, { id: string }>(
  { name: "submissions.reject", auth: "funder", body, rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ params, body, auth, services, now }) =>
    rejectSubmission(services, auth.funder.id, params.id, body.reason, now),
);
