import { and, eq, gt, sessions, users, type Database } from "@seenit/db";

import { randomToken, sha256Hex } from "../crypto";

export const SESSION_COOKIE = "seenit_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(db: Database, userId: string, now: Date) {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash: sha256Hex(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function authenticateSession(db: Database, token: string, now: Date) {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  return row?.user ?? null;
}

export async function deleteSession(db: Database, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}
