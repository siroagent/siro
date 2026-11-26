// $SIRO balances and holder passes. Balances are read from Robinhood Chain and kept for 60 s in the edge cache.
import { Hono } from "hono";
import { erc20Abi, formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";
import { FREE_TOOLS, PASS_MAX_SECONDS, SIRO_DECIMALS, TIERS, passMessage, tierFor, type Tier } from "../shared/holder";
import { TOKEN } from "../shared/token";
import { client } from "./onchain";

const today = () => new Date().toISOString().slice(0, 10);

/** Whole $SIRO held by `addr`, or 0 when there is no token or the chain cannot be read. */
export async function siroBalance(env: Env, addr: Address): Promise<number> {
  if (!TOKEN) return 0;
  const key = new Request(`https://siro.internal/siro-balance/${addr.toLowerCase()}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return Number(await hit.text());
  try {
    const raw = await client(env, "robinhood").readContract({ address: TOKEN.ca as Address, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
    const n = Number(formatUnits(raw, SIRO_DECIMALS));
    await cache.put(key, new Response(String(n), { headers: { "cache-control": "max-age=60" } }));
    return n;
  } catch (e) {
    console.error(JSON.stringify({ event: "siro_balance_failed", err: String(e).slice(0, 200) }));
    return 0;
  }
}

/** The tier the `x-siro-holder` header claims, checked on-chain. Null when absent, malformed or below 1M. */
export async function holderTier(env: Env, header: string | undefined): Promise<{ address: Address; siro: number; tier: Tier } | null> {
  const v = header?.trim();
  if (!v || !isAddress(v, { strict: false })) return null;
  const address = getAddress(v);
  const siro = await siroBalance(env, address);
  const tier = tierFor(siro);
  return tier ? { address, siro, tier } : null;
}

export type Pass = { address: Address; siro: number; tier: Tier };

/** Reads `x-siro-pass: <address>.<expires>.<signature>`. Throws a readable reason when it does not hold. */
export async function readPass(env: Env, header: string): Promise<Pass> {
  const [a, e, sig] = header.trim().split(".");
  if (!a || !isAddress(a, { strict: false }) || !/^\d+$/.test(e ?? "") || !/^0x[0-9a-fA-F]+$/.test(sig ?? "")) throw new Error("The holder pass is malformed. Sign a new one.");
  const expires = Number(e);
  const now = Math.floor(Date.now() / 1000);
  if (expires < now) throw new Error("The holder pass expired. Sign a new one.");
  if (expires > now + PASS_MAX_SECONDS + 60) throw new Error("A holder pass can last 24 hours at most.");
  const address = getAddress(a);
  const ok = await client(env, "robinhood")
    .verifyMessage({ address, message: passMessage(address, expires), signature: sig as Hex })
    .catch(() => false);
  if (!ok) throw new Error("The holder pass signature does not match the address.");
  const siro = await siroBalance(env, address);
  const tier = tierFor(siro);
  if (!tier) throw new Error(`Free calls need at least ${TIERS[TIERS.length - 1].min.toLocaleString("en-US")} $SIRO in this wallet; it holds ${Math.floor(siro).toLocaleString("en-US")}.`);
  return { address, siro, tier };
}

export async function freeUsed(env: Env, address: string) {
  const row = await env.DB.prepare("SELECT n FROM holder_free WHERE address = ?1 AND day = ?2").bind(address.toLowerCase(), today()).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Takes one free call if the day's allowance has room. Returns the calls left after it, or null when used up. */
export async function takeFree(env: Env, address: string, perDay: number): Promise<number | null> {
  const row = await env.DB.prepare(
    "INSERT INTO holder_free (address, day, n) VALUES (?1, ?2, 1) ON CONFLICT (address, day) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n",
  )
    .bind(address.toLowerCase(), today(), perDay)
    .first<{ n: number }>();
  return row ? perDay - row.n : null;
}
export async function giveBackFree(env: Env, address: string) {
  await env.DB.prepare("UPDATE holder_free SET n = n - 1 WHERE address = ?1 AND day = ?2 AND n > 0").bind(address.toLowerCase(), today()).run();
}

/** GET /api/holder/:address — balance, tier and today's free calls. Free. */
export const holder = new Hono<{ Bindings: Env }>();
holder.get("/holder/:address", async (c) => {
  const a = c.req.param("address");
  if (!isAddress(a, { strict: false })) return c.json({ error: "invalid_address", message: "Use a 0x address." }, 400);
  const address = getAddress(a);
  const siro = await siroBalance(c.env, address);
  const tier = tierFor(siro);
  const used = tier ? await freeUsed(c.env, address) : 0;
  c.header("Cache-Control", "public, max-age=30");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({
    address,
    token: TOKEN?.ca ?? null,
    siro,
    tier: tier ? { name: tier.name, discountPct: tier.discountPct, freePerDay: tier.freePerDay } : null,
    freeLeftToday: tier ? Math.max(0, tier.freePerDay - used) : 0,
    freeTools: FREE_TOOLS,
    tiers: TIERS,
  });
});
