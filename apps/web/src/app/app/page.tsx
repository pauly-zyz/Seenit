import type { Metadata } from "next";

import { ContributorApp } from "@/components/contributor/contributor-app";

export const metadata: Metadata = { title: "Missions near you" };

export default function Page() {
  return <ContributorApp view="missions" />;
}
