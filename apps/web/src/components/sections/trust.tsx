import { Crosshair, Link2, ScanFace, UserCheck, type LucideIcon } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { trustPoints, type TrustIcon } from "@/content/trust";

const icons: Record<TrustIcon, LucideIcon> = {
  gps: Crosshair,
  chain: Link2,
  blur: ScanFace,
  human: UserCheck,
};

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            id="trust-title"
            eyebrow="Built for trust"
            title="Proof you can check, privacy you can count on."
            align="center"
          />
        </Reveal>
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trustPoints.map((t, i) => {
            const Icon = icons[t.icon];
            return (
              <li key={t.title} className="h-full">
                <Reveal
                  delay={i * 0.06}
                  className="h-full rounded-3xl border border-line bg-surface p-6"
                >
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-accent-ink">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 font-semibold">{t.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
