"use client";

import { useState } from "react";

import type { DashboardApi } from "@/lib/dashboard/api";
import { explorerTx, money, shortHex } from "@/lib/dashboard/format";
import { fundMission, type FundingStep, type WalletActions } from "@/lib/dashboard/funding";
import type { Funding, Meta, Mission } from "@/lib/dashboard/types";

import { Button, Card, errorMessage, Notice } from "./ui";

type StepState = "todo" | "active" | "done" | "skipped";

/** Signs approve + createMission from the connected wallet and shows each step. */
export function FundMission({
  api,
  wallet,
  mission,
  funding,
  meta,
  onLive,
}: {
  api: Pick<DashboardApi, "confirmMission">;
  wallet: WalletActions | null;
  mission: Mission;
  funding: Funding;
  meta: Meta;
  onLive: (m: Mission) => void;
}) {
  const [steps, setSteps] = useState<
    Record<"approve" | "create" | "confirm", { state: StepState; hash?: string }>
  >({
    approve: { state: "todo" },
    create: { state: "todo" },
    confirm: { state: "todo" },
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function onStep(s: FundingStep) {
    if (s.step === "switching-chain") setStatus(`Switch your wallet to chain ${s.chainId}…`);
    if (s.step === "approve")
      setSteps((p) => ({
        ...p,
        approve: {
          state: s.status === "skipped" ? "skipped" : s.status === "done" ? "done" : "active",
          hash: s.hash,
        },
      }));
    if (s.step === "create")
      setSteps((p) => ({
        ...p,
        create: { state: s.status === "done" ? "done" : "active", hash: s.hash },
      }));
    if (s.step === "confirming") setSteps((p) => ({ ...p, confirm: { state: "active" } }));
    if (s.step === "live") setSteps((p) => ({ ...p, confirm: { state: "done" } }));
    setStatus(
      s.step === "approve" && s.status === "signing"
        ? "Confirm the approve transaction in your wallet."
        : s.step === "create" && s.status === "signing"
          ? "Confirm the funding transaction in your wallet."
          : s.step === "approve" && s.status === "pending"
            ? "Waiting for the approve transaction…"
            : s.step === "create" && s.status === "pending"
              ? "Waiting for the funding transaction…"
              : null,
    );
  }

  async function run() {
    if (!wallet) return;
    setRunning(true);
    setError(null);
    try {
      const live = await fundMission({ api, wallet, mission, funding, meta, onStep });
      onLive(live);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const items: [keyof typeof steps, string][] = [
    ["approve", `Approve ${money(funding.total, meta.token)} for the escrow`],
    ["create", "Fund the mission on-chain"],
    ["confirm", "Publish to contributors"],
  ];

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Fund “{mission.title}”</h2>
        <p className="text-sm text-muted">
          {money(funding.total, meta.token)} goes into the MissionEscrow contract on Robinhood
          Chain. Nothing is live until this is done.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {items.map(([k, label]) => {
          const s = steps[k];
          return (
            <li key={k} className="flex items-center gap-3 text-sm" data-state={s.state}>
              <span
                className={
                  s.state === "done" || s.state === "skipped"
                    ? "size-5 rounded-full bg-verify text-center text-xs leading-5 text-white"
                    : s.state === "active"
                      ? "size-5 animate-pulse rounded-full bg-accent"
                      : "size-5 rounded-full border border-line"
                }
                aria-hidden
              >
                {s.state === "done" || s.state === "skipped" ? "✓" : ""}
              </span>
              <span className={s.state === "todo" ? "text-muted" : ""}>
                {label}
                {s.state === "skipped" ? " (already approved)" : ""}
              </span>
              {s.hash ? (
                <a
                  className="ml-auto font-mono text-xs text-muted hover:text-foreground"
                  href={explorerTx(s.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortHex(s.hash)}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
      {status ? <Notice>{status}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!wallet ? <Notice tone="warn">Connect your wallet to fund this mission.</Notice> : null}
      <Button onClick={run} busy={running} disabled={!wallet}>
        {error ? "Try again" : `Fund ${money(funding.total, meta.token)}`}
      </Button>
    </Card>
  );
}
