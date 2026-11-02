import { describe, expect, it } from "vitest";

import { formatAmount, formatUnits, parseUnits, Seenit, SeenitError } from "../src/index.js";

type Call = { url: string; init: RequestInit };

/** Scripted fetch: each entry is a response (or an Error to throw). */
function fakeFetch(
  replies: Array<{ status?: number; body?: unknown; headers?: Record<string, string> } | Error>,
) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.headers,
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const TEMPLATES = {
  templates: [
    {
      id: "store_open",
      name: "Is the store open?",
      description: "",
      mediaType: "photo",
      suggestedInstructions: "",
      outputSchema: { type: "object", properties: { is_open: { type: "string" } } },
    },
  ],
};

describe("Seenit client", () => {
  it("sends the API key and JSON, and resolves templates client-side", async () => {
    const f = fakeFetch([
      { body: TEMPLATES },
      { status: 201, body: { mission: { id: "m1" }, funding: {} } },
    ]);
    const seenit = new Seenit({
      apiKey: "sk_test",
      baseUrl: "https://api.seenit.test/",
      fetch: f.fn,
    });
    await seenit.missions.create({
      title: "Open?",
      instructions: "Photograph the entrance.",
      mediaType: "photo",
      location: { lat: -6.2, lng: 106.8 },
      radiusMeters: 100,
      rewardPerSubmission: parseUnits("2.5", 6),
      maxSubmissions: 3,
      deadline: new Date("2026-11-03T10:00:00Z"),
      template: "store_open",
    });
    expect(f.calls[0]!.url).toBe("https://api.seenit.test/api/mission-templates");
    expect(new Headers(f.calls[0]!.init.headers).get("x-api-key")).toBeNull(); // public endpoint
    const create = f.calls[1]!;
    expect(create.url).toBe("https://api.seenit.test/api/missions");
    expect(create.init.method).toBe("POST");
    expect(new Headers(create.init.headers).get("x-api-key")).toBe("sk_test");
    expect(JSON.parse(create.init.body as string)).toEqual({
      title: "Open?",
      instructions: "Photograph the entrance.",
      mediaType: "photo",
      location: { lat: -6.2, lng: 106.8 },
      radiusMeters: 100,
      rewardPerSubmission: "2500000",
      maxSubmissions: 3,
      deadline: "2026-11-03T10:00:00.000Z",
      outputSchema: TEMPLATES.templates[0]!.outputSchema,
    });
  });

  it("maps API errors to SeenitError and doesn't retry writes", async () => {
    const f = fakeFetch([
      {
        status: 400,
        body: {
          error: {
            code: "validation_failed",
            message: "deadline too soon",
            details: { path: "deadline" },
            requestId: "r1",
          },
        },
      },
    ]);
    const seenit = new Seenit({ apiKey: "k", baseUrl: "https://x.test", fetch: f.fn });
    const err = await seenit.missions.confirm("m1", "0x01").catch((e) => e);
    expect(err).toBeInstanceOf(SeenitError);
    expect(err).toMatchObject({
      status: 400,
      code: "validation_failed",
      requestId: "r1",
      retryable: false,
    });
    expect(f.calls).toHaveLength(1);
  });

  it("retries reads on 5xx, 429 and network errors", async () => {
    const f = fakeFetch([
      new Error("ECONNRESET"),
      {
        status: 429,
        headers: { "retry-after": "0" },
        body: { error: { code: "rate_limited", message: "slow down" } },
      },
      { status: 200, body: { mission: { id: "m1" } } },
    ]);
    const seenit = new Seenit({ apiKey: "k", baseUrl: "https://x.test", fetch: f.fn });
    expect(await seenit.missions.status("m1")).toEqual({ mission: { id: "m1" } });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]!.url).toBe("https://x.test/api/missions/m1/status");
  });

  it("builds the right paths for every call", async () => {
    const f = fakeFetch(Array.from({ length: 9 }, () => ({ body: {} })));
    const s = new Seenit({ apiKey: "k", baseUrl: "https://x.test", fetch: f.fn });
    await s.missions.results("a b");
    await s.missions.submissions("m", { status: "needs_review" });
    await s.missions.cancel("m", { txHash: "0xab" });
    await s.submissions.accept("s1");
    await s.submissions.reject("s1", "blurry");
    await s.webhooks.set("https://hooks.test/x");
    await s.webhooks.get();
    await s.webhooks.delete();
    await s.meta();
    await s.meta(); // cached
    expect(f.calls.map((c) => `${c.init.method} ${c.url.replace("https://x.test", "")}`)).toEqual([
      "GET /api/missions/a%20b/results",
      "GET /api/missions/m/submissions?status=needs_review",
      "POST /api/missions/m/cancel",
      "POST /api/submissions/s1/accept",
      "POST /api/submissions/s1/reject",
      "PUT /api/webhook",
      "GET /api/webhook",
      "DELETE /api/webhook",
      "GET /api/meta",
    ]);
    expect(JSON.parse(f.calls[4]!.init.body as string)).toEqual({ reason: "blurry" });
  });

  it("needs a base URL and an API key for private calls", async () => {
    expect(() => new Seenit({ apiKey: "k", baseUrl: "" })).toThrow(/baseUrl/);
    const s = new Seenit({ baseUrl: "https://x.test", fetch: fakeFetch([]).fn, apiKey: undefined });
    if (!process.env.SEENIT_API_KEY)
      await expect(s.missions.status("m")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a missing template or schema", async () => {
    const f = fakeFetch([{ body: TEMPLATES }]);
    const s = new Seenit({ apiKey: "k", baseUrl: "https://x.test", fetch: f.fn });
    const base = {
      title: "t",
      instructions: "i",
      mediaType: "photo" as const,
      location: { lat: 0, lng: 0 },
      radiusMeters: 50,
      rewardPerSubmission: 1n,
      maxSubmissions: 1,
      deadline: "2030-01-01T00:00:00Z",
    };
    await expect(s.missions.create({ ...base, template: "nope" })).rejects.toThrow(
      /Unknown template/,
    );
    await expect(s.missions.create(base)).rejects.toThrow(/outputSchema or a template/);
  });
});

describe("units", () => {
  it.each([
    ["2.5", 6, 2_500_000n],
    ["0.000001", 6, 1n],
    ["10", 6, 10_000_000n],
    [3, 6, 3_000_000n],
  ])("parseUnits(%s, %d)", (v, d, out) => expect(parseUnits(v, d)).toBe(out));

  it("rejects bad amounts", () => {
    expect(() => parseUnits("1.0000001", 6)).toThrow(/decimals/);
    expect(() => parseUnits("-1", 6)).toThrow();
    expect(() => parseUnits("abc", 6)).toThrow();
  });

  it("formats", () => {
    expect(formatUnits(2_500_000n, 6)).toBe("2.5");
    expect(formatUnits("1000000", 6)).toBe("1");
    expect(formatAmount(2_500_000n, 6, "USDG")).toBe("2.50 USDG");
  });
});
