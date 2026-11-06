import type { Metadata } from "next";

import { ContributorApp } from "@/components/contributor/contributor-app";

export const metadata: Metadata = { title: "Mission" };

/** The id is read on the client (useParams), so this page stays a static shell. */
export default function Page() {
  return <ContributorApp view="mission" />;
}

export function generateStaticParams() {
  return [{ id: "_" }];
}
