/**
 * Long-running indexer: keeps the database in sync with MissionEscrow events.
 *   pnpm -F @seenit/web indexer
 * (Alternatively call GET /api/cron/indexer from a scheduler.)
 */
import { syncEscrowEvents } from "../domain/indexer";
import { getServices } from "../services";

const IDLE_MS = Number(process.env.INDEXER_POLL_MS ?? 4000);

async function main() {
  const services = getServices();
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
  services.logger.info({ pollMs: IDLE_MS }, "indexer started");

  while (!stopping) {
    try {
      const r = await syncEscrowEvents(services);
      if (r.caughtUp) await new Promise((res) => setTimeout(res, IDLE_MS));
    } catch (err) {
      services.logger.error({ err }, "indexer iteration failed");
      await new Promise((res) => setTimeout(res, IDLE_MS * 2));
    }
  }
  services.logger.info("indexer stopped");
  process.exit(0);
}

void main();
