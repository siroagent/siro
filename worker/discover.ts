// Discovery: find x402 services beyond Siro's own catalog, through the public x402
// Bazaar index (Coinbase CDP). Also a narrow relay so the web app can call those services
// despite CORS: it only forwards to URLs that discovery has returned, and it never signs or
// holds anything. The payment header comes from the visitor's browser.
import { Hono } from "hono";
import { PAY_CHAINS } from "../shared/x402client";
import { Fail } from "./fail";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { searchListings } from "./sell";

const BAZAAR = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const RELAY_MAX_BODY = 64_000;
const RELAY_MAX_RESPONSE = 2_000_000;
const SEEN_FOR = 14 * 86400;

/** Cuts long text at the last whole word before `max` characters, ending with an ellipsis. */
const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const at = s.lastIndexOf(" ", max - 1);
  return `${(at > 0 ? s.slice(0, at) : s.slice(0, max)).replace(/[\s,;:(-]+$/, "")}…`;
};

export type Service = {
  url: string;
  method: string;
  name: string | null;
  description: string;
  /** Lowest price among the options Siro can pay, in USD. Null when none are payable. */
  priceUsd: number | null;
  networks: string[];
  payable: boolean;
  input: unknown;
  outputExample: unknown;
  icon: string | null;
  /** Set for a partner service Siro features: the partner's name. */
  featured?: string;
};

/** Partner x402 services Siro shows first when a search matches. Each one is probed for its real 402
 *  before it is shown, so a partner appears only while its endpoint is up and payable. */
export const FEATURED: { partner: string; name: string; url: string; words: string[] }[] = [
  {
    partner: "ApexFaucet",
    name: "Robinhood Chain launch feed with a real sell test",
    url: "https://apexfaucet.xyz/api/x402/robinhood-launch-feed",
    words: ["robinhood", "launch", "launches", "new token", "new tokens", "sell test", "can sell", "honeypot", "rug", "exit", "trap", "memecoin", "pool", "pools"],
  },
];
const PROBE_FOR = 600;

export function normalize(it: any): Service | null {
  if (!it?.resource || !/^https:\/\//.test(it.resource)) return null;
  const info = it.extensions?.bazaar?.info ?? {};
  const payable = (it.accepts ?? []).filter((a: any) => {
    const c = PAY_CHAINS.find((c) => c.caip === a.network || c.v1 === a.network);
    return c && a.scheme === "exact" && String(a.asset ?? "").toLowerCase() === c.stable.toLowerCase();
  });
  const price = payable.length ? Math.min(...payable.map((a: any) => Number(it.x402Version === 1 ? a.maxAmountRequired : a.amount) / 1e6)) : null;
  return {
    url: it.resource,
    method: String(info.input?.method ?? (info.input?.body ? "POST" : "GET")).toUpperCase(),
    name: it.serviceName ?? null,
    description: clip(String(it.description ?? it.extensions?.bazaar?.description ?? ""), 400),
    priceUsd: price !== null && Number.isFinite(price) ? price : null,
    networks: [...new Set((it.accepts ?? []).map((a: any) => String(a.network)))] as string[],
    payable: payable.length > 0,
    input: info.input?.body ?? info.input?.queryParams ?? null,
    outputExample: info.output?.example ?? null,
    icon: typeof it.iconUrl === "string" && it.iconUrl.startsWith("https://") ? it.iconUrl : null,
  };
}

/** Search the Bazaar. Payable services (USDG on Robinhood Chain; USDC on Solana, Base, Arbitrum, Polygon) come first. */
/** Seller listings on Siro first (they settle only on a result), then the Bazaar. When the Bazaar
 *  is down, listings that match are still returned. */
export async function discover(env: Env, query: string, limit = 12): Promise<Service[]> {
  const own = await searchListings(env, query, Math.min(limit, 5)).catch(() => [] as Service[]);
  const partners = await featured(env, query).catch(() => [] as Service[]);
  const first = [...own, ...partners];
  try {
    const rest = (await discoverBazaar(env, query, limit)).filter((s) => !first.some((f) => f.url === s.url));
    return [...first, ...rest].slice(0, limit);
  } catch (e) {
    if (first.length) return first.slice(0, limit);
    throw e;
  }
}

/** The featured partners a query is about: one of their words, as whole words. */
export function matchFeatured(query: string) {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return FEATURED.filter((f) => f.words.some((w) => q.includes(` ${w} `)));
}

/** Featured partners whose words match the query, each with the terms from its live 402. */
export async function featured(env: Env, query: string): Promise<Service[]> {
  const found = await Promise.all(
    matchFeatured(query).map(async (f): Promise<Service | null> => {
      const s = await probe(f.url);
      return s?.payable ? { ...s, name: `${f.name} (${f.partner})`, featured: f.partner } : null;
    }),
  );
  const out = found.filter((s): s is Service => s !== null);
  await remember(env, out);
  return out;
}

/** The service as its own 402 describes it, or null when it does not answer with a payable 402. */
async function probe(url: string): Promise<Service | null> {
  const cache = caches.default;
  const key = new Request(`https://siroagent.com/__featured-probe?u=${encodeURIComponent(url)}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as Service | null;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "SiroDiscovery/1.0 (+https://siroagent.com)" }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  let svc: Service | null = null;
  if (res?.status === 402) {
    let req: any = null;
    const header = res.headers.get("payment-required");
    try {
      req = header ? JSON.parse(atob(header)) : await res.json();
    } catch {
      req = null;
    }
    if (req?.accepts) {
      const r = typeof req.resource === "object" ? req.resource : {};
      svc = normalize({ ...req, resource: url, description: r.description ?? req.description, serviceName: r.serviceName ?? null });
    }
  }
  await cache.put(key, new Response(JSON.stringify(svc), { headers: { "content-type": "application/json", "cache-control": `max-age=${PROBE_FOR}` } }));
  return svc;
}

/** Lets the relay forward to these services. */
async function remember(env: Env, list: Service[]) {
  if (!list.length) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch(
    list.map((s) =>
      env.DB.prepare(
        "INSERT INTO x402_services (url, method, name, description, price_usd, networks, payable, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (url) DO UPDATE SET method = ?2, name = ?3, description = ?4, price_usd = ?5, networks = ?6, payable = ?7, seen_at = ?8",
      ).bind(s.url, s.method, s.name, s.description, s.priceUsd, s.networks.join(","), s.payable ? 1 : 0, now),
    ),
  );
}

async function discoverBazaar(env: Env, query: string, limit: number): Promise<Service[]> {
  // The index answers 400 above limit=20.
  const url = `${BAZAAR}/search?query=${encodeURIComponent(query)}&limit=${Math.min(Math.max(limit * 2, 10), 20)}`;
  const cache = caches.default;
  const key = new Request(url);
  let body: any;
  const hit = await cache.match(key);
  if (hit) body = await hit.json();
  else {
    let res: Response | null = null;
    for (let i = 0; i < 2 && !res?.ok; i++) {
      res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!res?.ok) console.error(JSON.stringify({ event: "discovery_failed", status: res?.status ?? "network", body: (await res?.text().catch(() => ""))?.slice(0, 200) }));
    }
    if (!res?.ok) throw new Fail(502, "discovery_unavailable", `The x402 index did not answer (${res?.status ?? "network"}).`);
    body = await res.json();
    await cache.put(key, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "max-age=300" } }));
  }
  const all = ((body.resources ?? body.items ?? []) as any[]).map(normalize).filter((s): s is Service => !!s);
  const seen = new Set<string>();
  const list = all
    .filter((s) => !s.url.startsWith("https://siroagent.com/") && !seen.has(s.url) && seen.add(s.url))
    .sort((a, b) => Number(b.payable) - Number(a.payable))
    .slice(0, limit);
  await remember(env, list);
  return list;
}

export const discovery = new Hono<{ Bindings: Env }>();

const err = (e: unknown) => {
  if (e instanceof Fail) return { body: { error: { code: e.code, message: e.message } }, status: e.status };
  throw e;
};

discovery.get("/discover", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (q.length < 2) return c.json({ error: { code: "missing_query", message: "Add ?q= with what you need, e.g. ?q=weather" } }, 400);
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  if ((await overLimit(c.env.DB, `disc:${ip}`, 120, 3600)).limited) return c.json({ error: { code: "rate_limited", message: "Too many searches. Try again later." } }, 429);
  try {
    const services = await discover(c.env, q, Math.min(Number(c.req.query("limit")) || 12, 20));
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ query: q, source: "Sold on Siro, featured partners, then the x402 Bazaar (Coinbase CDP)", services });
  } catch (e) {
    const { body, status } = err(e);
    return c.json(body, status);
  }
});

/** Forward one request to a discovered x402 service. Headers allowed through are listed. */
discovery.post("/relay", async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: "forbidden_origin", message: "The relay is for the Siro web app. Call services directly from code." } }, 403);
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  if ((await overLimit(c.env.DB, `relay:${ip}`, 120, 3600)).limited) return c.json({ error: { code: "rate_limited", message: "Too many relayed calls. Try again later." } }, 429);
  const j = (await c.req.json().catch(() => null)) as { url?: string; method?: string; headers?: Record<string, string>; body?: string } | null;
  if (!j?.url || typeof j.url !== "string") return c.json({ error: { code: "invalid_body", message: "Send {url, method, headers, body}." } }, 400);
  const method = String(j.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return c.json({ error: { code: "invalid_method", message: "GET or POST only." } }, 400);
  if (typeof j.body === "string" && j.body.length > RELAY_MAX_BODY) return c.json({ error: { code: "too_large", message: "Body over 64 KB." } }, 413);
  // The exact URL, or the same URL with a query string for GET services.
  const base = j.url.split("?")[0];
  const known = await c.env.DB.prepare("SELECT url FROM x402_services WHERE (url = ?1 OR url = ?2) AND seen_at > ?3 LIMIT 1")
    .bind(j.url, base, Math.floor(Date.now() / 1000) - SEEN_FOR)
    .first();
  if (!known) return c.json({ error: { code: "unknown_service", message: "Only services returned by Siro discovery can be relayed. Search for it first." } }, 403);

  const headers = new Headers({ "user-agent": "SiroRelay/1.0 (+https://siroagent.com)", accept: "application/json, */*;q=0.5" });
  for (const [k, v] of Object.entries(j.headers ?? {})) {
    if (["payment-signature", "x-payment", "content-type"].includes(k.toLowerCase()) && typeof v === "string" && v.length < 16_000) headers.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(j.url, { method, headers, body: method === "POST" ? (j.body ?? "") : undefined, redirect: "manual" });
  } catch {
    return c.json({ error: { code: "service_unreachable", message: "The service did not answer." } }, 502);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > RELAY_MAX_RESPONSE) return c.json({ error: { code: "too_large", message: "The service answered with more than 2 MB." } }, 502);
  const type = res.headers.get("content-type") ?? "";
  const text = /json|text|xml|javascript/.test(type) || !type;
  let bin = "";
  if (!text) for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const pass: Record<string, string> = {};
  for (const h of ["content-type", "payment-required", "payment-response", "x-payment-response"]) {
    const v = res.headers.get(h);
    if (v) pass[h] = v;
  }
  return c.json({ status: res.status, headers: pass, body: text ? new TextDecoder().decode(buf) : btoa(bin), encoding: text ? "text" : "base64" });
});
