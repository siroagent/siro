// The Budget's storage keys and the caps a new Budget starts with. No viem here, so light pages
// (home, docs) can read caps without pulling in the payment code from pay.ts.

export const AGENT_KEY = "siro.agent.key";
export const LIMITS_KEY = "siro.agent.limits";
export const SPEND_LOG_KEY = "siro.agent.log";

export type Limits = { perPayment: number; perDay: number; autopay: boolean; perSwap: number };

/** The caps a new Budget starts with, until the owner saves others in Budget. */
export const DEFAULT_LIMITS: Readonly<Limits> = { perPayment: 0.1, perDay: 1, autopay: false, perSwap: 25 };
