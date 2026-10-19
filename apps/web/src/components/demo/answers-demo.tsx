"use client";

import { EyeOff, MapPin } from "lucide-react";
import { useState } from "react";

import { CodeBlock } from "@/components/ui/code-block";
import type { AnswerExample } from "@/content/answers";
import { cn } from "@/lib/cn";

import { Scene } from "./scenes";

export function AnswersDemo({ examples }: { examples: AnswerExample[] }) {
  const [active, setActive] = useState(0);
  const ex = examples[active] ?? examples[0];
  if (!ex) return null;

  return (
    <div>
      <div role="group" aria-label="Example captures" className="flex flex-wrap gap-2">
        {examples.map((e, i) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              i === active
                ? "border-foreground bg-foreground text-background"
                : "border-line bg-surface hover:bg-surface-2",
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <figure className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-line bg-surface-2">
          <Scene kind={ex.scene} />
          <figcaption className="sr-only">
            {ex.capture.media === "video" ? "Video" : "Photo"} captured {ex.capture.timestamp} at{" "}
            {ex.capture.gps}
          </figcaption>
          <div
            aria-hidden="true"
            className="absolute inset-0 flex flex-col justify-between p-3 sm:p-4"
          >
            <div className="flex items-start justify-between gap-2 font-mono text-[11px] text-white">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 backdrop-blur">
                <span
                  className={cn(
                    "size-2 rounded-full bg-rec",
                    ex.capture.media === "video" && "motion-safe:animate-blink",
                  )}
                />
                {ex.capture.media === "video" ? `REC ${ex.capture.duration ?? ""}` : "PHOTO"}
              </span>
              <span className="rounded-md bg-black/60 px-2 py-1 backdrop-blur">
                {ex.capture.timestamp}
              </span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2 font-mono text-[11px] text-white">
              <span className="inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 backdrop-blur">
                <MapPin className="size-3" /> {ex.capture.gps}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 backdrop-blur">
                <EyeOff className="size-3" /> faces & plates blurred
              </span>
            </div>
          </div>
        </figure>

        <CodeBlock
          code={JSON.stringify(ex.answer, null, 2)}
          lang="json"
          title={`answer.json · ${ex.label.toLowerCase()}`}
          className="h-full"
        />
      </div>
    </div>
  );
}
