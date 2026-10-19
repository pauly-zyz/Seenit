import { PersonhoodTier, requiredTier, toBaseUnits } from "@seenit/shared";
import { describe, expect, it } from "vitest";

import { answerExamples } from "./answers";
import { escrowTotal, useCases } from "./use-cases";

/** Must match TIER1_MAX_REWARD used for the escrow deployment (5 USD, 6 decimals). */
const TIER1_MAX_REWARD = 5_000_000n;

describe("use cases", () => {
  it("has the five demo tabs with unique ids", () => {
    expect(useCases.map((u) => u.label)).toEqual([
      "Store stock check",
      "Construction progress",
      "Is it open?",
      "Billboard proof",
      "Event crowd",
    ]);
    expect(new Set(useCases.map((u) => u.id)).size).toBe(useCases.length);
  });

  it.each(useCases.map((u) => [u.id, u] as const))("%s is a valid mission", (_, u) => {
    const d = u.draft;
    expect(d.reward).toMatch(/^\d+\.\d{2}$/);
    expect(d.slots).toBeGreaterThan(0);
    expect(d.radiusMeters).toBeGreaterThanOrEqual(10);
    expect(d.radiusMeters).toBeLessThanOrEqual(5000);
    expect(d.answerFields.length).toBeGreaterThan(0);
    if (d.media === "video") expect(d.videoSeconds).toBeGreaterThan(0);
    // The tier shown in the demo must follow the on-chain escrow rule.
    const tier = requiredTier(toBaseUnits(d.reward, 6), TIER1_MAX_REWARD, PersonhoodTier.Passport);
    expect(d.tier).toBe(tier);
  });
});

describe("escrowTotal", () => {
  it("multiplies reward by slots without float drift", () => {
    expect(escrowTotal({ reward: "3.00", slots: 2 })).toBe("6.00");
    expect(escrowTotal({ reward: "1.50", slots: 3 })).toBe("4.50");
    expect(escrowTotal({ reward: "0.10", slots: 3 })).toBe("0.30");
    expect(escrowTotal({ reward: "2.5", slots: 3 })).toBe("7.50");
    expect(escrowTotal({ reward: "12", slots: 1 })).toBe("12.00");
  });
});

describe("answer examples", () => {
  it.each(answerExamples.map((e) => [e.id, e] as const))("%s has confidence and proof", (_, e) => {
    expect(e.answer.confidence).toBeGreaterThan(0);
    expect(e.answer.confidence).toBeLessThanOrEqual(1);
    expect(e.answer.proof).toBeDefined();
    if (e.capture.media === "video") expect(e.capture.duration).toBeDefined();
  });
});
