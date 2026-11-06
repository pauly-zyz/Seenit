import type { Metadata } from "next";
import { Suspense } from "react";

import { ContributorProviders } from "@/components/contributor/providers";

export const metadata: Metadata = {
  title: { default: "Seenit app", template: "%s · Seenit app" },
  description: "Paid photo and video missions near you. Capture, verify, get paid in stablecoins.",
};

/** The contributor web app (wallet, camera, GPS) renders in the browser. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ContributorProviders>
      <Suspense fallback={<p className="py-20 text-center text-muted">Loading…</p>}>
        {children}
      </Suspense>
    </ContributorProviders>
  );
}
