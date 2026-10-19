import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

export { schema };
export * from "./schema/index.js";
// Re-export query helpers so every package uses this package's drizzle-orm instance.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type InferInsertModel,
  type InferSelectModel,
} from "drizzle-orm";

/** Any Postgres-backed Drizzle database with the Seenit schema (node-postgres or PGlite). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Folder with the generated SQL migrations. */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** Creates a Drizzle client backed by a pg connection pool. */
export function createDb(
  connectionString: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
): Database & { $client: Pool } {
  const pool = new Pool({ connectionString, max: 10, ...poolConfig });
  // NodePgDatabase's HKT is narrower than the shared PgDatabase type; behaviour is identical.
  return drizzle({ client: pool, schema }) as unknown as Database & { $client: Pool };
}

/** Applies pending migrations (used by deploy scripts; `pnpm db:migrate` does the same). */
export async function migrateDb(db: ReturnType<typeof createDb>): Promise<void> {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
}
