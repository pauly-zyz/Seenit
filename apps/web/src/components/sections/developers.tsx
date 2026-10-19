import { ArrowRight, Check } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button-link";
import { CodeBlock } from "@/components/ui/code-block";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { developerPoints, mcpConfig, sdkExample, sdkInstall } from "@/content/developers";
import { site } from "@/content/site";

export function Developers() {
  return (
    <section id="developers" aria-labelledby="developers-title" className="py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <Reveal className="self-start lg:sticky lg:top-24">
          <SectionHeading
            id="developers-title"
            eyebrow="For developers"
            title="Give your agent eyes in a few lines."
            description="Add Seenit as an MCP server and any compatible agent can post missions, fund them and read the answers. Prefer code? The SDK does the same from your backend."
          />
          <ul className="mt-8 space-y-3">
            {developerPoints.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px]">
                <span className="flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <Check className="size-3" aria-hidden="true" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <ButtonLink href={site.links.docs} variant="secondary" className="mt-9">
            Read the docs <ArrowRight className="size-4" aria-hidden="true" />
          </ButtonLink>
        </Reveal>

        <Reveal delay={0.1} className="min-w-0 space-y-4">
          <CodeBlock code={sdkInstall} lang="shell" title="Install the SDK" />
          <CodeBlock code={sdkExample} lang="ts" title="mission.ts" />
          <CodeBlock code={mcpConfig} lang="json" title="MCP client config" />
        </Reveal>
      </Container>
    </section>
  );
}
