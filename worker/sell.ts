// Sell a tool. A seller lists an HTTPS API with a price per call and a payout address. Buyers pay
// /v1/s/<id> over x402 like any Siro tool, but the quote's payTo is the seller's own address, so
// the stablecoin moves buyer -> seller on-chain and Siro never holds it. Siro verifies the signed
// payment, calls the seller's API, and settles only when the API returned a result.
//
// Ownership: the seller's host must publish /.well-known/siro.json naming the payout address, so
// nobody can list an API they do not control. Every call to the seller carries x-siro-secret,
// which the seller checks so their API only answers paid calls that came through Siro. The same
// secret is the owner key for pausing or removing the listing.
import { Hono, type Context } from "hono";
import { getAddress, isAddress } from "viem";
import { CATEGORIES, toUnits, type Category, type Field, type Resource } from "../shared/catalog";
import { bazaarExtension, exampleBody } from "./bazaar";
import type { Service } from "./discover";
import { Fail } from "./fail";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp } from "./request";
import { resultReceipt, settlementStatements } from "./proof";
import { prepare } from "./run";
import {
  allRequirements,
  chainFor,
  lockNonce,
  paymentError,
  paymentRequired,
  paymentResponseHeader,
  pickRequirements,
  readPayment,
  releaseNonce,
  resourceInfo,
  settlePayment,
  verifyPayment,
} from "./x402";

const ORIGIN = "https://siroagent.com";
const WELL_KNOWN = "/.well-known/siro.json";
const MIN_PRICE = 0.001;
const MAX_PRICE = 5;
const RUN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 25_000;
const MAX_RESULT_BYTES = 1_000_000;
const PAUSE_AFTER_FAILS = 5;
const MAX_FIELDS = 8;
const FIELD_TYPES = ["string", "number", "enum", "url"] as const;

type Row = {
  id: string;
  name: string;
  summary: string;
  category: string;
  price: string;
  endpoint: string;
  host: string;
  pay_to: string;
  fields: string;
  returns: string;
  secret: string;
  status: "live" | "paused" | "removed";
  fails: number;
  created_at: number;
};

/** What anyone may see. The endpoint and the secret never leave the worker. */
export type Listing = {
  id: string;
  name: string;
  summary: string;
  category: Category;
  categoryLabel: string;
  price: string;
  host: string;
  payTo: string;
  fields: Field[];
  returns: string;
  status: Row["status"];
  url: string;
  page: string;
  createdAt: number;
};

const toListing = (r: Row): Listing => ({
  id: r.id,
  name: r.name,
  summary: r.summary,
  category: r.category as Category,
  categoryLabel: CATEGORIES[r.category as Category] ?? r.category,
  price: r.price,
  host: r.host,
  payTo: r.pay_to,
  fields: JSON.parse(r.fields),
  returns: r.returns,
  status: r.status,
  url: `${ORIGIN}/v1/s/${r.id}`,
  page: `${ORIGIN}/sell/${r.id}`,
  createdAt: r.created_at,
});

/** The listing shaped like a catalog resource, so input checks and Bazaar metadata are shared. */
const asResource = (l: Listing): Resource => ({ id: `s/${l.id}`, name: l.name, category: l.category, price: l.price, summary: l.summary, provider: l.host, returns: l.returns, fields: l.fields });

const getRow = (env: Env, id: string) => env.DB.prepare("SELECT * FROM listings WHERE id = ?1").bind(id).first<Row>();

// ---- Input checks ----

const str = (v: unknown, name: string, min: number, max: number) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (s.length < min) throw new Fail(400, "invalid_field", `${name} needs at least ${min} characters.`);
  if (s.length > max) throw new Fail(400, "invalid_field", `${name} can be ${max} characters at most.`);
  return s;
};

/** A public https URL on a named host: no IP literals, no private names, no ports, no Siro itself. */
export function sellerEndpoint(v: unknown, env?: Env): URL {
  let u: URL;
  try {
    u = new URL(String(v ?? "").trim());
  } catch {
    throw new Fail(400, "invalid_endpoint", "The endpoint must be a full https:// URL.");
  }
  // Local development only (.dev.vars DEV_FREE=1): a seller API on http://localhost:<port> for testing.
  if (env?.DEV_FREE === "1" && u.protocol === "http:" && u.hostname === "localhost") return u;
  if (u.protocol !== "https:") throw new Fail(400, "invalid_endpoint", "The endpoint must use https://.");
  if (u.username || u.password || u.port) throw new Fail(400, "invalid_endpoint", "The endpoint cannot carry a user, a password or a port.");
  const h = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".") || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h)) throw new Fail(400, "invalid_endpoint", "The endpoint must be on a public domain name.");
  if (h === "siroagent.com" || h.endsWith(".siroagent.com")) throw new Fail(400, "invalid_endpoint", "That is Siro's own domain. List your API's URL.");
  if (u.toString().length > 300) throw new Fail(400, "invalid_endpoint", "The endpoint URL is longer than 300 characters.");
  u.hash = "";
  return u;
}

function payTo(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!isAddress(s)) throw new Fail(400, "invalid_pay_to", "The payout address must be an EVM address (0x followed by 40 hex characters).");
  if (/^0x0{40}$/i.test(s)) throw new Fail(400, "invalid_pay_to", "The payout address cannot be the zero address.");
  return getAddress(s);
}

function price(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Fail(400, "invalid_price", "The price is in USD with at most 3 decimals, like 0.02.");
  const n = Number(s);
  if (n < MIN_PRICE || n > MAX_PRICE) throw new Fail(400, "invalid_price", `The price must be between $${MIN_PRICE} and $${MAX_PRICE} per call.`);
  return String(n);
}

function fields(v: unknown): Field[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Fail(400, "invalid_fields", "fields must be a list.");
  if (v.length > MAX_FIELDS) throw new Fail(400, "invalid_fields", `A tool can take ${MAX_FIELDS} input fields at most.`);
  const seen = new Set<string>();
  return v.map((raw: any, i): Field => {
    const at = `Field ${i + 1}`;
    const name = String(raw?.name ?? "").trim();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw new Fail(400, "invalid_fields", `${at}: the name uses lowercase letters, digits and _ and starts with a letter.`);
    if (seen.has(name)) throw new Fail(400, "invalid_fields", `${at}: ${name} is used twice.`);
    seen.add(name);
    const type = String(raw?.type ?? "string") as (typeof FIELD_TYPES)[number];
    if (!FIELD_TYPES.includes(type)) throw new Fail(400, "invalid_fields", `${at}: the type is one of ${FIELD_TYPES.join(", ")}.`);
    const f: Field = { name, type, description: str(raw?.description, `${at} description`, 3, 200), required: raw?.required === true };
    if (type === "enum") {
      const opts = Array.isArray(raw?.options) ? raw.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 20 || opts.some((o: string) => o.length > 40)) throw new Fail(400, "invalid_fields", `${at}: a choice field needs 2 to 20 options of up to 40 characters.`);
      f.options = [...new Set<string>(opts)];
    }
    if (type === "string") f.max = Math.min(Math.max(Number(raw?.max) || 4000, 1), 20000);
    if (type === "number" && Number(raw?.max) > 0) f.max = Number(raw.max);
    const ex = raw?.example;
    if (ex !== undefined && ex !== null && ex !== "") {
      if (type === "number") {
        if (!(Number(ex) > 0)) throw new Fail(400, "invalid_fields", `${at}: the example must be a positive number.`);
        f.example = Number(ex);
      } else f.example = String(ex).slice(0, 500);
    }
    if (f.required && f.example === undefined) throw new Fail(400, "invalid_fields", `${at}: a required field needs an example. Siro uses it for the test call.`);
    return f;
  });
}

// ---- Talking to the seller ----

/** The payout addresses the seller's host allows, from /.well-known/siro.json. */
async function wellKnownPayTo(host: string): Promise<string[]> {
  const url = `${host.startsWith("localhost:") ? "http" : "https"}://${host}${WELL_KNOWN}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "SiroSell/1.0 (+https://siroagent.com/sell)" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Fail(400, "well_known_unreachable", `${url} did not answer.`);
  }
  if (!res.ok) throw new Fail(400, "well_known_missing", `${url} answered ${res.status}. Publish it first; the steps are on the Sell page.`);
  const j = (await res.json().catch(() => null)) as any;
  const list = Array.isArray(j?.payTo) ? j.payTo : [j?.payTo];
  const out = list.filter((a: unknown) => typeof a === "string" && isAddress(a)).map((a: string) => a.toLowerCase());
  if (!out.length) throw new Fail(400, "well_known_invalid", `${url} must be JSON like {"payTo":"0x…"}.`);
  return out;
}

async function proveHost(host: string, to: string) {
  const allowed = await wellKnownPayTo(host);
  if (!allowed.includes(to.toLowerCase())) throw new Fail(400, "pay_to_not_allowed", `https://${host}${WELL_KNOWN} does not name ${to}. Add it to payTo there.`);
}

/** One call to the seller's API. Anything but a 2xx JSON answer within the time limit is a failure. */
async function runSeller(endpoint: string, secret: string, input: unknown, extra: Record<string, string>, timeout: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "SiroSell/1.0 (+https://siroagent.com/sell)", "x-siro-secret": secret, ...extra },
      body: JSON.stringify(input ?? {}),
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: any) {
    throw new Fail(502, "seller_unreachable", e?.name === "TimeoutError" ? `The seller's API took longer than ${timeout / 1000} seconds.` : "The seller's API did not answer.");
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESULT_BYTES) throw new Fail(502, "seller_too_large", "The seller's API answered with more than 1 MB.");
  const text = new TextDecoder().decode(buf);
  if (!res.ok) throw new Fail(502, "seller_failed", `The seller's API answered ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Fail(502, "seller_not_json", "The seller's API did not answer with JSON.");
  }
}

const secretKey = () => `sk_siro_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Same-length comparison that does not stop at the first different character. */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function freeId(env: Env, name: string): Promise<string> {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "tool";
  for (let i = 1; i <= 50; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (!(await env.DB.prepare("SELECT 1 FROM listings WHERE id = ?1").bind(id).first())) return id;
  }
  throw new Fail(409, "name_taken", "That name is taken many times over. Pick another.");
}

const fail = (c: Context<any>, e: unknown) => {
  if (e instanceof Fail) return c.json({ error: { code: e.code, message: e.message } }, e.status as any);
  throw e;
};

// ---- Search, for discovery (Ask, MCP, CLI and /api/discover all go through it) ----

export async function searchListings(env: Env, query: string, limit: number): Promise<Service[]> {
  const rows = await env.DB.prepare("SELECT * FROM listings WHERE status = 'live' ORDER BY created_at DESC LIMIT 300").all<Row>().catch(() => null);
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const nets = (await allRequirements(env, 1000n)).filter((q) => q.network.startsWith("eip155:")).map((q) => q.network);
  return (rows?.results ?? [])
    .map(toListing)
    .map((l) => ({ l, hits: words.filter((w) => `${l.name} ${l.summary} ${l.categoryLabel} ${l.id}`.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(({ l }) => ({
      url: l.url,
      method: "POST",
      name: `${l.name} (sold on Siro by ${l.host})`,
      description: l.summary,
      priceUsd: Number(l.price),
      networks: nets,
      payable: nets.length > 0,
      input: exampleBody(asResource(l)),
      outputExample: null,
      icon: null,
    }));
}

// ---- Public and owner routes, mounted at /api ----

export const sell = new Hono<{ Bindings: Env }>();

/** Step 1 of the form: is /.well-known/siro.json in place and does it name this address? */
sell.post("/sell/check", async (c) => {
  try {
    const ip = await hashIp(clientIp(c), c.env.IP_SALT);
    if ((await overLimit(c.env.DB, `sellcheck:${ip}`, 60, 3600)).limited) throw new Fail(429, "rate_limited", "Too many checks. Try again in an hour.");
    const j = (await c.req.json().catch(() => null)) as any;
    const u = sellerEndpoint(j?.endpoint, c.env);
    const to = payTo(j?.payTo);
    await proveHost(u.host, to);
    return c.json({ ok: true, host: u.hostname, payTo: to });
  } catch (e) {
    return fail(c, e);
  }
});

/** Create a listing. Checks ownership, makes one test call with the example input, then lists it. */
sell.post("/sell", async (c) => {
  try {
    if (Number(c.req.header("content-length") ?? 0) > 30_000) throw new Fail(413, "body_too_large", "The listing is larger than 30 KB.");
    const ip = await hashIp(clientIp(c), c.env.IP_SALT);
    if ((await overLimit(c.env.DB, `sell:${ip}`, 10, 86400)).limited) throw new Fail(429, "rate_limited", "Ten listings a day from one place. Try again tomorrow.");
    const j = (await c.req.json().catch(() => null)) as any;
    if (!j || typeof j !== "object") throw new Fail(400, "invalid_json", "Send the listing as JSON.");
    const name = str(j.name, "The name", 3, 48);
    const summary = str(j.summary, "The summary", 20, 240);
    const returns = str(j.returns, "What it returns", 3, 120);
    const category = String(j.category ?? "") as Category;
    if (!(category in CATEGORIES)) throw new Fail(400, "invalid_category", `The category is one of ${Object.keys(CATEGORIES).join(", ")}.`);
    const p = price(j.price);
    const u = sellerEndpoint(j.endpoint, c.env);
    const to = payTo(j.payTo);
    const f = fields(j.fields);
    await proveHost(u.host, to);

    const secret = secretKey();
    const draft = asResource({ id: "draft", name, summary, category, categoryLabel: "", price: p, host: u.hostname, payTo: to, fields: f, returns, status: "live", url: "", page: "", createdAt: 0 });
    const sample = exampleBody(draft);
    let test: unknown;
    try {
      test = await runSeller(u.toString(), secret, sample, { "x-siro-test": "1" }, TEST_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof Fail) throw new Fail(400, "test_call_failed", `The test call failed. ${e.message} Siro sent ${JSON.stringify(sample).slice(0, 200)} with x-siro-test: 1.`);
      throw e;
    }
    const id = await freeId(c.env, name);
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "INSERT INTO listings (id, name, summary, category, price, endpoint, host, pay_to, fields, returns, secret, status, fails, created_at, checked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'live', 0, ?12, ?12)",
    )
      .bind(id, name, summary, category, p, u.toString(), u.host, to, JSON.stringify(f), returns, secret, now)
      .run();
    console.log(JSON.stringify({ event: "listing_created", id, host: u.hostname }));
    const row = (await getRow(c.env, id))!;
    return c.json({ listing: toListing(row), secret, test: JSON.stringify(test).slice(0, 400) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

sell.get("/listings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM listings WHERE status = 'live' ORDER BY created_at DESC LIMIT 300").all<Row>();
  c.header("Cache-Control", "public, max-age=60");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({ data: rows.results.map(toListing), count: rows.results.length });
});

sell.get("/listings/:id", async (c) => {
  const row = await getRow(c.env, c.req.param("id"));
  if (!row || row.status === "removed") return c.json({ error: { code: "not_found", message: "No listing with that id." } }, 404);
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(toListing(row));
});

/** Owner only: pause, resume or remove. The secret from the listing step is the key. */
sell.post("/listings/:id/status", async (c) => {
  try {
    const ip = await hashIp(clientIp(c), c.env.IP_SALT);
    if ((await overLimit(c.env.DB, `sellown:${ip}`, 30, 3600)).limited) throw new Fail(429, "rate_limited", "Too many attempts. Try again in an hour.");
    const row = await getRow(c.env, c.req.param("id"));
    const key = c.req.header("x-siro-secret") ?? "";
    if (!row || row.status === "removed" || !sameSecret(key, row.secret)) throw new Fail(403, "not_owner", "That id and secret do not match a listing.");
    const j = (await c.req.json().catch(() => null)) as any;
    const status = String(j?.status ?? "");
    if (!["live", "paused", "removed"].includes(status)) throw new Fail(400, "invalid_status", "status is live, paused or removed.");
    if (status === "live") await proveHost(row.host, row.pay_to);
    await c.env.DB.prepare("UPDATE listings SET status = ?1, fails = 0, checked_at = ?2 WHERE id = ?3").bind(status, Math.floor(Date.now() / 1000), row.id).run();
    return c.json({ id: row.id, status });
  } catch (e) {
    return fail(c, e);
  }
});

// ---- The paid call, mounted at /v1/s/:id ----

export async function describeListing(c: Context<{ Bindings: Env }>) {
  const row = await getRow(c.env, c.req.param("id")!);
  if (!row || row.status === "removed") return c.json({ error: { code: "not_found", message: "No listing with that id." } }, 404);
  return c.json(toListing(row));
}

const err = (c: Context<any>, status: number, code: string, message: string) => c.json({ error: { code, message } }, status as any);

export async function callListing(c: Context<{ Bindings: Env }>) {
  const row = await getRow(c.env, c.req.param("id")!);
  if (!row || row.status === "removed") return err(c, 404, "not_found", "No listing with that id. See GET /api/listings.");
  if (row.status !== "live") return err(c, 503, "paused", `${row.name} is paused by its seller or after repeated failures. Nothing was charged.`);
  if (Number(c.req.header("content-length") ?? 0) > 200_000) return err(c, 413, "body_too_large", "Body is larger than 200 KB.");
  const l = toListing(row);
  const r = asResource(l);

  let input: Record<string, unknown> | undefined;
  let inputError: Fail | undefined;
  try {
    const raw = await c.req.json().catch(() => {
      throw new Fail(400, "invalid_json", "Body must be JSON.");
    });
    input = prepare(r, raw);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    inputError = e;
  }
  const paying = !!(c.req.header("payment-signature") ?? c.req.header("x-payment"));
  if (inputError && paying) return err(c, inputError.status, inputError.code, inputError.message);

  // EVM networks only: the seller gave one EVM payout address.
  const amount = toUnits(l.price);
  const reqs = (await allRequirements(c.env, amount)).filter((q) => q.network.startsWith("eip155:")).map((q) => ({ ...q, payTo: l.payTo }));
  if (!reqs.length) return err(c, 503, "payments_not_configured", "Payments are not switched on yet.");
  const description = `${l.name}: ${l.summary} Sold by ${l.host} through Siro.`;
  const ctx = { resource: resourceInfo(c, description), extensions: { bazaar: bazaarExtension(r) } };
  const payment = readPayment(c);
  if (payment === null) return paymentRequired(c, reqs, description, { extensions: ctx.extensions, seller: { host: l.host, payTo: l.payTo }, ...(inputError ? { inputError: { code: inputError.code, message: inputError.message } } : {}) });
  if (payment === "bad") return paymentError(c, "invalid_payment", "PAYMENT-SIGNATURE could not be read");
  const req = pickRequirements(payment, reqs);
  if (typeof req === "string") return paymentError(c, "invalid_payment", req);

  if (!(await lockNonce(c.env.DB, payment))) return paymentError(c, "nonce_used", "This payment authorization was already used. Sign a new one.");
  const verified = await verifyPayment(c.env, payment, req, ctx);
  if (!verified.ok) {
    await releaseNonce(c.env.DB, payment);
    return paymentError(c, verified.code, verified.message);
  }

  const started = Date.now();
  let result: unknown;
  try {
    result = await runSeller(row.endpoint, row.secret, input, { "x-siro-payer": verified.payer, "x-siro-network": req.network }, RUN_TIMEOUT_MS);
  } catch (e) {
    await releaseNonce(c.env.DB, payment);
    const fails = row.fails + 1;
    await c.env.DB.prepare("UPDATE listings SET fails = ?1, status = CASE WHEN ?1 >= ?2 THEN 'paused' ELSE status END WHERE id = ?3").bind(fails, PAUSE_AFTER_FAILS, row.id).run();
    if (fails >= PAUSE_AFTER_FAILS) console.error(JSON.stringify({ event: "listing_paused", id: row.id, fails }));
    if (e instanceof Fail) return err(c, e.status, e.code, `${e.message} You were not charged.`);
    throw e;
  }
  const ms = Date.now() - started;

  const settled = await settlePayment(c.env, payment, req, ctx);
  const pending = !settled.ok && settled.code === "settle_unconfirmed" && !!settled.tx;
  if (!settled.ok) {
    console.error(JSON.stringify({ event: "settle_failed", resource: r.id, code: settled.code, message: settled.message, tx: settled.tx }));
    if (!pending) {
      if (settled.code === "settle_failed") await releaseNonce(c.env.DB, payment);
      return paymentError(c, settled.code, `Payment did not settle: ${settled.message}`);
    }
  }
  const tx = settled.ok ? settled.tx : settled.tx!;
  const payer = settled.ok ? settled.payer : verified.payer;
  const rr = await resultReceipt(result);
  await c.env.DB.batch([
    ...settlementStatements(c.env.DB, { resource: r.id, network: req.network, payer, amount: Number(amount), tx, ms }, rr),
    c.env.DB.prepare("UPDATE listings SET fails = 0 WHERE id = ?1").bind(row.id),
  ]).catch((e) => console.error(JSON.stringify({ event: "settlement_log_failed", err: String(e) })));

  paymentResponseHeader(c, { tx, payer }, req.network);
  const chain = chainFor(req.network);
  return c.json({
    resource: r.id,
    result,
    receipt: { network: req.network, asset: chain.symbol, amountUsd: Number(amount) / 1e6, payer, payTo: l.payTo, tx, ms, resultSha256: rr.sha, ...(pending ? { status: "pending" } : {}) },
  });
}
