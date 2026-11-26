/** Dollar amounts the page computes (caps, spend, quotes): at least two decimals, no float noise. */
export function money(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  const fixed = usd >= 0.1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);
  const [whole, frac = ""] = fixed.split(".");
  return `$${Number(whole).toLocaleString("en-US")}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

export const utc = (d: Date, seconds = false) => `${d.toISOString().slice(11, seconds ? 19 : 16)} UTC`;

/** 0x12ab…cdef for addresses and hashes. */
export const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

/** "A, B or C". */
export const either = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : (xs[0] ?? ""));

export const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
