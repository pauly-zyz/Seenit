import { chainEvents, eq, indexerState } from "@seenit/db";

import type { Services } from "../services";
import { applyEscrowEvent } from "./sync";

const STATE_ID = "mission_escrow";

/**
 * Reads MissionEscrow events from the last processed block onward and applies them.
 * Each event is recorded in chain_events first, so re-running over the same range is a no-op.
 */
export async function syncEscrowEvents(
  s: Pick<Services, "db" | "chain" | "config" | "logger">,
  opts: { maxBlocks?: bigint } = {},
) {
  const maxBlocks = opts.maxBlocks ?? 2_000n;
  const state = await s.db.query.indexerState.findFirst({ where: eq(indexerState.id, STATE_ID) });
  const fromBlock = state ? state.lastBlock + 1n : s.config.indexerStartBlock;
  const latest = await s.chain.getBlockNumber();
  if (fromBlock > latest) return { fromBlock, toBlock: latest, applied: 0, caughtUp: true };

  const toBlock = fromBlock + maxBlocks - 1n < latest ? fromBlock + maxBlocks - 1n : latest;
  const events = await s.chain.getEscrowEvents(fromBlock, toBlock);
  let applied = 0;

  for (const ev of events) {
    const inserted = await s.db
      .insert(chainEvents)
      .values({
        txHash: ev.txHash,
        logIndex: ev.logIndex,
        blockNumber: ev.blockNumber,
        eventName: ev.name,
        args: JSON.parse(
          JSON.stringify(ev.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        ),
      })
      .onConflictDoNothing()
      .returning({ txHash: chainEvents.txHash });
    if (inserted.length === 0) continue; // already applied
    await applyEscrowEvent(s.db, ev, s.logger);
    applied++;
  }

  await s.db
    .insert(indexerState)
    .values({ id: STATE_ID, lastBlock: toBlock })
    .onConflictDoUpdate({
      target: indexerState.id,
      set: { lastBlock: toBlock, updatedAt: new Date() },
    });

  s.logger.info({ fromBlock, toBlock, events: events.length, applied }, "indexer sync");
  return { fromBlock, toBlock, applied, caughtUp: toBlock === latest };
}
