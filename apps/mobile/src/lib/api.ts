/** Minimal client for the Seenit API used by the contributor app. */

export type ProviderId = "human_passport" | "self";

export interface TierInfo {
  tier: 1 | 2;
  name: string;
  howToVerify: string;
  unlocks: string;
  unlocked: boolean;
  provider: ProviderId | null;
  activeMissions: number;
}

export interface AttestationInfo {
  provider: ProviderId;
  tier: number;
  state: "active" | "pending_onchain" | "expired" | "revoked";
  verifiedAt: string;
  expiresAt: string;
  txHash: string | null;
}

export interface PersonhoodStatus {
  wallet: string;
  tier: number;
  missionsOpenToYou: number;
  attestations: AttestationInfo[];
  tiers: TierInfo[];
  providers: { id: ProviderId; name: string; tier: number; flow: "instant" | "redirect" }[];
}

export type StartResponse =
  | { status: "verified"; sessionId: string; tier: number }
  | { status: "pending"; sessionId: string; url: string; expiresAt: string };

export interface SessionInfo {
  id: string;
  provider: ProviderId;
  status: "pending" | "verified" | "failed" | "expired";
  error: string | null;
  tier: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface SeenitApi {
  getPersonhoodStatus(): Promise<PersonhoodStatus>;
  startVerification(provider: ProviderId): Promise<StartResponse>;
  getSession(id: string): Promise<SessionInfo>;
}

export function createApi(opts: {
  baseUrl: string;
  getToken: () => string | null;
  fetchFn?: typeof fetch;
}): SeenitApi {
  const fetchFn = opts.fetchFn ?? fetch;

  async function request<T>(method: "GET" | "POST", path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const token = opts.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (method === "POST") headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await fetchFn(`${opts.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: method === "POST" ? "{}" : undefined,
      });
    } catch {
      throw new ApiError(0, "network_error", "Can't reach Seenit. Check your connection.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = body?.error ?? {};
      throw new ApiError(
        res.status,
        err.code ?? "error",
        err.message ?? `Request failed (${res.status})`,
        err.details ?? {},
      );
    }
    return body as T;
  }

  return {
    getPersonhoodStatus: () => request("GET", "/api/personhood/status"),
    startVerification: (provider) => request("POST", `/api/personhood/${provider}/start`),
    getSession: (id) => request("GET", `/api/personhood/sessions/${encodeURIComponent(id)}`),
  };
}
