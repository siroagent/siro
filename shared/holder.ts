// $SIRO holder tiers. A wallet that holds $SIRO on Robinhood Chain pays less for every Siro tool, and gets a
// few free calls a day on Siro's own data tools. The balance is read on-chain when the quote is made and
// again when the payment is checked, so the discount follows the coins, not an account.

export const SIRO_DECIMALS = 18;

export type Tier = { name: string; min: number; discountPct: number; freePerDay: number };

/** Highest first. `min` is whole $SIRO. */
export const TIERS: Tier[] = [
  { name: "Holder 10M", min: 10_000_000, discountPct: 50, freePerDay: 30 },
  { name: "Holder 1M", min: 1_000_000, discountPct: 25, freePerDay: 10 },
];

/** Siro's own data tools: no upstream model bill, so holders can run them free a few times a day. */
export const FREE_TOOLS = ["gas-now", "wallet-balances", "token-snapshot", "contract-check", "new-pools", "stock-tokens", "prediction-markets"];

export const tierFor = (siro: number): Tier | null => TIERS.find((t) => siro >= t.min) ?? null;

/** The holder price in 6-decimal stablecoin units, rounded down so the holder never pays more than the cut. */
export const discounted = (units: bigint, pct: number) => (units * BigInt(100 - pct)) / 100n;

/** What a holder signs once to run free calls; the server checks the signature, the expiry and the balance. */
export const passMessage = (address: string, expires: number) => `Siro holder pass\nAddress: ${address.toLowerCase()}\nExpires: ${expires}`;
export const PASS_MAX_SECONDS = 24 * 3600;
