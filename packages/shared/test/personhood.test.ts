import { describe, expect, it } from "vitest";

import { PersonhoodTier, requiredTier } from "../src/index.js";

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
