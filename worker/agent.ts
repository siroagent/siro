// The agent behind Ask. Talking is free (rate-limited); when a task needs a paid resource the
// agent proposes one call with its exact price, and the visitor's own wallet decides. It can also
// propose a third-party x402 service found through discovery, or a token swap. The agent never
// holds funds and never pays on anyone's behalf: the browser signs, or nothing happens.
import { Hono } from "hono";
import { RESOURCES, byId, formatPrice } from "../shared/catalog";
import { premiumReady } from "./premium";
import { TOKEN } from "../shared/token";
import { discover, type Service } from "./discover";
import { Fail } from "./fail";
import { overLimit } from "./ratelimit";
import { clientIp, hashIp, originAllowed } from "./request";
import { prepare } from "./run";

export const agent = new Hono<{ Bindings: Env }>();

const MODEL = "@cf/openai/gpt-oss-120b";
const MAX_TURNS = 24;

// Only resources that can be paid right now are offered to the model.
const tools = (env: Env) =>
  RESOURCES.filter((r) => premiumReady(env, r)).map(
  (r) => `- ${r.id} (${r.name}, ${formatPrice(r.price)}): ${r.summary} Fields: ${r.fields.map((f) => `${f.name}${f.required ? "*" : ""}${f.options ? `[${f.options.join("|")}]` : ""}`).join(", ")}`,
).join("\n");

const system = (env: Env) => `You are the Siro agent: an assistant that gets things done by buying pay-per-call resources over x402. The user's wallet pays; you only propose.

Resources you can call (price per call; * = required field):
${tools(env)}

Facts you can rely on:
- x402 is an open payment standard for the web (started by Coinbase) built on HTTP status 402 Payment Required: a server quotes a price, the client signs a stablecoin transfer, sends it back in a header, and gets the result. No accounts or API keys.
- Siro is commerce for AI agents: Ask (this chat), Budget (the agent wallet with per-payment and daily caps, in the browser or the CLI) and Tools (the catalog above). Payments settle in USDG on Robinhood Chain, or USDC on Base, Solana, Arbitrum or Polygon. Video renders and the longer music tracks take minutes, so they are paid on the EVM chains only. Failed calls are never charged.
- Siro can also find and pay tools that other makers sell on Siro (paid to the seller's own address, settled only on a result; they come first in discovery) and third-party x402 services (listed in the open x402 Bazaar index: search, weather, enrichment, data APIs and more) and swap tokens on Robinhood Chain or Base through the KyberSwap aggregator. Swaps are sent from the user's wallet only after they approve the quote. Developers get the same wallet as a CLI, SDK and MCP server: npm i -g https://siroagent.com/cli/siro.tgz (docs: siroagent.com/docs#cli).
- Privacy: every payment is public on the ledger and on-chain. Siro does not store inputs or text and data results. Generated images, video and audio are kept 7 days, then deleted; the paying wallet can delete one sooner ("Delete it now" under the receipt, or POST /v1/results/<tx>/forget with a signature). Ask chats stay in the user's browser. Details at /privacy.
${TOKEN ? `- Siro's only token is $${TOKEN.ticker} on ${TOKEN.chain}, contract ${TOKEN.ca}. Any other contract claiming to be Siro's is not. You may share this address when asked; never discuss its price, predict it, or suggest buying or selling it. What holding it does: a paying wallet with 1,000,000 $SIRO gets 25% off every Siro tool and 10 free runs a day of Siro's own data tools (gas-now, wallet-balances, token-snapshot, contract-check, new-pools, stock-tokens, prediction-markets); 10,000,000 gets 50% off and 30 free runs. Tools are still paid in USDG or USDC; $SIRO is never spent. Anyone can check a wallet at GET /api/holder/<address>.` : "- Siro has no token yet. Do not discuss prices or buying of a Siro token."}

Rules:
- Answer simple questions yourself, for free, in a few sentences. Only propose a resource when it clearly helps (fresh on-chain data, images, audio, a stronger model, reading a page).
- Propose at most ONE action per turn. Fill every required field from the conversation; if something required is missing, ask for it instead of proposing.
- Prefer a Siro resource when one fits. When none does, search third-party x402 services with {"discover":"<3-6 word query>"}.
- For a swap the user asked for, propose {"swap":{"network":"robinhood|base","from":"ETH","to":"USDG","amount":"0.01"}} with the amount in units of the "from" token. Symbols: ETH, WETH, USDG (Robinhood), USDC (Base), Robinhood stock tickers like TSLA, or a 0x address. Never suggest a trade on your own initiative; only when the user asks.
- network is "robinhood" unless the user says Base.
- After a tool result arrives, explain it briefly and plainly. Do not repeat raw JSON. Never invent numbers that are not in the result.
- Never give financial advice or promise returns. Never ask for private keys or seed phrases.
- Reply with JSON only, no prose around it:
{"reply":"what you say to the user (markdown allowed, short)","call":null}
or
{"reply":"one sentence on why this resource","call":{"resource":"<id>","input":{...}}}
or
{"reply":"one sentence","call":{"discover":"<query>"}}
or
{"reply":"one sentence restating the trade","call":{"swap":{"network":"robinhood","from":"ETH","to":"USDG","amount":"0.01"}}}`;

const PICK = `You choose one third-party x402 service for a task and fill its input. Reply with JSON only:
{"pick":<index or null>,"input":{...},"reply":"one sentence on what it does and its price"}
Pick null when nothing fits the task well. Only pick services marked payable. Build input to match the service's example input exactly in shape; use values from the conversation.`;

type Turn = { role: "user" | "assistant" | "tool"; content: string };

function clean(turns: unknown): Turn[] {
  if (!Array.isArray(turns) || turns.length === 0) throw new Fail(400, "invalid_messages", "messages must be a non-empty array");
  return turns.slice(-MAX_TURNS).map((t: any) => {
    if (!t || !["user", "assistant", "tool"].includes(t.role) || typeof t.content !== "string") throw new Fail(400, "invalid_messages", "each message needs role user|assistant|tool and string content");
    return { role: t.role, content: t.content.slice(0, t.role === "tool" ? 4000 : 6000) };
  });
}

type Call = { resource: string; input: Record<string, unknown> } | { discover: string } | { swap: { network: string; from: string; to: string; amount: string } };

function json(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function parse(text: string): { reply: string; call: Call | null } {
  const j = json(text);
  if (j && typeof j.reply === "string") {
    const c = j.call;
    if (c && typeof c.resource === "string") return { reply: j.reply, call: { resource: c.resource, input: c.input ?? {} } };
    if (c && typeof c.discover === "string" && c.discover.trim()) return { reply: j.reply, call: { discover: c.discover.trim().slice(0, 120) } };
    if (c?.swap && typeof c.swap === "object") return { reply: j.reply, call: { swap: { network: c.swap.network === "base" ? "base" : "robinhood", from: String(c.swap.from ?? "").slice(0, 64), to: String(c.swap.to ?? "").slice(0, 64), amount: String(c.swap.amount ?? "").slice(0, 32) } } };
    return { reply: j.reply, call: null };
  }
  return { reply: text.trim(), call: null };
}

async function llm(env: Env, messages: { role: string; content: string }[], maxTokens = 2500): Promise<string> {
  const out: any = await env.AI.run(MODEL as any, { messages, max_tokens: maxTokens, reasoning_effort: "low" } as any);
  return String(out?.choices?.[0]?.message?.content ?? out?.response ?? "");
}

agent.post("/", async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: "forbidden_origin", message: "Use Ask on siroagent.com or the /v1 API." } }, 403);
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  const hour = await overLimit(c.env.DB, `agent:h:${ip}`, 40, 3600);
  if (hour.limited) return c.json({ error: { code: "rate_limited", message: `Free chat limit reached. Try again in ${Math.ceil(hour.retryAfter / 60)} min.` } }, 429);
  const cap = Number((await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'agent_daily_cap'").first<{ value: string }>())?.value ?? 3000);
  const day = await overLimit(c.env.DB, "agent:global", cap, 86400);
  if (day.limited) return c.json({ error: { code: "busy", message: "The free agent is at today's capacity. Paid resources still work through the API." } }, 429);

  let turns: Turn[];
  try {
    turns = clean((await c.req.json().catch(() => ({})) as any).messages);
  } catch (e) {
    if (e instanceof Fail) return c.json({ error: { code: e.code, message: e.message } }, e.status);
    throw e;
  }

  const messages = [
    { role: "system", content: system(c.env) },
    ...turns.map((t) => (t.role === "tool" ? { role: "user", content: `[Tool result]\n${t.content}` } : t)),
  ];
  let text: string;
  try {
    text = await llm(c.env, messages);
  } catch (e) {
    console.error(JSON.stringify({ event: "agent_ai_failed", err: String((e as any)?.message ?? e).slice(0, 300) }));
    return c.json({ error: { code: "agent_unavailable", message: "The agent is busy. Try again in a moment." } }, 502);
  }
  const { reply, call } = parse(text);

  if (call && "swap" in call) {
    const s = call.swap;
    if (!s.from || !s.to || !(Number(s.amount) > 0)) return c.json({ reply: `${reply}\n\nTell me which tokens and how much, e.g. "swap 0.01 ETH to USDG".`, proposal: null });
    return c.json({ reply, proposal: { kind: "swap", ...s } });
  }

  if (call && "discover" in call) {
    let services: Service[] = [];
    try {
      services = (await discover(c.env, call.discover, 12)).filter((s) => s.payable);
    } catch (e) {
      console.error(JSON.stringify({ event: "agent_discover_failed", err: String((e as any)?.message ?? e).slice(0, 300) }));
      return c.json({ reply: "The x402 service index is not answering right now. Try again shortly.", proposal: null });
    }
    if (!services.length) return c.json({ reply: `I searched the x402 index for "${call.discover}" and found nothing I can pay for in USDG or USDC on the networks Siro supports.`, proposal: null });
    const menu = services.map((s, i) => ({ i, name: s.name, url: s.url, method: s.method, priceUsd: s.priceUsd, description: s.description, exampleInput: s.input }));
    let pick: any = null;
    try {
      pick = json(await llm(c.env, [{ role: "system", content: PICK }, { role: "user", content: `Task, from the conversation:\n${turns.filter((t) => t.role === "user").slice(-3).map((t) => t.content).join("\n")}\n\nServices (all payable):\n${JSON.stringify(menu).slice(0, 9000)}` }], 1500));
    } catch {
      /* fall through to the plain answer */
    }
    const svc = Number.isInteger(pick?.pick) ? services[pick.pick] : undefined;
    if (!svc) return c.json({ reply: `I searched the x402 index for "${call.discover}" but none of the services fits this well enough to pay for.`, proposal: null });
    const input = pick.input && typeof pick.input === "object" && !Array.isArray(pick.input) ? pick.input : {};
    if (JSON.stringify(input).length > 8000) return c.json({ reply: "That request is too large to send to a third-party service.", proposal: null });
    return c.json({
      reply: typeof pick.reply === "string" ? pick.reply : reply,
      proposal: { kind: "external", name: svc.name ?? new URL(svc.url).host, url: svc.url, method: svc.method, price: String(svc.priceUsd), description: svc.description, input },
    });
  }

  let proposal = null;
  if (call && "resource" in call) {
    const r = byId(call.resource);
    if (r) {
      try {
        proposal = { kind: "resource", resource: r.id, name: r.name, price: r.price, category: r.category, input: prepare(r, call.input) };
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
        // The agent filled a field badly; say so instead of proposing a call that will fail.
        return c.json({ reply: `${reply}\n\nI need one more detail first: ${e.message}`, proposal: null });
      }
    }
  }
  return c.json({ reply: reply || "Done.", proposal });
});
