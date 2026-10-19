import { Agents } from "@/components/sections/agents";
import { Answers } from "@/components/sections/answers";
import { Contributors } from "@/components/sections/contributors";
import { Developers } from "@/components/sections/developers";
import { Hero } from "@/components/sections/hero";
import { Trust } from "@/components/sections/trust";

export default function Home() {
  return (
    <main>
      <Hero />
      <Agents />
      <Answers />
      <Developers />
      <Contributors />
      <Trust />
    </main>
  );
}
