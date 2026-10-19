import { BadgeCheck, Camera, CheckCircle2, Clock, Link2, MapPin, Wallet } from "lucide-react";

import { site } from "@/content/site";

/** Reward bubbles on the mock map: [x, y, amount]. */
const PINS: Array<[number, number, string]> = [
  [58, 70, "3.00"],
  [196, 52, "4.00"],
  [210, 168, "2.50"],
  [44, 188, "12.00"],
];

/**
 * Hero phone showing the Seenit contributor app. Pure markup + CSS animation
 * (no client JS), so it costs nothing to hydrate.
 */
export function PhoneMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[340px] lg:max-w-none">
      <div
        role="img"
        aria-label="The Seenit app: a map of nearby paid missions and a mission card with a Record proof button"
        className="relative mx-auto w-[290px] motion-safe:animate-float"
      >
        <div
          aria-hidden="true"
          className="rounded-[46px] bg-foreground p-[9px] shadow-[0_40px_80px_-30px_rgba(14,17,22,0.55)]"
        >
          <div className="relative h-[590px] overflow-hidden rounded-[38px] bg-background">
            {/* status bar */}
            <div className="flex items-center justify-between px-6 pt-3.5 text-[11px] font-semibold">
              <span>9:41</span>
              <span className="h-5 w-20 rounded-full bg-foreground" />
              <span className="flex gap-0.5">
                <span className="h-2 w-1 rounded-sm bg-foreground" />
                <span className="h-2 w-1 rounded-sm bg-foreground" />
                <span className="h-2 w-1 rounded-sm bg-foreground/40" />
              </span>
            </div>

            {/* header */}
            <div className="flex items-center justify-between px-5 pt-4">
              <div>
                <p className="text-[11px] text-muted">Within 1 km</p>
                <p className="text-[17px] font-semibold tracking-tight">Nearby missions</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold">
                <Wallet className="size-3" />
                42.50 {site.rewardSymbol}
              </span>
            </div>

            {/* map */}
            <div className="relative mx-4 mt-3 h-[236px] overflow-hidden rounded-3xl border border-line bg-surface-2">
              <svg viewBox="0 0 258 236" className="absolute inset-0 size-full">
                <rect x="150" y="96" width="90" height="56" rx="10" className="fill-verify/15" />
                <path
                  d="M-10 150 C 60 120, 120 200, 270 160"
                  className="fill-none stroke-verify/25"
                  strokeWidth="14"
                />
                <g className="stroke-surface" strokeWidth="9" strokeLinecap="round">
                  <path d="M0 40 H258" />
                  <path d="M0 118 H258" />
                  <path d="M86 0 V236" />
                  <path d="M170 0 V236" />
                </g>
                <g className="stroke-line" strokeWidth="1.5">
                  <path d="M0 80 H258" />
                  <path d="M0 200 H258" />
                  <path d="M40 0 V236" />
                  <path d="M128 0 V236" />
                  <path d="M220 0 V236" />
                </g>
              </svg>
              {PINS.map(([x, y, amount]) => (
                <span
                  key={amount}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background shadow"
                  style={{ left: x, top: y }}
                >
                  {amount}
                </span>
              ))}
              {/* selected mission pin */}
              <span className="absolute top-[118px] left-[128px] -translate-x-1/2 -translate-y-full">
                <span className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-fg shadow-lg">
                  <MapPin className="size-3" />
                  1.50
                </span>
              </span>
              {/* you are here */}
              <span className="absolute top-[156px] left-[104px] flex size-4 items-center justify-center">
                <span className="absolute size-full rounded-full bg-verify/40 motion-safe:animate-ping-slow" />
                <span className="size-3 rounded-full border-2 border-surface bg-verify" />
              </span>
            </div>

            {/* mission sheet */}
            <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-line bg-surface px-5 pt-3 pb-6 shadow-[0_-12px_30px_-20px_rgba(0,0,0,0.35)]">
              <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-line" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold tracking-tight">Is Luna Bakery open?</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                    <MapPin className="size-3" /> Orchard Ave · 120 m away
                  </p>
                </div>
                <span className="rounded-lg bg-accent px-2 py-1 text-[12px] font-bold whitespace-nowrap text-accent-fg">
                  +1.50
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10.5px] font-medium">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
                  <Clock className="size-3" /> 45 min left
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
                  <Camera className="size-3" /> 1 photo
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-verify">
                  <BadgeCheck className="size-3" /> Tier 1
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-snug text-muted">
                Capture the entrance and any posted notice. Answer: is_open, sign_text.
              </p>
              <span className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-foreground text-[13px] font-semibold text-background">
                <span className="size-2.5 rounded-full bg-rec" />
                Record proof
              </span>
            </div>

            {/* payout toast */}
            <div className="absolute inset-x-4 top-11 flex items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2.5 shadow-lg backdrop-blur motion-safe:animate-pop motion-reduce:hidden">
              <CheckCircle2 className="size-5 shrink-0 text-verify" />
              <div className="text-[11px] leading-tight">
                <p className="font-semibold">Shelf check accepted</p>
                <p className="text-muted">+3.00 {site.rewardSymbol} sent to your wallet</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* floating proof cards (decorative) */}
      <div
        aria-hidden="true"
        className="absolute top-24 -left-4 hidden rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-xl [animation-delay:-2s] motion-safe:animate-float sm:block lg:-left-10"
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <BadgeCheck className="size-4 text-verify" /> Human-verified
        </p>
        <p className="mt-0.5 text-[11px] text-muted">One person, one account</p>
      </div>
      <div
        aria-hidden="true"
        className="absolute -right-2 bottom-28 hidden rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-xl [animation-delay:-4s] motion-safe:animate-float sm:block lg:-right-6"
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Link2 className="size-4 text-accent-ink" /> Hash anchored
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">0x9f2c…e81a</p>
      </div>
    </div>
  );
}
