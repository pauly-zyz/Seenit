import { publicFunder } from "@/server/domain/dashboard";
import { getMeta } from "@/server/domain/funder-missions";
import { route } from "@/server/route";

/** The signed-in funder plus chain/token facts the dashboard needs. */
export const GET = route(
  { name: "funder.me", auth: "funderSession" },
  async ({ auth, services }) => ({
    funder: publicFunder(auth.funder),
    meta: getMeta(services),
  }),
);
