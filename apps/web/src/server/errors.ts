export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precheck_failed"
  | "rate_limited"
  | "chain_error"
  | "upstream_error"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precheck_failed: 422,
  rate_limited: 429,
  chain_error: 502,
  upstream_error: 502,
  internal_error: 500,
};

/** Errors meant for the API client. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} not found`);
