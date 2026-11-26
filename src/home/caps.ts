// The caps a quote is checked against, read straight from this browser's storage. The keys and
// defaults come from src/lib/caps.ts; src/lib/pay.ts stays out of the home bundle because it pulls in viem.
import { AGENT_KEY as KEY, DEFAULT_LIMITS, LIMITS_KEY as LIMITS, SPEND_LOG_KEY as LOG } from "../lib/caps";

/** The caps a new Budget starts with. */
export const DEFAULT_CAPS = { perCall: DEFAULT_LIMITS.perPayment, perDay: DEFAULT_LIMITS.perDay } as const;

/** saved: caps set in Budget. wallet: a wallet here still runs on the defaults. new: no wallet here yet. */
export type CapSource = "saved" | "wallet" | "new";
export type Caps = { perCall: number; perDay: number; spentToday: number; source: CapSource };

function stored(key: string): unknown {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

const dollars = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

export function readCaps(now = new Date()): Caps {
  const saved = stored(LIMITS);
  const limits = saved && typeof saved === "object" ? (saved as { perPayment?: unknown; perDay?: unknown }) : null;
  const log = stored(LOG);
  const entries: unknown[] = Array.isArray(log) ? log : [];
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  // What the Budget paid today. Payments signed by a connected wallet are marked via "connected" and left
  // out, as checkCaps does; entries logged before that mark existed are counted, which can only overstate.
  const spentToday = entries.reduce<number>((sum, e) => {
    const s = e as { at?: unknown; usd?: unknown; via?: unknown } | null;
    return s && s.via !== "connected" && typeof s.at === "number" && s.at >= midnight.getTime() && typeof s.usd === "number" ? sum + s.usd : sum;
  }, 0);
  let hasKey = false;
  try {
    hasKey = localStorage.getItem(KEY) !== null;
  } catch {
    /* storage blocked: treat as no wallet */
  }
  return {
    perCall: dollars(limits?.perPayment, DEFAULT_CAPS.perCall),
    perDay: dollars(limits?.perDay, DEFAULT_CAPS.perDay),
    spentToday,
    // Spend logged by a connected wallet alone does not make an agent wallet; caps only bind the agent wallet.
    source: limits ? "saved" : hasKey ? "wallet" : "new",
  };
}

/** "$0.10", "$0.045", "$0.002", "$1.00": two decimals at least, no trailing zeros past them. */
export function usd(n: number): string {
  const digits = n === 0 || n >= 0.1 ? 2 : n >= 0.01 ? 3 : 4;
  return `$${n.toFixed(digits).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

export type Verdict = {
  ok: boolean;
  /** The full sentence for the quote display. */
  line: string;
  /** A few words for a lamp in tight places. */
  short: string;
  /** Where the caps came from. */
  source: string;
  /** This call against the per-call cap, and today including this call against the daily cap (0 to 1). */
  perCallShare: number;
  dayShare: number;
  dayTotal: number;
};

const SOURCES: Record<CapSource, string> = {
  saved: "Caps from Budget, saved in this browser. Today adds up what the Budget paid from this browser.",
  wallet: "Your Budget's default caps, unchanged since it was made. Today adds up what it paid from this browser.",
  new: "No wallet in this browser yet, so these are the caps a new one starts with.",
};

/** The check Siro runs before signing (src/lib/pay.ts checkCaps), worded for a reader. */
export function judge(price: number, caps: Caps): Verdict {
  const spent = caps.source === "new" ? 0 : caps.spentToday;
  const dayTotal = spent + price;
  const share = (v: number, cap: number) => (cap > 0 ? Math.min(1, v / cap) : 1);
  const base = { source: SOURCES[caps.source], perCallShare: share(price, caps.perCall), dayShare: share(dayTotal, caps.perDay), dayTotal };
  if (price > caps.perCall + 1e-9) {
    return { ...base, ok: false, line: `Over ${usd(caps.perCall)} a call. Siro refuses before signing. Raise it in Budget.`, short: `Over the ${usd(caps.perCall)} per-call cap` };
  }
  if (dayTotal > caps.perDay + 1e-9) {
    return { ...base, ok: false, line: `Over today's ${usd(caps.perDay)} cap: ${usd(spent)} spent already. Siro refuses before signing. Raise it in Budget.`, short: `Over today's ${usd(caps.perDay)} cap` };
  }
  if (caps.source === "new") {
    return { ...base, ok: true, line: `Within a new wallet's default caps: ${usd(caps.perCall)} a call, ${usd(caps.perDay)} a day.`, short: "Within a new wallet's default caps" };
  }
  return { ...base, ok: true, line: `Within your caps: ${usd(price)} of ${usd(caps.perCall)} a call, ${usd(dayTotal)} of ${usd(caps.perDay)} today.`, short: "Within your caps" };
}
