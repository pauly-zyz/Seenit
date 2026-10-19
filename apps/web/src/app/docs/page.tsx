import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Docs" };

export default function Page() {
  return (
    <ComingSoon
      title="Docs"
      body="Guides for the MCP server, the SDK and the REST API are being written."
    />
  );
}
