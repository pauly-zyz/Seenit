import type { Metadata } from "next";

import { DashboardApp } from "@/components/dashboard/dashboard-app";

export const metadata: Metadata = { title: "API keys" };

export default function Page() {
  return <DashboardApp view="keys" />;
}
