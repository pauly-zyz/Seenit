"use client";

import { evaluateCaptureGate, type LiveFix } from "@seenit/shared";
import { Camera as CameraIcon, Circle, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Notice } from "@/components/dashboard/ui";
import {
  baseContentType,
  type CapturedMedia,
  pickVideoType,
  type SubmitStep,
} from "@/lib/contributor/capture";
import { formatDistance } from "@/lib/contributor/format";
import type { MissionDetail } from "@/lib/contributor/types";

import type { LocationPermission } from "./use-location";

type Phase = "starting" | "live" | "recording" | "review" | "submitting" | "error";

const STEP_LABEL: Record<SubmitStep, string> = {
  hashing: "Securing your capture…",
  requesting: "Checking your location…",
  uploading: "Uploading…",
  finalizing: "Recording proof on-chain…",
};

export interface CameraDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder: (stream: MediaStream, mimeType: string) => MediaRecorder;
  isTypeSupported: (type: string) => boolean;
}

const browserDeps = (): CameraDeps => ({
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  createRecorder: (stream, mimeType) =>
    new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 }),
  isTypeSupported: (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
});

/**
 * In-app camera for the web. There is deliberately no file/gallery picker: only media shot here,
 * inside the mission area, can be submitted. GPS and time are taken at the shutter.
 */
export function Camera({
  mission,
  fix,
  permission,
  onSubmit,
  onClose,
  deps: injected,
}: {
  mission: MissionDetail["mission"];
  fix: LiveFix | null;
  permission: LocationPermission;
  onSubmit: (media: CapturedMedia, onStep: (s: SubmitStep) => void) => Promise<void>;
  onClose: () => void;
  deps?: CameraDeps;
}) {
  const [deps] = useState(() => injected ?? browserDeps());
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<SubmitStep | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isVideo = mission.mediaType === "video";
  const maxSeconds = mission.maxVideoSeconds ?? 30;
  const videoType = isVideo ? pickVideoType(deps.isTypeSupported) : null;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Start the rear camera (no microphone: audio isn't needed to verify a scene).
  useEffect(() => {
    let cancelled = false;
    deps
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          try {
            // Autoplay can be refused; the <video autoPlay muted> element retries on its own.
            void Promise.resolve(video.current.play()).catch(() => undefined);
          } catch {
            // not a real media element (tests)
          }
        }
        setPhase("live");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera access is blocked. Allow the camera for this site in your browser settings."
            : name === "NotFoundError"
              ? "No camera found on this device. Open Seenit on your phone."
              : "The camera couldn't start. Close other apps using it and try again.",
        );
        setPhase("error");
      });
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [deps]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const gate = evaluateCaptureGate({ permission, fix, mission, now });
  const elapsed =
    recordingSince !== null ? Math.max(0, Math.floor((now - recordingSince) / 1000)) : 0;

  // Stop at the mission's max video length.
  useEffect(() => {
    if (phase === "recording" && elapsed >= maxSeconds) recorder.current?.stop();
  }, [phase, elapsed, maxSeconds]);

  function review(media: CapturedMedia) {
    setCaptured(media);
    setPreviewUrl(URL.createObjectURL(media.blob));
    setPhase("review");
  }

  function shutterFix(f: LiveFix) {
    return {
      lat: f.lat,
      lng: f.lng,
      accuracyMeters: f.accuracyMeters ?? 9999,
      timestamp: f.timestamp,
    };
  }

  async function takePhoto() {
    const el = video.current;
    if (!el || !fix || !gate.canRecord) return;
    const shutterAt = Date.now();
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth || 1280;
    canvas.height = el.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    if (!blob) {
      setError("Couldn't take the photo. Try again.");
      return;
    }
    review({
      blob,
      contentType: "image/jpeg",
      mediaType: "photo",
      shutterAt,
      fix: shutterFix(fix),
    });
  }

  function startRecording() {
    if (!stream.current || !fix || !gate.canRecord || !videoType) return;
    const chunks: Blob[] = [];
    const rec = deps.createRecorder(stream.current, videoType);
    const start = { at: Date.now(), fix };
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const contentType = baseContentType(rec.mimeType || videoType);
      const blob = new Blob(chunks, { type: contentType });
      setRecordingSince(null);
      review({
        blob,
        contentType,
        mediaType: "video",
        shutterAt: start.at,
        fix: shutterFix(start.fix),
        durationSeconds: (Date.now() - start.at) / 1000,
      });
    };
    recorder.current = rec;
    setRecordingSince(start.at);
    rec.start(1000);
    setNow(Date.now());
    setPhase("recording");
  }

  async function submit() {
    if (!captured) return;
    setPhase("submitting");
    setError(null);
    try {
      await onSubmit(captured, setStep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submitting failed. Try again.");
      setPhase("review");
    } finally {
      setStep(null);
    }
  }

  function retake() {
    setCaptured(null);
    setPreviewUrl(null);
    setError(null);
    setPhase("live");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          aria-label="Camera viewfinder"
          className={
            phase === "review" || phase === "submitting"
              ? "hidden"
              : "aspect-[3/4] w-full object-cover sm:aspect-video"
          }
        />
        {previewUrl && (phase === "review" || phase === "submitting") ? (
          isVideo ? (
            <video
              src={previewUrl}
              controls
              playsInline
              className="aspect-[3/4] w-full object-contain sm:aspect-video"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Your capture"
              className="aspect-[3/4] w-full object-contain sm:aspect-video"
            />
          )
        ) : null}
        {phase === "recording" ? (
          <span className="absolute top-3 left-3 rounded-full bg-rec px-2.5 py-1 font-mono text-xs font-semibold text-white">
            REC {elapsed}s / {maxSeconds}s
          </span>
        ) : null}
        {phase === "live" || phase === "recording" ? (
          <span
            className={`absolute right-3 bottom-3 left-3 rounded-xl px-3 py-2 text-center text-sm font-medium ${gate.canRecord ? "bg-verify/90 text-white" : "bg-black/70 text-white"}`}
            role="status"
          >
            {gate.message}
            {gate.distanceMeters !== undefined && gate.canRecord
              ? ` (${formatDistance(gate.distanceMeters)} from the spot)`
              : ""}
          </span>
        ) : null}
        {phase === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting camera…
          </p>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {isVideo && !videoType && phase !== "error" ? (
        <Notice tone="warn">
          This browser can&apos;t record video. Use Chrome or Safari on your phone.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === "live" && !isVideo ? (
          <Button onClick={takePhoto} disabled={!gate.canRecord} aria-label="Take photo">
            <CameraIcon className="size-4" aria-hidden /> Take photo
          </Button>
        ) : null}
        {phase === "live" && isVideo ? (
          <Button
            onClick={startRecording}
            disabled={!gate.canRecord || !videoType}
            aria-label="Start recording"
          >
            <Circle className="size-4 fill-current" aria-hidden /> Record
          </Button>
        ) : null}
        {phase === "recording" ? (
          <Button
            variant="danger"
            onClick={() => recorder.current?.stop()}
            aria-label="Stop recording"
          >
            <Square className="size-4 fill-current" aria-hidden /> Stop
          </Button>
        ) : null}
        {phase === "review" || phase === "submitting" ? (
          <>
            <Button onClick={submit} busy={phase === "submitting"}>
              {phase === "submitting" && step ? STEP_LABEL[step] : "Submit capture"}
            </Button>
            <Button variant="ghost" onClick={retake} disabled={phase === "submitting"}>
              Retake
            </Button>
          </>
        ) : null}
        {phase !== "submitting" && phase !== "recording" ? (
          <Button variant="ghost" onClick={onClose}>
            Close camera
          </Button>
        ) : null}
      </div>
      <p className="text-center text-xs text-muted">
        Captures can only be taken here, inside the mission area. Faces and licence plates are
        blurred before the funder sees anything.
      </p>
    </div>
  );
}
