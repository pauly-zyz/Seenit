/** Shapes returned by the contributor endpoints (see the route handlers under src/app/api). */

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

export type SubmissionStatus =
  | "awaiting_upload"
  | "rejected_precheck"
  | "chain_failed"
  | "processing"
  | "ready"
  | "needs_review"
  | "accepted"
  | "rejected";

export interface MissionDetail {
  mission: Mission & { slotsLeft: number; open: boolean };
  access: { yourTier: number; requiredTier: number; locked: boolean };
  mySubmission: { id: string; status: SubmissionStatus; rejectionReasons: string[] | null } | null;
}

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

export interface Meta {
  chainId: number;
  token: { symbol: string; decimals: number };
  [key: string]: unknown;
}
