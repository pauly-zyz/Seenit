import type { MissionStatusResult, SubmissionsResponse } from "seenit-sdk";

import type { ApiKey, Funder, Funding, Meta, Mission, MissionListItem, Template } from "./types";

/** Error body every API route returns: { error: { code, message, details, requestId } }. */
export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export type Fetch = typeof fetch;

/**
 * Browser client for the dashboard. Auth is the httpOnly session cookie; every write sends the
 * x-seenit-csrf header the server requires for cookie-authenticated requests.
 */
export function createDashboardApi(fetchFn: Fetch = (...a) => fetch(...a)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (method !== "GET") headers["x-seenit-csrf"] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetchFn(path, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new DashboardApiError(0, "network_error", "Can't reach Seenit. Check your connection.");
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new DashboardApiError(
        res.status,
        e.code ?? "http_error",
        e.message ?? `HTTP ${res.status}`,
        e.details,
      );
    }
    return json as T;
  }

  return {
    me: () => request<{ funder: Funder; meta: Meta }>("GET", "/api/funder/me"),
    nonce: () =>
      request<{ nonce: string; domain: string; chainId: number }>("GET", "/api/auth/nonce"),
    signIn: (message: string, signature: string) =>
      request<{ funder: Funder }>("POST", "/api/funder/auth/verify", { message, signature }),
    signOut: () => request<{ ok: true }>("POST", "/api/funder/auth/logout"),

    apiKeys: () => request<{ keys: ApiKey[] }>("GET", "/api/funder/api-keys"),
    createApiKey: (name: string) =>
      request<{ id: string; name: string; prefix: string; key: string }>(
        "POST",
        "/api/funder/api-keys",
        { name },
      ),
    revokeApiKey: (id: string) =>
      request<ApiKey>("DELETE", `/api/funder/api-keys/${encodeURIComponent(id)}`),

    templates: () => request<{ templates: Template[] }>("GET", "/api/mission-templates"),
    missions: () =>
      request<{ token: { symbol: string; decimals: number }; missions: MissionListItem[] }>(
        "GET",
        "/api/missions",
      ),
    createMission: (spec: Record<string, unknown>) =>
      request<{ mission: Mission; funding: Funding }>("POST", "/api/missions", spec),
    missionStatus: (id: string) =>
      request<MissionStatusResult>("GET", `/api/missions/${encodeURIComponent(id)}/status`),
    confirmMission: (id: string, txHash: string) =>
      request<Mission>("POST", `/api/missions/${encodeURIComponent(id)}/confirm`, { txHash }),
    submissions: (id: string) =>
      request<SubmissionsResponse>("GET", `/api/missions/${encodeURIComponent(id)}/submissions`),
    accept: (submissionId: string) =>
      request<{
        submission: { resolveTxHash: string | null };
        payout: { amount: string; fee: string; txHash: string };
      }>("POST", `/api/submissions/${encodeURIComponent(submissionId)}/accept`, {}),
    reject: (submissionId: string, reason: string) =>
      request<{ submission: { resolveTxHash: string | null } }>(
        "POST",
        `/api/submissions/${encodeURIComponent(submissionId)}/reject`,
        { reason },
      ),
    refund: (id: string) =>
      request<{ mission: Mission; refunded: string | null; txHash: string | null }>(
        "POST",
        `/api/missions/${encodeURIComponent(id)}/refund`,
      ),
    exportUrl: (id: string, format: "json" | "csv", scope: "accepted" | "all" = "accepted") =>
      `/api/missions/${encodeURIComponent(id)}/export?format=${format}&scope=${scope}`,
  };
}

export type DashboardApi = ReturnType<typeof createDashboardApi>;
