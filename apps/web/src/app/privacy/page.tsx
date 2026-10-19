import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Privacy" };

export default function Page() {
  return (
    <ComingSoon title="Privacy" body="Our privacy policy will be published here before launch." />
  );
}
