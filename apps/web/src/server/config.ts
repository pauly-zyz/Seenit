import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  CHAIN_ID: z.coerce.number().int().positive().default(46630),
  RPC_URL: z.url(),
  MISSION_ESCROW_ADDRESS: address,
  PERSONHOOD_REGISTRY_ADDRESS: address,
  REWARD_TOKEN_ADDRESS: address,
  /** Backend signer with OPERATOR_ROLE on MissionEscrow. Use a KMS-backed signer in production. */
  OPERATOR_PRIVATE_KEY: privateKey,
  TIER1_MAX_REWARD: z.coerce.bigint().default(5_000_000n),
  INDEXER_START_BLOCK: z.coerce.bigint().default(0n),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  /** Host that SIWE messages must name, e.g. "seenit.xyz" or "localhost:3000". */
  SIWE_DOMAIN: z.string().min(1),
  /** Shared secret for /api/cron/* (sent as Bearer token). */
  CRON_SECRET: z.string().min(32),

  REWARD_TOKEN_SYMBOL: z.string().default("USDG"),
  REWARD_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),

  // --- Proof of personhood (each provider is enabled only when its config is complete) ---
  /** Backend signer with ATTESTER_ROLE on PersonhoodRegistry. Required for any provider. */
  ATTESTER_PRIVATE_KEY: privateKey.optional(),

  HUMAN_PASSPORT_API_URL: z.url().default("https://api.passport.xyz"),
  HUMAN_PASSPORT_API_KEY: z.string().min(1).optional(),
  HUMAN_PASSPORT_SCORER_ID: z.string().regex(/^\d+$/).optional(),
  HUMAN_PASSPORT_MIN_SCORE: z.coerce.number().positive().default(20),
  HUMAN_PASSPORT_TTL_DAYS: z.coerce.number().int().positive().default(90),

  SELF_APP_NAME: z.string().default("Seenit"),
  SELF_SCOPE: z
    .string()
    .regex(/^[\x20-\x7e]{1,31}$/, "max 31 ASCII characters")
    .optional(),
  SELF_ENDPOINT: z.url().startsWith("https://").optional(),
  SELF_MOCK_PASSPORT: z.stringbool().default(false),
  SELF_DEEPLINK_CALLBACK: z.string().default("seenit://personhood"),
  SELF_TTL_DAYS: z.coerce.number().int().positive().default(365),
});

export type AppConfig = {
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  chainId: number;
  rpcUrl: string;
  escrowAddress: `0x${string}`;
  registryAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  tier1MaxReward: bigint;
  indexerStartBlock: bigint;
  siweDomain: string;
  cronSecret: string;
  tokenSymbol: string;
  tokenDecimals: number;
};

export type ServerEnv = z.infer<typeof schema>;

export function parseEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${fields}`);
  }
  return result.data;
}

export function toAppConfig(env: ServerEnv): AppConfig {
  return {
    logLevel: env.LOG_LEVEL,
    chainId: env.CHAIN_ID,
    rpcUrl: env.RPC_URL,
    escrowAddress: env.MISSION_ESCROW_ADDRESS as `0x${string}`,
    registryAddress: env.PERSONHOOD_REGISTRY_ADDRESS as `0x${string}`,
    tokenAddress: env.REWARD_TOKEN_ADDRESS as `0x${string}`,
    tier1MaxReward: env.TIER1_MAX_REWARD,
    indexerStartBlock: env.INDEXER_START_BLOCK,
    siweDomain: env.SIWE_DOMAIN,
    cronSecret: env.CRON_SECRET,
    tokenSymbol: env.REWARD_TOKEN_SYMBOL,
    tokenDecimals: env.REWARD_TOKEN_DECIMALS,
  };
}
