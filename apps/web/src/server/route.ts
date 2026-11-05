import { randomUUID } from "node:crypto";

import type { InferSelectModel } from "@seenit/db";
import type { funders, users } from "@seenit/db";
import { connection } from "next/server";
import { z, type ZodType } from "zod";

import { authenticateApiKey } from "./auth/api-keys";
import {
  authenticateFunderSession,
  CSRF_HEADER,
  FUNDER_SESSION_COOKIE,
} from "./auth/funder-sessions";
import { authenticateSession, SESSION_COOKIE } from "./auth/sessions";
import { safeEqual } from "./crypto";
import { ConfigError } from "./config";
import { AppError } from "./errors";
import { json } from "./json";
import { createLogger, type Logger } from "./logger";
import { enforceRateLimit, type RateLimitRule } from "./rate-limit";
import { getServices, type Services } from "./services";

type User = InferSelectModel<typeof users>;
type Funder = InferSelectModel<typeof funders>;

/**
 * funder: API key (agents, SDK, MCP) or a dashboard session cookie.
 * funderSession: dashboard session cookie only (e.g. managing API keys).
 */
type AuthMode = "none" | "contributor" | "funder" | "funderSession" | "cron";
type AuthFor<A extends AuthMode> = A extends "contributor"
  ? { user: User }
  : A extends "funder" | "funderSession"
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

/**
 * Client IP for rate limiting. Clients can put anything at the start of X-Forwarded-For, so trust
 * x-real-ip (set by Vercel / the reverse proxy) or else the right-most X-Forwarded-For entry,
 * which the nearest proxy appended.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = req.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops?.at(-1) || "unknown";
}

/** Applied when a route doesn't set its own limit, so no endpoint is ever unlimited. */
export const DEFAULT_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 };

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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function authenticate(mode: AuthMode, req: Request, s: Services, now: Date) {
  if (mode === "none") return { auth: {}, principal: null };
  if (mode === "cron") {
    const token = bearer(req);
    if (!token || !safeEqual(token, s.config.cronSecret))
      throw new AppError("unauthorized", "Invalid cron secret");
    return { auth: {}, principal: "cron" };
  }
  if (mode === "funder" || mode === "funderSession") {
    const key = mode === "funder" ? (req.headers.get("x-api-key") ?? bearer(req)) : null;
    if (key) {
      const found = await authenticateApiKey(s.db, key, now);
      if (!found) throw new AppError("unauthorized", "Missing or invalid API key");
      return { auth: { funder: found.funder }, principal: `funder:${found.funder.id}` };
    }
    const token = cookie(req, FUNDER_SESSION_COOKIE);
    const funder = token ? await authenticateFunderSession(s.db, token, now) : null;
    if (!funder) {
      throw new AppError(
        "unauthorized",
        mode === "funder" ? "Missing or invalid API key" : "Sign in to the dashboard first",
      );
    }
    // Cookies ride along on cross-site requests; a custom header can't without CORS approval.
    if (!SAFE_METHODS.has(req.method) && req.headers.get(CSRF_HEADER) !== "1") {
      throw new AppError("forbidden", `Missing ${CSRF_HEADER} header`);
    }
    return { auth: { funder }, principal: `funder:${funder.id}` };
  }
  const token = bearer(req) ?? cookie(req, SESSION_COOKIE);
  const user = token ? await authenticateSession(s.db, token, now) : null;
  if (!user) throw new AppError("unauthorized", "Sign in with Ethereum first");
  return { auth: { user }, principal: `user:${user.id}` };
}

let configErrorLogged = false;

/**
 * Missing/invalid env: answer 503 with JSON (instead of an empty 500) and log the
 * variable names once. The names are not sent to the client.
 */
function notConfigured(err: unknown, routeName: string): Response {
  if (!(err instanceof ConfigError)) throw err;
  if (!configErrorLogged) {
    configErrorLogged = true;
    createLogger().error(
      { route: routeName, fields: err.fields },
      "server environment is incomplete",
    );
  }
  return json(
    {
      error: {
        code: "not_configured",
        message: "Seenit's server isn't configured yet. Please try again later.",
      },
    },
    { status: 503, headers: { "retry-after": "60" } },
  );
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
    let services: Services;
    try {
      services = getServices();
    } catch (err) {
      return notConfigured(err, opts.name);
    }
    const now = services.now();
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const url = new URL(req.url);
    const ip = clientIp(req);
    const log = services.logger.child({ requestId, route: opts.name });
    const started = performance.now();
    let status = 500;

    try {
      const { auth, principal } = await authenticate(opts.auth, req, services, now);
      await enforceRateLimit(
        services.db,
        `${opts.name}:${principal ?? `ip:${ip}`}`,
        opts.rateLimit ?? DEFAULT_RATE_LIMIT,
        now,
      );

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
