import { randomUUID } from "node:crypto";

import type { InferSelectModel } from "@seenit/db";
import type { funders, users } from "@seenit/db";
import { connection } from "next/server";
import { z, type ZodType } from "zod";

import { authenticateApiKey } from "./auth/api-keys";
import { authenticateSession, SESSION_COOKIE } from "./auth/sessions";
import { safeEqual } from "./crypto";
import { AppError } from "./errors";
import { json } from "./json";
import type { Logger } from "./logger";
import { enforceRateLimit, type RateLimitRule } from "./rate-limit";
import { getServices, type Services } from "./services";

type User = InferSelectModel<typeof users>;
type Funder = InferSelectModel<typeof funders>;

type AuthMode = "none" | "contributor" | "funder" | "cron";
type AuthFor<A extends AuthMode> = A extends "contributor"
  ? { user: User }
  : A extends "funder"
    ? { funder: Funder }
    : Record<string, never>;

export interface RouteContext<A extends AuthMode, B, P> {
  req: Request;
  url: URL;
  params: P;
  body: B;
  auth: AuthFor<A>;
  services: Services;
  log: Logger;
  ip: string;
  now: Date;
}

export interface RouteOptions<A extends AuthMode, B> {
  /** Used in logs and as the rate-limit bucket name. */
  name: string;
  auth: A;
  body?: ZodType<B>;
  /** Keyed by principal (user / funder) when authenticated, else by client IP. */
  rateLimit?: RateLimitRule;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return null;
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function authenticate(mode: AuthMode, req: Request, s: Services, now: Date) {
  if (mode === "none") return { auth: {}, principal: null };
  if (mode === "cron") {
    const token = bearer(req);
    if (!token || !safeEqual(token, s.config.cronSecret))
      throw new AppError("unauthorized", "Invalid cron secret");
    return { auth: {}, principal: "cron" };
  }
  if (mode === "funder") {
    const key = req.headers.get("x-api-key") ?? bearer(req);
    const found = key ? await authenticateApiKey(s.db, key, now) : null;
    if (!found) throw new AppError("unauthorized", "Missing or invalid API key");
    return { auth: { funder: found.funder }, principal: `funder:${found.funder.id}` };
  }
  const token = bearer(req) ?? cookie(req, SESSION_COOKIE);
  const user = token ? await authenticateSession(s.db, token, now) : null;
  if (!user) throw new AppError("unauthorized", "Sign in with Ethereum first");
  return { auth: { user }, principal: `user:${user.id}` };
}

/**
 * Wraps a route handler with: request id, structured logging, auth, rate limiting,
 * Zod body validation and consistent JSON errors.
 */
export function route<A extends AuthMode, B = undefined, P = Record<string, string>>(
  opts: RouteOptions<A, B>,
  handler: (ctx: RouteContext<A, B, P>) => Promise<Response | unknown>,
) {
  return async (req: Request, routeCtx?: { params: Promise<P> }): Promise<Response> => {
    try {
      await connection(); // always dynamic, never prerendered
    } catch {
      // outside a Next request scope (tests, scripts)
    }
    const services = getServices();
    const now = services.now();
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const url = new URL(req.url);
    const ip = clientIp(req);
    const log = services.logger.child({ requestId, route: opts.name });
    const started = performance.now();
    let status = 500;

    try {
      const { auth, principal } = await authenticate(opts.auth, req, services, now);
      if (opts.rateLimit) {
        await enforceRateLimit(
          services.db,
          `${opts.name}:${principal ?? `ip:${ip}`}`,
          opts.rateLimit,
          now,
        );
      }

      let body = undefined as B;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new AppError("bad_request", "Body must be valid JSON");
        }
        const parsed = opts.body.safeParse(raw);
        if (!parsed.success) {
          throw new AppError(
            "validation_failed",
            "Invalid request body",
            z.treeifyError(parsed.error),
          );
        }
        body = parsed.data;
      }

      const params = (routeCtx ? await routeCtx.params : {}) as P;
      const result = await handler({
        req,
        url,
        params,
        body,
        auth: auth as AuthFor<A>,
        services,
        log,
        ip,
        now,
      });
      const res = result instanceof Response ? result : json(result);
      res.headers.set("x-request-id", requestId);
      status = res.status;
      return res;
    } catch (err) {
      const appErr =
        err instanceof AppError ? err : new AppError("internal_error", "Something went wrong");
      status = appErr.status;
      if (!(err instanceof AppError)) log.error({ err }, "unhandled error");
      return json(
        {
          error: { code: appErr.code, message: appErr.message, details: appErr.details, requestId },
        },
        { status: appErr.status, headers: { ...appErr.headers, "x-request-id": requestId } },
      );
    } finally {
      log.info(
        {
          method: req.method,
          path: url.pathname,
          status,
          durationMs: Math.round(performance.now() - started),
          ip,
        },
        "request",
      );
    }
  };
}
