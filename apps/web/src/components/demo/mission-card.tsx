import { BadgeCheck, Camera, Clock, MapPin, Radius, Video } from "lucide-react";

import { site } from "@/content/site";
import type { MissionDraft } from "@/content/use-cases";

import { proofLabel, tierLabel } from "./mission-meta";

/** The live mission as contributors see it, shown at the end of each demo. */
export function MissionCard({ draft, nearby }: { draft: MissionDraft; nearby: number }) {
  const MediaIcon = draft.media === "video" ? Video : Camera;
  return (
    <article
      aria-label={`Live mission: ${draft.title}`}
      className="rounded-2xl border border-line bg-surface p-4 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.5)] sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-verify/12 px-2.5 py-1 text-xs font-semibold text-verify">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full rounded-full bg-verify opacity-60 motion-safe:animate-ping-slow" />
            <span className="relative inline-flex size-2 rounded-full bg-verify" />
          </span>
          Live
        </span>
        <span className="text-xs text-muted">{nearby} contributors nearby</span>
      </div>

      <h3 className="mt-3 text-lg font-semibold tracking-tight">{draft.title}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <MapPin className="size-3.5" aria-hidden="true" />
        {draft.place}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3">
        <p>
          <span className="text-2xl font-semibold tracking-tight">{draft.reward}</span>{" "}
          <span className="text-sm font-medium text-muted">{site.rewardSymbol} / capture</span>
        </p>
        <p className="text-xs text-muted">0 of {draft.slots} captured</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full w-[6%] rounded-full bg-accent" />
      </div>

      <ul className="mt-4 flex flex-wrap gap-1.5 text-xs font-medium">
        <li className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
          <MediaIcon className="size-3.5" aria-hidden="true" /> {proofLabel(draft)}
        </li>
        <li className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
          <Radius className="size-3.5" aria-hidden="true" /> {draft.radiusMeters} m radius
        </li>
        <li className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
          <Clock className="size-3.5" aria-hidden="true" /> {draft.expiresIn}
        </li>
        <li className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-verify">
          <BadgeCheck className="size-3.5" aria-hidden="true" /> {tierLabel(draft.tier)}
        </li>
      </ul>
    </article>
  );
}
