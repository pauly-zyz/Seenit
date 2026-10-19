import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <ComingSoon
      title="Dashboard"
      body="Create, fund and track missions from one place. The funder dashboard is on its way."
    />
  );
}
