// Chain reads for the on-chain resources. Robinhood Chain and Base share one code path;
// only the RPC, the stablecoin and the GeckoTerminal network id differ.
import { createPublicClient, erc20Abi, fallback, formatUnits, getAddress, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";
import { base, robinhood } from "viem/chains";
import { NETWORKS, type NetworkKey } from "../shared/catalog";
import { Fail } from "./fail";

const STABLE: Record<NetworkKey, { address: Address; symbol: string }> = {
  robinhood: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
};

export function networkOf(v: unknown): NetworkKey {
  if (v === undefined || v === null || v === "") return "robinhood";
  const s = String(v).toLowerCase();
  if (s === "robinhood" || s === "4663" || s === "eip155:4663") return "robinhood";
  if (s === "base" || s === "8453" || s === "eip155:8453") return "base";
  throw new Fail(400, "invalid_network", "network must be robinhood or base");
}

export function addressOf(v: unknown, field = "address"): Address {
  if (typeof v !== "string" || !isAddress(v.trim(), { strict: false })) throw new Fail(400, "invalid_address", `${field} must be a 0x address`);
  return getAddress(v.trim());
}

const RPCS: Record<NetworkKey, string[]> = {
  robinhood: ["https://robinhood.drpc.org", robinhood.rpcUrls.default.http[0]],
  base: [base.rpcUrls.default.http[0], "https://base-rpc.publicnode.com", "https://base.drpc.org"],
};

export function client(env: Env, net: NetworkKey): PublicClient {
  const first = net === "robinhood" ? env.RPC_URL : env.BASE_RPC_URL;
  const urls = [...new Set([...(first ? [first] : []), ...RPCS[net]])];
  return createPublicClient({
    chain: net === "robinhood" ? robinhood : base,
    batch: { multicall: { wait: 10 } },
    transport: fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 1, retryDelay: 400 }))),
  }) as PublicClient;
}

const rpcFail = (err: unknown) => {
  console.error(JSON.stringify({ event: "rpc_failed", err: String((err as any)?.shortMessage ?? err).slice(0, 300) }));
  return new Fail(502, "chain_unavailable", "The chain RPC did not answer. You were not charged.");
};

export async function readToken(env: Env, net: NetworkKey, address: Address) {
  const c = client(env, net);
  const code = await c.getCode({ address }).catch((e) => {
    throw rpcFail(e);
  });
  if (!code || code === "0x") throw new Fail(404, "not_a_contract", `No contract at ${address} on ${NETWORKS[net].name}.`);
  const r = await c
    .multicall({ contracts: (["name", "symbol", "decimals", "totalSupply"] as const).map((functionName) => ({ address, abi: erc20Abi, functionName })), allowFailure: true })
    .catch((e) => {
      throw rpcFail(e);
    });
  const [name, symbol, decimals, supply] = r.map((x) => (x.status === "success" ? x.result : null));
  const dec = typeof decimals === "number" ? decimals : null;
  return {
    address,
    network: net,
    name: (name as string) ?? null,
    symbol: (symbol as string) ?? null,
    decimals: dec,
    totalSupply: supply === null ? null : dec === null ? String(supply) : formatUnits(supply as bigint, dec),
    explorer: `${NETWORKS[net].explorer}/token/${address}`,
  };
}

// ---- GeckoTerminal data ----
// The public GeckoTerminal API rate-limits Cloudflare's shared egress IPs almost every time,
// so the same on-chain endpoints are read through CoinGecko's keyed API when CG_API_KEY is
// set (limits are per key there). The public API stays as a fallback.

/** Is the keyed CoinGecko route answering from here? Checked at most once a minute. */
export async function marketHealth(env: Env) {
  const key = new Request("https://siro.internal/health/market");
  const hit = await caches.default.match(key);
  if (hit) return hit.json() as Promise<{ keyed: boolean; status: number; ok: boolean }>;
  let status = 0;
  if (env.CG_API_KEY) {
    const pro = env.CG_API_KEY.startsWith("CG-") ? "api" : "pro-api";
    const res = await fetch(`https://${pro}.coingecko.com/api/v3/onchain/networks/robinhood/trending_pools?page=1`, { headers: { accept: "application/json", [pro === "api" ? "x-cg-demo-api-key" : "x-cg-pro-api-key"]: env.CG_API_KEY } }).catch(() => null);
    status = res?.status ?? 0;
  }
  const out = { keyed: !!env.CG_API_KEY, status, ok: status === 200 };
  await caches.default.put(key, new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=60" } }));
  return out;
}

async function gecko(env: Env, path: string) {
  const cache = caches.default;
  const key = new Request(`https://api.geckoterminal.com/api/v2${path}`);
  const hit = await cache.match(key);
  if (hit) return hit.json() as Promise<any>;
  const tries: [string, Record<string, string>][] = [];
  if (env.CG_API_KEY) {
    const pro = env.CG_API_KEY.startsWith("CG-") ? "api" : "pro-api";
    const header = pro === "api" ? "x-cg-demo-api-key" : "x-cg-pro-api-key";
    tries.push([`https://${pro}.coingecko.com/api/v3/onchain${path}`, { accept: "application/json", [header]: env.CG_API_KEY }]);
  }
  tries.push([key.url, { accept: "application/json;version=20230302" }], [key.url, { accept: "application/json;version=20230302" }]);
  let status = 0;
  for (const [url, headers] of tries) {
    let res = await fetch(url, { headers }).catch(() => null);
    if (res?.status === 429 && url.includes("coingecko.com")) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url, { headers }).catch(() => null);
    }
    if (res?.ok) {
      const body = await res.text();
      await cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": "max-age=60" } }));
      return JSON.parse(body);
    }
    status = res?.status ?? 0;
    console.error(JSON.stringify({ event: "market_fetch_failed", host: new URL(url).host, status }));
  }
  throw new Fail(502, "market_unavailable", `Market data is busy (${status}). You were not charged.`);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function pool(p: any, included: any[] = []) {
  const a = p.attributes ?? {};
  const baseId = p.relationships?.base_token?.data?.id;
  const tok = included.find((t) => t.id === baseId)?.attributes;
  return {
    name: a.name,
    address: a.address,
    dex: p.relationships?.dex?.data?.id ?? null,
    baseToken: tok ? { address: tok.address, symbol: tok.symbol, name: tok.name } : baseId ? { address: String(baseId).split("_").pop() } : null,
    priceUsd: num(a.base_token_price_usd),
    liquidityUsd: num(a.reserve_in_usd),
    fdvUsd: num(a.fdv_usd),
    marketCapUsd: num(a.market_cap_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    change1h: num(a.price_change_percentage?.h1),
    change24h: num(a.price_change_percentage?.h24),
    txns24h: a.transactions?.h24 ? (a.transactions.h24.buys ?? 0) + (a.transactions.h24.sells ?? 0) : null,
    createdAt: a.pool_created_at ?? null,
  };
}

export async function tokenMarket(env: Env, net: NetworkKey, address: Address) {
  try {
    const [t, j] = await Promise.all([
      gecko(env, `/networks/${NETWORKS[net].gecko}/tokens/${address.toLowerCase()}`),
      gecko(env, `/networks/${NETWORKS[net].gecko}/tokens/${address.toLowerCase()}/pools?page=1&include=base_token`),
    ]);
    const a = t?.data?.attributes ?? {};
    const pools = (j.data ?? []).slice(0, 5).map((p: any) => pool(p, j.included));
    // 24h change comes from the deepest pool where this token is the base side.
    const own = (j.data ?? []).find((p: any) => String(p.relationships?.base_token?.data?.id ?? "").toLowerCase().endsWith(address.toLowerCase()));
    return {
      market: a.price_usd
        ? {
            priceUsd: num(a.price_usd),
            liquidityUsd: num(a.total_reserve_in_usd),
            volume24hUsd: num(a.volume_usd?.h24),
            change24h: own ? num(own.attributes?.price_change_percentage?.h24) : null,
            fdvUsd: num(a.fdv_usd),
            marketCapUsd: num(a.market_cap_usd),
          }
        : null,
      pools,
    };
  } catch (e) {
    if (e instanceof Fail && e.status === 502) return { market: null, pools: [], note: "market data unavailable right now" };
    throw e;
  }
}

export async function poolList(env: Env, net: NetworkKey, kind: "trending" | "new") {
  const path = kind === "trending" ? `/networks/${NETWORKS[net].gecko}/trending_pools?page=1&include=base_token` : `/networks/${NETWORKS[net].gecko}/new_pools?page=1&include=base_token`;
  const j = await gecko(env, path);
  return (j.data ?? []).slice(0, 15).map((p: any) => pool(p, j.included));
}

// ---- Contract check ----

const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const EIP1967_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
// Pre-1967 OpenZeppelin (zos) proxies, still used by e.g. Circle's FiatTokenProxy.
const ZOS_IMPL = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const ZOS_ADMIN = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b";
const OWNABLE = parseAbi(["function owner() view returns (address)", "function getOwner() view returns (address)"]);

const slotAddress = (v: string | undefined) => {
  if (!v || /^0x0*$/.test(v)) return null;
  const a = "0x" + v.slice(-40);
  return /^0x0{40}$/.test(a) ? null : getAddress(a);
};

export async function contractCheck(env: Env, net: NetworkKey, address: Address) {
  const c = client(env, net);
  const code = await c.getCode({ address }).catch((e) => {
    throw rpcFail(e);
  });
  if (!code || code === "0x") return { address, network: net, isContract: false, owner: null, proxy: null, implementation: null, notes: ["No contract code here: this is a wallet (EOA) or an empty address."] };
  if (code.startsWith("0xef0100")) return { address, network: net, isContract: false, owner: null, proxy: null, implementation: null, notes: ["EIP-7702 delegated wallet, not a token contract."] };
  const [impl1967, admin1967, beacon, implZos, adminZos] = await Promise.all(
    [EIP1967_IMPL, EIP1967_ADMIN, EIP1967_BEACON, ZOS_IMPL, ZOS_ADMIN].map((slot) => c.getStorageAt({ address, slot: slot as `0x${string}` }).catch(() => undefined)),
  );
  const impl = slotAddress(impl1967) ? impl1967 : implZos;
  const admin = slotAddress(admin1967) ? admin1967 : adminZos;
  const owners = await c.multicall({ contracts: [{ address, abi: OWNABLE, functionName: "owner" }, { address, abi: OWNABLE, functionName: "getOwner" }], allowFailure: true }).catch(() => []);
  const ownerRaw = owners.find((o: any) => o.status === "success")?.result as Address | undefined;
  const owner = ownerRaw && !/^0x0{40}$/i.test(ownerRaw) ? getAddress(ownerRaw) : null;
  const implementation = slotAddress(impl);
  const beaconAddr = slotAddress(beacon);
  const notes: string[] = [];
  if (implementation || beaconAddr) notes.push("Upgradeable proxy: the code behind this address can be swapped by whoever controls the proxy.");
  if (slotAddress(admin)) notes.push(`Proxy admin: ${slotAddress(admin)}.`);
  if (owner) notes.push(`Has an owner (${owner}). Check which owner-only functions exist before trusting it.`);
  else if (ownerRaw) notes.push("Ownership renounced (owner is the zero address).");
  else notes.push("No owner() function found.");
  notes.push(`Bytecode size: ${(code.length - 2) / 2} bytes.`);
  return { address, network: net, isContract: true, owner, proxy: implementation || beaconAddr ? (beaconAddr ? "beacon" : slotAddress(impl1967) ? "eip1967" : "zos") : null, implementation: implementation ?? beaconAddr, notes };
}

export async function walletBalances(env: Env, net: NetworkKey, address: Address, extra: Address[]) {
  const c = client(env, net);
  const tokens = [STABLE[net].address, ...extra.filter((t) => t.toLowerCase() !== STABLE[net].address.toLowerCase())].slice(0, 11);
  const [eth, reads] = await Promise.all([
    c.getBalance({ address }).catch((e) => {
      throw rpcFail(e);
    }),
    c
      .multicall({
        contracts: tokens.flatMap((t) => [
          { address: t, abi: erc20Abi, functionName: "balanceOf", args: [address] },
          { address: t, abi: erc20Abi, functionName: "decimals" },
          { address: t, abi: erc20Abi, functionName: "symbol" },
        ]),
        allowFailure: true,
      })
      .catch((e) => {
        throw rpcFail(e);
      }),
  ]);
  const balances: { symbol: string; token: string | null; amount: string }[] = [{ symbol: "ETH", token: null, amount: formatUnits(eth, 18) }];
  tokens.forEach((t, i) => {
    const [bal, dec, sym] = [reads[i * 3], reads[i * 3 + 1], reads[i * 3 + 2]];
    if (bal?.status !== "success" || dec?.status !== "success") return;
    balances.push({ symbol: sym?.status === "success" ? String(sym.result) : "?", token: t, amount: formatUnits(bal.result as bigint, Number(dec.result)) });
  });
  return { address, network: net, balances };
}

export async function gasNow(env: Env, net: NetworkKey) {
  const c = client(env, net);
  const [block, gas] = await Promise.all([c.getBlockNumber(), c.getGasPrice()]).catch((e) => {
    throw rpcFail(e);
  });
  return { network: net, block: Number(block), gasPriceGwei: Number(formatUnits(gas, 9)) };
}
