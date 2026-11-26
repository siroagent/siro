// x402 v2 in USD stablecoins on five networks: USDG on Robinhood Chain, USDC on Base, Arbitrum,
// Polygon and Solana. On the EVM chains the client signs an EIP-3009 transferWithAuthorization for
// exactly the quoted amount; on Solana it signs a USDC transfer transaction that the facilitator
// co-signs as fee payer. Either way the facilitator verifies and settles it (paying the gas), the
// stablecoin moves payer -> treasury, and nobody here holds a key.
import type { Context } from "hono";
import { getAddress, isAddress } from "viem";
import { PAY_NETWORKS, type PayNetworkKey } from "../shared/catalog";
import { ataOf } from "../shared/solana";
import { cdpEnabled, cdpFetch } from "./cdp";
import { solanaCall } from "./solana";

export type Chain = {
  network: string;
  label: PayNetworkKey;
  asset: string;
  symbol: string;
  vm: "evm" | "svm";
  /** "cdp": only through Coinbase's facilitator. "cdp-or-default": CDP when its key is set, else FACILITATOR_URL. */
  via: "default" | "cdp" | "cdp-or-default";
  domain?: { name: string; version: string };
};

const chain = (label: PayNetworkKey, asset: string, via: Chain["via"], domain?: Chain["domain"]): Chain => ({
  network: PAY_NETWORKS[label].caip,
  label,
  asset,
  symbol: PAY_NETWORKS[label].asset,
  vm: PAY_NETWORKS[label].vm,
  via,
  domain,
});

/** In quote order. Base goes first: most x402 buyers (and the Bazaar's checks) start with accepts[0].
 *  EIP-712 domains were read from each token contract (name(), version()). */
export const CHAINS: Chain[] = [
  // Circle USDC on Base mainnet. 6 decimals.
  chain("base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "cdp-or-default", { name: "USD Coin", version: "2" }),
  // Global Dollar (USDG, Paxos). 6 decimals.
  chain("robinhood", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "default", { name: "Global Dollar", version: "1" }),
  // Native Circle USDC on Arbitrum One and Polygon PoS. 6 decimals.
  chain("arbitrum", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "cdp", { name: "USD Coin", version: "2" }),
  chain("polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "cdp", { name: "USD Coin", version: "2" }),
  // Circle USDC mint on Solana. 6 decimals.
  chain("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "cdp"),
];
/** A client that names no network and signs an EVM authorization is taken to mean Robinhood Chain. */
export const NETWORK = PAY_NETWORKS.robinhood.caip;
export const MAX_TIMEOUT_SECONDS = 120;

export const chainFor = (network: string): Chain => CHAINS.find((c) => c.network === network) ?? CHAINS[1];

export type Requirements = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string } | { feePayer: string };
};

type EvmPayload = { signature: string; authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string } };
type SvmPayload = { transaction: string };

export type PaymentPayload = {
  x402Version: 2;
  accepted?: Partial<Requirements>;
  resource?: unknown;
  extensions?: Record<string, unknown>;
  payload: EvmPayload | SvmPayload;
};

const isEvm = (p: PaymentPayload["payload"]): p is EvmPayload => "authorization" in p;

/** Base58 public key, 32 bytes. */
const isSolanaAddress = (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
/** EVM addresses are case-insensitive; Solana ones are not. */
export const normPayer = (v: string) => (v.startsWith("0x") ? v.toLowerCase() : v);
export const isPayerAddress = (v: string) => isAddress(v) || isSolanaAddress(v);

export function treasury(env: Env): string | null {
  return isAddress(env.TREASURY ?? "") ? getAddress(env.TREASURY) : null;
}
export function solanaTreasury(env: Env): string | null {
  const t = (env.SOLANA_TREASURY ?? "").trim();
  return isSolanaAddress(t) ? t : null;
}

const viaCdp = (env: Env, c: Chain) => c.via === "cdp" || (c.via === "cdp-or-default" && cdpEnabled(env));

/** Chains that can take a payment right now, before asking the facilitator anything. */
export function offeredChains(env: Env): Chain[] {
  return CHAINS.filter((c) => (c.via !== "cdp" || cdpEnabled(env)) && (c.vm === "evm" ? !!treasury(env) : !!solanaTreasury(env)));
}

// The Solana fee payer is the facilitator's own account; clients put it in the transaction they sign.
// CDP rotates a pool of them (each /supported answer can name another), and one that has left the
// pool fails verify with "fee_payer_mismatch". So it is cached for a minute only, and dropped as
// soon as the facilitator rejects it.
let feePayer: { at: number; value: string | null } | null = null;
async function solanaFeePayer(env: Env): Promise<string | null> {
  if (feePayer && Date.now() - feePayer.at < (feePayer.value ? 60_000 : 30_000)) return feePayer.value;
  let value: string | null = feePayer?.value ?? null;
  try {
    const res = await cdpFetch(env, "supported");
    const j = (await res.json().catch(() => null)) as any;
    const k = j?.kinds?.find((k: any) => k.network === PAY_NETWORKS.solana.caip && k.scheme === "exact" && Number(k.x402Version ?? 2) === 2);
    if (res.ok) value = typeof k?.extra?.feePayer === "string" ? k.extra.feePayer : null;
  } catch {
    /* keep the last known value */
  }
  feePayer = { at: Date.now(), value };
  return value;
}

export function requirements(env: Env, amount: bigint, c: Chain, svmFeePayer?: string, timeout = MAX_TIMEOUT_SECONDS): Requirements {
  return {
    scheme: "exact",
    network: c.network,
    amount: amount.toString(),
    asset: c.asset,
    payTo: (c.vm === "svm" ? solanaTreasury(env) : treasury(env)) ?? "",
    maxTimeoutSeconds: timeout,
    extra: c.vm === "svm" ? { feePayer: svmFeePayer ?? "" } : { ...c.domain! },
  };
}

// A USDC transfer to a wallet that has never held USDC fails on-chain (no token account), so
// Solana is offered only once the treasury's account exists. Checked hourly, every 5 minutes
// while it is missing.
let treasuryAccount: { at: number; owner: string; ok: boolean } | null = null;
async function solanaTreasuryReady(env: Env): Promise<boolean> {
  const owner = solanaTreasury(env)!;
  const t = treasuryAccount;
  if (t && t.owner === owner && Date.now() - t.at < (t.ok ? 3600_000 : 300_000)) return t.ok;
  const r = await solanaCall(env, "getAccountInfo", [ataOf(owner), { commitment: "confirmed", encoding: "base64" }]);
  const ok = r.error ? (t?.owner === owner && t.ok) : !!r.result?.value;
  treasuryAccount = { at: Date.now(), owner, ok };
  return ok;
}

/** One quote per network that can be paid right now; $1 is 1,000,000 base units on all of them.
 *  Slow resources (video, music) pass a longer timeout so the signed authorization outlives the render. */
export async function allRequirements(env: Env, amount: bigint, timeout = MAX_TIMEOUT_SECONDS): Promise<Requirements[]> {
  const chains = offeredChains(env);
  const svm = chains.some((c) => c.vm === "svm");
  const fp = svm && (await solanaTreasuryReady(env)) ? await solanaFeePayer(env) : null;
  return chains.filter((c) => c.vm === "evm" || fp).map((c) => requirements(env, amount, c, fp ?? undefined, timeout));
}

const b64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));

/** The resource block of a 402, also echoed into settlements for Bazaar indexing. */
export const resourceInfo = (c: Context<any>, description: string) => ({
  url: new URL(c.req.url).origin + c.req.path,
  description,
  mimeType: "application/json",
  iconUrl: `${new URL(c.req.url).origin}/icon-512.png`,
});

/** 402 with the quote in the body and, base64-encoded, in PAYMENT-REQUIRED. */
export function paymentRequired(c: Context<any>, reqs: Requirements[], description: string, extra: Record<string, unknown> = {}) {
  const body = {
    x402Version: 2,
    error: "payment_required",
    resource: resourceInfo(c, description),
    accepts: reqs,
    ...extra,
  };
  c.header("PAYMENT-REQUIRED", b64(body));
  return c.json(body, 402);
}

export function paymentError(c: Context<any>, code: string, error: string) {
  return c.json({ x402Version: 2, error, code, accepts: [] }, 402);
}

/** Decoded PAYMENT-SIGNATURE (or legacy X-PAYMENT) header; "bad" when present but unreadable. */
export function readPayment(c: Context<any>): PaymentPayload | null | "bad" {
  const raw = c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!raw) return null;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(raw.trim())))) as PaymentPayload;
    if (p?.x402Version !== 2 || !p.payload || typeof p.payload !== "object") return "bad";
    if (!isEvm(p.payload)) {
      const tx = (p.payload as SvmPayload).transaction;
      return typeof tx === "string" && tx.length >= 100 && tx.length <= 4000 && /^[A-Za-z0-9+/]+=*$/.test(tx) ? p : "bad";
    }
    const a = p.payload.authorization;
    if (!a || typeof p.payload.signature !== "string") return "bad";
    if (!isAddress(a.from) || !isAddress(a.to) || !/^\d+$/.test(a.value) || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return "bad";
    return p;
  } catch {
    return "bad";
  }
}

/** The quote the client signed for: the network it names, or (when it names none) Robinhood Chain
 *  for an EVM authorization and Solana for a Solana transaction. */
export function pickRequirements(p: PaymentPayload, reqs: Requirements[]): Requirements | string {
  const named = p.accepted?.network ?? (isEvm(p.payload) ? NETWORK : PAY_NETWORKS.solana.caip);
  let req = reqs.find((r) => r.network === named);
  if (!req) return `network ${named} is not accepted; use one of ${reqs.map((r) => r.network).join(", ")}`;
  // Solana: verify against the fee payer the client was quoted and signed with. This isolate's
  // cached one can differ (CDP rotates a pool, and every isolate caches its own pick); a fee
  // payer that is not CDP's is refused by CDP anyway, so nothing is trusted that should not be.
  const fp = (p.accepted?.extra as any)?.feePayer;
  if (chainFor(req.network).vm === "svm" && typeof fp === "string" && isSolanaAddress(fp)) req = { ...req, extra: { feePayer: fp } };
  return termsMatch(p, req) ?? req;
}

/** What the client signed must be exactly what we quoted. Solana transactions are checked
 *  instruction by instruction by the facilitator against these same requirements. */
export function termsMatch(p: PaymentPayload, req: Requirements): string | null {
  const svm = chainFor(req.network).vm === "svm";
  if (svm === isEvm(p.payload)) return `this payload does not fit ${req.network}`;
  if (isEvm(p.payload)) {
    const a = p.payload.authorization;
    if (a.value !== req.amount) return `client amount=${a.value} does not match required ${req.amount}`;
    if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return "recipient does not match payTo";
  } else {
    if (p.accepted?.amount && p.accepted.amount !== req.amount) return `client amount=${p.accepted.amount} does not match required ${req.amount}`;
    if (p.accepted?.payTo && p.accepted.payTo !== req.payTo) return "recipient does not match payTo";
  }
  if (p.accepted?.network && p.accepted.network !== req.network) return "network does not match";
  if (p.accepted?.asset && p.accepted.asset.toLowerCase() !== req.asset.toLowerCase()) return "asset does not match";
  return null;
}

/** What the facilitator sees: our own resource block and discovery metadata, whatever the client sent. */
export type Context402 = { resource: unknown; extensions: Record<string, unknown> };

async function facilitator(env: Env, path: "verify" | "settle", p: PaymentPayload, req: Requirements, ctx?: Context402) {
  const paymentPayload = { ...p, accepted: req, ...(ctx ? { resource: ctx.resource, extensions: { ...(p.extensions ?? {}), ...ctx.extensions } } : {}) };
  const body = { x402Version: 2, paymentPayload, paymentRequirements: req };
  const cdp = viaCdp(env, chainFor(req.network));
  const res = cdp
    ? await cdpFetch(env, path, body)
    : await fetch(`${env.FACILITATOR_URL}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  const ext = res.headers.get("extension-responses");
  if (ext) {
    try {
      console.log(JSON.stringify({ event: "facilitator_extensions", path, network: req.network, ext: JSON.parse(atob(ext)) }));
    } catch {
      /* informational only */
    }
  }
  if (!res.ok) console.error(JSON.stringify({ event: "facilitator_http", path, network: req.network, cdp, status: res.status, body: JSON.stringify(json).slice(0, 300) }));
  return { status: res.status, json };
}

/** The payer as the client claims it; Solana payers are only known once the facilitator answers. */
const claimedPayer = (p: PaymentPayload) => (isEvm(p.payload) ? p.payload.authorization.from : "");

export async function verifyPayment(env: Env, p: PaymentPayload, req: Requirements, ctx?: Context402): Promise<{ ok: true; payer: string } | { ok: false; code: string; message: string }> {
  try {
    const { json } = await facilitator(env, "verify", p, req, ctx);
    if (json.isValid) return { ok: true, payer: normPayer(String(json.payer ?? claimedPayer(p))) };
    if (/fee_payer/i.test(`${json.invalidReason ?? ""} ${json.invalidMessage ?? ""}`)) feePayer = null;
    return { ok: false, code: "verify_invalid", message: String(json.invalidMessage ?? json.invalidReason ?? "rejected").split("\n")[0].slice(0, 200) };
  } catch (err) {
    return { ok: false, code: "verify_invalid", message: "facilitator unreachable" };
  }
}

export type Settled = { ok: true; tx: string; payer: string } | { ok: false; code: "settle_failed" | "settle_unconfirmed"; message: string; tx?: string };

export async function settlePayment(env: Env, p: PaymentPayload, req: Requirements, ctx?: Context402): Promise<Settled> {
  try {
    const { status, json } = await facilitator(env, "settle", p, req, ctx);
    if (json.success && json.transaction) return { ok: true, tx: String(json.transaction), payer: normPayer(String(json.payer ?? claimedPayer(p))) };
    if (json.transaction) return { ok: false, code: "settle_unconfirmed", message: "broadcast but not confirmed", tx: String(json.transaction) };
    if (/fee_payer/i.test(`${json.errorReason ?? ""} ${json.errorMessage ?? ""}`)) feePayer = null;
    return { ok: false, code: "settle_failed", message: String(json.errorMessage ?? json.errorReason ?? `facilitator ${status}`) };
  } catch {
    return { ok: false, code: "settle_failed", message: "facilitator unreachable" };
  }
}

export function paymentResponseHeader(c: Context<any>, s: { tx: string; payer: string }, network: string = NETWORK) {
  c.header("PAYMENT-RESPONSE", b64({ success: true, transaction: s.tx, network, payer: s.payer }));
}

/** EVM: the EIP-3009 nonce. Solana: a hash of the signed transaction (its blockhash makes it unique). */
async function nonceOf(p: PaymentPayload): Promise<string> {
  if (isEvm(p.payload)) return p.payload.authorization.nonce.toLowerCase();
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.payload.transaction));
  return `svm:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Claim the payment's nonce so one signature can't be replayed across parallel requests. */
export async function lockNonce(db: D1Database, p: PaymentPayload): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO x402_nonces (nonce, payer, at) VALUES (?1, ?2, ?3) ON CONFLICT (nonce) DO NOTHING")
    .bind(await nonceOf(p), normPayer(claimedPayer(p)) || "solana", Math.floor(Date.now() / 1000))
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** A nonce whose call failed before settlement can be used again by the client. */
export async function releaseNonce(db: D1Database, p: PaymentPayload): Promise<void> {
  await db.prepare("DELETE FROM x402_nonces WHERE nonce = ?1").bind(await nonceOf(p)).run();
}
