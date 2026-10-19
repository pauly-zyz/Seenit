/** Recorded on-chain, waiting for the funder (or the review window) to resolve it. */
export const AWAITING_DECISION = ["processing", "ready", "needs_review"] as const;

/** Submissions that hold (or are about to hold) a slot. */
export const SLOT_HOLDING = [...AWAITING_DECISION, "accepted"] as const;

export const isAwaitingDecision = (status: string) =>
  (AWAITING_DECISION as readonly string[]).includes(status);
