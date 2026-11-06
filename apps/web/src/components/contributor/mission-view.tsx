"use client";

import { evaluateCaptureGate } from "@seenit/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SubmissionsMap } from "@/components/dashboard/maps";
import { Badge, Button, Card, Notice } from "@/components/dashboard/ui";
import { type SubmitStep, submitCapture } from "@/lib/contributor/capture";
import type { CapturedMedia } from "@/lib/contributor/capture";
import { formatReward, formatTimeLeft, submissionStatusLabel } from "@/lib/contributor/format";
import { exampleFromSchema } from "@/lib/contributor/missions";
import type { PersonhoodStatus } from "@/lib/contributor/types";

import { Camera, type CameraDeps } from "./camera";
import { useNow } from "@/components/dashboard/use-now";

import { apiErrorMessage, useMeta } from "./gate";
import { useContributorApi } from "./providers";
import { type LiveLocation, useLiveLocation } from "./use-location";

export const APP_VERSION = `web-${process.env.NEXT_PUBLIC_APP_VERSION ?? "1"}`;

export function MissionView({
  id,
  me,
  location: injected,
  cameraDeps,
}: {
  id: string;
  me: PersonhoodStatus;
  location?: LiveLocation;
  cameraDeps?: CameraDeps;
}) {
  const now = useNow(1000);
  const live = useLiveLocation(!injected);
  const location = injected ?? live;
  const api = useContributorApi();
  const qc = useQueryClient();
  const meta = useMeta();
  const token = meta.data?.token ?? { symbol: "USDG", decimals: 6 };
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const detail = useQuery({ queryKey: ["mission", id], queryFn: () => api.mission(id) });

  const back = (
    <Link
      href="/app"
      className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden /> All missions
    </Link>
  );
  if (detail.isPending) return <p className="py-16 text-center text-muted">Loading…</p>;
  if (detail.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Notice tone="error">{apiErrorMessage(detail.error)}</Notice>
      </div>
    );
  }

  const { mission, access, mySubmission } = detail.data;
  const gate = evaluateCaptureGate({
    permission: location.permission,
    fix: location.fix,
    mission,
    now,
  });
  const example = exampleFromSchema(mission.outputSchema);

  async function onSubmit(media: CapturedMedia, onStep: (s: SubmitStep) => void) {
    await submitCapture({
      api,
      missionId: mission.id,
      media,
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent,
      onStep,
    });
    setCameraOpen(false);
    setSubmitted(true);
    await qc.invalidateQueries({ queryKey: ["mission", id] });
    await qc.invalidateQueries({ queryKey: ["history"] });
  }

  let blocker: string | null = null;
  if (access.locked) {
    blocker =
      me.tier === 0
        ? "Verify that you're a unique person to take this mission."
        : `This mission needs Tier ${access.requiredTier}. You're Tier ${access.yourTier}.`;
  } else if (!mission.open && !mySubmission) {
    blocker = "This mission is no longer open.";
  }

  const status = mySubmission ? submissionStatusLabel(mySubmission.status) : null;
  const canCapture =
    !access.locked &&
    mission.open &&
    (!mySubmission || mySubmission.status === "rejected_precheck");

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{mission.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {mission.mediaType === "video"
              ? `Video, up to ${mission.maxVideoSeconds ?? 30} s`
              : "Photo"}{" "}
            · {formatTimeLeft(mission.deadline, new Date(now))} · {mission.slotsLeft} of{" "}
            {mission.maxCaptures} left
          </p>
        </div>
        <Badge tone="accent">{formatReward(mission.reward, token.decimals, token.symbol)}</Badge>
      </div>

      {submitted ? (
        <Notice tone="success">
          Submitted! We&apos;re checking your capture. You&apos;ll be paid when the funder accepts
          it (or automatically after the review window).{" "}
          <Link href="/app/history" className="font-semibold underline">
            See earnings
          </Link>
        </Notice>
      ) : null}

      {cameraOpen ? (
        <Camera
          mission={mission}
          fix={location.fix}
          permission={location.permission}
          onSubmit={onSubmit}
          onClose={() => setCameraOpen(false)}
          deps={cameraDeps}
        />
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="font-semibold">What to capture</h2>
            <p className="text-sm whitespace-pre-line">{mission.instructions}</p>
            {example ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  What the AI will read from your capture
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-surface-2 p-3 text-xs">
                  {JSON.stringify(example, null, 2)}
                </pre>
              </details>
            ) : null}
          </Card>

          <SubmissionsMap
            center={mission.location}
            radius={mission.radiusMeters}
            points={
              location.fix
                ? [
                    {
                      id: "you",
                      lat: location.fix.lat,
                      lng: location.fix.lng,
                      label: "You",
                      color: "#2563eb",
                      accuracyMeters: location.fix.accuracyMeters,
                    },
                  ]
                : []
            }
          />

          {status && mySubmission ? (
            <Notice
              tone={
                status.tone === "danger" ? "error" : status.tone === "verify" ? "success" : "info"
              }
            >
              Your capture: <strong>{status.label}</strong>
              {mySubmission.rejectionReasons?.length
                ? ` (${mySubmission.rejectionReasons.join(", ")})`
                : null}
            </Notice>
          ) : null}

          {blocker ? (
            <Notice tone="warn">
              {blocker}{" "}
              {access.locked ? (
                <Link href="/app/verify" className="font-semibold underline">
                  Verify
                </Link>
              ) : null}
            </Notice>
          ) : null}

          {canCapture ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted" role="status">
                {location.error ?? gate.message}
              </p>
              <Button onClick={() => setCameraOpen(true)}>Open camera</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
