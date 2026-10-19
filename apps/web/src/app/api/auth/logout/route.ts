import { deleteSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { json } from "@/server/json";
import { route } from "@/server/route";

export const POST = route(
  { name: "auth.logout", auth: "contributor" },
  async ({ req, services }) => {
    const header = req.headers.get("authorization");
    const token =
      header?.slice(7) ??
      req.headers
        .get("cookie")
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
        ?.split("=")[1];
    if (token) await deleteSession(services.db, token);
    const res = json({ ok: true });
    res.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    return res;
  },
);
