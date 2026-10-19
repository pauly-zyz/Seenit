import { ApiError, createApi } from "./api";
import { verificationErrorMessage } from "./messages";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("createApi", () => {
  it("calls the personhood endpoints with the bearer token", async () => {
    const f = fakeFetch(200, { tier: 1 });
    const api = createApi({
      baseUrl: "https://api.seenit.test/",
      getToken: () => "tok",
      fetchFn: f.fn,
    });
    await api.getPersonhoodStatus();
    await api.startVerification("self");
    await api.getSession("abc/def");
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://api.seenit.test/api/personhood/status",
      "https://api.seenit.test/api/personhood/self/start",
      "https://api.seenit.test/api/personhood/sessions/abc%2Fdef",
    ]);
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(f.calls[1]!.init.method).toBe("POST");
  });

  it("turns API errors into ApiError with details", async () => {
    const f = fakeFetch(422, {
      error: {
        code: "precheck_failed",
        message: "Not eligible yet",
        details: { reason: "score_too_low" },
      },
    });
    const api = createApi({ baseUrl: "https://x", getToken: () => null, fetchFn: f.fn });
    const err = await api.startVerification("human_passport").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: "precheck_failed",
      details: { reason: "score_too_low" },
    });
  });

  it("reports network failures", async () => {
    const api = createApi({
      baseUrl: "https://x",
      getToken: () => null,
      fetchFn: (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
    });
    await expect(api.getPersonhoodStatus()).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("verificationErrorMessage", () => {
  const e = (reason: string, details: Record<string, unknown> = {}, status = 400) =>
    new ApiError(status, "x", "fallback", { reason, ...details });

  it("explains a low Passport score with the numbers", () => {
    expect(verificationErrorMessage(e("score_too_low", { score: 12.34, requiredScore: 20 }))).toBe(
      "Your Human Passport score is 12.3. You need 20 to unlock Tier 1. Add more stamps, then check again.",
    );
  });

  it("explains a duplicate identity", () => {
    expect(verificationErrorMessage(e("nullifier_in_use"))).toMatch(
      /already linked to another Seenit account/,
    );
  });

  it("falls back sensibly", () => {
    expect(verificationErrorMessage(new ApiError(401, "unauthorized", "x"))).toBe(
      "Please sign in again.",
    );
    expect(verificationErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
