"use client";

import { missionSpecSchema, requiredTier } from "@seenit/shared";
import { useMemo, useState } from "react";

import { money, parseUnits } from "@/lib/dashboard/format";
import type { Meta, Template } from "@/lib/dashboard/types";

import { LocationPickerMap } from "./maps";
import { Button, Card, Field, inputClass, Notice } from "./ui";

export interface MissionDraft {
  title: string;
  instructions: string;
  mediaType: "photo" | "video";
  maxVideoSeconds: number;
  lat: number;
  lng: number;
  radiusMeters: number;
  template: string;
  reward: string;
  maxCaptures: number;
  minTier: 1 | 2;
  deadline: string; // datetime-local value
}

const pad = (n: number) => String(n).padStart(2, "0");
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function defaultDraft(templates: Template[], now = new Date()): MissionDraft {
  const t = templates[0];
  return {
    title: "",
    instructions: t?.suggestedInstructions ?? "",
    mediaType: t?.mediaType ?? "photo",
    maxVideoSeconds: 20,
    lat: -6.175392,
    lng: 106.827153,
    radiusMeters: 100,
    template: t?.id ?? "",
    reward: "2",
    maxCaptures: 3,
    minTier: 1,
    deadline: toLocalInput(new Date(now.getTime() + 24 * 3600_000)),
  };
}

/** Builds the API spec from the form; returns field errors when it doesn't validate. */
export function buildSpec(d: MissionDraft, templates: Template[], meta: Meta) {
  const errors: Partial<Record<keyof MissionDraft, string>> = {};
  let reward: bigint | null = null;
  try {
    reward = parseUnits(d.reward, meta.token.decimals);
    if (reward <= 0n) throw new Error();
  } catch {
    errors.reward = `Enter an amount in ${meta.token.symbol}, e.g. 2.5`;
  }
  const template = templates.find((t) => t.id === d.template);
  if (!template) errors.template = "Pick an output template";
  const deadline = new Date(d.deadline);
  if (Number.isNaN(deadline.getTime())) errors.deadline = "Pick a deadline";

  const spec = {
    title: d.title.trim(),
    instructions: d.instructions.trim(),
    mediaType: d.mediaType,
    ...(d.mediaType === "video" ? { maxVideoSeconds: d.maxVideoSeconds } : {}),
    location: { lat: d.lat, lng: d.lng },
    radiusMeters: d.radiusMeters,
    rewardPerSubmission: (reward ?? 0n).toString(),
    maxSubmissions: d.maxCaptures,
    deadline: Number.isNaN(deadline.getTime()) ? "" : deadline.toISOString(),
    minTier: d.minTier,
    outputSchema: template?.outputSchema ?? {},
  };
  const parsed = missionSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const map: Record<string, keyof MissionDraft> = {
      rewardPerSubmission: "reward",
      maxSubmissions: "maxCaptures",
      location: "lat",
      outputSchema: "template",
    };
    for (const issue of parsed.error.issues) {
      const key = map[String(issue.path[0])] ?? (issue.path[0] as keyof MissionDraft);
      errors[key] ??= issue.message;
    }
  }
  // Total and tier only need a valid reward and capture count, so the summary shows early.
  const preview =
    reward !== null && !errors.reward && Number.isInteger(d.maxCaptures) && d.maxCaptures > 0
      ? {
          total: reward * BigInt(d.maxCaptures),
          tier: requiredTier(reward, BigInt(meta.tier1MaxReward), d.minTier),
        }
      : { total: null, tier: null };
  if (Object.keys(errors).length) return { errors, spec: null, ...preview };
  return { errors, spec, ...preview };
}

export function MissionForm({
  meta,
  templates,
  busy,
  onSubmit,
}: {
  meta: Meta;
  templates: Template[];
  busy?: boolean;
  onSubmit: (spec: Record<string, unknown>) => void;
}) {
  const [d, setD] = useState<MissionDraft>(() => defaultDraft(templates));
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof MissionDraft>(k: K, v: MissionDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));
  const result = useMemo(() => buildSpec(d, templates, meta), [d, templates, meta]);
  const err = (k: keyof MissionDraft) => (submitted ? result.errors[k] : undefined);
  const token = meta.token;

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    setD((p) => ({
      ...p,
      template: id,
      mediaType: t?.mediaType ?? p.mediaType,
      instructions:
        !p.instructions || templates.some((x) => x.suggestedInstructions === p.instructions)
          ? (t?.suggestedInstructions ?? "")
          : p.instructions,
    }));
  }

  return (
    <form
      className="grid gap-5 lg:grid-cols-[1fr_340px]"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (result.spec) onSubmit(result.spec);
      }}
      noValidate
    >
      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">What to capture</h2>
          <Field
            label="Answer template"
            htmlFor="template"
            error={err("template")}
            hint={templates.find((t) => t.id === d.template)?.description}
          >
            <select
              id="template"
              className={inputClass}
              value={d.template}
              onChange={(e) => pickTemplate(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" htmlFor="title" error={err("title")}>
            <input
              id="title"
              className={inputClass}
              value={d.title}
              maxLength={120}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Is Luna Bakery open right now?"
            />
          </Field>
          <Field
            label="Instructions for the contributor"
            htmlFor="instructions"
            error={err("instructions")}
          >
            <textarea
              id="instructions"
              className={`${inputClass} h-28 py-2`}
              value={d.instructions}
              maxLength={4000}
              onChange={(e) => set("instructions", e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Media" htmlFor="media">
              <select
                id="media"
                className={inputClass}
                value={d.mediaType}
                onChange={(e) => set("mediaType", e.target.value as "photo" | "video")}
              >
                <option value="photo">Photo</option>
                <option value="video">Video</option>
              </select>
            </Field>
            {d.mediaType === "video" ? (
              <Field
                label="Max video length (s)"
                htmlFor="video-len"
                error={err("maxVideoSeconds")}
              >
                <input
                  id="video-len"
                  type="number"
                  min={1}
                  max={120}
                  className={inputClass}
                  value={d.maxVideoSeconds}
                  onChange={(e) => set("maxVideoSeconds", Number(e.target.value))}
                />
              </Field>
            ) : null}
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Where</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                navigator.geolocation?.getCurrentPosition((p) =>
                  setD((x) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude })),
                )
              }
            >
              Use my location
            </Button>
          </div>
          <p className="text-sm text-muted">
            Click the map to place the mission. Contributors must be inside the circle when they
            capture.
          </p>
          <LocationPickerMap
            value={{ lat: d.lat, lng: d.lng }}
            radius={d.radiusMeters}
            onChange={(p) => setD((x) => ({ ...x, lat: p.lat, lng: p.lng }))}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Latitude" htmlFor="lat" error={err("lat")}>
              <input
                id="lat"
                type="number"
                step="any"
                className={inputClass}
                value={d.lat}
                onChange={(e) => set("lat", Number(e.target.value))}
              />
            </Field>
            <Field label="Longitude" htmlFor="lng">
              <input
                id="lng"
                type="number"
                step="any"
                className={inputClass}
                value={d.lng}
                onChange={(e) => set("lng", Number(e.target.value))}
              />
            </Field>
            <Field
              label={`Radius: ${d.radiusMeters} m`}
              htmlFor="radius"
              error={err("radiusMeters")}
            >
              <input
                id="radius"
                type="range"
                min={10}
                max={2000}
                step={10}
                value={d.radiusMeters}
                onChange={(e) => set("radiusMeters", Number(e.target.value))}
                className="h-10 accent-[var(--accent-ink)]"
              />
            </Field>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Reward</h2>
          <Field
            label={`Reward per accepted capture (${token.symbol})`}
            htmlFor="reward"
            error={err("reward")}
          >
            <input
              id="reward"
              inputMode="decimal"
              className={inputClass}
              value={d.reward}
              onChange={(e) => set("reward", e.target.value)}
            />
          </Field>
          <Field label="Captures wanted" htmlFor="captures" error={err("maxCaptures")}>
            <input
              id="captures"
              type="number"
              min={1}
              max={1000}
              className={inputClass}
              value={d.maxCaptures}
              onChange={(e) => set("maxCaptures", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Minimum contributor tier"
            htmlFor="tier"
            hint={`Rewards above ${money(meta.tier1MaxReward, token)} always need Tier 2.`}
          >
            <select
              id="tier"
              className={inputClass}
              value={d.minTier}
              onChange={(e) => set("minTier", Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>Tier 1: Human Passport</option>
              <option value={2}>Tier 2: passport NFC (Self)</option>
            </select>
          </Field>
          <Field
            label="Deadline"
            htmlFor="deadline"
            error={err("deadline")}
            hint="Between 10 minutes and 90 days from now."
          >
            <input
              id="deadline"
              type="datetime-local"
              className={inputClass}
              value={d.deadline}
              onChange={(e) => set("deadline", e.target.value)}
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Summary</h2>
          {result.total !== null ? (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted">Escrow total</dt>
              <dd data-testid="total" className="font-semibold tabular-nums">
                {money(result.total, token)}
              </dd>
              <dt className="text-muted">Contributors</dt>
              <dd>Tier {result.tier}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Enter a reward and number of captures to see the total.
            </p>
          )}
          <p className="text-xs text-muted">
            You sign two transactions: approve {token.symbol}, then fund the escrow. A platform fee
            comes out of each paid reward; unused slots are refundable after the deadline.
          </p>
          {submitted && !result.spec ? (
            <Notice tone="error">Fix the highlighted fields.</Notice>
          ) : null}
          <Button type="submit" busy={busy}>
            Create and fund
          </Button>
        </Card>
      </div>
    </form>
  );
}
