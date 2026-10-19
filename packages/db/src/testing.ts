import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { type Database, migrationsFolder, schema, sql } from "./index.js";

/**
 * In-process Postgres (PGlite) with all migrations applied. For tests only:
 * no Docker needed, real SQL semantics.
 */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Database, close: () => client.close() };
}

/** Empties every table, keeping the schema. */
export async function resetTestDb(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table payouts, submissions, missions, api_keys, funders, sessions,
      auth_nonces, personhood_attestations, users, jobs, rate_limits, indexer_state, chain_events
      restart identity cascade`,
  );
}
