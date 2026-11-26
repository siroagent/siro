// Numbers and times as Ask prints them: dollars with at least two decimals, UTC clock times.
import { PAY_NETWORKS, type PayNetworkKey } from "../../shared/catalog";

/** "$0.10", "$0.045", "$1,234.50". Sums of float prices are rounded to six places first. */
export function money(n: number): string {
  const s = (Math.round(n * 1e6) / 1e6).toFixed(6).replace(/0+$/, "");
  const [w, f = ""] = s.split(".");
  return `$${Number(w).toLocaleString("en-US")}.${f.padEnd(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:05 UTC" for today, "14 Nov, 14:05 UTC" for earlier days (with the year once it differs). */
export function utcStamp(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const iso = d.toISOString();
  const today = new Date(now).toISOString();
  const hm = `${iso.slice(11, 16)} UTC`;
  if (iso.slice(0, 10) === today.slice(0, 10)) return hm;
  const year = iso.slice(0, 4) === today.slice(0, 4) ? "" : ` ${iso.slice(0, 4)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}, ${hm}`;
}

export const isoOf = (ms: number) => new Date(ms).toISOString();

/** 0x3f2a…a91c */
export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

// The hash can come from a third-party service's payment header, so it is encoded before it lands in an href.
export const txUrl = (n: PayNetworkKey, tx: string) => `${PAY_NETWORKS[n].explorer}/tx/${encodeURIComponent(tx)}`;

/** "USDG on Robinhood Chain" */
export const assetOn = (n: PayNetworkKey) => `${PAY_NETWORKS[n].asset} on ${PAY_NETWORKS[n].name}`;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
