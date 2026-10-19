import { and, apiKeys, eq, funders, isNull, type Database } from "@seenit/db";

import { randomToken, sha256Hex } from "../crypto";

export const API_KEY_PREFIX = "sk_";

/** Creates an API key. The plaintext is returned once; only its SHA-256 is stored. */
export async function createApiKey(db: Database, funderId: string, name = "default") {
  const key = `${API_KEY_PREFIX}${randomToken(32)}`;
  const [row] = await db
    .insert(apiKeys)
    .values({ funderId, name, keyHash: sha256Hex(key), prefix: key.slice(0, 10) })
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix });
  return { key, id: row!.id, prefix: row!.prefix };
}

export async function authenticateApiKey(db: Database, key: string, now: Date) {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const [row] = await db
    .select({ keyId: apiKeys.id, funder: funders })
    .from(apiKeys)
    .innerJoin(funders, eq(funders.id, apiKeys.funderId))
    .where(and(eq(apiKeys.keyHash, sha256Hex(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.keyId));
  return row;
}
