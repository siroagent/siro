// Prediction markets (Polymarket, public Gamma + CLOB APIs) and tokenized stocks on
// Robinhood Chain (Robinhood's asset registry + Chainlink reference feeds + DEX market).
import { getAddress, isAddress, parseAbi, type Address } from "viem";
import { Fail } from "./fail";
import { client, tokenMarket } from "./onchain";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

/** GET JSON with an edge cache. Upstream failures become a 502 that is never charged. */
async function getJson(url: string, ttl: number, what: string): Promise<any> {
  const cache = caches.default;
  const key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "SiroBot/1.0 (+https://siroagent.com)" } }).catch(() => null);
  if (!res?.ok) throw new Fail(502, "upstream_unavailable", `${what} did not answer (${res?.status ?? "network"}). You were not charged.`);
  const body = await res.text();
  await cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
  return JSON.parse(body);
}

const num = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try {
    const j = JSON.parse(String(v ?? "[]"));
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
};

// ---- Polymarket ----

function market(m: any, eventSlug?: string) {
  const names = parseList(m.outcomes);
  const prices = parseList(m.outcomePrices).map(Number);
  return {
    id: String(m.id),
    question: m.question,
    slug: m.slug,
    url: `https://polymarket.com/event/${eventSlug ?? m.events?.[0]?.slug ?? m.slug}`,
    outcomes: names.map((name, i) => ({ name, probability: Number.isFinite(prices[i]) ? Math.round(prices[i] * 1000) / 10 : null })),
    volume24hUsd: num(m.volume24hr),
    volumeUsd: num(m.volumeNum ?? m.volume),
    liquidityUsd: num(m.liquidityNum ?? m.liquidity),
    endDate: m.endDate ?? null,
    active: !!m.active && !m.closed,
  };
}

export async function predictionMarkets(input: { query?: string; sort?: string; limit?: number }) {
  const limit = Math.min(input.limit ?? 10, 20);
  if (input.query) {
    const j = await getJson(`${GAMMA}/public-search?q=${encodeURIComponent(input.query)}&limit_per_type=12&events_status=active`, 60, "Polymarket");
    const markets = (j.events ?? []).flatMap((e: any) => (e.markets ?? []).filter((m: any) => m.active && !m.closed).map((m: any) => market(m, e.slug)));
    markets.sort((a: any, b: any) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
    return { query: input.query, markets: markets.slice(0, limit) };
  }
  const order = input.sort === "ending" ? "order=endDate&ascending=true" : input.sort === "new" ? "order=startDate&ascending=false" : "order=volume24hr&ascending=false";
  const since = input.sort === "ending" ? `&end_date_min=${new Date().toISOString()}` : "";
  const j = await getJson(`${GAMMA}/markets?active=true&closed=false&limit=${limit}&${order}${since}`, 60, "Polymarket");
  return { sort: input.sort ?? "volume", markets: (Array.isArray(j) ? j : []).map((m: any) => market(m)) };
}

/** Accepts a Polymarket URL, an event or market slug, or a numeric market id. */
export async function findMarket(ref: string) {
  try {
    return await findMarketExact(ref);
  } catch (e) {
    if (!(e instanceof Fail) || e.status !== 404) throw e;
    // Not a live link, slug or id: treat it as a search and take the busiest open market.
    const hit = (await predictionMarkets({ query: ref.trim().slice(0, 120), limit: 1 })).markets[0];
    if (!hit) throw new Fail(404, "market_not_found", "No open Polymarket market matches that. You were not charged.");
    return findMarketExact(hit.id);
  }
}

async function findMarketExact(ref: string) {
  let s = ref.trim();
  try {
    const u = new URL(s);
    if (!/(^|\.)polymarket\.com$/.test(u.hostname)) throw new Fail(400, "invalid_field", "market must be a polymarket.com link, a slug or an id");
    s = u.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch (e) {
    if (e instanceof Fail) throw e;
  }
  if (!/^[a-z0-9-]{1,200}$/i.test(s)) throw new Fail(404, "market_not_found", "Not a Polymarket link, slug or id.");
  if (/^\d+$/.test(s)) {
    const m = await getJson(`${GAMMA}/markets/${s}`, 60, "Polymarket").catch(() => null);
    if (m?.id) return { event: null, markets: [m] };
  }
  const bySlug = await getJson(`${GAMMA}/markets?slug=${s}`, 60, "Polymarket");
  if (Array.isArray(bySlug) && bySlug.length) return { event: null, markets: bySlug };
  const ev = await getJson(`${GAMMA}/events?slug=${s}`, 60, "Polymarket");
  const e = Array.isArray(ev) ? ev[0] : null;
  if (!e) throw new Fail(404, "market_not_found", "No Polymarket market matches that. You were not charged.");
  return { event: { title: e.title, slug: e.slug, description: String(e.description ?? "").slice(0, 1500) }, markets: (e.markets ?? []).filter((m: any) => !m.closed) };
}

/** Last week of the first outcome's price, sampled every 3 hours. Optional: null when the CLOB is unreachable. */
export async function priceHistory(m: any): Promise<{ t: string; p: number }[] | null> {
  const token = parseList(m.clobTokenIds)[0];
  if (!token) return null;
  const j = await getJson(`${CLOB}/prices-history?market=${token}&interval=1w&fidelity=180`, 300, "Polymarket CLOB").catch(() => null);
  const pts = (j?.history ?? []) as { t: number; p: number }[];
  return pts.length ? pts.map((x) => ({ t: new Date(x.t * 1000).toISOString().slice(0, 16), p: Math.round(x.p * 1000) / 10 })) : null;
}

export { market as normalizeMarket };

// ---- Tokenized stocks on Robinhood Chain ----

const REGISTRY = "https://api.robinhood.com/rhj/assets";
const FEEDS = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const FEED_ABI = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);

export type Stock = { symbol: string; name: string; address: Address; multiplier: number; feed: Address | null };

export async function stockList(): Promise<Stock[]> {
  const [reg, feeds] = await Promise.all([getJson(REGISTRY, 21600, "Robinhood asset registry"), getJson(FEEDS, 21600, "Chainlink feed directory").catch(() => [])]);
  const feedMap = new Map<string, Address>();
  for (const f of Array.isArray(feeds) ? feeds : []) {
    const m = /^Robinhood\s+([A-Z.]+)\s*[-/]/.exec(f.name ?? "");
    if (m && isAddress(f.proxyAddress ?? "")) feedMap.set(m[1], getAddress(f.proxyAddress));
  }
  return (reg?.assets ?? [])
    .filter((x: any) => x.status === "ASSET_STATUS_ACTIVE")
    .flatMap((x: any) => {
      const d = (x.deployments ?? []).find((d: any) => d.chainId === 4663);
      if (!d || !isAddress(d.contractAddress ?? "")) return [];
      return [{ symbol: String(x.tokenSymbol), name: String(x.tokenName).split(" • ")[0], address: getAddress(d.contractAddress), multiplier: Number(x.currentMultiplier) || 1, feed: feedMap.get(x.tokenSymbol) ?? null }];
    })
    .sort((a: Stock, b: Stock) => a.symbol.localeCompare(b.symbol));
}

export async function stockTokens(query?: string) {
  const all = await stockList();
  const q = query?.trim().toLowerCase();
  const list = q ? all.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : all;
  return { network: "robinhood", total: all.length, stocks: list.slice(0, 60).map((s) => ({ ...s, chainlink: !!s.feed })) };
}

export async function stockQuote(env: Env, ref: string) {
  const all = await stockList();
  const r = ref.trim();
  const s = isAddress(r) ? all.find((x) => x.address.toLowerCase() === r.toLowerCase()) : all.find((x) => x.symbol.toLowerCase() === r.toLowerCase());
  if (!s) throw new Fail(404, "stock_not_found", `No active Robinhood stock token matches "${r}". You were not charged.`);
  const [reference, dex] = await Promise.all([
    s.feed
      ? client(env, "robinhood")
          .multicall({ contracts: [{ address: s.feed, abi: FEED_ABI, functionName: "latestRoundData" }, { address: s.feed, abi: FEED_ABI, functionName: "decimals" }], allowFailure: true })
          .then(([rd, dec]) => {
            if (rd.status !== "success" || dec.status !== "success") return null;
            const [, answer, , updatedAt] = rd.result as readonly [bigint, bigint, bigint, bigint, bigint];
            return { priceUsd: Number(answer) / 10 ** Number(dec.result), updatedAt: new Date(Number(updatedAt) * 1000).toISOString(), source: "Chainlink", feed: s.feed };
          })
          .catch(() => null)
      : Promise.resolve(null),
    tokenMarket(env, "robinhood", s.address),
  ]);
  const dexPrice = dex.market?.priceUsd ?? null;
  const premiumPct = reference && dexPrice ? Math.round((dexPrice / reference.priceUsd - 1) * 10000) / 100 : null;
  if (!reference && !dexPrice) throw new Fail(502, "no_price", `No reference or DEX price for ${s.symbol} right now. You were not charged.`);
  return { stock: { symbol: s.symbol, name: s.name, address: s.address, multiplier: s.multiplier }, reference, dex: dex.market, pools: dex.pools.slice(0, 3), premiumPct };
}
