import { rateLimits, sql, type Database } from "@seenit/db";

import { AppError } from "./errors";

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter in Postgres, so limits hold across server instances without extra infra.
 * Throws a 429 AppError (with Retry-After) when over the limit.
 */
export async function enforceRateLimit(db: Database, key: string, rule: RateLimitRule, now: Date) {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  // Occasionally drop old windows so the table stays small.
  if (Math.random() < 0.01) {
    await db
      .delete(rateLimits)
      .where(sql`${rateLimits.windowStart} < ${new Date(now.getTime() - 86_400_000)}`);
  }

  const count = row?.count ?? 1;
  if (count > rule.limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    throw new AppError(
      "rate_limited",
      "Too many requests, slow down",
      { limit: rule.limit, windowSeconds: rule.windowSeconds },
      { "retry-after": String(Math.max(retryAfter, 1)) },
    );
  }
  return { remaining: rule.limit - count };
}
