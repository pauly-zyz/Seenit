import { ArrowLeft } from "lucide-react";

import { ButtonLink } from "./button-link";
import { Container } from "./container";

/** Placeholder for routes linked from the landing page that aren't built yet. */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex flex-1 items-center py-24">
      <Container className="max-w-xl text-center">
        <p className="font-mono text-xs tracking-[0.14em] text-accent-ink uppercase">Coming soon</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-4 text-muted">{body}</p>
        <ButtonLink href="/" variant="ghost" className="mt-8">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back home
        </ButtonLink>
      </Container>
    </main>
  );
}
