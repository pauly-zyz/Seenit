import { OUTPUT_SCHEMA_TEMPLATES, OUTPUT_TEMPLATE_IDS } from "@seenit/shared";

import { route } from "@/server/route";

/** Ready-made output schemas (stock_check, store_open, ...) to start a mission from. */
export const GET = route(
  { name: "mission-templates.list", auth: "none", rateLimit: { limit: 120, windowSeconds: 60 } },
  async () => ({ templates: OUTPUT_TEMPLATE_IDS.map((id) => OUTPUT_SCHEMA_TEMPLATES[id]) }),
);
