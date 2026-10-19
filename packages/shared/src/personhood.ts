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
