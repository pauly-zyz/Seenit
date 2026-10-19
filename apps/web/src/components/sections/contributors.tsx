import { ArrowRight, Fingerprint, MapPinned, Video, type LucideIcon } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button-link";
import { Container } from "@/components/ui/container";
import { contributorSteps, type StepIcon } from "@/content/contributors";
import { site } from "@/content/site";

const icons: Record<StepIcon, LucideIcon> = { verify: Fingerprint, map: MapPinned, record: Video };

export function Contributors() {
  return (
    <section
      id="contributors"
      aria-labelledby="contributors-title"
      className="border-y border-line bg-[#0e1116] py-20 text-[#edeff2] sm:py-28 dark:bg-surface"
    >
      <Container>
        <Reveal className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-medium tracking-[0.14em] text-accent uppercase">
              For contributors
            </p>
            <h2
              id="contributors-title"
              className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl"
            >
              Your phone, your neighbourhood, your pay.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/70 sm:text-lg">
              Earn by capturing quick, useful proof near you. No pitching, no portfolio, just show
              up and record.
            </p>
          </div>
          <ButtonLink href={site.links.app} size="lg" className="shrink-0">
            Start earning <ArrowRight className="size-4" aria-hidden="true" />
          </ButtonLink>
        </Reveal>

        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {contributorSteps.map((s, i) => {
            const Icon = icons[s.icon];
            return (
              <li key={s.title} className="h-full">
                <Reveal
                  delay={i * 0.08}
                  className="flex h-full flex-col rounded-3xl border border-white/12 bg-white/[0.04] p-6"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-fg">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-sm text-white/55">0{i + 1}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/70">{s.body}</p>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
