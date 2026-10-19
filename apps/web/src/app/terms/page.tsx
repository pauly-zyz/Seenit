import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Terms" };

export default function Page() {
  return (
    <ComingSoon title="Terms" body="Our terms of service will be published here before launch." />
  );
}
