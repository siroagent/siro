// SDK entry: `import { Siro } from "siroagent"` (the package name; the command it installs is `siro`).
export { Siro, SiroError, DEFAULT_LIMITS } from "./core.js";
export type { Approval, Limits, Net, SpendEntry, SwapQuote, Token, SiroOptions } from "./core.js";
export { x402fetch, readQuote, choose, signPayment, PAY_CHAINS, X402Error } from "../../shared/x402client";
export type { Requirement, Quote, Signer } from "../../shared/x402client";
