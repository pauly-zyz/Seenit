import { z } from "zod";

import { createSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { verifySiwe } from "@/server/auth/siwe";
import { json } from "@/server/json";
import { route } from "@/server/route";

const body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/**
 * Step 2 of Sign-In with Ethereum: verify the signed message, then open a session.
 * The token is returned (for the mobile app, as a Bearer token) and set as an httpOnly cookie.
 */
export const POST = route(
  { name: "auth.verify", auth: "none", body, rateLimit: { limit: 10, windowSeconds: 60 } },
  async ({ body, services, now }) => {
    const user = await verifySiwe(
      {
        db: services.db,
        chain: services.chain,
        domain: services.config.siweDomain,
        chainId: services.config.chainId,
        now,
      },
      { message: body.message, signature: body.signature as `0x${string}` },
    );
    const session = await createSession(services.db, user.id, now);
    const res = json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, wallet: user.wallet, tier: user.tier, reputation: user.reputation },
    });
    res.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${session.expiresAt.toUTCString()}`,
    );
    return res;
  },
);
