import type {
  CancelResult,
  CreateMissionResult,
  Hex,
  MediaType,
  Meta,
  Mission,
  MissionStatusResult,
  OutputSchema,
  ResultsResponse,
  SubmissionsResponse,
  SubmissionStatus,
  Template,
  WebhookCreated,
  WebhookSettings,
} from "./types.js";

/** Error returned by the API (`{ error: { code, message, details, requestId } }`) or the network. */
export class SeenitError extends Error {
  constructor(
    /** HTTP status, or 0 for network errors and timeouts. */
    readonly status: number,
    /** API error code, e.g. `validation_failed`, `not_found`, `conflict`, `rate_limited`. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "SeenitError";
  }

  /** Worth retrying later (network, rate limit, server error). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface SeenitOptions {
  /** Funder / agent API key (`sk_...`). Defaults to `process.env.SEENIT_API_KEY`. */
  apiKey?: string;
  /** API origin. Defaults to `process.env.SEENIT_API_URL`. */
  baseUrl?: string;
  /** Custom fetch (tests, proxies, edge runtimes). */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Retries for idempotent requests (GET) on network errors, 429 and 5xx. Default 2. */
  maxRetries?: number;
}

/** Input for `missions.create`. Give either `outputSchema` or a `template` id. */
export interface CreateMissionInput {
  title: string;
  /** What contributors must capture. Shown to them and to the AI that extracts the answer. */
  instructions: string;
  mediaType: MediaType;
  /** Required for video missions (1–120 s). */
  maxVideoSeconds?: number;
  location: { lat: number; lng: number };
  /** Capture must happen within this distance of `location` (10–5000 m). */
  radiusMeters: number;
  /** Reward per accepted capture in token base units (use `parseUnits` for "2.5"). */
  rewardPerSubmission: bigint | string;
  maxSubmissions: number;
  deadline: Date | string;
  /** Minimum personhood tier. Raised to 2 automatically above the Tier 1 reward limit. */
  minTier?: 1 | 2;
  outputSchema?: OutputSchema;
  /** Use a ready-made output schema, e.g. "store_open" (see `templates.list()`). */
  template?: string;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

const env = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

/**
 * Client for the Seenit REST API.
 *
 * ```ts
 * const seenit = new Seenit({ apiKey: process.env.SEENIT_API_KEY });
 * const { mission, funding } = await seenit.missions.create({ ... , template: "store_open" });
 * ```
 */
export class Seenit {
  readonly missions: MissionsApi;
  readonly submissions: SubmissionsApi;
  readonly webhooks: WebhooksApi;
  readonly templates: TemplatesApi;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private metaCache?: Promise<Meta>;

  constructor(opts: SeenitOptions = {}) {
    this.apiKey = opts.apiKey ?? env("SEENIT_API_KEY");
    const baseUrl = opts.baseUrl ?? env("SEENIT_API_URL");
    if (!baseUrl) throw new Error("Seenit: baseUrl (or SEENIT_API_URL) is required");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.missions = new MissionsApi(this);
    this.submissions = new SubmissionsApi(this);
    this.webhooks = new WebhooksApi(this);
    this.templates = new TemplatesApi(this);
  }

  /** Chain, escrow and reward token facts (cached per client). */
  meta(): Promise<Meta> {
    this.metaCache ??= this.request<Meta>("GET", "/api/meta", { auth: false }).catch((err) => {
      this.metaCache = undefined;
      throw err;
    });
    return this.metaCache;
  }

  /** Low-level request. Prefer the typed helpers. */
  async request<T>(
    method: Method,
    path: string,
    opts: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth !== false) {
      if (!this.apiKey)
        throw new SeenitError(
          401,
          "unauthorized",
          "Seenit: apiKey (or SEENIT_API_KEY) is required",
        );
      headers["x-api-key"] = this.apiKey;
    }
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const retries = method === "GET" ? this.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const e = new SeenitError(
          0,
          "network_error",
          `Could not reach Seenit: ${(err as Error).message}`,
        );
        if (attempt < retries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw e;
      }
      const text = await res.text();
      const json = text ? safeJson(text) : null;
      if (res.ok) return json as T;

      const err = (
        json as {
          error?: { code?: string; message?: string; details?: unknown; requestId?: string };
        } | null
      )?.error;
      const e = new SeenitError(
        res.status,
        err?.code ?? "http_error",
        err?.message ?? `HTTP ${res.status}`,
        err?.details,
        err?.requestId,
      );
      if (e.retryable && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : backoff(attempt),
        );
        continue;
      }
      throw e;
    }
  }
}

class MissionsApi {
  constructor(private readonly c: Seenit) {}

  /**
   * Saves a mission as `pending_funding` and returns the transactions that fund it. Nothing is
   * live and no money moves until the funding transactions are mined and `confirm` is called.
   */
  async create(input: CreateMissionInput): Promise<CreateMissionResult> {
    const { template, rewardPerSubmission, deadline, ...rest } = input;
    let outputSchema = input.outputSchema;
    if (!outputSchema && template)
      outputSchema = (await this.c.templates.get(template)).outputSchema;
    if (!outputSchema)
      throw new SeenitError(400, "validation_failed", "Give an outputSchema or a template");
    return this.c.request("POST", "/api/missions", {
      body: {
        ...rest,
        outputSchema,
        rewardPerSubmission: rewardPerSubmission.toString(),
        deadline: deadline instanceof Date ? deadline.toISOString() : deadline,
      },
    });
  }

  /** Activates a mission from its mined createMission transaction. */
  confirm(missionId: string, txHash: Hex): Promise<Mission> {
    return this.c.request("POST", `/api/missions/${enc(missionId)}/confirm`, { body: { txHash } });
  }

  status(missionId: string): Promise<MissionStatusResult> {
    return this.c.request("GET", `/api/missions/${enc(missionId)}/status`);
  }

  /** Accepted answers with blurred media links and on-chain proof. */
  results(missionId: string): Promise<ResultsResponse> {
    return this.c.request("GET", `/api/missions/${enc(missionId)}/results`);
  }

  /** Review queue: every recorded submission with its AI answer and quality flags. */
  submissions(
    missionId: string,
    opts: { status?: SubmissionStatus } = {},
  ): Promise<SubmissionsResponse> {
    const q = opts.status ? `?status=${enc(opts.status)}` : "";
    return this.c.request("GET", `/api/missions/${enc(missionId)}/submissions${q}`);
  }

  /**
   * Cancels a mission. Unfunded drafts close at once; a funded mission returns the
   * cancelMission transaction to sign. Call again with `txHash` once it is mined.
   */
  cancel(missionId: string, opts: { txHash?: Hex } = {}): Promise<CancelResult> {
    return this.c.request("POST", `/api/missions/${enc(missionId)}/cancel`, { body: opts });
  }
}

class SubmissionsApi {
  constructor(private readonly c: Seenit) {}

  /** Pays the contributor (reward minus platform fee) on-chain. */
  accept(
    submissionId: string,
  ): Promise<{ submission: Record<string, unknown>; payout: Record<string, unknown> }> {
    return this.c.request("POST", `/api/submissions/${enc(submissionId)}/accept`, { body: {} });
  }

  /** Rejects within the review window; `reason` is stored on-chain (≤ 32 bytes). */
  reject(submissionId: string, reason: string): Promise<{ submission: Record<string, unknown> }> {
    return this.c.request("POST", `/api/submissions/${enc(submissionId)}/reject`, {
      body: { reason },
    });
  }
}

class WebhooksApi {
  constructor(private readonly c: Seenit) {}

  get(): Promise<WebhookSettings> {
    return this.c.request("GET", "/api/webhook");
  }

  /** Sets the endpoint and returns a new signing secret (shown once). */
  set(url: string): Promise<WebhookCreated> {
    return this.c.request("PUT", "/api/webhook", { body: { url } });
  }

  delete(): Promise<WebhookSettings> {
    return this.c.request("DELETE", "/api/webhook");
  }
}

class TemplatesApi {
  private cache?: Promise<Template[]>;
  constructor(private readonly c: Seenit) {}

  /** Ready-made output schemas (stock_check, store_open, construction_progress, ...). */
  list(): Promise<Template[]> {
    this.cache ??= this.c
      .request<{ templates: Template[] }>("GET", "/api/mission-templates", { auth: false })
      .then((r) => r.templates)
      .catch((err) => {
        this.cache = undefined;
        throw err;
      });
    return this.cache;
  }

  async get(id: string): Promise<Template> {
    const t = (await this.list()).find((x) => x.id === id);
    if (!t) throw new SeenitError(404, "not_found", `Unknown template "${id}"`);
    return t;
  }
}

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(500 * 2 ** attempt, 8_000) + Math.random() * 250;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "invalid_response", message: text.slice(0, 200) } };
  }
}
