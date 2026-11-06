import type { CaptureMetadata } from "@seenit/shared";

import type {
  History,
  Meta,
  MissionDetail,
  NearbyMission,
  PersonhoodStatus,
  ProviderId,
  SessionInfo,
  StartResponse,
  SubmissionStatus,
  UploadUrlResponse,
} from "./types";

/** Error body every API route returns: { error: { code, message, details, requestId } }. */
export class ContributorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ContributorApiError";
  }
}

export type Fetch = typeof fetch;

export interface UploadRequest {
  missionId: string;
  mediaType: "photo" | "video";
  contentType: string;
  contentLength: number;
  gps: { lat: number; lng: number; accuracyMeters: number };
}

/**
 * Browser client for the contributor web app. Auth is the httpOnly `seenit_session` cookie set by
 * Sign-In with Ethereum; every write sends the x-seenit-csrf header the server requires for it.
 */
export function createContributorApi(fetchFn: Fetch = (...a) => fetch(...a)) {
  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (method !== "GET") {
      headers["x-seenit-csrf"] = "1";
      headers["content-type"] = "application/json";
    }
    let res: Response;
    try {
      res = await fetchFn(path, {
        method,
        headers,
        credentials: "same-origin",
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      throw new ContributorApiError(
        0,
        "network_error",
        "Can't reach Seenit. Check your connection.",
      );
    }
    const text = await res.text();
    let json: {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new ContributorApiError(
        res.status,
        e.code ?? "http_error",
        e.message ?? `Request failed (${res.status})`,
        e.details ?? {},
      );
    }
    return json as T;
  }

  return {
    meta: () => request<Meta>("GET", "/api/meta"),
    nonce: () =>
      request<{ nonce: string; domain: string; chainId: number }>("GET", "/api/auth/nonce"),
    signIn: (message: string, signature: string) =>
      request<{ user: { id: string; wallet: string; tier: number } }>("POST", "/api/auth/verify", {
        message,
        signature,
      }),
    signOut: () => request<{ ok: true }>("POST", "/api/auth/logout"),

    /** Also the "who am I" call: 401 means signed out. */
    personhood: () => request<PersonhoodStatus>("GET", "/api/personhood/status"),
    startVerification: (provider: ProviderId) =>
      request<StartResponse>("POST", `/api/personhood/${provider}/start`),
    verificationSession: (id: string) =>
      request<SessionInfo>("GET", `/api/personhood/sessions/${encodeURIComponent(id)}`),

    nearby: (q: { lat: number; lng: number; radiusKm: number }) =>
      request<{ missions: NearbyMission[] }>(
        "GET",
        `/api/missions/nearby?lat=${q.lat}&lng=${q.lng}&radiusKm=${q.radiusKm}&limit=100`,
      ),
    mission: (id: string) =>
      request<MissionDetail>("GET", `/api/missions/${encodeURIComponent(id)}`),
    uploadUrl: (body: UploadRequest) =>
      request<UploadUrlResponse>("POST", "/api/submissions/upload-url", body),
    finalize: (body: { submissionId: string; capture: CaptureMetadata }) =>
      request<{ submission: { id: string; status: SubmissionStatus } }>(
        "POST",
        "/api/submissions",
        body,
      ),
    history: () => request<History>("GET", "/api/me/submissions"),
  };
}

export type ContributorApi = ReturnType<typeof createContributorApi>;
