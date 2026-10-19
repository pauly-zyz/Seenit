import {
  and,
  desc,
  eq,
  inArray,
  missions,
  payouts,
  sql,
  submissions,
  type InferSelectModel,
  type users,
} from "@seenit/db";

import { AppError, notFound } from "../errors";
import type { Services } from "../services";
import { publicMission, SLOT_HOLDING } from "./missions";
import { effectiveTier } from "./personhood";

type User = InferSelectModel<typeof users>;

/** Contributor view of one mission: details, free slots, tier lock and the caller's submission. */
export async function getMissionForContributor(
  s: Services,
  user: User,
  missionId: string,
  now: Date,
) {
  const m = await s.db.query.missions.findFirst({ where: eq(missions.id, missionId) });
  if (!m) throw notFound("Mission");
  const mine = await s.db.query.submissions.findFirst({
    where: and(eq(submissions.missionId, m.id), eq(submissions.contributorId, user.id)),
  });
  // Contributors only see funded missions (or ones they already took part in).
  if (m.status === "pending_funding" && !mine) throw notFound("Mission");

  const [{ taken } = { taken: 0 }] = await s.db
    .select({ taken: sql<number>`count(*)::int` })
    .from(submissions)
    .where(and(eq(submissions.missionId, m.id), inArray(submissions.status, [...SLOT_HOLDING])));
  const tier = await effectiveTier(s.db, user.id, now);

  return {
    mission: publicMission(m, {
      slotsLeft: Math.max(m.maxCaptures - taken, 0),
      open: m.status === "active" && m.deadline > now && taken < m.maxCaptures,
    }),
    access: { yourTier: tier, requiredTier: m.minTier, locked: tier < m.minTier },
    mySubmission: mine
      ? {
          id: mine.id,
          status: mine.status,
          rejectionReasons: mine.rejectionReasons,
          createdAt: mine.createdAt,
        }
      : null,
  };
}

/** Feeds the history screen: every submission with its mission, payout and on-chain links. */
export async function listMySubmissions(s: Services, user: User) {
  const rows = await s.db
    .select({ submission: submissions, mission: missions, payout: payouts })
    .from(submissions)
    .innerJoin(missions, eq(missions.id, submissions.missionId))
    .leftJoin(payouts, eq(payouts.submissionId, submissions.id))
    .where(eq(submissions.contributorId, user.id))
    .orderBy(desc(submissions.createdAt))
    .limit(200);

  let earned = 0n;
  let pending = 0n;
  const items = rows
    .filter((r) => r.submission.status !== "awaiting_upload")
    .map(({ submission: sub, mission: m, payout: p }) => {
      if (p) earned += BigInt(p.amount);
      if (sub.status === "processing" || sub.status === "ready") {
        const reward = BigInt(m.reward);
        pending += reward - (reward * BigInt(m.feeBps ?? 0)) / 10_000n;
      }
      return {
        id: sub.id,
        status: sub.status,
        rejectionReasons: sub.rejectionReasons,
        capturedAt: sub.capturedAt,
        createdAt: sub.createdAt,
        reviewDeadline: sub.reviewDeadline,
        mediaType: sub.mediaType,
        recordTxHash: sub.recordTxHash,
        resolveTxHash: sub.resolveTxHash,
        mission: { id: m.id, title: m.title, reward: m.reward },
        payout: p
          ? { amount: p.amount, fee: p.fee, txHash: p.txHash, finalized: p.finalized }
          : null,
      };
    });

  return {
    wallet: user.wallet,
    summary: {
      earned: earned.toString(),
      pending: pending.toString(),
      accepted: items.filter((i) => i.status === "accepted").length,
      inReview: items.filter((i) => i.status === "processing" || i.status === "ready").length,
      rejected: items.filter((i) => i.status === "rejected" || i.status === "rejected_precheck")
        .length,
      token: { symbol: s.config.tokenSymbol, decimals: s.config.tokenDecimals },
    },
    items,
  };
}

export const assertUuid = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError("not_found", "Not found");
  }
};
