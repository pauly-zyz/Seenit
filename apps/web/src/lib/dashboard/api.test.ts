// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createDashboardApi, DashboardApiError } from "./api";

function fake(status = 200, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("dashboard API client", () => {
  it("sends the CSRF header on writes only, with same-origin cookies", async () => {
    const f = fake();
    const api = createDashboardApi(f.fn);
    await api.missions();
    await api.createApiKey("bot");
    await api.revokeApiKey("k/1");
    const h = f.calls.map((c) => new Headers(c.init.headers).get("x-seenit-csrf"));
    expect(h).toEqual([null, "1", "1"]);
    expect(f.calls.every((c) => c.init.credentials === "same-origin")).toBe(true);
    expect(f.calls[2]!.url).toBe("/api/funder/api-keys/k%2F1");
    expect(f.calls[2]!.init.method).toBe("DELETE");
  });

  it("maps API errors", async () => {
    const api = createDashboardApi(
      fake(409, { error: { code: "conflict", message: "Review window is over" } }).fn,
    );
    const err = await api.accept("s1").catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err).toMatchObject({ status: 409, code: "conflict", message: "Review window is over" });
  });

  it("builds export URLs", () => {
    expect(createDashboardApi(fake().fn).exportUrl("m1", "csv")).toBe(
      "/api/missions/m1/export?format=csv&scope=accepted",
    );
  });
});
