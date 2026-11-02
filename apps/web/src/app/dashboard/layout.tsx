import type { Metadata } from "next";
import { Suspense } from "react";

import { DashboardProviders } from "@/components/dashboard/providers";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

/** The dashboard is a client app (wallet, maps): the server sends a shell, the browser renders it. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <Suspense fallback={<p className="py-20 text-center text-muted">Loading…</p>}>
        {children}
      </Suspense>
    </DashboardProviders>
  );
}
