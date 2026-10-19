import pino, { type Logger } from "pino";

export type { Logger };

/** Structured JSON logs (one line per event). Secrets are redacted by path. */
export function createLogger(level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    level,
    base: { service: "seenit-web" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "*.token",
        "*.signature",
        "*.privateKey",
      ],
      censor: "[redacted]",
    },
  });
}
