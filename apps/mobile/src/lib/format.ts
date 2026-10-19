import { formatBaseUnits } from "@seenit/shared";

/** "2000000" (6 decimals) -> "2.00 USDG". Always at least 2 decimals. */
export function formatReward(baseUnits: string | bigint, decimals: number, symbol: string): string {
  const raw = formatBaseUnits(BigInt(baseUnits), decimals);
  const [whole, frac = ""] = raw.split(".");
  return `${whole}.${frac.padEnd(2, "0")} ${symbol}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** "2 h 15 min left", "45 min left", "Ended". */
export function formatTimeLeft(deadline: string | Date, now: Date): string {
  const ms = new Date(deadline).getTime() - now.getTime();
  if (ms <= 0) return "Ended";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min left`;
  return `${Math.floor(hours / 24)} days left`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}
