import { describe, expect, it } from "vitest";

import { formatBaseUnits, loadRewardTokenConfig, toBaseUnits } from "../src/index.js";

describe("toBaseUnits / formatBaseUnits", () => {
  it.each([
    ["2.5", 6, 2_500_000n],
    ["0", 6, 0n],
    ["1", 6, 1_000_000n],
    ["0.000001", 6, 1n],
    ["123.456", 18, 123_456_000_000_000_000_000n],
    ["7", 0, 7n],
  ])("toBaseUnits(%s, %i) = %s", (amount, decimals, expected) => {
    expect(toBaseUnits(amount, decimals)).toBe(expected);
  });

  it("rejects bad input and excess precision", () => {
    expect(() => toBaseUnits("1.0000001", 6)).toThrow("more than 6 decimals");
    expect(() => toBaseUnits("-1", 6)).toThrow("Invalid amount");
    expect(() => toBaseUnits("1e6", 6)).toThrow("Invalid amount");
    expect(() => toBaseUnits("", 6)).toThrow("Invalid amount");
  });

  it.each([
    [2_500_000n, 6, "2.5"],
    [1n, 6, "0.000001"],
    [0n, 6, "0"],
    [10_000_000n, 6, "10"],
    [7n, 0, "7"],
  ])("formatBaseUnits(%s, %i) = %s", (value, decimals, expected) => {
    expect(formatBaseUnits(value, decimals)).toBe(expected);
  });

  it("round-trips", () => {
    for (const s of ["0.1", "42", "999999.999999", "0.000001"]) {
      expect(formatBaseUnits(toBaseUnits(s, 6), 6)).toBe(s);
    }
  });

  it("rejects negatives when formatting", () => {
    expect(() => formatBaseUnits(-1n, 6)).toThrow();
  });
});

describe("loadRewardTokenConfig", () => {
  it("parses env", () => {
    expect(
      loadRewardTokenConfig({
        REWARD_TOKEN_ADDRESS: "0x" + "a".repeat(40),
        REWARD_TOKEN_SYMBOL: "USDG",
        REWARD_TOKEN_DECIMALS: "6",
      }),
    ).toEqual({ address: "0x" + "a".repeat(40), symbol: "USDG", decimals: 6 });
  });

  it("fails loudly when the address is missing or malformed", () => {
    expect(() =>
      loadRewardTokenConfig({ REWARD_TOKEN_SYMBOL: "USDG", REWARD_TOKEN_DECIMALS: "6" }),
    ).toThrow();
    expect(() =>
      loadRewardTokenConfig({
        REWARD_TOKEN_ADDRESS: "0x1234",
        REWARD_TOKEN_SYMBOL: "USDG",
        REWARD_TOKEN_DECIMALS: "6",
      }),
    ).toThrow();
  });
});
