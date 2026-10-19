import { syncEscrowEvents } from "@/server/domain/indexer";
import { route } from "@/server/route";

/** Called by a scheduler (e.g. every minute) with `Authorization: Bearer $CRON_SECRET`. */
export const GET = route({ name: "cron.indexer", auth: "cron" }, async ({ services }) => {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const r = await syncEscrowEvents(services);
    runs.push(r);
    if (r.caughtUp) break;
  }
  return { runs };
});
