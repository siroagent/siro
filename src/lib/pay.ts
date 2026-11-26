// Paying for tools, third-party x402 services and swaps from the browser. Two payers:
//  - Budget (the agent wallet): a key generated on this device and kept in localStorage, with
//    a per-call cap, a daily cap and an optional autopay mode;
//  - a connected wallet (MetaMask, Rabby…) that signs each payment in its own popup.
// Either way the browser signs an EIP-3009 transferWithAuthorization for the exact quoted
// amount and the server never touches a key. The agent wallet also pays on Solana, with a key
// derived from its EVM key (shared/solana.ts); a connected wallet pays on EVM chains only.
import { createPublicClient, createWalletClient, custom, erc20Abi, fallback, formatUnits, http, parseUnits, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, polygon, robinhood } from "viem/chains";
import { EVM_PAY, PAY_KEYS, PAY_NETWORKS, formatPrice, isPayKey, payNetworkOf, type EvmPayKey, type NetworkKey, type PayNetworkKey } from "../../shared/catalog";
import { latestBlockhash, solanaBalances, solanaKeyFromEvm, type SolanaPayer } from "../../shared/solana";
import { TOKENS, executeSwap, quoteSwap, resolveToken, type SwapQuote, type Token } from "../../shared/swap";
import { PAY_CHAINS, X402Error, x402fetch, type Signer } from "../../shared/x402client";
import { PASS_MAX_SECONDS, passMessage } from "../../shared/holder";
import { forgetMessage } from "../../shared/privacy";
import { base58 } from "@scure/base";
import { AGENT_KEY, DEFAULT_LIMITS, LIMITS_KEY, SPEND_LOG_KEY, type Limits } from "./caps";

/** The networks this wallet pays on. Swaps stay on Robinhood Chain and Base. */
export const CHAINS = { robinhood, base, arbitrum, polygon } as const;
export const STABLES = Object.fromEntries(PAY_CHAINS.map((c) => [c.key, c.stable])) as Record<EvmPayKey, Address>;
// A second public RPC per chain, in case the first is slow or rate-limited (also allowed in the CSP).
const RPC2: Partial<Record<EvmPayKey, string>> = { base: "https://base-rpc.publicnode.com", arbitrum: "https://arbitrum-one-rpc.publicnode.com", polygon: "https://polygon-bor-rpc.publicnode.com" };
const transport = (n: EvmPayKey) => (RPC2[n] ? fallback([http(), http(RPC2[n])]) : http());

const KEY = AGENT_KEY;
const LIMITS = LIMITS_KEY;
const LOG = SPEND_LOG_KEY;
const NET = "siro.network";

const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

// ---- Agent wallet ----

export function agentKey(): Hex | null {
  const k = read<string | null>(KEY, null);
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}
export function agentAccount() {
  const k = agentKey();
  return k ? privateKeyToAccount(k) : null;
}
export function createAgentWallet() {
  const k = generatePrivateKey();
  write(KEY, k);
  return privateKeyToAccount(k);
}
export function importAgentWallet(k: string) {
  const v = k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error("That is not a 64-character hex private key.");
  write(KEY, v);
  return privateKeyToAccount(v as Hex);
}
const SOLANA_RPC = "/api/solana";
/** The agent wallet's Solana side: same backup, its own address. */
export function agentSolana() {
  const k = agentKey();
  if (!k) return null;
  const s = solanaKeyFromEvm(k);
  const payer: SolanaPayer = { address: s.address, sign: s.sign, blockhash: () => latestBlockhash(SOLANA_RPC) };
  return { address: s.address, secretKey: s.secretKey, payer };
}
/** Every address the agent wallet pays from; the daily cap counts them together. */
export const agentAddresses = (): string[] => {
  const a = agentAccount();
  return a ? [a.address, agentSolana()!.address] : [];
};
export function forgetAgentWallet() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export type { Limits };
export const limits = (): Limits => ({ ...DEFAULT_LIMITS, ...read<Partial<Limits>>(LIMITS, {}) });
export const setLimits = (l: Limits) => write(LIMITS, l);

/** One payment or swap made from this browser. `via` says which payer signed; entries written before it existed have none. */
export type Spend = { at: number; usd: number; resource: string; network: PayNetworkKey; tx: string; payer: string; via?: Payer["kind"] };
export const spendLog = (): Spend[] => read<Spend[]>(LOG, []);
const logSpend = (s: Spend) => write(LOG, [s, ...spendLog()].slice(0, 500));
export const spentToday = (payer?: string | string[]) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const who = payer === undefined ? null : new Set((Array.isArray(payer) ? payer : [payer]).map((p) => p.toLowerCase()));
  return spendLog()
    .filter((s) => s.at >= start.getTime() && (!who || who.has(s.payer.toLowerCase())))
    .reduce((a, s) => a + s.usd, 0);
};

/** The payment network. Robinhood Chain (home of $SIRO) until the user picks another. */
export const network = (): PayNetworkKey => {
  const n = read<string>(NET, "robinhood");
  return isPayKey(n) ? n : "robinhood";
};
export const setNetwork = (n: PayNetworkKey) => write(NET, n);
/** <option>s for a payment-network <select>. */
export const netOptions = (selected: PayNetworkKey = network(), keys: readonly PayNetworkKey[] = PAY_KEYS) =>
  keys.map((n) => `<option value="${n}"${n === selected ? " selected" : ""}>${PAY_NETWORKS[n].name} · ${PAY_NETWORKS[n].asset}</option>`).join("");

/** Networks the server quotes right now. Solana, Arbitrum and Polygon only appear once the CDP
 *  facilitator is switched on server-side, so selectors list what can actually be paid. */
let live: Promise<PayNetworkKey[]> | null = null;
export const liveNetworks = (): Promise<PayNetworkKey[]> =>
  (live ??= fetch("/v1/resources/gas-now")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const keys = ((j?.networks ?? []) as string[]).map(payNetworkOf).filter((k): k is PayNetworkKey => !!k);
      // Robinhood Chain first (the default), then Base and Solana, then the rest.
      return (["robinhood", "base", "solana", "arbitrum", "polygon"] as PayNetworkKey[]).filter((k) => keys.includes(k));
    })
    // An empty list means "could not read the server": callers keep their full menus but claim nothing.
    .catch(() => []));

/** Narrows a payment <select> to the live networks, moving the choice off a network that is not live. */
export function liveSelect(sel: HTMLSelectElement) {
  liveNetworks().then((keys) => {
    if (!keys.length) return;
    const cur = keys.includes(network()) ? network() : keys[0];
    if (cur !== network()) setNetwork(cur);
    sel.innerHTML = netOptions(cur, keys);
  });
}

const either = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : (xs[0] ?? ""));

/** "USDC on Base, Solana or Arbitrum, or USDG on Robinhood Chain", from the live networks. */
export const liveNetworkText = (keys: PayNetworkKey[]) => {
  if (!keys.length) return "USD stablecoins, on the networks the server quotes";
  const byAsset = new Map<string, string[]>();
  for (const k of keys) byAsset.set(PAY_NETWORKS[k].asset, [...(byAsset.get(PAY_NETWORKS[k].asset) ?? []), PAY_NETWORKS[k].name]);
  const parts = [...byAsset].map(([asset, names]) => `${asset} on ${either(names)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}` : (parts[0] ?? "");
};

/** Data resources and swaps only cover Robinhood Chain and Base. */
export const dataNetwork = (): NetworkKey => (network() === "base" ? "base" : "robinhood");

export function publicClient(n: EvmPayKey) {
  return createPublicClient({ chain: CHAINS[n], transport: transport(n) });
}

/** USD stablecoin and gas-token balances on every payment network. `eth` is the gas token amount. */
export async function balances(addr: Address, solanaAddr?: string) {
  const out = Object.fromEntries(PAY_KEYS.map((n) => [n, null])) as Record<PayNetworkKey, { eth: string; gas: string; usd: string } | null>;
  await Promise.all([
    solanaAddr
      ? solanaBalances(SOLANA_RPC, solanaAddr).then(
          (b) => void (out.solana = { eth: b.sol, gas: "SOL", usd: b.usdc }),
          () => {},
        )
      : null,
    ...EVM_PAY.map(async (n) => {
      try {
        const c = publicClient(n);
        const [eth, usd] = await Promise.all([c.getBalance({ address: addr }), c.readContract({ address: STABLES[n], abi: erc20Abi, functionName: "balanceOf", args: [addr] })]);
        out[n] = { eth: formatUnits(eth, 18), gas: CHAINS[n].nativeCurrency.symbol, usd: formatUnits(usd as bigint, 6) };
      } catch {
        out[n] = null;
      }
    }),
  ]);
  return out;
}

/** Plain ERC-20 transfer out of the agent wallet. Needs a little of the chain's gas token. */
export async function withdraw(n: EvmPayKey, to: Address, amountUsd: string) {
  const account = agentAccount();
  if (!account) throw new Error("No agent wallet on this device.");
  const wc = createWalletClient({ account, chain: CHAINS[n], transport: transport(n) });
  const hash = await wc.writeContract({ address: STABLES[n], abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(amountUsd, 6)] });
  return hash;
}

// ---- Connected (injected) wallet via EIP-6963 ----

type Provider = { request: (a: { method: string; params?: unknown[] }) => Promise<any> };
type Announced = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Provider };
const found = new Map<string, Announced>();
if (typeof window !== "undefined") {
  addEventListener("eip6963:announceProvider", (e: any) => found.set(e.detail.info.uuid, e.detail));
  dispatchEvent(new Event("eip6963:requestProvider"));
}
export const injectedWallets = () => [...found.values()];

let connected: { provider: Provider; address: Address; name: string } | null = null;
export const connectedWallet = () => connected;

export async function connect(w?: Announced) {
  const p = w?.provider ?? ((window as any).ethereum as Provider | undefined);
  if (!p) throw new Error("No browser wallet found. Install MetaMask or Rabby, or pay with Budget.");
  const [address] = (await p.request({ method: "eth_requestAccounts" })) as Address[];
  connected = { provider: p, address, name: w?.info.name ?? "Browser wallet" };
  return connected;
}
export function disconnect() {
  connected = null;
}

async function ensureChain(p: Provider, n: EvmPayKey) {
  const chain = CHAINS[n];
  const hex = `0x${chain.id.toString(16)}`;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers!.default.url] }],
    });
  }
}

// ---- x402 calls ----

/** What the server returns with a result. `status: "pending"` means the payment was broadcast but not yet confirmed. */
export type Receipt = { network: string; asset: string; amountUsd: number; payer: string; tx: string; ms: number; status?: "pending" };
export class PayError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Payer = { kind: "agent" } | { kind: "connected" };

/** A signer for the chosen payer. The connected wallet is switched to the right chain first. */
function signerFor(payer: Payer, n: PayNetworkKey): Signer {
  if (payer.kind === "agent") {
    const acct = agentAccount();
    if (!acct) throw new PayError("no_agent_wallet", "Create a Budget first.");
    return acct;
  }
  if (n === "solana") throw new PayError("solana_agent_only", "Solana payments come from your Budget. Pay with Budget, or pick an EVM network.");
  if (!connected) throw new PayError("not_connected", "Connect a wallet first.");
  const c = connected;
  return {
    address: c.address,
    signTypedData: async (args) => {
      await ensureChain(c.provider, n);
      const wc = createWalletClient({ account: c.address, chain: CHAINS[n], transport: custom(c.provider) });
      return wc.signTypedData(args as any);
    },
  };
}

/** "$0.10", "$25.00", "$0.001": dollar amounts in messages, with float noise rounded off. */
const usdText = (x: number) => formatPrice(String(+x.toPrecision(6)));

/** Caps apply to the Budget (EVM and Solana together); a connected wallet asks its owner every time anyway. */
function checkCaps(payer: Payer, usd: number) {
  if (payer.kind !== "agent") return;
  const l = limits();
  if (usd > l.perPayment) throw new PayError("over_payment_cap", `${usdText(usd)} is above your per-call cap of ${usdText(l.perPayment)}. Raise it in Budget.`);
  const spent = spentToday(agentAddresses());
  if (spent + usd > l.perDay + 1e-9) throw new PayError("over_daily_cap", `Today's spend is ${usdText(spent)} of your ${usdText(l.perDay)} daily cap, and this call is ${usdText(usd)}. Raise the cap in Budget, or wait until midnight.`);
}

function friendly(code: string, msg: string, n: PayNetworkKey, from?: string) {
  if (!/insufficient|exceeds balance|InsufficientFunds|execution reverted/i.test(msg)) return new PayError(code, msg);
  return new PayError("insufficient_funds", `Not enough ${PAY_NETWORKS[n].asset} on ${PAY_NETWORKS[n].name}${from ? ` in ${from.slice(0, 6)}…${from.slice(-4)}` : ""}.`);
}

async function paid(url: string, init: RequestInit, opts: { payer: Payer; network: PayNetworkKey; prefer?: PayNetworkKey[]; confirm?: (usd: number) => Promise<boolean> | boolean; fetch?: typeof fetch }) {
  const signer = signerFor(opts.payer, opts.network);
  try {
    return await x402fetch(url, init, {
      signer,
      solana: opts.payer.kind === "agent" ? agentSolana()?.payer : undefined,
      prefer: opts.prefer ?? [opts.network],
      fetch: opts.fetch,
      approve: async (req) => {
        checkCaps(opts.payer, req.usd);
        if (opts.confirm && !(await opts.confirm(req.usd))) throw new PayError("declined", "Payment declined.");
      },
    });
  } catch (e: any) {
    if (e instanceof PayError) throw e;
    if (e instanceof X402Error) throw new PayError(e.code, e.code === "no_supported_payment" && !opts.prefer ? `This tool is not offered on ${PAY_NETWORKS[opts.network].name}.` : e.message);
    throw new PayError("network_error", e?.message ?? "Network error.");
  }
}

/**
 * Calls /v1/<id>. On 402, signs for the chosen network and retries.
 * `confirm` runs before signing with the quoted USD price; return false to cancel.
 */
export async function callResource(id: string, input: unknown, opts: { payer: Payer; network: PayNetworkKey; confirm?: (usd: number) => Promise<boolean> | boolean }) {
  // On an EVM network the paying address is named up front, so a wallet holding $SIRO is quoted its holder price.
  const holder = opts.network === "solana" ? null : payingAddress(opts.payer);
  const headers: Record<string, string> = { "content-type": "application/json", ...(holder ? { "x-siro-holder": holder } : {}) };
  const { res, paid: p } = await paid(`/v1/${id}`, { method: "POST", headers, body: JSON.stringify(input ?? {}) }, opts);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = out?.error?.message ?? (typeof out?.error === "string" ? out.error : null) ?? `Request failed (${res.status}).`;
    throw friendly(out?.error?.code ?? out?.code ?? (p ? "payment_failed" : "http_error"), msg, opts.network, p?.from);
  }
  if (out.receipt) logSpend({ at: Date.now(), usd: out.receipt.amountUsd, resource: id, network: opts.network, tx: out.receipt.tx, payer: out.receipt.payer ?? p?.from ?? "", via: opts.payer.kind });
  return out as { result: any; receipt: Receipt };
}

/**
 * Deletes what Siro stored for one paid call (its media file). The wallet that paid signs forgetMessage(tx):
 * Budget signs locally, a connected wallet asks first. `payer` is the address on the receipt.
 */
export async function forgetResult(tx: string, payer: string, via: Payer) {
  const message = forgetMessage(tx);
  let signature: string;
  const agent = agentAccount();
  const sol = agentSolana();
  if (via.kind === "agent" && agent && agent.address.toLowerCase() === payer.toLowerCase()) signature = await agent.signMessage({ message });
  else if (via.kind === "agent" && sol && sol.address === payer) signature = base58.encode(await sol.payer.sign(new TextEncoder().encode(message)));
  else if (connected && connected.address.toLowerCase() === payer.toLowerCase())
    signature = (await connected.provider.request({ method: "personal_sign", params: [toHex(message), connected.address] })) as string;
  else throw new PayError("not_payer", "Connect the wallet that paid for this call to delete its result.");
  const res = await fetch(`/v1/results/${encodeURIComponent(tx)}/forget`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayError(out?.error?.code ?? "http_error", out?.error?.message ?? `Request failed (${res.status}).`);
  return out as { forgotten: true; media: string };
}

/** The EVM address that would pay for this payer, or null when there is none yet. */
export function payingAddress(payer: Payer): string | null {
  if (payer.kind === "agent") return agentAccount()?.address ?? null;
  return connected?.address ?? null;
}

export type HolderInfo = { siro: number; tier: { name: string; discountPct: number; freePerDay: number } | null; freeLeftToday: number; freeTools: string[] };
const holderCache = new Map<string, { at: number; info: Promise<HolderInfo | null> }>();
/** $SIRO balance and tier for an address, from /api/holder (kept 30 s). Null when it cannot be read. */
export function holderInfo(address: string, fresh = false): Promise<HolderInfo | null> {
  const k = address.toLowerCase();
  const hit = holderCache.get(k);
  if (hit && !fresh && Date.now() - hit.at < 30_000) return hit.info;
  const info = fetch(`/api/holder/${k}`)
    .then((r) => (r.ok ? (r.json() as Promise<HolderInfo>) : null))
    .catch(() => null);
  holderCache.set(k, { at: Date.now(), info });
  return info;
}

const PASS_KEY = "siro.holder.pass";
/** A signed holder pass for the connected wallet, reused until an hour before it expires. */
async function holderPass(): Promise<string> {
  if (!connected) throw new PayError("not_connected", "Connect the wallet that holds $SIRO first.");
  const addr = connected.address.toLowerCase();
  try {
    const saved = JSON.parse(localStorage.getItem(PASS_KEY) ?? "null") as { address: string; expires: number; value: string } | null;
    if (saved && saved.address === addr && saved.expires - 3600 > Date.now() / 1000) return saved.value;
  } catch {
    /* storage blocked: sign a new pass */
  }
  const expires = Math.floor(Date.now() / 1000) + PASS_MAX_SECONDS;
  const sig = (await connected.provider.request({ method: "personal_sign", params: [toHex(passMessage(addr, expires)), connected.address] })) as string;
  const value = `${addr}.${expires}.${sig}`;
  try {
    localStorage.setItem(PASS_KEY, JSON.stringify({ address: addr, expires, value }));
  } catch {
    /* the pass still works for this call */
  }
  return value;
}

/** Runs one of Siro's own data tools free with a holder pass. The wallet signs the pass once a day. */
export async function callFree(id: string, input: unknown) {
  const pass = await holderPass();
  const res = await fetch(`/v1/${id}`, { method: "POST", headers: { "content-type": "application/json", "x-siro-pass": pass }, body: JSON.stringify(input ?? {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out?.error?.code === "invalid_pass") localStorage.removeItem(PASS_KEY);
    throw new PayError(out?.error?.code ?? "http_error", out?.error?.message ?? `Request failed (${res.status}).`);
  }
  if (connected) holderCache.delete(connected.address.toLowerCase());
  return out as { result: any; free: { holder: string; tier: string; leftToday: number } };
}

// ---- Third-party x402 services (found through discovery, called through the relay) ----

/** fetch() through /api/relay, so the browser can reach services that do not allow CORS. */
const relayFetch: typeof fetch = async (input, init) => {
  const h: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (h[k] = v));
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: String(input), method: init?.method ?? "GET", headers: h, body: typeof init?.body === "string" ? init.body : undefined }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || typeof j.status !== "number") throw new PayError(j?.error?.code ?? "relay_failed", j?.error?.message ?? "The relay could not reach that service.");
  const body = j.encoding === "base64" ? Uint8Array.from(atob(j.body), (ch) => ch.charCodeAt(0)) : j.body;
  return new Response(j.status === 204 ? null : body, { status: j.status, headers: j.headers });
};

export type Service = { url: string; method: string; name: string | null; description: string; priceUsd: number | null; networks: string[]; payable: boolean; input: unknown; outputExample: unknown; icon: string | null };

export async function discoverServices(q: string): Promise<Service[]> {
  const r = await fetch(`/api/discover?q=${encodeURIComponent(q)}&limit=12`);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new PayError(j?.error?.code ?? "discovery_failed", j?.error?.message ?? "Discovery is unavailable.");
  return j.services;
}

const dataUrl = async (res: Response, type: string) => {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type.split(";")[0]};base64,${btoa(s)}`;
};

/** Call a third-party x402 service. GET input becomes the query string, POST input the JSON body. */
export async function callExternal(svc: { url: string; method: string }, input: unknown, opts: { payer: Payer; network: PayNetworkKey; confirm?: (usd: number) => Promise<boolean> | boolean }) {
  const get = svc.method === "GET";
  const qs = get && input && typeof input === "object" && Object.keys(input).length ? new URLSearchParams(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, String(v)])).toString() : "";
  const url = qs ? `${svc.url}${svc.url.includes("?") ? "&" : "?"}${qs}` : svc.url;
  const prefer: PayNetworkKey[] = [opts.network, ...PAY_KEYS.filter((n) => n !== opts.network)];
  const init: RequestInit = get ? { method: "GET" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? {}) };
  // Tools sold on Siro (/v1/s/<id>) are same-origin: called directly, not through the relay.
  const own = new URL(svc.url, location.href).origin === location.origin;
  const { res, paid: p } = await paid(own ? new URL(url, location.href).pathname : url, init, { ...opts, prefer, fetch: own ? fetch.bind(window) : relayFetch });
  const type = res.headers.get("content-type") ?? "";
  const host = new URL(svc.url).host;
  let result: any;
  if (/json/.test(type)) result = await res.json().catch(() => null);
  else if (/^(image|audio)\//.test(type)) result = { [type.startsWith("image") ? "image" : "audio"]: await dataUrl(res, type) };
  else result = { text: await res.text() };
  if (!res.ok) throw new PayError(p ? "payment_failed" : "http_error", `${host} answered ${res.status}: ${JSON.stringify(result).slice(0, 200)}`);
  // The hash comes from the third party's header: keep it only if it looks like one (EVM hex or a Solana signature).
  const tx = typeof p?.tx === "string" && /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{43,90})$/.test(p.tx) ? p.tx : "";
  if (p) logSpend({ at: Date.now(), usd: p.req.usd, resource: `${host}${new URL(svc.url).pathname}`, network: p.req.chain.key, tx, payer: p.from, via: opts.payer.kind });
  return { result, paid: p ? { usd: p.req.usd, network: p.req.chain.key, tx } : null };
}

// ---- Swaps (KyberSwap aggregator, signed and sent from this device) ----

async function walletFor(payer: Payer, n: NetworkKey) {
  if (payer.kind === "agent") {
    const account = agentAccount();
    if (!account) throw new PayError("no_agent_wallet", "Create a Budget first.");
    return createWalletClient({ account, chain: CHAINS[n], transport: http() });
  }
  if (!connected) throw new PayError("not_connected", "Connect a wallet first.");
  await ensureChain(connected.provider, n);
  return createWalletClient({ account: connected.address, chain: CHAINS[n], transport: custom(connected.provider) });
}

const tokenCache: Partial<Record<NetworkKey, Token[]>> = {};
export async function tokenList(n: NetworkKey): Promise<Token[]> {
  if (!tokenCache[n]) {
    const j = await fetch(`/api/tokens?network=${n}`)
      .then((r) => r.json())
      .catch(() => null);
    tokenCache[n] = j?.tokens ?? TOKENS[n];
  }
  return tokenCache[n]!;
}
const lookup = async (n: NetworkKey, sym: string) => (await tokenList(n)).find((t) => t.symbol.toLowerCase() === sym.toLowerCase()) ?? null;

export async function getSwapQuote(n: NetworkKey, from: string, to: string, amount: string): Promise<SwapQuote> {
  try {
    const c = publicClient(n) as any;
    const [tokenIn, tokenOut] = await Promise.all([resolveToken(n, from, c, lookup), resolveToken(n, to, c, lookup)]);
    return await quoteSwap({ network: n, tokenIn, tokenOut, amount });
  } catch (e: any) {
    throw new PayError(e?.code ?? "quote_failed", e?.shortMessage ?? e?.message ?? "No quote.");
  }
}

/** Swaps always need an explicit approval in the UI; the Budget also enforces the per-swap cap. */
export async function doSwap(q: SwapQuote, payer: Payer, step?: (s: string) => void) {
  if (payer.kind === "agent") {
    const l = limits();
    if (!q.amountInUsd) throw new PayError("no_usd_value", "Could not value this swap in USD, so Budget will not send it. Use My wallet.");
    if (q.amountInUsd > l.perSwap) throw new PayError("over_swap_cap", `${usdText(q.amountInUsd)} is above your per-swap cap of ${usdText(l.perSwap)}. Raise it in Budget.`);
  }
  try {
    const wallet = await walletFor(payer, q.network);
    const out = await executeSwap({ quote: q, wallet, client: publicClient(q.network) as any, step });
    logSpend({ at: Date.now(), usd: 0, resource: `swap ${q.amountIn} ${q.tokenIn.symbol} to ${q.tokenOut.symbol}`, network: q.network, tx: out.tx, payer: wallet.account!.address, via: payer.kind });
    return out;
  } catch (e: any) {
    if (e instanceof PayError) throw e;
    throw new PayError(e?.code ?? "swap_failed", e?.shortMessage ?? e?.message ?? "Swap failed.");
  }
}
