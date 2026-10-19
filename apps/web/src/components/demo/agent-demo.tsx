"use client";

import { Bot, CheckCircle2, RotateCcw } from "lucide-react";
import { useInView, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";

import { site } from "@/content/site";
import { escrowTotal, type UseCase } from "@/content/use-cases";
import { cn } from "@/lib/cn";

import { DraftCard } from "./draft-card";
import { MissionCard } from "./mission-card";
import { useCaseIcons } from "./mission-meta";

/**
 * Conversation steps:
 * 0 user asks · 1 agent typing · 2 agent drafts mission · 3 user approves
 * 4 agent typing · 5 escrow funded · 6 live mission card
 */
export const LAST_STEP = 6;
/** How long each step stays before the next one appears (ms). */
export const STEP_DELAYS = [700, 1100, 1700, 1000, 900, 900] as const;

export function AgentDemo({ useCases }: { useCases: UseCase[] }) {
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inView = useInView(rootRef, { once: true, amount: 0.3 });

  const current = useCases[active] ?? useCases[0];
  const shown = reduceMotion ? LAST_STEP : step;

  // Advance the conversation once the demo is on screen.
  useEffect(() => {
    if (reduceMotion || !inView || step >= LAST_STEP) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_DELAYS[step]);
    return () => clearTimeout(t);
  }, [step, inView, reduceMotion, active, run]);

  // Keep the newest message in view inside the chat window (never scrolls the page).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [shown, active, reduceMotion]);

  if (!current) return null;

  function select(i: number) {
    setActive(i);
    setStep(0);
    setRun((r) => r + 1);
  }

  function onTabKey(e: React.KeyboardEvent, i: number) {
    const last = useCases.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % useCases.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + useCases.length) % useCases.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }

  const key = `${current.id}-${run}`;
  const enter = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <div ref={rootRef} className="grid gap-6 lg:grid-cols-[260px_1fr] lg:gap-10">
      {/* use case tabs */}
      <div
        role="tablist"
        aria-label="Use cases"
        className="-mx-5 flex [scrollbar-width:none] gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
      >
        {useCases.map((uc, i) => {
          const Icon = useCaseIcons[uc.icon];
          const selected = i === active;
          return (
            <button
              key={uc.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`usecase-tab-${uc.id}`}
              aria-selected={selected}
              aria-controls="usecase-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none lg:w-full",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-line bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  selected ? "bg-accent text-accent-fg" : "bg-surface-2",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="whitespace-nowrap">{uc.label}</span>
            </button>
          );
        })}
      </div>

      {/* chat window */}
      <div
        id="usecase-panel"
        role="tabpanel"
        aria-labelledby={`usecase-tab-${current.id}`}
        className="overflow-hidden rounded-3xl border border-line bg-background shadow-[0_30px_60px_-40px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Your agent</p>
              <p className="text-xs text-muted">connected to Seenit via MCP</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => select(active)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> Replay
          </button>
        </div>

        <div
          ref={scrollRef}
          className="h-[540px] space-y-4 overflow-y-auto px-4 py-5 sm:h-[580px] sm:px-6"
          aria-live="polite"
        >
          <m.div key={`${key}-ask`} {...enter} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-[15px] leading-relaxed text-background">
              {current.ask}
            </p>
          </m.div>

          {shown === 1 || shown === 4 ? <Typing key={`${key}-typing-${shown}`} /> : null}

          {shown >= 2 ? (
            <m.div key={`${key}-plan`} {...enter} className="max-w-[92%] sm:max-w-[85%]">
              <div className="rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3 text-[15px] leading-relaxed">
                {current.plan}
                <DraftCard draft={current.draft} />
              </div>
            </m.div>
          ) : null}

          {shown >= 3 ? (
            <m.div key={`${key}-approve`} {...enter} className="flex justify-end">
              <p className="inline-flex items-center gap-2 rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-[15px] text-background">
                <CheckCircle2 className="size-4 text-accent" aria-hidden="true" />
                {current.approve}
              </p>
            </m.div>
          ) : null}

          {shown >= 5 ? (
            <m.p
              key={`${key}-live`}
              {...enter}
              className="mx-auto w-fit rounded-full border border-line bg-surface px-3.5 py-1.5 text-center text-xs text-muted"
            >
              Escrow funded · {escrowTotal(current.draft)} {site.rewardSymbol} locked on{" "}
              {site.chainName} · mission is live
            </m.p>
          ) : null}

          {shown >= 6 ? (
            <m.div key={`${key}-card`} {...enter}>
              <MissionCard draft={current.draft} nearby={current.nearby} />
            </m.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Typing() {
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3.5"
      aria-label="Agent is typing"
      role="status"
    >
      {[0, 1, 2].map((i) => (
        <m.span
          key={i}
          className="size-1.5 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </m.div>
  );
}
