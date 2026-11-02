"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { dateTime, money, relative } from "@/lib/dashboard/format";
import type { MissionListItem } from "@/lib/dashboard/types";

import { useDashboardApi } from "./providers";
import { Badge, Button, Card, errorMessage, missionLabel, missionTone, Notice } from "./ui";

export function MissionsList() {
  const api = useDashboardApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["missions"],
    queryFn: () => api.missions(),
    refetchInterval: 30_000,
  });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const refund = useMutation({
    mutationFn: (id: string) => api.refund(id),
    onSuccess: (r) => {
      const token = q.data!.token;
      setMessage({
        tone: "success",
        text: r.refunded
          ? `Refunded ${money(r.refunded, token)} to your wallet.`
          : "Nothing left to refund.",
      });
      void qc.invalidateQueries({ queryKey: ["missions"] });
    },
    onError: (e) => setMessage({ tone: "error", text: errorMessage(e) }),
  });

  if (q.isPending) return <p className="text-muted">Loading missions…</p>;
  if (q.isError) return <Notice tone="error">{errorMessage(q.error)}</Notice>;
  const { missions, token } = q.data;

  const totals = missions.reduce(
    (t, m) => ({
      held: t.held + BigInt(m.escrow.held),
      paid: t.paid + BigInt(m.escrow.paidOut),
      refundable: t.refundable + (m.escrow.refundable ? BigInt(m.escrow.unused) : 0n),
    }),
    { held: 0n, paid: 0n, refundable: 0n },
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Missions</h1>
          <p className="text-sm text-muted">
            Escrow held, paid out and refundable across your missions.
          </p>
        </div>
        <Link
          href="/dashboard/missions/new"
          className="inline-flex h-10 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-accent-fg hover:brightness-95"
        >
          New mission
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="In escrow" value={money(totals.held, token)} />
        <Stat label="Paid out (incl. fees)" value={money(totals.paid, token)} />
        <Stat label="Refundable now" value={money(totals.refundable, token)} />
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {missions.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium">No missions yet</p>
          <p className="mt-1 text-sm text-muted">
            Create one here, or let an agent create it through the API or MCP.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Mission</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submissions</th>
                <th className="px-4 py-3 font-medium">Escrow</th>
                <th className="px-4 py-3 font-medium">Deadline</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <Row
                  key={m.id}
                  m={m}
                  token={token}
                  onRefund={() => refund.mutate(m.id)}
                  refunding={refund.isPending && refund.variables === m.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  m,
  token,
  onRefund,
  refunding,
}: {
  m: MissionListItem;
  token: { symbol: string; decimals: number };
  onRefund: () => void;
  refunding: boolean;
}) {
  const s = m.submissions;
  const toReview = s.ready + s.needsReview;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-3">
        <Link href={`/dashboard/missions/${m.id}`} className="font-medium hover:underline">
          {m.title}
        </Link>
        <div className="text-xs text-muted">
          {money(m.reward, token)} × {m.maxCaptures} · {m.mediaType} · Tier {m.minTier}
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge tone={missionTone(m.status)}>{missionLabel(m.status)}</Badge>
        {m.escrow.expired && m.status === "active" ? (
          <div className="mt-1 text-xs text-muted">Expired</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div>
          {s.accepted} accepted · {s.rejected} rejected
        </div>
        {toReview > 0 ? (
          <div className="mt-1">
            <Badge tone={s.needsReview ? "warn" : "accent"}>{toReview} to review</Badge>
          </div>
        ) : s.processing ? (
          <div className="text-xs text-muted">{s.processing} processing</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-xs leading-5">
        {m.status === "pending_funding" ? (
          <span className="text-muted">
            Not funded ({money(BigInt(m.reward) * BigInt(m.maxCaptures), token)})
          </span>
        ) : (
          <>
            <div>
              <span className="text-muted">Held</span> {money(m.escrow.held, token)}
            </div>
            <div>
              <span className="text-muted">Paid</span> {money(m.escrow.paidOut, token)}
            </div>
            {BigInt(m.escrow.returned) > 0n ? (
              <div>
                <span className="text-muted">Returned</span> {money(m.escrow.returned, token)}
              </div>
            ) : null}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        <div>{dateTime(m.deadline)}</div>
        <div className="text-muted">{relative(m.deadline)}</div>
      </td>
      <td className="px-4 py-3 text-right">
        {m.escrow.refundable ? (
          <Button size="sm" variant="secondary" busy={refunding} onClick={onRefund}>
            Refund {money(m.escrow.unused, token)}
          </Button>
        ) : m.status === "pending_funding" ? (
          <Link
            href={`/dashboard/missions/${m.id}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Fund
          </Link>
        ) : (
          <Link
            href={`/dashboard/missions/${m.id}`}
            className="text-sm font-medium hover:underline"
          >
            Review
          </Link>
        )}
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}
