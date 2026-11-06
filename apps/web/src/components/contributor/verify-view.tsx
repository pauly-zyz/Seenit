"use client";

import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Card, Notice } from "@/components/dashboard/ui";
import { dateTime, explorerTx, shortHex } from "@/lib/dashboard/format";
import { verificationErrorMessage } from "@/lib/contributor/messages";
import type { PersonhoodStatus, ProviderId } from "@/lib/contributor/types";

import { useContributorApi } from "./providers";

type Pending = { sessionId: string; url: string; qr: string | null };

/**
 * Proof of personhood. Tier 1 checks the Human Passport score in place; Tier 2 hands off to the
 * Self app (QR on a computer, a direct link on a phone) and polls until the proof arrives.
 */
export function VerifyView({
  me,
  pollIntervalMs = 3000,
}: {
  me: PersonhoodStatus;
  pollIntervalMs?: number;
}) {
  const api = useContributorApi();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["contributor"] });
  }

  function poll(sessionId: string) {
    timer.current = setTimeout(async () => {
      try {
        const s = await api.verificationSession(sessionId);
        if (s.status === "pending") return poll(sessionId);
        setPending(null);
        setBusy(null);
        if (s.status === "verified") {
          setSuccess(`Verified! You're now Tier ${s.tier}.`);
          await refresh();
        } else {
          setError(
            s.status === "expired"
              ? "The verification request expired. Start again."
              : (s.error ?? "Verification failed. Please try again."),
          );
        }
      } catch {
        poll(sessionId); // transient: keep waiting
      }
    }, pollIntervalMs);
  }

  async function start(provider: ProviderId) {
    setBusy(provider);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.startVerification(provider);
      if (res.status === "verified") {
        setSuccess(`Verified! You're now Tier ${res.tier}.`);
        setBusy(null);
        await refresh();
        return;
      }
      const qr = await QRCode.toDataURL(res.url, { margin: 1, width: 240 }).catch(() => null);
      setPending({ sessionId: res.sessionId, url: res.url, qr });
      poll(res.sessionId);
    } catch (err) {
      setError(verificationErrorMessage(err));
      setBusy(null);
    }
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    setPending(null);
    setBusy(null);
  }

  const providerFor = (tier: number) => me.providers.find((p) => p.tier === tier);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify you&apos;re human</h1>
        <p className="mt-1 text-sm text-muted">
          Each person can have one Seenit account. Verifying unlocks missions; no personal data is
          shared with funders, only a proof is recorded on-chain.
        </p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}

      {pending ? (
        <Card className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-semibold">Scan with the Self app</h2>
          <p className="max-w-sm text-sm text-muted">
            Open the Self app on your phone and scan this code, or tap the button if you&apos;re
            already on your phone. Keep this page open; it updates when you&apos;re done.
          </p>
          {pending.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pending.qr}
              alt="Self verification QR code"
              width={240}
              height={240}
              className="rounded-xl bg-white p-2"
            />
          ) : null}
          <a
            href={pending.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-full bg-accent px-5 font-medium text-accent-fg"
          >
            Open Self app
          </a>
          <p className="text-xs text-muted" role="status">
            Waiting for your proof…
          </p>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {me.tiers.map((t) => {
          const provider = providerFor(t.tier);
          return (
            <Card key={t.tier} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">
                  Tier {t.tier} · {t.name}
                </h2>
                <Badge tone={t.unlocked ? "verify" : "neutral"}>
                  {t.unlocked ? "Unlocked" : "Locked"}
                </Badge>
              </div>
              <p className="text-sm text-muted">{t.howToVerify}</p>
              <p className="text-sm">
                <span className="text-muted">Unlocks:</span> {t.unlocks}
                {t.activeMissions ? ` (${t.activeMissions} live missions)` : null}
              </p>
              {!t.unlocked && provider ? (
                <Button
                  onClick={() => start(provider.id)}
                  busy={busy === provider.id}
                  disabled={busy !== null && busy !== provider.id}
                >
                  Verify with {provider.name}
                </Button>
              ) : !t.unlocked ? (
                <p className="text-xs text-muted">Not available yet.</p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {me.attestations.length ? (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Your verifications</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {me.attestations.map((a) => (
              <li
                key={`${a.provider}-${a.verifiedAt}`}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  {a.provider === "self" ? "Self" : "Human Passport"} · Tier {a.tier} ·{" "}
                  {a.state.replace("_", " ")}
                </span>
                <span className="text-muted">
                  until {dateTime(a.expiresAt)}
                  {a.txHash ? (
                    <>
                      {" · "}
                      <a
                        href={explorerTx(a.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {shortHex(a.txHash)}
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
