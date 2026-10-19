/** Mirrors PersonhoodRegistry tier constants. */
export const PersonhoodTier = {
  None: 0,
  /** Human Passport, Unique Humanity Score. Low-value missions. */
  Passport: 1,
  /** Self Protocol, NFC passport + ZK proof. All missions. */
  Self: 2,
} as const;
export type PersonhoodTier = (typeof PersonhoodTier)[keyof typeof PersonhoodTier];

/** Mirrors PersonhoodRegistry.Provider (values are the on-chain enum indexes). */
export const PersonhoodProvider = {
  None: 0,
  HumanPassport: 1,
  Self: 2,
} as const;
export type PersonhoodProvider = (typeof PersonhoodProvider)[keyof typeof PersonhoodProvider];

/** Same as PersonhoodRegistry.tierForProvider: the tier is fixed by the provider. */
export function tierForProvider(provider: PersonhoodProvider): PersonhoodTier {
  if (provider === PersonhoodProvider.Self) return PersonhoodTier.Self;
  if (provider === PersonhoodProvider.HumanPassport) return PersonhoodTier.Passport;
  return PersonhoodTier.None;
}

/**
 * Same rule as MissionEscrow.requiredTier / createMission: at least Tier 1, and Tier 2 when
 * the per-submission reward is above the Tier 1 cap.
 */
export function requiredTier(
  rewardBaseUnits: bigint,
  tier1MaxReward: bigint,
  requested: PersonhoodTier = PersonhoodTier.Passport,
): PersonhoodTier {
  if (rewardBaseUnits > tier1MaxReward) return PersonhoodTier.Self;
  return requested < PersonhoodTier.Passport ? PersonhoodTier.Passport : requested;
}

/** Database / API identifiers for personhood providers (snake_case, stable). */
export const PERSONHOOD_PROVIDER_IDS = ["human_passport", "self"] as const;
export type PersonhoodProviderId = (typeof PERSONHOOD_PROVIDER_IDS)[number];

export interface TierAccess {
  tier: 1 | 2;
  name: string;
  /** How a contributor gets this tier. */
  howToVerify: string;
  /** Which missions this tier opens, in plain words. */
  unlocks: string;
  unlocked: boolean;
}

/**
 * Plain-language explanation of each tier for a contributor at `currentTier`.
 * Mirrors the escrow rule: Tier 1 opens missions paying up to tier1MaxReward per capture,
 * Tier 2 opens every mission.
 */
export function describeTierAccess(
  currentTier: number,
  opts: { tier1MaxReward: bigint; decimals: number; symbol: string },
): TierAccess[] {
  const cap = formatAmount(opts.tier1MaxReward, opts.decimals);
  return [
    {
      tier: 1,
      name: "Verified human",
      howToVerify: "Reach the required Unique Humanity Score on Human Passport.",
      unlocks: `Missions paying up to ${cap} ${opts.symbol} per capture.`,
      unlocked: currentTier >= 1,
    },
    {
      tier: 2,
      name: "ID-verified human",
      howToVerify:
        "Scan your passport's NFC chip in the Self app. Only a zero-knowledge proof is shared.",
      unlocks: `All missions, including those paying more than ${cap} ${opts.symbol} per capture.`,
      unlocked: currentTier >= 2,
    },
  ];
}

function formatAmount(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac.padEnd(2, "0")}` : `${whole}.00`;
}
