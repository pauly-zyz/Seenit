import { AgentDemo } from "@/components/demo/agent-demo";
import { Reveal } from "@/components/motion/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { useCases } from "@/content/use-cases";

export function Agents() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            id="agents-title"
            eyebrow="For agents & funders"
            title="Ask a question about the real world. Your agent posts the mission."
            description="Tell your agent what you need to know. It drafts a paid mission with the right location, proof and reward, you approve it, and verified people nearby get to work."
          />
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <AgentDemo useCases={useCases} />
        </Reveal>
      </Container>
    </section>
  );
}
