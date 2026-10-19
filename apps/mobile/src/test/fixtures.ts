import type { History, MissionDetail, NearbyMission } from "../lib/api";
import type { LiveFix } from "../lib/capture-gate";

export const NOW = Date.parse("2026-10-19T10:00:00Z");
export const HERE = { lat: -6.2, lng: 106.8 };

export const fixAt = (lat: number, lng: number, extra: Partial<LiveFix> = {}): LiveFix => ({
  lat,
  lng,
  accuracyMeters: 8,
  timestamp: NOW - 1000,
  mocked: false,
  ...extra,
});

export function nearby(over: Partial<NearbyMission> & { id: string }): NearbyMission {
  return {
    title: `Mission ${over.id}`,
    instructions: "Photograph the storefront.",
    mediaType: "photo",
    maxVideoSeconds: null,
    location: HERE,
    radiusMeters: 100,
    reward: "2000000",
    maxCaptures: 5,
    minTier: 1,
    deadline: "2026-10-20T10:00:00Z",
    status: "open",
    outputSchema: { type: "object", properties: { is_open: { type: "boolean" } } },
    onchainId: "1",
    distanceMeters: 0,
    withinMissionRadius: true,
    slotsLeft: 3,
    ...over,
  };
}

export function detail(
  over: Partial<MissionDetail["mission"]> = {},
  access?: Partial<MissionDetail["access"]>,
): MissionDetail {
  const { distanceMeters: _d, withinMissionRadius: _w, ...base } = nearby({ id: "m1" });
  return {
    mission: { ...base, slotsLeft: 3, open: true, ...over },
    access: { yourTier: 1, requiredTier: 1, locked: false, ...access },
    mySubmission: null,
  };
}

export function history(over: Partial<History> = {}): History {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    summary: {
      earned: "3800000",
      pending: "2000000",
      accepted: 2,
      inReview: 1,
      rejected: 1,
      token: { symbol: "USDG", decimals: 6 },
    },
    items: [
      {
        id: "s1",
        status: "accepted",
        rejectionReasons: null,
        capturedAt: "2026-10-18T09:00:00Z",
        createdAt: "2026-10-18T09:01:00Z",
        reviewDeadline: null,
        mediaType: "photo",
        recordTxHash: `0x${"a".repeat(64)}`,
        resolveTxHash: `0x${"b".repeat(64)}`,
        mission: { id: "m1", title: "Is the bakery open?", reward: "2000000" },
        payout: {
          amount: "1900000",
          fee: "100000",
          txHash: `0x${"b".repeat(64)}`,
          finalized: false,
        },
      },
      {
        id: "s2",
        status: "rejected",
        rejectionReasons: ["outside_radius"],
        capturedAt: "2026-10-18T08:00:00Z",
        createdAt: "2026-10-18T08:01:00Z",
        reviewDeadline: null,
        mediaType: "video",
        recordTxHash: null,
        resolveTxHash: null,
        mission: { id: "m2", title: "Queue length at the station", reward: "1000000" },
        payout: null,
      },
    ],
    ...over,
  };
}
