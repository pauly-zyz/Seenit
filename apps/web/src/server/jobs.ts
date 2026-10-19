import { jobs, sql, type Database } from "@seenit/db";

export const JOB_AI_PROCESS = "submission.ai_process";

export async function enqueueJob(db: Database, type: string, payload: Record<string, unknown>) {
  const [job] = await db.insert(jobs).values({ type, payload }).returning();
  return job!;
}

/** Claims the next ready job of `type` (safe with many workers: FOR UPDATE SKIP LOCKED). */
export async function claimJob(db: Database, type: string, now: Date) {
  const result = (await db.execute(sql`
    update ${jobs} set status = 'running', locked_at = ${now}, attempts = attempts + 1
    where id = (
      select id from ${jobs}
      where type = ${type} and status = 'queued' and run_after <= ${now}
      order by run_after
      for update skip locked
      limit 1
    )
    returning id`)) as unknown as { rows: { id: string }[] };
  const id = result.rows[0]?.id;
  if (!id) return null;
  return (await db.query.jobs.findFirst({ where: (j, { eq }) => eq(j.id, id) })) ?? null;
}

export async function completeJob(db: Database, id: string) {
  await db
    .update(jobs)
    .set({ status: "done", lockedAt: null })
    .where(sql`${jobs.id} = ${id}`);
}

/** Re-queues with exponential backoff, or marks failed after `maxAttempts`. */
export async function failJob(db: Database, id: string, error: string, now: Date, maxAttempts = 5) {
  const job = await db.query.jobs.findFirst({ where: (j, { eq }) => eq(j.id, id) });
  if (!job) return;
  const failed = job.attempts >= maxAttempts;
  await db
    .update(jobs)
    .set({
      status: failed ? "failed" : "queued",
      lockedAt: null,
      lastError: error.slice(0, 2000),
      runAfter: new Date(now.getTime() + 2 ** job.attempts * 30_000),
    })
    .where(sql`${jobs.id} = ${id}`);
}
