"use client";

import { haversineMeters } from "@seenit/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { dateTime, explorerTx, money, relative, shortHex } from "@/lib/dashboard/format";
import type { WalletActions } from "@/lib/dashboard/funding";
import type { Meta, ReviewItem } from "@/lib/dashboard/types";

import { FundMission } from "./fund-mission";
import { SubmissionsMap, type CapturePoint } from "./maps";
import { useDashboardApi } from "./providers";
import { useNow } from "./use-now";
import {
  Badge,
  Button,
  Card,
  errorMessage,
  inputClass,
  missionLabel,
  missionTone,
  Notice,
  submissionLabel,
  submissionTone,
} from "./ui";

const AWAITING = new Set(["processing", "ready", "needs_review"]);
const COLORS: Record<string, string> = {
  accepted: "#0b7a6e",
  rejected: "#d93a3f",
  needs_review: "#d97706",
  ready: "#496600",
  processing: "#535a65",
};

export function MissionReview({
  missionId,
  meta,
  wallet,
}: {
  missionId: string;
  meta: Meta;
  wallet: WalletActions | null;
}) {
  const api = useDashboardApi();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => api.missionStatus(missionId),
  });
  const subs = useQuery({
    queryKey: ["submissions", missionId],
    queryFn: () => api.submissions(missionId),
    enabled: status.data?.mission.status !== "pending_funding",
    refetchInterval: 20_000,
  });
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [focus, setFocus] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const now = useNow();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mission", missionId] });
    void qc.invalidateQueries({ queryKey: ["submissions", missionId] });
    void qc.invalidateQueries({ queryKey: ["missions"] });
  };
  const refund = useMutation({
    mutationFn: () => api.refund(missionId),
    onSuccess: (r) => {
      setNotice({
        tone: "success",
        text: r.refunded
          ? `Refunded ${money(r.refunded, meta.token)} to your wallet.`
          : "Nothing left to refund.",
      });
      refresh();
    },
    onError: (e) => setNotice({ tone: "error", text: errorMessage(e) }),
  });

  if (status.isPending) return <p className="text-muted">Loading mission…</p>;
  if (status.isError) return <Notice tone="error">{errorMessage(status.error)}</Notice>;
  const { mission: m, escrow, slots, funding } = status.data;
  const expired = new Date(m.deadline).getTime() <= now;
  const refundable = m.status === "active" && expired && slots.left > 0;

  const items = subs.data?.submissions ?? [];
  const shown =
    filter === "review"
      ? items.filter((s) => s.status === "ready" || s.status === "needs_review")
      : items;
  const points: CapturePoint[] = items
    .filter((s) => s.location)
    .map((s, i) => ({
      id: s.submissionId,
      lat: s.location!.lat,
      lng: s.location!.lng,
      accuracyMeters: s.location!.accuracyMeters,
      color: COLORS[s.status] ?? "#535a65",
      label: `#${i + 1} · ${submissionLabel(s.status)} · ${dateTime(s.capturedAt)}`,
    }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
            <Badge tone={missionTone(m.status)}>{missionLabel(m.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {money(m.reward, meta.token)} × {m.maxCaptures} · {m.mediaType} · Tier {m.minTier} ·
            deadline {dateTime(m.deadline)} ({relative(m.deadline)})
          </p>
        </div>
        {m.status !== "pending_funding" ? (
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2"
              href={api.exportUrl(m.id, "json")}
              download
            >
              Download JSON
            </a>
            <a
              className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2"
              href={api.exportUrl(m.id, "csv")}
              download
            >
              Download CSV
            </a>
            {refundable ? (
              <Button
                size="sm"
                variant="secondary"
                busy={refund.isPending}
                onClick={() => refund.mutate()}
              >
                Refund {money(BigInt(m.reward) * BigInt(slots.left), meta.token)}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {m.status === "pending_funding" && funding ? (
        <FundMission
          api={api}
          wallet={wallet}
          mission={m}
          funding={funding}
          meta={meta}
          onLive={() => refresh()}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Escrow" value={money(escrow.total, meta.token)} />
            <Mini
              label="Paid to contributors"
              value={money(escrow.paidToContributors, meta.token)}
            />
            <Mini label="Slots used" value={`${slots.used} / ${slots.total}`} />
            <Mini
              label="To review"
              value={String(status.data.submissions.ready + status.data.submissions.needsReview)}
            />
          </div>

          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">Capture locations</h2>
            <SubmissionsMap
              center={m.location}
              radius={m.radiusMeters}
              points={points}
              focusId={focus}
            />
            <p className="text-xs text-muted">
              Green circle: mission area. Dots: GPS fix at capture time, with its accuracy radius.
            </p>
          </Card>

          <div className="flex items-center gap-2" role="tablist" aria-label="Filter submissions">
            {(["review", "all"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === f ? "bg-foreground text-background" : "text-muted hover:bg-surface-2"}`}
              >
                {f === "review" ? "To review" : `All (${items.length})`}
              </button>
            ))}
          </div>

          {subs.isPending ? (
            <p className="text-muted">Loading submissions…</p>
          ) : subs.isError ? (
            <Notice tone="error">{errorMessage(subs.error)}</Notice>
          ) : shown.length === 0 ? (
            <Card className="py-10 text-center text-sm text-muted">
              {filter === "review" ? "Nothing waiting for review." : "No submissions yet."}
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map((s) => (
                <SubmissionCard
                  key={s.submissionId}
                  item={s}
                  meta={meta}
                  center={m.location}
                  radius={m.radiusMeters}
                  reward={m.reward}
                  onFocus={() => setFocus(s.submissionId)}
                  onResolved={refresh}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SubmissionCard({
  item: s,
  meta,
  center,
  radius,
  reward,
  onFocus,
  onResolved,
}: {
  item: ReviewItem;
  meta: Meta;
  center: { lat: number; lng: number };
  radius: number;
  reward: string;
  onFocus?: () => void;
  onResolved: () => void;
}) {
  const api = useDashboardApi();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    text: string;
    tx?: string;
  } | null>(null);
  const reasonBytes = new TextEncoder().encode(reason).length;

  const accept = useMutation({
    mutationFn: () => api.accept(s.submissionId),
    onSuccess: (r) => {
      setResult({
        tone: "success",
        text: `Accepted. Paid ${money(r.payout.amount, meta.token)} to the contributor.`,
        tx: r.payout.txHash,
      });
      onResolved();
    },
    onError: (e) => setResult({ tone: "error", text: errorMessage(e) }),
  });
  const reject = useMutation({
    mutationFn: () => api.reject(s.submissionId, reason.trim()),
    onSuccess: (r) => {
      setResult({
        tone: "success",
        text: `Rejected. ${money(reward, meta.token)} stays in escrow.`,
        tx: r.submission.resolveTxHash ?? undefined,
      });
      setRejecting(false);
      onResolved();
    },
    onError: (e) => setResult({ tone: "error", text: errorMessage(e) }),
  });

  const distance = s.location ? Math.round(haversineMeters(center, s.location)) : null;
  const canDecide = AWAITING.has(s.status) && s.status !== "processing" && !result?.tx;
  const conf = s.ai?.confidence;

  return (
    <Card className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="flex flex-col gap-2">
        {s.media?.frames.length ? (
          <div className={s.media.frames.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
            {s.media.frames.map((f, i) => (
              <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                {/* Short-lived signed URLs to the blurred copy: plain <img>, no image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.url}
                  alt={`Blurred capture, frame ${i + 1}`}
                  className="aspect-[4/3] w-full rounded-lg border border-line object-cover"
                />
              </a>
            ))}
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-surface-2 p-4 text-center text-sm text-muted">
            {s.status === "processing"
              ? "Being processed: faces and plates are blurred first."
              : "No media to show."}
          </div>
        )}
        <p className="text-xs text-muted">
          Faces and licence plates are blurred. Videos are shown as key frames.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={submissionTone(s.status)}>{submissionLabel(s.status)}</Badge>
          {s.ai?.reviewReasons.map((r) => (
            <Badge key={r} tone="warn">
              {r.replaceAll("_", " ")}
            </Badge>
          ))}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Captured</dt>
          <dd>{dateTime(s.capturedAt)}</dd>
          <dt className="text-muted">GPS</dt>
          <dd>
            {s.location ? (
              <button type="button" onClick={onFocus} className="text-left hover:underline">
                {s.location.lat.toFixed(5)}, {s.location.lng.toFixed(5)}
                {s.location.accuracyMeters
                  ? ` ±${Math.round(s.location.accuracyMeters)} m`
                  : ""} · {distance} m from center
                {distance !== null && distance > radius ? " (outside area)" : ""}
              </button>
            ) : (
              "—"
            )}
          </dd>
          {s.reviewDeadline && AWAITING.has(s.status) ? (
            <>
              <dt className="text-muted">Decide by</dt>
              <dd>
                {dateTime(s.reviewDeadline)} ({relative(s.reviewDeadline)}). After that it is paid
                automatically.
              </dd>
            </>
          ) : null}
          {s.proof.recordTxHash ? (
            <>
              <dt className="text-muted">On-chain</dt>
              <dd>
                <a
                  className="font-mono text-xs hover:underline"
                  href={explorerTx(s.proof.recordTxHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHex(s.proof.recordTxHash)}
                </a>
              </dd>
            </>
          ) : null}
        </dl>

        {s.ai ? (
          <div className="rounded-xl border border-line bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">AI answer</p>
              {conf !== null && conf !== undefined ? (
                <div
                  className="flex items-center gap-2 text-xs"
                  aria-label={`Confidence ${Math.round(conf * 100)}%`}
                >
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full ${conf >= 0.7 ? "bg-verify" : "bg-amber-500"}`}
                      style={{ width: `${Math.round(conf * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{Math.round(conf * 100)}%</span>
                </div>
              ) : null}
            </div>
            {s.ai.answer ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(s.ai.answer).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-xs text-muted">{k}</dt>
                    <dd className="break-words">
                      {v === null || v === undefined
                        ? "—"
                        : typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">No answer could be extracted.</p>
            )}
            {s.ai.reasoning ? <p className="mt-2 text-sm text-muted">“{s.ai.reasoning}”</p> : null}
          </div>
        ) : null}

        {result ? (
          <Notice tone={result.tone}>
            {result.text}{" "}
            {result.tx ? (
              <a
                className="underline"
                href={explorerTx(result.tx)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            ) : null}
          </Notice>
        ) : null}

        {canDecide ? (
          rejecting ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-start"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim() && reasonBytes <= 32) reject.mutate();
              }}
            >
              <div className="flex-1">
                <label htmlFor={`reason-${s.submissionId}`} className="sr-only">
                  Reason
                </label>
                <input
                  id={`reason-${s.submissionId}`}
                  className={inputClass}
                  value={reason}
                  placeholder="Reason (stored on-chain, max 32 bytes)"
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
                <p className={`mt-1 text-xs ${reasonBytes > 32 ? "text-rec" : "text-muted"}`}>
                  {reasonBytes}/32 bytes
                </p>
              </div>
              <Button
                type="submit"
                variant="danger"
                busy={reject.isPending}
                disabled={!reason.trim() || reasonBytes > 32}
              >
                Reject
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button
                busy={accept.isPending}
                onClick={() => accept.mutate()}
                disabled={reject.isPending}
              >
                Accept and pay
              </Button>
              <Button
                variant="danger"
                onClick={() => setRejecting(true)}
                disabled={accept.isPending}
              >
                Reject…
              </Button>
            </div>
          )
        ) : null}
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </Card>
  );
}
