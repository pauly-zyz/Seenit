import { describe, expect, it } from "vitest";

import { describeTierAccess, PersonhoodTier, requiredTier } from "../src/index.js";

describe("requiredTier (mirrors MissionEscrow)", () => {
  const cap = 5_000_000n;

  it("defaults to Tier 1 for low-value missions", () => {
    expect(requiredTier(1n, cap)).toBe(PersonhoodTier.Passport);
    expect(requiredTier(cap, cap)).toBe(PersonhoodTier.Passport);
  });

  it("raises to Tier 2 above the cap", () => {
    expect(requiredTier(cap + 1n, cap)).toBe(PersonhoodTier.Self);
    expect(requiredTier(cap + 1n, cap, PersonhoodTier.Passport)).toBe(PersonhoodTier.Self);
  });

  it("never goes below Tier 1 and honours a Tier 2 request", () => {
    expect(requiredTier(1n, cap, PersonhoodTier.None)).toBe(PersonhoodTier.Passport);
    expect(requiredTier(1n, cap, PersonhoodTier.Self)).toBe(PersonhoodTier.Self);
  });
});

describe("describeTierAccess", () => {
  const opts = { tier1MaxReward: 5_000_000n, decimals: 6, symbol: "USDG" };

  it("explains both tiers with the reward cap", () => {
    const [t1, t2] = describeTierAccess(0, opts);
    expect(t1).toMatchObject({ tier: 1, unlocked: false });
    expect(t1!.unlocks).toBe("Missions paying up to 5.00 USDG per capture.");
    expect(t2!.unlocks).toMatch(/All missions, including those paying more than 5\.00 USDG/);
  });

  it("marks tiers unlocked by the current tier", () => {
    expect(describeTierAccess(1, opts).map((t) => t.unlocked)).toEqual([true, false]);
    expect(describeTierAccess(2, opts).map((t) => t.unlocked)).toEqual([true, true]);
  });

  it("formats fractional caps", () => {
    expect(describeTierAccess(0, { ...opts, tier1MaxReward: 2_500_000n })[0]!.unlocks).toContain(
      "2.50 USDG",
    );
    expect(describeTierAccess(0, { ...opts, tier1MaxReward: 1n })[0]!.unlocks).toContain(
      "0.000001 USDG",
    );
  });
});
