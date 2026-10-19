import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Seenit app" };

export default function Page() {
  return (
    <ComingSoon
      title="Seenit app"
      body="The contributor app for iOS and Android is in development."
    />
  );
}
