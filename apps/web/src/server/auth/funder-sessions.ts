import { and, eq, funderSessions, funders, gt, type Database } from "@seenit/db";

import { randomToken, sha256Hex } from "../crypto";

export const FUNDER_SESSION_COOKIE = "seenit_funder_session";
export const FUNDER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Browser requests authenticated by cookie must send this header on writes (CSRF guard). */
export const CSRF_HEADER = "x-seenit-csrf";

export async function createFunderSession(db: Database, funderId: string, now: Date) {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + FUNDER_SESSION_TTL_MS);
  await db.insert(funderSessions).values({ tokenHash: sha256Hex(token), funderId, expiresAt });
  return { token, expiresAt };
}

export async function authenticateFunderSession(db: Database, token: string, now: Date) {
  const [row] = await db
    .select({ funder: funders })
    .from(funderSessions)
    .innerJoin(funders, eq(funders.id, funderSessions.funderId))
    .where(and(eq(funderSessions.tokenHash, sha256Hex(token)), gt(funderSessions.expiresAt, now)))
    .limit(1);
  return row?.funder ?? null;
}

export async function deleteFunderSession(db: Database, token: string) {
  await db.delete(funderSessions).where(eq(funderSessions.tokenHash, sha256Hex(token)));
}

export function funderSessionCookie(token: string, expiresAt: Date) {
  return `${FUNDER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expiresAt.toUTCString()}`;
}

export const clearFunderSessionCookie = `${FUNDER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
