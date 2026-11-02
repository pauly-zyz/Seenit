import { z } from "zod";

import { createFunderSession, funderSessionCookie } from "@/server/auth/funder-sessions";
import { publicFunder, signInFunder } from "@/server/domain/dashboard";
import { json } from "@/server/json";
import { route } from "@/server/route";

const body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Dashboard sign-in (SIWE). Nonce from GET /api/auth/nonce. Sets an httpOnly session cookie. */
export const POST = route(
  { name: "funder.auth.verify", auth: "none", body, rateLimit: { limit: 10, windowSeconds: 60 } },
  async ({ body, services, now }) => {
    const funder = await signInFunder(
      services,
      { message: body.message, signature: body.signature as `0x${string}` },
      now,
    );
    const session = await createFunderSession(services.db, funder.id, now);
    const res = json({ funder: publicFunder(funder), expiresAt: session.expiresAt });
    res.headers.append("set-cookie", funderSessionCookie(session.token, session.expiresAt));
    return res;
  },
);
