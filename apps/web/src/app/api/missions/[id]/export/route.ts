import { exportRows, toCsv, toJson, type ExportScope } from "@/server/domain/export";
import { route } from "@/server/route";

/** Download results: ?format=json|csv (default json), ?scope=accepted|all (default accepted). */
export const GET = route<"funder", undefined, { id: string }>(
  { name: "missions.export", auth: "funder", rateLimit: { limit: 30, windowSeconds: 60 } },
  async ({ params, url, auth, services }) => {
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const scope: ExportScope = url.searchParams.get("scope") === "all" ? "all" : "accepted";
    const data = await exportRows(services, auth.funder.id, params.id, scope);
    const name = `seenit-${data.mission.id.slice(0, 8)}-${scope}.${format}`;
    const body = format === "csv" ? toCsv(data) : JSON.stringify(toJson(data), null, 2);
    return new Response(body, {
      headers: {
        "content-type":
          format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  },
);
