// Remote MCP server at /mcp (Streamable HTTP, JSON responses, stateless).
// Free tools answer directly: the catalog, one resource's schema, third-party x402 discovery and
// the swappable token list. siro_call runs a paid resource with the x402-over-MCP convention:
// the client puts a signed PaymentPayload in params._meta["x402/payment"]; without it the tool
// returns isError with the payment requirements (structuredContent and _meta["x402/error"]).
// Agents without an x402 wallet can run the local server (`siro mcp` from the CLI), which pays
// automatically inside the user's caps.
import { Hono } from "hono";
import { CATEGORIES, RESOURCES, byId, formatPrice } from "../shared/catalog";
import { TOKENS } from "../shared/swap";
import { bazaarExtension, exampleBody } from "./bazaar";
import { discover } from "./discover";
import { Fail } from "./fail";
import { stockList } from "./markets";
import { v1 } from "./v1";

// The paid API as mounted on the site, so 402 quotes and receipts carry the public /v1 URL.
const api = new Hono<{ Bindings: Env }>().route("/v1", v1);

const PROTOCOL = "2025-06-18";
const SITE = "https://siroagent.com";
const VERSION = "1.0.0";

type Args = Record<string, any>;
type Tool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };

const TOOLS: Tool[] = [
  {
    name: "siro_resources",
    title: "Search the Siro catalog",
    description: `Lists Siro's pay-per-call resources (${RESOURCES.length} in total) with id, name, category, USD price and a one-line summary. Use it first to find the right resource id; then read its input schema with siro_resource_schema and run it with siro_call. Categories: LLMs, image generation, audio (speech and transcription), vision, web (reading and translation), on-chain data on Robinhood Chain and Base, tokenized stocks, Polymarket prediction markets and content tools. Free, no payment needed.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional words to match against the id, name, summary and tags, e.g. \"stock\", \"image\", \"polymarket\". Omit to list everything." },
        category: { type: "string", enum: Object.keys(CATEGORIES), description: "Optional category filter." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "siro_resource_schema",
    title: "Get one tool's input schema",
    description: "Returns everything needed to call one Siro resource: its USD price, the JSON Schema of its input, a ready-to-use example input, what it returns, and its HTTP endpoint. Use it after siro_resources and before siro_call so the input is valid (invalid input is rejected before any payment). Free, no payment needed.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Resource id from siro_resources, e.g. \"stock-signal\" or \"prediction-markets\"." } }, required: ["id"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "siro_call",
    title: "Run a paid tool (x402)",
    description:
      'Runs one Siro resource and pays its exact USD price over x402, in USDG on Robinhood Chain or USDC on Solana, Base, Arbitrum or Polygon. Send a signed x402 v2 PaymentPayload in params._meta["x402/payment"]; without it the tool returns isError with the payment requirements (price, networks, payTo) to sign. The work runs before the payment settles, so failed calls are never charged; a successful call returns the result plus a receipt with the transaction hash in _meta["x402/payment-response"]. Agents without an x402 wallet can use the Siro CLI (`siro mcp`), which pays automatically within spending caps.',
    inputSchema: {
      type: "object",
      properties: {
        resource: { type: "string", description: "Resource id from siro_resources, e.g. \"gas-now\"." },
        input: { type: "object", description: "Input object matching the resource's schema from siro_resource_schema, e.g. {\"network\":\"base\"}." },
      },
      required: ["resource"],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: "siro_discover",
    title: "Find third-party x402 services",
    description: "Searches the open x402 Bazaar index (run by Coinbase CDP) for paid APIs outside Siro's own catalog, such as weather, web search, data enrichment or token prices. Returns each service's URL, HTTP method, price, accepted networks, an example input and whether Siro can pay it (payable = accepts USDG on Robinhood Chain or USDC on Solana, Base, Arbitrum or Polygon). Use it when no Siro resource fits the task. Free, no payment needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, description: "What you need in a few words, e.g. \"weather forecast\" or \"web search\"." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "How many services to return (default 10, max 20)." },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "siro_tokens",
    title: "List swappable tokens",
    description: "Lists the tokens a Siro wallet can swap through the KyberSwap aggregator on one network, with symbol, name and contract address. On Robinhood Chain this includes ETH, WETH, USDG and every Robinhood stock token (TSLA, NVDA, AAPL…); on Base it includes ETH, WETH and USDC. Use it to resolve a ticker to its contract address before quoting or executing a swap with the Siro CLI. Read-only and free; it does not trade.",
    inputSchema: { type: "object", properties: { network: { type: "string", enum: ["robinhood", "base"], description: "Which chain's tokens to list. Defaults to robinhood." } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const text = (v: unknown) => [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }];
const toolError = (code: string, message: string) => ({ isError: true, content: text({ error: code, message }) });

function resourceCard(id: string) {
  const r = byId(id);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    category: CATEGORIES[r.category],
    priceUsd: r.price,
    price: formatPrice(r.price),
    summary: r.summary,
    returns: r.returns,
    input: bazaarExtension(r).schema.properties.input.properties.body,
    example: exampleBody(r),
    http: `POST ${SITE}/v1/${r.id}`,
  };
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

async function callTool(env: Env, name: string, args: Args, meta: Args | undefined) {
  switch (name) {
    case "siro_resources": {
      const q = String(args.query ?? "").toLowerCase();
      const list = RESOURCES.filter((r) => (!args.category || r.category === args.category) && (!q || `${r.id} ${r.name} ${r.summary} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(q)));
      const data = list.map((r) => ({ id: r.id, name: r.name, category: CATEGORIES[r.category], priceUsd: r.price, summary: r.summary }));
      return { content: text(data), structuredContent: { resources: data } };
    }
    case "siro_resource_schema":
    case "siro_resource": {
      const card = resourceCard(String(args.id ?? ""));
      if (!card) return toolError("not_found", `No resource ${args.id}. Use siro_resources to find ids.`);
      return { content: text(card), structuredContent: card };
    }
    case "siro_discover": {
      const q = String(args.query ?? "").trim();
      if (q.length < 2) return toolError("missing_query", "Say what you need, e.g. weather.");
      try {
        const services = await discover(env, q, Math.min(Number(args.limit) || 10, 20));
        return { content: text(services), structuredContent: { services } };
      } catch (e) {
        if (e instanceof Fail) return toolError(e.code, e.message);
        throw e;
      }
    }
    case "siro_tokens": {
      const net = args.network === "base" ? "base" : "robinhood";
      const stocks = net === "robinhood" ? await stockList().catch(() => []) : [];
      const tokens = [...TOKENS[net], ...stocks.map((s) => ({ symbol: s.symbol, name: s.name, address: s.address, decimals: null, kind: "stock" }))];
      return { content: text({ network: net, count: tokens.length, tokens: tokens.slice(0, 60), note: tokens.length > 60 ? `${tokens.length - 60} more; filter with a symbol` : undefined }), structuredContent: { network: net, tokens } };
    }
    case "siro_call": {
      const r = byId(String(args.resource ?? ""));
      if (!r) return toolError("not_found", `No resource ${args.resource}. Use siro_resources.`);
      const payment = meta?.["x402/payment"];
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (payment) headers["payment-signature"] = typeof payment === "string" ? payment : b64(JSON.stringify(payment));
      const res = await api.request(`${SITE}/v1/${r.id}`, { method: "POST", headers, body: JSON.stringify(args.input ?? {}) }, env);
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 402) {
        // No payment yet, or the payment was refused: hand back the requirements to sign.
        const required = body.accepts?.length ? body : { ...body, hint: "Sign a new payment for the requirements returned without _meta." };
        return { isError: true, content: text({ payment_required: true, price: formatPrice(r.price), ...required }), structuredContent: required, _meta: { "x402/error": required } };
      }
      if (!res.ok) return toolError(body?.error?.code ?? "failed", body?.error?.message ?? `HTTP ${res.status}`);
      return { content: text(body.result), structuredContent: body, _meta: { "x402/payment-response": body.receipt } };
    }
  }
  return toolError("unknown_tool", `No tool ${name}.`);
}

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Args };

async function handle(env: Env, m: Rpc) {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "siro", title: "Siro", version: VERSION, websiteUrl: `${SITE}/docs#mcp` },
        instructions:
          "Siro is an x402 layer for AI agents. Browse the catalog and third-party x402 services for free; siro_call runs a paid resource when params._meta[\"x402/payment\"] carries a signed payment (USDG on Robinhood Chain or USDC on Solana, Base, Arbitrum or Polygon). For automatic, capped payments from a local wallet, use the Siro CLI (`siro mcp`).",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call":
      return ok(await callTool(env, String(m.params?.name ?? ""), (m.params?.arguments as Args) ?? {}, m.params?._meta));
    default:
      return m.id == null ? null : fail(-32601, `method not found: ${m.method}`);
  }
}

export const mcp = new Hono<{ Bindings: Env }>();

/** Static metadata for directories that cannot scan (served at /.well-known/mcp/server-card.json). */
export const serverCard = () => ({
  serverInfo: { name: "siro", title: "Siro", version: VERSION, websiteUrl: `${SITE}/docs#mcp` },
  description: "x402 layer for AI agents: pay-per-call AI, media, on-chain data, tokenized stocks and prediction markets, settled in USDG on Robinhood Chain or USDC on Solana, Base, Arbitrum or Polygon; plus x402 service discovery.",
  iconUrl: `${SITE}/icon-512.png`,
  transport: { type: "streamable-http", url: `${SITE}/mcp` },
  authentication: { required: false },
  tools: TOOLS,
  resources: [],
  prompts: [],
});

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization", "access-control-allow-methods": "POST, GET, OPTIONS" };
mcp.options("/", () => new Response(null, { status: 204, headers: cors }));
mcp.get("/", (c) => c.json({ error: "Use POST (MCP Streamable HTTP, JSON responses).", docs: `${SITE}/docs#mcp` }, 405, cors));
mcp.post("/", async (c) => {
  const body = await c.req.json<Rpc | Rpc[]>().catch(() => null);
  if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, cors);
  const batch = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(batch.map((m) => handle(c.env, m)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return c.json(Array.isArray(body) ? out : out[0], 200, cors);
});
