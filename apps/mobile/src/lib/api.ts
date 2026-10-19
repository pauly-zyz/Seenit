/** Client for the Seenit API used by the contributor app. */
import type { CaptureMetadata } from "@seenit/shared";

export type ProviderId = "human_passport" | "self";

// ------------------------------------------------------------------------------------------------
// Personhood
// ------------------------------------------------------------------------------------------------

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

// ------------------------------------------------------------------------------------------------
// Missions & submissions
// ------------------------------------------------------------------------------------------------

export interface Mission {
  id: string;
  title: string;
  instructions: string;
  mediaType: "photo" | "video";
  maxVideoSeconds: number | null;
  location: { lat: number; lng: number };
  radiusMeters: number;
  /** Token base units, as a string. */
  reward: string;
  maxCaptures: number;
  minTier: number;
  deadline: string;
  status: string;
  outputSchema: Record<string, unknown>;
  onchainId: string | null;
}

export interface NearbyMission extends Mission {
  distanceMeters: number;
  withinMissionRadius: boolean;
  slotsLeft: number;
}

export interface MissionDetail {
  mission: Mission & { slotsLeft: number; open: boolean };
  access: { yourTier: number; requiredTier: number; locked: boolean };
  mySubmission: { id: string; status: SubmissionStatus; rejectionReasons: string[] | null } | null;
}

export type SubmissionStatus =
  | "awaiting_upload"
  | "rejected_precheck"
  | "chain_failed"
  | "processing"
  | "ready"
  | "accepted"
  | "rejected";

export interface UploadUrlResponse {
  submissionId: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
}

export interface HistoryItem {
  id: string;
  status: SubmissionStatus;
  rejectionReasons: string[] | null;
  capturedAt: string | null;
  createdAt: string;
  reviewDeadline: string | null;
  mediaType: "photo" | "video";
  recordTxHash: string | null;
  resolveTxHash: string | null;
  mission: { id: string; title: string; reward: string };
  payout: { amount: string; fee: string; txHash: string; finalized: boolean } | null;
}

export interface History {
  wallet: string;
  summary: {
    earned: string;
    pending: string;
    accepted: number;
    inReview: number;
    rejected: number;
    token: { symbol: string; decimals: number };
  };
  items: HistoryItem[];
}

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: { id: string; wallet: string; tier: number; reputation: number };
}

// ------------------------------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** Worth retrying later (offline, server trouble, rate limit). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface SeenitApi {
  getNonce(): Promise<{ nonce: string; domain: string; chainId: number }>;
  verifySiwe(message: string, signature: string): Promise<AuthResult>;
  logout(): Promise<void>;
  getPersonhoodStatus(): Promise<PersonhoodStatus>;
  startVerification(provider: ProviderId): Promise<StartResponse>;
  getSession(id: string): Promise<SessionInfo>;
  getNearby(q: {
    lat: number;
    lng: number;
    radiusKm: number;
  }): Promise<{ missions: NearbyMission[] }>;
  getMission(id: string): Promise<MissionDetail>;
  requestUploadUrl(body: {
    missionId: string;
    mediaType: "photo" | "video";
    contentType: string;
    contentLength: number;
    gps: { lat: number; lng: number; accuracyMeters: number; isMocked?: boolean };
  }): Promise<UploadUrlResponse>;
  finalizeSubmission(body: {
    submissionId: string;
    capture: CaptureMetadata;
  }): Promise<{ submission: { id: string; status: SubmissionStatus } }>;
  getHistory(): Promise<History>;
}

export function createApi(opts: {
  baseUrl: string;
  getToken: () => string | null;
  fetchFn?: typeof fetch;
}): SeenitApi {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const token = opts.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (method === "POST") headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
    } catch {
      throw new ApiError(0, "network_error", "Can't reach Seenit. Check your connection.");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = json?.error ?? {};
      throw new ApiError(
        res.status,
        err.code ?? "error",
        err.message ?? `Request failed (${res.status})`,
        err.details ?? {},
      );
    }
    return json as T;
  }

  return {
    getNonce: () => request("GET", "/api/auth/nonce"),
    verifySiwe: (message, signature) => request("POST", "/api/auth/verify", { message, signature }),
    logout: async () => {
      await request("POST", "/api/auth/logout");
    },
    getPersonhoodStatus: () => request("GET", "/api/personhood/status"),
    startVerification: (provider) => request("POST", `/api/personhood/${provider}/start`),
    getSession: (id) => request("GET", `/api/personhood/sessions/${encodeURIComponent(id)}`),
    getNearby: ({ lat, lng, radiusKm }) =>
      request("GET", `/api/missions/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&limit=100`),
    getMission: (id) => request("GET", `/api/missions/${encodeURIComponent(id)}`),
    requestUploadUrl: (body) => request("POST", "/api/submissions/upload-url", body),
    finalizeSubmission: (body) => request("POST", "/api/submissions", body),
    getHistory: () => request("GET", "/api/me/submissions"),
  };
}
