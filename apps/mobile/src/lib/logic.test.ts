import { parseSiweMessage } from "viem/siwe";

import type { NearbyMission } from "./api";
import { evaluateCaptureGate, MAX_FIX_AGE_MS } from "./capture-gate";
import { formatDistance, formatReward, formatTimeLeft, shortAddress } from "./format";
import { applyFilters, exampleFromSchema, isLocked, sortForList } from "./missions";
import { buildSiweMessage } from "./siwe";

const mission = (over: Partial<NearbyMission> = {}): NearbyMission => ({
  id: "m",
  title: "t",
  instructions: "i",
  mediaType: "photo",
  maxVideoSeconds: null,
  location: { lat: 0, lng: 0 },
  radiusMeters: 100,
  reward: "2000000",
  maxCaptures: 3,
  minTier: 1,
  deadline: "2030-01-01T00:00:00Z",
  status: "active",
  outputSchema: {},
  onchainId: "1",
  distanceMeters: 500,
  withinMissionRadius: false,
  slotsLeft: 3,
  ...over,
});

describe("capture gate", () => {
  const now = Date.parse("2026-10-19T10:00:00Z");
  const m = {
    location: { lat: -6.175392, lng: 106.827153 },
    radiusMeters: 100,
    deadline: "2030-01-01T00:00:00Z",
  };
  const fix = (over = {}) => ({
    lat: -6.17545,
    lng: 106.82718,
    accuracyMeters: 8,
    timestamp: now - 1000,
    ...over,
  });

  it("allows recording inside the radius with a fresh, accurate, real fix", () => {
    const r = evaluateCaptureGate({ permission: "granted", fix: fix(), mission: m, now });
    expect(r.canRecord).toBe(true);
    expect(r.distanceMeters).toBeLessThan(10);
  });

  it.each([
    ["no_permission", { permission: "denied" as const }],
    ["locating", { fix: null }],
    ["locating", { fix: fix({ timestamp: now - MAX_FIX_AGE_MS - 1 }) }],
    ["mocked", { fix: fix({ mocked: true }) }],
    ["inaccurate", { fix: fix({ accuracyMeters: 80 }) }],
    ["inaccurate", { fix: fix({ accuracyMeters: null }) }],
    ["outside_radius", { fix: fix({ lat: -6.18 }) }],
    ["mission_closed", { mission: { ...m, deadline: "2000-01-01T00:00:00Z" } }],
    ["mission_closed", { mission: { ...m, open: false } }],
  ])("blocks with %s", (reason, over) => {
    const r = evaluateCaptureGate({ permission: "granted", fix: fix(), mission: m, now, ...over });
    expect(r).toMatchObject({ canRecord: false, reason });
  });

  it("tells the user how far outside they are", () => {
    const r = evaluateCaptureGate({
      permission: "granted",
      fix: fix({ lat: -6.1764 }),
      mission: m,
      now,
    });
    expect(r.message).toMatch(/^You're \d+ m outside the mission area\.$/);
  });

  it("checks mocked before distance so spoofers can't probe the area", () => {
    const r = evaluateCaptureGate({
      permission: "granted",
      fix: fix({ mocked: true, lat: 10 }),
      mission: m,
      now,
    });
    expect(r.reason).toBe("mocked");
  });
});

describe("missions", () => {
  it("filters by distance and minimum reward", () => {
    const list = [
      mission({ id: "a", distanceMeters: 400, reward: "1000000" }),
      mission({ id: "b", distanceMeters: 4000, reward: "3000000" }),
      mission({ id: "c", distanceMeters: 9000, reward: "5000000" }),
    ];
    expect(applyFilters(list, { maxDistanceKm: 5, minReward: 0n }).map((m) => m.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      applyFilters(list, { maxDistanceKm: 10, minReward: 2_000_000n }).map((m) => m.id),
    ).toEqual(["b", "c"]);
  });

  it("locks missions above the user's tier and lists unlocked first", () => {
    expect(isLocked({ minTier: 2 }, 1)).toBe(true);
    expect(isLocked({ minTier: 1 }, 1)).toBe(false);
    const sorted = sortForList(
      [
        mission({ id: "locked-near", minTier: 2, distanceMeters: 10 }),
        mission({ id: "far", distanceMeters: 900 }),
        mission({ id: "near", distanceMeters: 100 }),
      ],
      1,
    );
    expect(sorted.map((m) => m.id)).toEqual(["near", "far", "locked-near"]);
  });

  it("builds an example answer from the output schema", () => {
    expect(
      exampleFromSchema({
        type: "object",
        properties: {
          is_open: { type: "boolean" },
          price: { type: "number" },
          facings: { type: "integer" },
          sign_text: { type: "string", description: "text on the sign" },
          level: { type: "string", enum: ["low", "high"] },
          tags: { type: "array", items: { type: "string" } },
          note: { type: "string", example: "closed for lunch" },
        },
      }),
    ).toEqual({
      is_open: true,
      price: 4.29,
      facings: 3,
      sign_text: "<text on the sign>",
      level: "low",
      tags: ["…"],
      note: "closed for lunch",
    });
    expect(exampleFromSchema(null)).toBeNull();
  });
});

describe("format", () => {
  it("formats rewards, distances, deadlines and addresses", () => {
    expect(formatReward("2000000", 6, "USDG")).toBe("2.00 USDG");
    expect(formatReward("1234567", 6, "USDG")).toBe("1.234567 USDG");
    expect(formatDistance(120.4)).toBe("120 m");
    expect(formatDistance(2450)).toBe("2.5 km");
    expect(formatDistance(23_000)).toBe("23 km");
    const now = new Date("2026-10-19T10:00:00Z");
    expect(formatTimeLeft("2026-10-19T10:30:00Z", now)).toBe("30 min left");
    expect(formatTimeLeft("2026-10-19T12:15:00Z", now)).toBe("2 h 15 min left");
    expect(formatTimeLeft("2026-10-25T10:00:00Z", now)).toBe("6 days left");
    expect(formatTimeLeft("2026-10-19T09:00:00Z", now)).toBe("Ended");
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("SIWE message", () => {
  it("produces an EIP-4361 message the server can parse", () => {
    const msg = buildSiweMessage({
      address: "0x1234567890AbcdEF1234567890aBcdef12345678",
      nonce: "abcdef123456",
      domain: "api.seenit.xyz",
      chainId: 46630,
      uri: "https://api.seenit.xyz",
      issuedAt: new Date("2026-10-19T10:00:00Z"),
    });
    const parsed = parseSiweMessage(msg);
    expect(parsed).toMatchObject({
      domain: "api.seenit.xyz",
      chainId: 46630,
      nonce: "abcdef123456",
      version: "1",
    });
    expect(msg).toContain("does not send a transaction");
  });
});
