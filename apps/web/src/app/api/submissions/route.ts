import { captureMetadataSchema } from "@seenit/shared";
import { z } from "zod";

import { finalizeSubmission } from "@/server/domain/submissions";
import { json } from "@/server/json";
import { route } from "@/server/route";

const body = z.object({ submissionId: z.uuid(), capture: captureMetadataSchema });

/** Finalize an upload: verify hash, GPS and time, record on-chain, queue AI processing. */
export const POST = route(
  {
    name: "submissions.finalize",
    auth: "contributor",
    body,
    rateLimit: { limit: 20, windowSeconds: 60 },
  },
  async ({ body, auth, services, now, log }) =>
    json(
      { submission: await finalizeSubmission(services, auth.user, body, now, log) },
      { status: 201 },
    ),
);
