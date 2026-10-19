import { z } from "zod";

import { findNearby } from "@/server/domain/missions";
import { AppError } from "@/server/errors";
import { route } from "@/server/route";

const query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).default(5),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Active missions with free slots near a point, closest first. */
export const GET = route(
  { name: "missions.nearby", auth: "none", rateLimit: { limit: 60, windowSeconds: 60 } },
  async ({ url, services, now }) => {
    const parsed = query.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new AppError(
        "validation_failed",
        "lat and lng are required numbers",
        z.treeifyError(parsed.error),
      );
    }
    return { missions: await findNearby(services.db, parsed.data, now) };
  },
);
