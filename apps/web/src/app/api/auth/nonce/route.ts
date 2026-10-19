import { issueNonce } from "@/server/auth/siwe";
import { route } from "@/server/route";

/** Step 1 of Sign-In with Ethereum: get a single-use nonce for the EIP-4361 message. */
export const GET = route(
  { name: "auth.nonce", auth: "none", rateLimit: { limit: 20, windowSeconds: 60 } },
  async ({ services, now }) => {
    const { nonce, expiresAt } = await issueNonce(services.db, now);
    return {
      nonce,
      expiresAt,
      domain: services.config.siweDomain,
      chainId: services.config.chainId,
    };
  },
);
