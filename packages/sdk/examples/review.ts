/**
 * Review the queue: accept confident answers, reject clear failures, leave the rest for a human.
 *
 *   SEENIT_API_URL=... SEENIT_API_KEY=sk_... npx tsx examples/review.ts <mission-id>
 */
import { Seenit, SeenitError } from "seenit-sdk";

const missionId = process.argv[2]!;
const seenit = new Seenit();

const { submissions } = await seenit.missions.submissions(missionId, { status: "ready" });
for (const s of submissions) {
  if (!s.ai) continue;
  try {
    if ((s.ai.confidence ?? 0) >= 0.85) {
      const { payout } = await seenit.submissions.accept(s.submissionId);
      console.log(`accepted ${s.submissionId}`, s.ai.answer, payout);
    } else {
      console.log(`left for review ${s.submissionId} (confidence ${s.ai.confidence})`);
    }
  } catch (err) {
    if (err instanceof SeenitError && err.code === "conflict")
      console.log(`skipped ${s.submissionId}: ${err.message}`);
    else throw err;
  }
}

const { results } = await seenit.missions.results(missionId);
console.log(
  JSON.stringify(
    results.map((r) => ({ answer: r.answer, photo: r.media?.url })),
    null,
    2,
  ),
);
