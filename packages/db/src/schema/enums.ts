import { pgEnum } from "drizzle-orm/pg-core";

export const personhoodProvider = pgEnum("personhood_provider", ["human_passport", "self"]);
export const verificationSessionStatus = pgEnum("verification_session_status", [
  "pending",
  "verified",
  "failed",
  "expired",
]);
export const mediaType = pgEnum("media_type", ["photo", "video"]);

/**
 * pending_funding: saved, waiting for the funder's createMission tx
 * active: funded on-chain (MissionCreated seen)
 * cancelled / refunded: closed on-chain
 */
export const missionStatus = pgEnum("mission_status", [
  "pending_funding",
  "active",
  "cancelled",
  "refunded",
]);

/**
 * awaiting_upload: upload URL issued
 * rejected_precheck: failed hash / GPS / timestamp checks, never went on-chain
 * chain_failed: recordSubmission tx failed, can be retried
 * processing: recorded on-chain, queued for AI
 * ready: AI result available, waiting for funder decision
 * needs_review: AI result available but low confidence or quality flags; a human should look
 * accepted / rejected: resolved on-chain
 */
export const submissionStatus = pgEnum("submission_status", [
  "awaiting_upload",
  "rejected_precheck",
  "chain_failed",
  "processing",
  "ready",
  "needs_review",
  "accepted",
  "rejected",
]);

export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);
