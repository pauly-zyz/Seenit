"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge, Card, Notice } from "@/components/dashboard/ui";
import { formatReward, submissionStatusLabel } from "@/lib/contributor/format";
import { dateTime, explorerTx, shortHex } from "@/lib/dashboard/format";

import { apiErrorMessage } from "./gate";
import { useContributorApi } from "./providers";

const toneMap = { verify: "verify", danger: "danger", warn: "warn", neutral: "neutral" } as const;

/** Earnings summary and every submission with its status and payout transaction. */
export function HistoryView() {
  const api = useContributorApi();
  const history = useQuery({
    queryKey: ["history"],
    queryFn: api.history,
    refetchInterval: 30_000,
  });

  if (history.isPending) return <p className="py-16 text-center text-muted">Loading…</p>;
  if (history.isError) return <Notice tone="error">{apiErrorMessage(history.error)}</Notice>;

  const { summary, items } = history.data;
  const money = (v: string) => formatReward(v, summary.token.decimals, summary.token.symbol);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Earned", money(summary.earned)],
          ["Pending", money(summary.pending)],
          ["Accepted", String(summary.accepted)],
          ["In review", String(summary.inReview)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="py-8 text-center text-sm text-muted">
          No captures yet.{" "}
          <Link href="/app" className="font-semibold text-foreground underline">
            Find a mission
          </Link>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => {
            const st = submissionStatusLabel(s.status);
            return (
              <li key={s.id}>
                <Card className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/app/missions/${s.mission.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.mission.title}
                    </Link>
                    <Badge tone={toneMap[st.tone]}>{st.label}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {dateTime(s.capturedAt ?? s.createdAt)} · {money(s.mission.reward)}
                  </p>
                  {s.rejectionReasons?.length ? (
                    <p className="text-sm text-rec">{s.rejectionReasons.join(", ")}</p>
                  ) : null}
                  {s.payout ? (
                    <p className="text-sm">
                      Paid {money(s.payout.amount)} ·{" "}
                      <a
                        href={explorerTx(s.payout.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {shortHex(s.payout.txHash)}
                      </a>
                    </p>
                  ) : s.reviewDeadline && st.label === "Processing" ? (
                    <p className="text-xs text-muted">
                      Paid automatically after {dateTime(s.reviewDeadline)} unless the funder
                      rejects it.
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
