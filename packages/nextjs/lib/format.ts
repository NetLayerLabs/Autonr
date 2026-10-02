import { formatUnits } from "viem";

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Oracle prices need more precision than balances: HBAR trades around $0.10, and a 1 bps divergence is visible only
// in the fifth significant digit.
const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumSignificantDigits: 4,
  maximumSignificantDigits: 6,
});

const rateFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 });

export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

export function formatPrice(value: number): string {
  return priceFormat.format(value);
}

/** An exchange rate between two tokens, e.g. USDC per WHBAR. */
export function formatRate(value: number): string {
  return rateFormat.format(value);
}

/** The vault's USD values and prices are unsigned 18-decimal fixed point, passed around as decimal strings. */
export function e18ToNumber(value: string): number {
  return Number(formatUnits(BigInt(value), 18));
}

/** Exact decimal formatting of a raw token amount, truncated (never rounded up) to `maxFraction` digits. */
export function formatTokenAmount(raw: string | bigint, decimals: number, maxFraction = 4): string {
  const [whole = "0", fraction = ""] = formatUnits(BigInt(raw), decimals).split(".");
  const shown = fraction.slice(0, maxFraction).replace(/0+$/, "");
  if (whole === "0" && shown === "" && /[1-9]/.test(fraction)) return `<0.${"0".repeat(maxFraction - 1)}1`;
  const grouped = BigInt(whole).toLocaleString("en-US");
  return shown ? `${grouped}.${shown}` : grouped;
}

export function formatBps(bps: number): string {
  return `${bps.toLocaleString("en-US")} bps`;
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function formatRelative(thenMs: number, nowMs: number): string {
  const seconds = Math.round((nowMs - thenMs) / 1000);
  if (Math.abs(seconds) < 5) return "just now";
  const span = formatDuration(Math.abs(seconds)).split(" ")[0];
  return seconds > 0 ? `${span} ago` : `in ${span}`;
}

/** UTC, because Hedera consensus time and the vault's daily cap both run on UTC. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
