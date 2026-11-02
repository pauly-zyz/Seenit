import type { Metadata } from "next";

import { DashboardApp } from "@/components/dashboard/dashboard-app";

export const metadata: Metadata = { title: "Mission" };

/** The id is read on the client (useParams), so this page stays a static shell. */
export default function Page() {
  return <DashboardApp view="mission" />;
}

export function generateStaticParams() {
  return [{ id: "_" }];
}
