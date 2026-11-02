import { assertUuid } from "@/server/domain/contributor";
import { revokeApiKey } from "@/server/domain/dashboard";
import { route } from "@/server/route";

/** Revoke a key. Requests using it fail from now on. */
export const DELETE = route<"funderSession", undefined, { id: string }>(
  { name: "funder.api-keys.revoke", auth: "funderSession" },
  async ({ auth, params, services, now }) => {
    assertUuid(params.id);
    return revokeApiKey(services.db, auth.funder.id, params.id, now);
  },
);
