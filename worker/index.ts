import { Hono, type Context } from "hono";
import { holder } from "./holder";
import { secureHeaders } from "hono/secure-headers";
import { RESOURCES, byId } from "../shared/catalog";
import { agent } from "./agent";
import { discovery } from "./discover";
import { stockList } from "./markets";
import { cdpEnabled, cdpFetch } from "./cdp";
import { solanaCall, SOLANA_READS } from "./solana";
import { allRequirements } from "./x402";
import { marketHealth } from "./onchain";
import { TOKENS } from "../shared/swap";
import { mcp, serverCard } from "./mcp";
import { v1 } from "./v1";
import { sell } from "./sell";
import { RESULT_TTL_SECONDS } from "../shared/privacy";

const api = new Hono<{ Bindings: Env }>();

api.use("*", secureHeaders());
api.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

api.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>().catch(() => null);
  if (c.req.query("deep") === "1") {
    // CDP facilitator auth: one GET /supported with our JWT (no payment involved).
    let cdp: { configured: boolean; status?: number; base?: boolean; exact?: string[] } = { configured: cdpEnabled(c.env) };
    if (cdp.configured) {
      const res = await cdpFetch(c.env, "supported").catch(() => null);
      const j: any = await res?.json().catch(() => null);
      const exact: string[] = (j?.kinds ?? []).filter((k: any) => k.scheme === "exact" && Number(k.x402Version ?? 2) === 2).map((k: any) => String(k.network));
      const solanaFeePayers = (j?.kinds ?? []).filter((k: any) => String(k.network).startsWith("solana:5eyk")).map((k: any) => `v${k.x402Version}:${k.scheme}:${k.extra?.feePayer}`);
      cdp = { configured: true, status: res?.status ?? 0, base: exact.includes("eip155:8453"), exact, solanaFeePayers } as any;
    }
    const quote = (await allRequirements(c.env, 1000n)).map((r) => r.network);
    return c.json({ ok: db?.ok === 1, market: await marketHealth(c.env), cdp, networks: quote }, db ? 200 : 503);
  }
  return c.json({ ok: db?.ok === 1 }, db ? 200 : 503);
});

const LEDGER_MAX = 500;

/** Live numbers for the landing page. Nothing here is estimated. */
api.get("/stats", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS calls, COALESCE(SUM(amount), 0) AS volume, COUNT(DISTINCT payer) AS payers FROM settlements",
  ).first<{ calls: number; volume: number; payers: number }>();
  const last = await c.env.DB.prepare("SELECT resource, network, at FROM settlements ORDER BY at DESC LIMIT 1").first<{ resource: string; network: string; at: number }>();
  const shown = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM proofs").first<{ n: number }>();
  c.header("Cache-Control", "public, max-age=30");
  return c.json({
    resources: RESOURCES.length,
    networks: (await allRequirements(c.env, 1000n)).length,
    paidCalls: row?.calls ?? 0,
    volumeUsd: (row?.volume ?? 0) / 1e6,
    payers: row?.payers ?? 0,
    last: last ?? null,
    // Where to check these numbers: every row with its transaction, and paid results shown in full.
    ledger: `/api/ledger?limit=${LEDGER_MAX}`,
    resultsShown: shown?.n ?? 0,
    proofs: "/api/proofs",
  });
});

/** The public ledger: recent settlements and daily totals. Every row is an on-chain transfer anyway. */
api.get("/ledger", async (c) => {
  const before = Number(c.req.query("before")) || Math.floor(Date.now() / 1000) + 1;
  const limit = Math.min(LEDGER_MAX, Math.max(1, Math.floor(Number(c.req.query("limit")) || 50)));
  const rows = await c.env.DB.prepare(
    "SELECT s.id, s.resource, s.network, s.payer, s.amount, s.tx, s.ms, s.at, s.result_sha AS resultSha, s.result_bytes AS resultBytes, s.result_kind AS resultKind, s.forgotten_at AS forgottenAt, p.tx IS NOT NULL AS shown FROM settlements s LEFT JOIN proofs p ON p.tx = s.tx WHERE s.at < ?1 ORDER BY s.at DESC, s.id DESC LIMIT ?2",
  )
    .bind(before, limit)
    .all<{ id: number; resource: string; network: string; payer: string; amount: number; tx: string; ms: number | null; at: number; resultSha: string | null; resultBytes: number | null; resultKind: string | null; forgottenAt: number | null; shown: number }>();
  const days = await c.env.DB.prepare(
    "SELECT date(at, 'unixepoch') AS day, COUNT(*) AS calls, SUM(amount) AS amount, COUNT(DISTINCT payer) AS payers FROM settlements WHERE at > ? GROUP BY day ORDER BY day DESC",
  )
    .bind(Math.floor(Date.now() / 1000) - 30 * 86400)
    .all<{ day: string; calls: number; amount: number; payers: number }>();
  const all = await c.env.DB.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(amount), 0) AS volume, COUNT(DISTINCT payer) AS payers FROM settlements").first<{ calls: number; volume: number; payers: number }>();
  c.header("Cache-Control", "public, max-age=20");
  return c.json({
    // The whole table, so a page of rows can be checked against /api/stats. ?limit= up to 500 rows a page, ?before= for older ones.
    totals: { paidCalls: all?.calls ?? 0, volumeUsd: (all?.volume ?? 0) / 1e6, payers: all?.payers ?? 0 },
    rows: rows.results.map(({ resultSha, resultBytes, resultKind, forgottenAt, shown, ...r }) => ({
      ...r,
      usd: r.amount / 1e6,
      resultSha,
      resultBytes,
      resultKind,
      shown,
      // A row paid by a Siro team wallet links to the exact result it returned; other payers' results stay private.
      // forgottenAt: the payer deleted the stored result; the payment row and its fingerprint stay.
      result: resultSha ? { sha256: resultSha, bytes: resultBytes, kind: resultKind, ...(shown ? { url: `/api/proofs/${r.tx}` } : {}), ...(forgottenAt ? { forgottenAt } : {}) } : null,
    })),
    days: days.results.map((d) => ({ day: d.day, calls: d.calls, usd: d.amount / 1e6, payers: d.payers })),
  });
});

/** Paid calls from the Siro team's own wallets, with the full result each one returned. Newest first. */
api.get("/proofs", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT s.id, s.resource, s.network, s.payer, s.amount, s.tx, s.ms, s.at, s.result_sha AS resultSha, s.result_bytes AS resultBytes, s.result_kind AS resultKind, p.result, p.cut FROM proofs p JOIN settlements s ON s.tx = p.tx ORDER BY s.at DESC LIMIT 12",
  ).all<{ id: number; resource: string; network: string; payer: string; amount: number; tx: string; ms: number | null; at: number; resultSha: string; resultBytes: number; resultKind: string; result: string; cut: number }>();
  c.header("Cache-Control", "public, max-age=30");
  return c.json({
    proofs: rows.results.map(({ amount, result, cut, ...r }) => ({ ...r, usd: amount / 1e6, cut: !!cut, result: safeJson(result) })),
  });
});
/** One paid result in full, by its transaction hash. sha256(JSON.stringify(result)) equals resultSha. */
api.get("/proofs/:tx", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT s.id, s.resource, s.network, s.payer, s.amount, s.tx, s.ms, s.at, s.result_sha AS resultSha, s.result_bytes AS resultBytes, s.result_kind AS resultKind, p.result, p.cut FROM proofs p JOIN settlements s ON s.tx = p.tx WHERE p.tx = ?",
  )
    .bind(c.req.param("tx"))
    .first<{ id: number; amount: number; result: string; cut: number; [k: string]: unknown }>();
  if (!row) return c.json({ error: "not_found", message: "No result is shown for this transaction. Only calls paid by a Siro team wallet are shown in full." }, 404);
  const { amount, result, cut, ...r } = row;
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ ...r, usd: amount / 1e6, cut: !!cut, result: safeJson(result), check: "sha256 of JSON.stringify(result) equals resultSha" });
});
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

// Read-only Solana JSON-RPC for Siro wallets (web and CLI): a recent blockhash to sign a
// payment with, and balances. Only these methods.
api.post("/solana", async (c) => {
  const raw = await c.req.text();
  let body: any = null;
  try {
    body = raw.length <= 2000 ? JSON.parse(raw) : null;
  } catch {
    /* answered below */
  }
  if (!body || body.jsonrpc !== "2.0" || !SOLANA_READS.has(body.method) || !Array.isArray(body.params)) return c.json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: `Allowed methods: ${[...SOLANA_READS].join(", ")}` } }, 400);
  const out = await solanaCall(c.env, body.method, body.params, body.id ?? 1);
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(out, out.error ? 502 : 200);
});

api.route("/agent", agent);
api.route("/", holder);
api.route("/", discovery);
api.route("/", sell);

/** Swappable tokens: the common ones per network plus every Robinhood stock token. Free. */
api.get("/tokens", async (c) => {
  const net = c.req.query("network") === "base" ? "base" : "robinhood";
  const stocks = net === "robinhood" ? await stockList().catch(() => []) : [];
  c.header("Cache-Control", "public, max-age=3600");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({ network: net, tokens: [...TOKENS[net], ...stocks.map((s) => ({ symbol: s.symbol, name: s.name, address: s.address, decimals: null, kind: "stock" }))] });
});
api.notFound((c) => c.json({ error: "not_found" }, 404));

const app = new Hono<{ Bindings: Env }>();

// One canonical host. www and the old staging host answer with a permanent redirect, path and query kept.
const CANONICAL = "siroagent.com";
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname !== CANONICAL && (url.hostname === `www.${CANONICAL}` || url.hostname === "siro.pawww.sbs")) {
    url.hostname = CANONICAL;
    return c.redirect(url.toString(), 301);
  }
  // Dotfiles that slip into the build (a macOS .DS_Store lists file names) are never served; .well-known is.
  if (/\/\.(?!well-known\/)/.test(url.pathname)) return c.env.ASSETS.fetch(new URL("/__not-found__", url));
  await next();
});

app.route("/api", api);
app.route("/v1", v1);
app.route("/mcp", mcp);

// Proves to the official MCP Registry that whoever publishes com.siroagent/* controls this domain.
// Public key only (var MCP_REGISTRY_PUBKEY); the signing key stays on the publisher's machine (mcp-registry/key.pem).
app.get("/.well-known/mcp-registry-auth", (c) => {
  const key = c.env.MCP_REGISTRY_PUBKEY;
  return key ? c.text(`v=MCPv1; k=ed25519; p=${key}`) : c.notFound();
});

// Glama ownership claim (var GLAMA_CLAIM), set once Glama hands one out. Must stay published after that.
app.get("/.well-known/glama.json", (c) => {
  const claim = c.env.GLAMA_CLAIM;
  if (!claim) return c.notFound();
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ $schema: "https://glama.ai/mcp/schemas/connector.json", claim });
});

app.get("/.well-known/mcp/server-card.json", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(serverCard());
});

// Clean URLs for the multi-page site.
const PAGES: Record<string, string> = { "/ask": "/ask.html", "/budget": "/budget.html", "/tools": "/tools.html", "/activity": "/activity.html", "/docs": "/docs.html", "/shipped": "/shipped.html", "/sell": "/sell.html", "/privacy": "/privacy.html" };
for (const [path, file] of Object.entries(PAGES)) {
  app.get(path, (c) => c.env.ASSETS.fetch(new URL(file, c.req.url)));
}
// The tool page is one shell; an id that is not in the catalog still gets it (it says so) but with a 404.
app.get("/tools/:id", async (c) => {
  const page = await c.env.ASSETS.fetch(new URL("/tools.html", c.req.url));
  return byId(c.req.param("id")) ? page : new Response(page.body, { status: 404, headers: page.headers });
});

// One page shows any seller listing; it fetches the listing itself and says so when there is none.
app.get("/sell/:id", (c) => c.env.ASSETS.fetch(new URL("/sell.html", c.req.url)));

// The pages were renamed on 15 Nov 2026 (App → Ask, Wallet → Budget, Resources → Tools, Ledger → Activity,
// Roadmap → Shipped). Old links keep working: path rewritten, query kept, the browser keeps any #anchor.
const MOVED: Record<string, string> = { "/app": "/ask", "/wallet": "/budget", "/resources": "/tools", "/ledger": "/activity", "/roadmap": "/shipped" };
// Exact prefixes only: a pattern route here once matched /img/05-wallet-plate.webp and looped.
const moveTo = (c: Context, from: string, to: string) => {
  const url = new URL(c.req.url);
  url.pathname = to + url.pathname.slice(from.length);
  return c.redirect(url.toString(), 301);
};
for (const [from, to] of Object.entries(MOVED)) {
  app.get(`${from}.html`, (c) => c.redirect(to, 301));
  app.get(from, (c) => moveTo(c, from, to));
  app.get(`${from}/*`, (c) => moveTo(c, from, to));
}

// Generated media kept in R2. Range requests are honoured so video can seek.
app.get("/media/*", async (c) => {
  const key = c.req.path.slice("/media/".length);
  if (!c.env.MEDIA || !/^[\w./-]{1,200}$/.test(key) || key.includes("..")) return c.notFound();
  const obj = await c.env.MEDIA.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) return c.text("This result was deleted, or it is older than 7 days and has expired.", 404);
  // Results are kept for RESULT_TTL_DAYS. The bucket's lifecycle rule deletes them too, but it can run late,
  // so an older file is refused here the moment it expires.
  if (Date.now() - obj.uploaded.getTime() > RESULT_TTL_SECONDS * 1000) return c.text("This result is older than 7 days and has expired.", 410);
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("cache-control", "private, max-age=3600");
  h.set("x-robots-tag", "noindex");
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("access-control-allow-origin", "*");
  if (!("body" in obj)) return new Response(null, { status: 304, headers: h });
  const r = obj.range as { offset?: number; length?: number } | undefined;
  if (r && (r.offset || (r.length !== undefined && r.length < obj.size))) {
    const start = r.offset ?? 0;
    const end = start + (r.length ?? obj.size - start) - 1;
    h.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers: h });
  }
  return new Response(obj.body, { headers: h });
});

// Everything else is a static file (the worker now runs first on every path, for the redirect above).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error(JSON.stringify({ event: "unhandled", path: c.req.path, err: err.stack ?? String(err) }));
  return c.req.path.startsWith("/api/") || c.req.path.startsWith("/v1/") ? c.json({ error: "internal" }, 500) : c.text("Something broke on our side.", 500);
});

export default app;
