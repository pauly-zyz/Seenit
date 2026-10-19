import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

export { schema };
export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/** Creates a Drizzle client backed by a pg connection pool. */
export function createDb(
  connectionString: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
): Database {
  const pool = new Pool({ connectionString, ...poolConfig });
  return drizzle({ client: pool, schema });
}
