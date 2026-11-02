import {
  clearFunderSessionCookie,
  deleteFunderSession,
  FUNDER_SESSION_COOKIE,
} from "@/server/auth/funder-sessions";
import { json } from "@/server/json";
import { route } from "@/server/route";

export const POST = route(
  { name: "funder.auth.logout", auth: "funderSession" },
  async ({ req, services }) => {
    const token = req.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${FUNDER_SESSION_COOKIE}=`))
      ?.slice(FUNDER_SESSION_COOKIE.length + 1);
    if (token) await deleteFunderSession(services.db, token);
    const res = json({ ok: true });
    res.headers.append("set-cookie", clearFunderSessionCookie);
    return res;
  },
);
