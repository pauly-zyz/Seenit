import type { Hex, Mission } from "seenit-sdk";

/** In-memory stand-in for the Seenit REST API (enough for the MCP tools). */
export function fakeSeenitApi() {
  const calls: { method: string; path: string; body: unknown; apiKey: string | null }[] = [];
  const missions = new Map<string, Mission>();
  let n = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const error = (status: number, code: string, message: string) =>
    json({ error: { code, message, requestId: "req_1" } }, status);

  const funding = (m: Mission) => ({
    chainId: 46630,
    escrow: "0x00000000000000000000000000000000000e5c20",
    token: "0x0000000000000000000000000000000000007070",
    total: (BigInt(m.reward) * BigInt(m.maxCaptures)).toString(),
    transactions: [
      {
        to: "0x0000000000000000000000000000000000007070",
        data: "0x095ea7b3",
        value: "0",
        description: "Approve the escrow to pull the mission total",
      },
      {
        to: "0x00000000000000000000000000000000000e5c20",
        data: "0xabcdef01",
        value: "0",
        description: "Create and fund the mission",
      },
    ],
    next: "confirm",
  });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const apiKey = new Headers(init?.headers).get("x-api-key");
    calls.push({ method, path: url.pathname + url.search, body, apiKey });
    const p = url.pathname;

    if (p === "/api/meta") {
      return json({
        chainId: 46630,
        escrow: "0x00000000000000000000000000000000000e5c20",
        token: {
          address: "0x0000000000000000000000000000000000007070",
          symbol: "USDG",
          decimals: 6,
        },
        tier1MaxReward: "5000000",
        limits: {},
      });
    }
    if (p === "/api/mission-templates") {
      return json({
        templates: [
          {
            id: "store_open",
            name: "Is the store open?",
            description: "Whether a business is open right now.",
            mediaType: "photo",
            suggestedInstructions: "Photograph the entrance.",
            outputSchema: {
              type: "object",
              properties: { is_open: { type: "string" } },
              required: ["is_open"],
            },
          },
        ],
      });
    }
    if (apiKey !== "sk_test") return error(401, "unauthorized", "Missing or invalid API key");
    if (p === "/api/missions" && method === "POST") {
      if (body.title === "boom")
        return error(400, "validation_failed", "deadline must be at least 10 minutes from now");
      const id = `00000000-0000-4000-8000-00000000000${++n}`;
      const m: Mission = {
        id,
        title: body.title,
        instructions: body.instructions,
        mediaType: body.mediaType,
        maxVideoSeconds: body.maxVideoSeconds ?? null,
        location: body.location,
        radiusMeters: body.radiusMeters,
        reward: body.rewardPerSubmission,
        maxCaptures: body.maxSubmissions,
        minTier: BigInt(body.rewardPerSubmission) > 5_000_000n ? 2 : (body.minTier ?? 1),
        deadline: body.deadline,
        status: "pending_funding",
        outputSchema: body.outputSchema,
        specHash: `0x${"ab".repeat(32)}`,
        onchainId: null,
        chainTxHash: null,
        createdAt: "2026-11-02T10:00:00.000Z",
      };
      missions.set(id, m);
      return json({ mission: m, funding: funding(m) }, 201);
    }
    const match = /^\/api\/missions\/([^/]+)(?:\/(\w+))?$/.exec(p);
    const m = match ? missions.get(match[1]!) : undefined;
    if (!match || !m) return error(404, "not_found", "Mission not found");
    switch (match[2]) {
      case "status":
        return json({
          mission: m,
          escrow: {
            total: funding(m).total,
            paidToContributors: "1900000",
            platformFees: "100000",
          },
          slots: { total: m.maxCaptures, used: 1, left: m.maxCaptures - 1 },
          submissions: { processing: 0, ready: 1, needsReview: 1, accepted: 1, rejected: 0 },
          funding: m.status === "pending_funding" ? funding(m) : null,
        });
      case "confirm":
        if (body.txHash === `0x${"00".repeat(32)}`)
          return error(409, "conflict", "Transaction not found");
        m.status = "active";
        m.onchainId = "7";
        m.chainTxHash = body.txHash;
        return json(m);
      case "cancel":
        if (m.status === "pending_funding" || body.txHash) {
          m.status = "cancelled";
          return json({
            mission: m,
            cancelled: true,
            transactions: [],
            ...(body.txHash ? { refunded: "4000000" } : {}),
          });
        }
        return json({
          mission: m,
          cancelled: false,
          chainId: 46630,
          transactions: [
            {
              to: "0x00000000000000000000000000000000000e5c20",
              data: "0xc4d66de8",
              value: "0",
              description: "Cancel the mission and refund unused slots",
            },
          ],
        });
      case "results":
        return json({
          mission: { id: m.id, title: m.title, status: m.status, maxCaptures: m.maxCaptures },
          results: [
            {
              submissionId: "s1",
              capturedAt: "2026-11-02T11:00:00.000Z",
              answer: { is_open: "open" },
              confidence: 0.94,
              reasoning: "OPEN sign on the door.",
              media: {
                type: "photo",
                format: "jpeg_frames",
                frames: [{ url: "https://r2.test/blurred/s1/frame-0.jpg?sig", expiresAt: "x" }],
                url: "u",
                expiresAt: "x",
              },
              proof: {
                mediaSha256: "ab",
                onchainSubmissionId: "1",
                recordTxHash: "0x1",
                acceptTxHash: "0x2",
              },
            },
          ],
        });
      case "submissions":
        return json({
          mission: { id: m.id, title: m.title, status: m.status },
          submissions: [
            { submissionId: "s1", status: "accepted", ai: null, media: null },
            {
              submissionId: "s2",
              status: "needs_review",
              reviewDeadline: "2026-11-05T10:00:00.000Z",
              ai: { answer: null, confidence: 0.3, reviewReasons: ["too_dark"] },
              media: null,
            },
          ],
        });
      default:
        return error(404, "not_found", "Not found");
    }
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    missions,
    setStatus: (id: string, s: Mission["status"]) => (missions.get(id)!.status = s),
  };
}

/** Records what it was asked to sign. */
export function fakeFunder(api: ReturnType<typeof fakeSeenitApi>) {
  const funded: string[] = [];
  const cancelled: string[] = [];
  return {
    address: "0x00000000000000000000000000000000000000f1" as Hex,
    funded,
    cancelled,
    fund: async (missionId: string) => {
      funded.push(missionId);
      api.setStatus(missionId, "active");
      return { mission: api.missions.get(missionId)!, txHash: `0x${"cd".repeat(32)}` as Hex };
    },
    cancel: async (missionId: string) => {
      cancelled.push(missionId);
      api.setStatus(missionId, "cancelled");
      return {
        mission: api.missions.get(missionId)!,
        txHash: `0x${"ce".repeat(32)}` as Hex,
        refunded: "4000000",
      };
    },
  };
}
