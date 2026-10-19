import { z } from "zod";

export const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte hex address");

/**
 * Reward stablecoin config. The address must come from the official
 * Robinhood Chain docs for the target network, so it is read from env
 * instead of being hardcoded.
 */
export const rewardTokenConfigSchema = z.object({
  address: evmAddress,
  symbol: z.string().min(1).max(11),
  decimals: z.coerce.number().int().min(0).max(18),
});
export type RewardTokenConfig = z.infer<typeof rewardTokenConfigSchema>;

export function loadRewardTokenConfig(
  env: Record<string, string | undefined>,
): RewardTokenConfig {
  return rewardTokenConfigSchema.parse({
    address: env.REWARD_TOKEN_ADDRESS,
    symbol: env.REWARD_TOKEN_SYMBOL,
    decimals: env.REWARD_TOKEN_DECIMALS,
  });
}

/** "2.5" with 6 decimals -> 2500000n. Rejects more precision than the token supports. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error(`Invalid amount "${amount}"`);
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  if (frac.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimals`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** 2500000n with 6 decimals -> "2.5". */
export function formatBaseUnits(value: bigint, decimals: number): string {
  if (value < 0n) throw new Error("Negative amounts are not supported");
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
