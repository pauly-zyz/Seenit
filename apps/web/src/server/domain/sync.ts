import {
  and,
  eq,
  inArray,
  missions,
  payouts,
  sql,
  submissions,
  users,
  type Database,
} from "@seenit/db";
import type { Hex } from "viem";

import type { EscrowEvent, MissionCreatedEvent } from "../chain/types";
import type { Logger } from "../logger";
import { enqueueJob, JOB_AI_PROCESS } from "../jobs";

/**
 * Applies chain events to the database. Used by both the API (right after a tx) and the indexer
 * (catch-up / events from other senders, e.g. permissionless finalize). Every function is
 * idempotent: applying the same event twice changes nothing.
 */

export async function applyMissionCreated(db: Database, ev: MissionCreatedEvent & { txHash: Hex }) {
  const [row] = await db
    .update(missions)
    .set({
      status: "active",
      onchainId: ev.missionId,
      chainTxHash: ev.txHash,
      funderWallet: ev.funder.toLowerCase(),
      feeBps: ev.feeBps,
      minTier: ev.minTier, // the contract's tier rule is authoritative
      maxCaptures: ev.maxCaptures,
    })
    .where(
      and(eq(missions.specHash, ev.specHash.toLowerCase()), eq(missions.status, "pending_funding")),
    )
    .returning();
  return row ?? null;
}

async function applyMissionClosed(
  db: Database,
  missionId: bigint,
  status: "cancelled" | "refunded",
) {
  await db
    .update(missions)
    .set({ status })
    .where(and(eq(missions.onchainId, missionId), eq(missions.status, "active")));
}

async function applySubmissionRecorded(
  db: Database,
  ev: Extract<EscrowEvent, { name: "SubmissionRecorded" }>,
) {
  const mediaHash = ev.args.mediaHash.slice(2).toLowerCase();
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(submissions)
      .set({
        status: "processing",
        onchainId: ev.args.submissionId,
        recordTxHash: ev.txHash,
        reviewDeadline: new Date(Number(ev.args.reviewDeadline) * 1000),
      })
      .where(
        and(
          eq(submissions.mediaHash, mediaHash),
          inArray(submissions.status, ["awaiting_upload", "chain_failed"]),
        ),
      )
      .returning({ id: submissions.id });
    // Only enqueue AI work when this event moved it forward (API missed the receipt).
    for (const s of updated) await enqueueJob(tx, JOB_AI_PROCESS, { submissionId: s.id });
  });
}

export async function applySubmissionAccepted(
  db: Database,
  ev: { submissionId: bigint; payout: bigint; fee: bigint; finalized: boolean; txHash: Hex },
) {
  await db.transaction(async (tx) => {
    const [sub] = await tx
      .update(submissions)
      .set({ status: "accepted", resolveTxHash: ev.txHash })
      .where(
        and(
          eq(submissions.onchainId, ev.submissionId),
          inArray(submissions.status, ["processing", "ready"]),
        ),
      )
      .returning();
    if (!sub) return;
    await tx
      .insert(payouts)
      .values({
        submissionId: sub.id,
        contributorId: sub.contributorId,
        amount: ev.payout.toString(),
        fee: ev.fee.toString(),
        txHash: ev.txHash,
        finalized: ev.finalized,
      })
      .onConflictDoNothing();
    await tx
      .update(users)
      .set({ reputation: sql`${users.reputation} + 1` })
      .where(eq(users.id, sub.contributorId));
  });
}

export async function applySubmissionRejected(
  db: Database,
  ev: { submissionId: bigint; reason: string; txHash: Hex },
) {
  await db
    .update(submissions)
    .set({ status: "rejected", resolveTxHash: ev.txHash, rejectionReasons: [ev.reason] })
    .where(
      and(
        eq(submissions.onchainId, ev.submissionId),
        inArray(submissions.status, ["processing", "ready"]),
      ),
    );
}

export async function applyEscrowEvent(db: Database, ev: EscrowEvent, log: Logger) {
  switch (ev.name) {
    case "MissionCreated": {
      const m = await applyMissionCreated(db, { ...ev.args, txHash: ev.txHash });
      if (!m)
        log.debug(
          { missionId: ev.args.missionId },
          "MissionCreated for unknown or already active spec",
        );
      return;
    }
    case "MissionCancelled":
      return applyMissionClosed(db, ev.args.missionId, "cancelled");
    case "MissionRefunded":
      return applyMissionClosed(db, ev.args.missionId, "refunded");
    case "SubmissionRecorded":
      return applySubmissionRecorded(db, ev);
    case "SubmissionAccepted":
      return applySubmissionAccepted(db, { ...ev.args, txHash: ev.txHash });
    case "SubmissionRejected":
      return applySubmissionRejected(db, {
        submissionId: ev.args.submissionId,
        reason: decodeReason(ev.args.reason),
        txHash: ev.txHash,
      });
  }
}

/** bytes32 reason -> readable string (trailing zero bytes dropped). */
export function decodeReason(reason: Hex): string {
  const bytes = Buffer.from(reason.slice(2), "hex");
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}
