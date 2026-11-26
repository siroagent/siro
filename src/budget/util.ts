// Shared bits of the Budget page: money and time formats, explorer links, copying, payment errors.
import { formatPrice, PAY_NETWORKS, type PayNetworkKey } from "../../shared/catalog";
import { limits } from "../lib/pay";
import { toast } from "../shell";

/** The order this page lists networks in: the default first, the same order liveNetworks() uses. */
export const NET_ORDER: PayNetworkKey[] = ["robinhood", "base", "solana", "arbitrum", "polygon"];

/** A number without float noise or trailing zeros, for command lines: 0.1, 25, 0.045. */
export const plain = (v: number) => String(Number(v.toFixed(6)));

/** USD in the catalog's price style: "$0.10", "$0.045", "$25.00". */
export const usd = (v: number) => (v === 0 ? "$0.00" : formatPrice(plain(v)));

/** A typed USD amount. Fields are text, not type=number, so every locale shows "0.10" like the rest of
 *  the page; a comma is read as the decimal point. NaN when it is not a plain amount. */
export function parseUsd(s: string) {
  const t = s.trim().replace(",", ".");
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/** A form value with at least two decimals: "0.10", "0.045", "25.00". */
export function fieldValue(v: number) {
  const [w, f = ""] = plain(v).split(".");
  return `${w}.${f.padEnd(2, "0")}`;
}

/** A balance: separators and two decimals, more only for amounts under a cent. */
export const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.01 ? 6 : 2 })}`;

/** A token amount from a quote or a chain read: six significant digits at most. */
export const amount = (v: string | number) => Number(v).toLocaleString("en-US", { maximumSignificantDigits: 6 });

export const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export const utc = (d = new Date()) => `${d.toISOString().slice(11, 16)} UTC`;

/** Local wall-clock time. The daily cap starts over at local midnight, so spend is shown in local time. */
export const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const txUrl = (n: PayNetworkKey, tx: string) => `${PAY_NETWORKS[n].explorer}/tx/${tx}`;

export function untilMidnight(now = new Date()) {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const mins = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h} h ${mins % 60} min` : `${mins} min`;
}

/** Holds a key while its action runs: aria-disabled, because a disabled key drops keyboard focus mid-action. */
export function hold(key: Element, on: boolean) {
  if (on) key.setAttribute("aria-disabled", "true");
  else key.removeAttribute("aria-disabled");
}
export const held = (key: Element | null) => key?.getAttribute("aria-disabled") === "true";

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast(`This browser blocked copying. Select the ${what.toLowerCase()} and copy it by hand.`);
  }
}

/** A failed payment or swap in this page's words. pay.ts phrases a few of these for other pages. */
export function payText(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string; shortMessage?: string };
  const l = limits();
  switch (err.code) {
    case "over_payment_cap": {
      const asked = /^\$([\d.]+)/.exec(err.message ?? "");
      return `${asked ? usd(Number(asked[1])) : "This call"} is above your per-call cap of ${usd(l.perPayment)}. Raise it in Caps.`;
    }
    case "over_daily_cap":
      return `This payment would take today's spend past your daily cap of ${usd(l.perDay)}. Raise it in Caps, or wait for midnight.`;
    case "over_swap_cap":
      return `This swap is above your per-swap cap of ${usd(l.perSwap)}. Raise it in Caps.`;
    case "no_agent_wallet":
      return "There is no agent key on this browser.";
    case "declined":
      return "Cancelled. Nothing was signed.";
  }
  const said = String(err.shortMessage ?? err.message ?? "Something went wrong.");
  // Swaps send a transaction from the agent wallet; viem words a gas shortfall like this.
  if (/exceeds the balance of the account|insufficient funds for gas/i.test(said)) return "Not enough ETH on this network to pay the gas. Send a little ETH to the EVM address first.";
  return said.slice(0, 280);
}
