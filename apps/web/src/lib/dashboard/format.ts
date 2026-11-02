import { formatAmount, parseUnits } from "seenit-sdk";

export { parseUnits };

export const money = (v: string | bigint, token: { decimals: number; symbol: string }) =>
  formatAmount(v, token.decimals, token.symbol);

export const shortHex = (h: string, n = 6) =>
  h.length > 2 * n + 2 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;

export function explorerTx(hash: string) {
  const base = (
    process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.chain.robinhood.com"
  ).replace(/\/$/, "");
  return `${base}/tx/${hash}`;
}

export function explorerAddress(addr: string) {
  const base = (
    process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.chain.robinhood.com"
  ).replace(/\/$/, "");
  return `${base}/address/${addr}`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "in 3 h", "2 d ago". */
export function relative(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const units: [number, string][] = [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "min"],
  ];
  const [size, unit] = units.find(([u]) => abs >= u) ?? [60_000, "min"];
  const n = Math.max(1, Math.round(abs / size));
  return ms >= 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}
