import { z } from "zod";

import { issueUploadUrl } from "@/server/domain/submissions";
import { route } from "@/server/route";

const body = z.object({
  missionId: z.uuid(),
  mediaType: z.enum(["photo", "video"]),
  contentType: z.string().min(1).max(100),
  contentLength: z.number().int().positive(),
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyMeters: z.number().positive(),
    isMocked: z.boolean().optional(),
  }),
});

/** Signed upload URL, only inside the mission radius and with a sufficient personhood tier. */
export const POST = route(
  {
    name: "submissions.upload_url",
    auth: "contributor",
    body,
    rateLimit: { limit: 20, windowSeconds: 60 },
  },
  async ({ body, auth, services, now }) => issueUploadUrl(services, auth.user, body, now),
);
