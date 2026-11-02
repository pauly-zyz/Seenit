/** Shapes returned by the Seenit REST API. Amounts are token base units as decimal strings. */

export type MediaType = "photo" | "video";
export type MissionStatus = "pending_funding" | "active" | "cancelled" | "refunded";
export type SubmissionStatus = "processing" | "ready" | "needs_review" | "accepted" | "rejected";
export type Hex = `0x${string}`;

/** A JSON Schema object describing the answer the AI extracts from each capture. */
export type OutputSchema = Record<string, unknown>;

export interface Meta {
  chainId: number;
  escrow: Hex;
  token: { address: Hex; symbol: string; decimals: number };
  /** Rewards above this (base units) are only open to Tier 2 (passport-verified) contributors. */
  tier1MaxReward: string;
  limits: {
    minDeadlineMinutes: number;
    maxDeadlineDays: number;
    maxRadiusMeters: number;
    maxCaptures: number;
  };
}

export interface Template {
  id: string;
  name: string;
  description: string;
  mediaType: MediaType;
  suggestedInstructions: string;
  outputSchema: OutputSchema;
}

export interface Mission {
  id: string;
  title: string;
  instructions: string;
  mediaType: MediaType;
  maxVideoSeconds: number | null;
  location: { lat: number; lng: number };
  radiusMeters: number;
  /** Reward per accepted capture, base units. */
  reward: string;
  maxCaptures: number;
  /** Personhood tier contributors need (1 = Human Passport, 2 = Self passport NFC). */
  minTier: number;
  deadline: string;
  status: MissionStatus;
  outputSchema: OutputSchema;
  specHash: Hex;
  onchainId: string | null;
  chainTxHash: Hex | null;
  createdAt: string;
}

export interface TxRequest {
  to: Hex;
  data: Hex;
  value: "0";
  description: string;
}

export interface Funding {
  chainId: number;
  escrow: Hex;
  token: Hex;
  /** Total pulled into escrow: reward × maxCaptures (base units). */
  total: string;
  /** approve(escrow, total) then createMission(...). Sign and send in order. */
  transactions: TxRequest[];
  next: string;
}

export interface CreateMissionResult {
  mission: Mission;
  funding: Funding;
}

export interface MissionStatusResult {
  mission: Mission;
  escrow: { total: string; paidToContributors: string; platformFees: string };
  slots: { total: number; used: number; left: number };
  submissions: {
    processing: number;
    ready: number;
    needsReview: number;
    accepted: number;
    rejected: number;
  };
  /** Present while the mission is unfunded. */
  funding: Funding | null;
}

export interface CancelResult {
  mission: Mission;
  /** False when a funded mission still needs its cancelMission transaction signed. */
  cancelled: boolean;
  transactions: TxRequest[];
  refunded?: string;
  chainId?: number;
  next?: string;
}

export interface MediaLinks {
  type: MediaType;
  /** Videos are shared as face/plate-blurred key frames. */
  format: "jpeg_frames";
  frames: { url: string; expiresAt: string }[];
  url: string;
  expiresAt: string;
}

export interface Result {
  submissionId: string;
  capturedAt: string | null;
  /** Structured answer matching the mission's output schema. */
  answer: Record<string, unknown> | null;
  confidence: number | null;
  reasoning: string | null;
  media: MediaLinks | null;
  proof: {
    mediaSha256: string | null;
    onchainSubmissionId: string | null;
    recordTxHash: Hex | null;
    acceptTxHash: Hex | null;
  };
}

export interface ResultsResponse {
  mission: { id: string; title: string; status: MissionStatus; maxCaptures: number };
  results: Result[];
}

export interface AiReview {
  answer: Record<string, unknown> | null;
  confidence: number | null;
  reasoning: string | null;
  needsReview: boolean;
  reviewReasons: string[];
  quality: Record<string, unknown>;
  privacy: { faces: number; licensePlates: number; checked: boolean };
  processedAt: string;
}

export interface ReviewItem {
  submissionId: string;
  status: SubmissionStatus;
  capturedAt: string | null;
  reviewDeadline: string | null;
  location: { lat: number; lng: number; accuracyMeters: number | null } | null;
  ai: AiReview | null;
  media: MediaLinks | null;
  proof: {
    mediaSha256: string | null;
    onchainSubmissionId: string | null;
    recordTxHash: Hex | null;
  };
}

export interface SubmissionsResponse {
  mission: { id: string; title: string; status: MissionStatus };
  submissions: ReviewItem[];
}

export interface WebhookSettings {
  url: string | null;
  events: string[];
}

export interface WebhookCreated extends WebhookSettings {
  url: string;
  /** Signing secret. Shown once: store it to verify deliveries. */
  secret: string;
}

/** Body of a `submission.processed` webhook delivery. */
export interface WebhookEvent {
  id: string;
  event: "submission.processed";
  createdAt: string;
  data: {
    submissionId: string;
    missionId: string;
    status: SubmissionStatus;
    needsReview: boolean;
    reviewReasons: string[];
    answer: Record<string, unknown> | null;
    confidence: number | null;
    reviewDeadline: string | null;
    processedAt: string;
  };
}
