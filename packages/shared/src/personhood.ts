/** Mirrors PersonhoodRegistry tier constants. */
export const PersonhoodTier = {
  None: 0,
  /** Human Passport, Unique Humanity Score. Low-value missions. */
  Passport: 1,
  /** Self Protocol, NFC passport + ZK proof. All missions. */
  Self: 2,
} as const;
export type PersonhoodTier = (typeof PersonhoodTier)[keyof typeof PersonhoodTier];

/**
 * Same rule as MissionEscrow.createMission: at least Tier 1, and Tier 2 when
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
