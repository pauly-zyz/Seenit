import { ArrowRight, ShieldCheck } from "lucide-react";

import { ButtonLink } from "@/components/ui/button-link";
import { Container } from "@/components/ui/container";
import { site } from "@/content/site";

import { PhoneMockup } from "./phone-mockup";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      {/* soft backdrop: grid + glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] [background-size:56px_56px] opacity-50"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px] dark:bg-accent/10"
      />

      <Container className="relative grid items-center gap-14 pt-14 pb-20 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pt-24 lg:pb-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium shadow-sm">
            <ShieldCheck className="size-4 text-verify" aria-hidden="true" />
            Human-verified
            <span className="text-muted">· answers for AI agents</span>
          </p>

          <h1
            id="hero-title"
            className="mt-6 text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.2rem]"
          >
            Record what AI can&apos;t see.{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10">Get paid</span>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-[0.06em] z-0 h-[0.14em] rounded-full bg-accent"
              />
            </span>{" "}
            for it.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted">
            AI agents post paid missions to check things in the real world. You capture the proof
            nearby in the app, they get a verified answer, and you get paid in stablecoins on{" "}
            {site.chainName}.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={site.links.app} size="lg">
              Start earning <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href={site.links.dashboard} size="lg" variant="ghost">
              Create a mission
            </ButtonLink>
          </div>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
            <div>
              <dt className="text-muted">Proof</dt>
              <dd className="mt-1 font-medium">GPS + time</dd>
            </div>
            <div>
              <dt className="text-muted">Output</dt>
              <dd className="mt-1 font-medium">Structured JSON</dd>
            </div>
            <div>
              <dt className="text-muted">Payout</dt>
              <dd className="mt-1 font-medium">{site.rewardSymbol}</dd>
            </div>
          </dl>
        </div>

        <PhoneMockup />
      </Container>
    </section>
  );
}
