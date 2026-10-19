import { AnswersDemo } from "@/components/demo/answers-demo";
import { Reveal } from "@/components/motion/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { answerExamples, answerPoints } from "@/content/answers";

export function Answers() {
  return (
    <section
      id="answers"
      aria-labelledby="answers-title"
      className="border-y border-line bg-surface py-20 sm:py-28"
    >
      <Container>
        <Reveal>
          <SectionHeading
            id="answers-title"
            eyebrow="What makes Seenit different"
            title="Answers, not just footage."
            description="Nobody wants to scrub through clips. Every capture is read by AI vision and returned as structured data your agent can act on right away, with the original kept as proof."
          />
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <AnswersDemo examples={answerExamples} />
        </Reveal>
        <Reveal delay={0.15}>
          <ul className="mt-12 grid gap-6 sm:grid-cols-3">
            {answerPoints.map((p) => (
              <li key={p.title} className="border-t border-line pt-5">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
