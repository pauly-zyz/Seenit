/** "2.5" → 2500000n for 6 decimals. Rejects more decimals than the token has. */
export function parseUnits(value: string | number, decimals: number): bigint {
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount "${value}"`);
  const [, whole, frac = ""] = m;
  if (frac.length > decimals)
    throw new Error(`Amount "${value}" has more than ${decimals} decimals`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 2500000n (6 decimals) → "2.5". */
export function formatUnits(value: bigint | string, decimals: number): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** "2.5 USDG" style label with at least two decimals. */
export function formatAmount(value: bigint | string, decimals: number, symbol: string): string {
  const [whole, frac = ""] = formatUnits(value, decimals).split(".");
  return `${whole}.${frac.padEnd(2, "0")} ${symbol}`;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount "${n}"`);
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 });
}
