import { z } from "zod";

import { getSession } from "@/server/domain/personhood";
import { AppError } from "@/server/errors";
import { route } from "@/server/route";

/** Poll a verification session started with a redirect provider. */
export const GET = route<"contributor", undefined, { id: string }>(
  { name: "personhood.session", auth: "contributor", rateLimit: { limit: 120, windowSeconds: 60 } },
  async ({ params, auth, services, now }) => {
    if (!z.uuid().safeParse(params.id).success)
      throw new AppError("not_found", "Session not found");
    return getSession(services, auth.user, params.id, now);
  },
);
