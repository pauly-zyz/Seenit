import { z } from "zod";

const hex32 = /^0x[0-9a-fA-F]{64}$/;

const schema = z.object({
  /** Seenit API origin (apps/web). */
  SEENIT_API_URL: z.url(),
  /** Funder / agent API key used for every call. */
  SEENIT_API_KEY: z.string().min(1),
  /**
   * Optional funder wallet key. When set, confirm_mission / cancel_mission sign the on-chain
   * transactions themselves (after the user approves). Without it, they return the transactions
   * for the user to sign in their own wallet. Prefer a dedicated wallet holding only what agents
   * may spend.
   */
  SEENIT_FUNDER_PRIVATE_KEY: z
    .string()
    .regex(hex32, "must be a 0x-prefixed 32-byte hex key")
    .optional(),
  /** RPC for the funder wallet. Defaults to the chain's public RPC from the official docs. */
  SEENIT_RPC_URL: z.url().optional(),
  /** Max escrow per mission the server will fund, in token units (e.g. "50"). */
  SEENIT_MAX_SPEND: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),

  /** Streamable HTTP transport. */
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Bearer token clients must send to the HTTP endpoint. Required when not bound to localhost. */
  MCP_HTTP_TOKEN: z.string().min(24).optional(),
  /** Extra hostnames allowed in the Host header (when behind a proxy / custom domain). */
  MCP_HTTP_ALLOWED_HOSTS: z.string().optional(),
});

export type McpEnv = z.infer<typeof schema>;

export function parseEnv(env: Record<string, string | undefined> = process.env): McpEnv {
  const r = schema.safeParse(env);
  if (!r.success) {
    const fields = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid Seenit MCP configuration: ${fields}`);
  }
  return r.data;
}
