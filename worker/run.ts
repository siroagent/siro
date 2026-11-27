// Runs one resource. `prepare` validates the input before anyone pays; `execute` does the
// work and throws Fail on anything that should not be charged.
import type { Address } from "viem";
import type { Field, Resource } from "../shared/catalog";
import { Fail } from "./fail";
import { findMarket, normalizeMarket, predictionMarkets, priceHistory, stockQuote, stockTokens } from "./markets";
import { addressOf, contractCheck, gasNow, networkOf, poolList, readToken, tokenMarket, walletBalances } from "./onchain";
import { premiumReady, runPremium } from "./premium";
import { PickError, pickModel, pickSummary, type Pick } from "../shared/router";

export type Input = Record<string, unknown>;

const MAX_FETCH_BYTES = 10_000_000;
const SIZES: Record<string, [number, number]> = { "1024x1024": [1024, 1024], "1280x768": [1280, 768], "768x1280": [768, 1280] };

/** Check fields against the catalog. Unknown fields are dropped, strings trimmed and capped. */
export function prepare(r: Resource, raw: unknown): Input {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) throw new Fail(400, "invalid_body", "Send a JSON object.");
  const body = (raw ?? {}) as Input;
  const out: Input = {};
  for (const f of r.fields) {
    const v = body[f.name];
    if (v === undefined || v === null || v === "") {
      if (f.required) throw new Fail(400, "missing_field", `${f.name} is required: ${f.description}`);
      continue;
    }
    out[f.name] = field(f, v);
  }
  return out;
}

function field(f: Field, v: unknown): unknown {
  switch (f.type) {
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Fail(400, "invalid_field", `${f.name} must be a positive number`);
      return Math.min(Math.floor(n), f.max ?? n);
    }
    case "enum": {
      const s = String(v);
      if (!f.options?.includes(s)) throw new Fail(400, "invalid_field", `${f.name} must be one of ${f.options?.join(", ")}`);
      return s;
    }
    case "network":
      return networkOf(v);
    case "address":
      return addressOf(v, f.name);
    case "url": {
      let u: URL;
      try {
        u = new URL(String(v));
      } catch {
        throw new Fail(400, "invalid_url", `${f.name} must be a full https:// link`);
      }
      if (u.protocol !== "https:") throw new Fail(400, "invalid_url", `${f.name} must use https://`);
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) throw new Fail(400, "invalid_url", "private addresses are not allowed");
      return u.toString();
    }
    default: {
      const s = String(v).trim();
      if (!s) throw new Fail(400, "invalid_field", `${f.name} is empty`);
      if (f.max && s.length > f.max) throw new Fail(413, "field_too_long", `${f.name} is ${s.length} characters; the limit is ${f.max}`);
      return s;
    }
  }
}

// ---- Workers AI helpers ----

function aiFail(err: unknown): Fail {
  const msg = String((err as any)?.message ?? err);
  console.error(JSON.stringify({ event: "ai_failed", err: msg.slice(0, 300) }));
  if (/capacity|overloaded|429|Too many/i.test(msg)) return new Fail(429, "model_busy", "The model is at capacity. Retry in a few seconds. You were not charged.");
  return new Fail(502, "model_failed", "The model did not answer. You were not charged.");
}

async function ai(env: Env, model: string, input: unknown): Promise<any> {
  try {
    return await env.AI.run(model as any, input as any);
  } catch (err) {
    throw aiFail(err);
  }
}

function textOf(out: any): string {
  const c = out?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (typeof out?.response === "string") return out.response;
  if (out?.response != null) return JSON.stringify(out.response);
  return "";
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function streamBytes(s: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Image models answer as {image: base64}, a stream of bytes, or raw bytes. */
const mimeOf = (b64s: string) => (b64s.startsWith("/9j/") ? "image/jpeg" : b64s.startsWith("iVBOR") ? "image/png" : b64s.startsWith("UklGR") ? "image/webp" : "image/png");

async function imageOut(out: any): Promise<string> {
  if (typeof out?.image === "string") return out.image.startsWith("data:") ? out.image : `data:${mimeOf(out.image)};base64,${out.image}`;
  if (out instanceof ReadableStream) {
    const s = b64(await streamBytes(out));
    return `data:${mimeOf(s)};base64,${s}`;
  }
  if (out instanceof Uint8Array || out instanceof ArrayBuffer) {
    const s = b64(new Uint8Array(out as ArrayBuffer));
    return `data:${mimeOf(s)};base64,${s}`;
  }
  throw new Fail(502, "model_failed", "The image model returned nothing. You were not charged.");
}

/** Models that now reason by default spend the token budget thinking and return empty content
 *  unless told otherwise (checked against Workers AI, 28 Oct 2026). */
const MODEL_OPTS: Record<string, Record<string, unknown>> = {
  "@cf/zai-org/glm-5.3": { reasoning_effort: "low" },
  "@cf/google/gemma-4-26b-a4b-it": { chat_template_kwargs: { enable_thinking: false } },
  "@cf/openai/gpt-oss-120b": { reasoning_effort: "low" },
};

async function chat(env: Env, model: string, system: string | undefined, prompt: string, maxTokens = 1024) {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const out = await ai(env, model, { messages, max_tokens: maxTokens, ...MODEL_OPTS[model] });
  const text = textOf(out).trim();
  if (!text) throw new Fail(502, "empty_answer", "The model returned an empty answer. You were not charged.");
  return { text, usage: out?.usage ?? null };
}

/** Ask for JSON and parse the first object in the answer. */
async function chatJson<T>(env: Env, model: string, system: string, prompt: string, maxTokens = 1200): Promise<T> {
  const { text } = await chat(env, model, system, prompt, maxTokens);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Fail(502, "model_failed", "The model did not return structured output. You were not charged.");
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    throw new Fail(502, "model_failed", "The model returned malformed output. You were not charged.");
  }
}

async function fetchCapped(env: Env, url: string, accept: string): Promise<{ bytes: Uint8Array; type: string }> {
  let res: Response;
  try {
    // A Worker cannot fetch its own custom domain over the internet; serve those from assets.
    const own = /^(www\.)?siroagent\.com$|^siro\.pawww\.sbs$/.test(new URL(url).hostname);
    res = own
      ? await env.ASSETS.fetch(new Request(new URL(new URL(url).pathname, "https://assets.local")))
      : await fetch(url, { headers: { accept, "user-agent": "SiroBot/1.0 (+https://siroagent.com)" }, redirect: "follow", cf: { cacheTtl: 60 } } as RequestInit);
  } catch {
    throw new Fail(422, "fetch_failed", "Could not reach that link. You were not charged.");
  }
  if (!res.ok) throw new Fail(422, "fetch_failed", `That link answered ${res.status}. You were not charged.`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FETCH_BYTES) throw new Fail(413, "too_large", "The file is larger than 10 MB.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FETCH_BYTES) throw new Fail(413, "too_large", "The file is larger than 10 MB.");
  return { bytes, type: res.headers.get("content-type") ?? "" };
}

const FAST_MODEL = "@cf/openai/gpt-oss-120b";

// ---- Execute ----

/** The model the router picks for this input, among the models switched on right now. Throws Fail (400) before any payment. */
export function routerPick(env: Env, input: Input): Pick {
  try {
    return pickModel(input, (m) => premiumReady(env, m));
  } catch (e) {
    if (e instanceof PickError) throw new Fail(400, e.code, e.message);
    throw e;
  }
}

export async function execute(env: Env, r: Resource, input: Input): Promise<unknown> {
  if (r.id === "llm-auto") {
    const pick = routerPick(env, input);
    const { tier: _t, maker: _m, max_price: _p, ...rest } = input;
    const out = (await execute(env, pick.resource, rest)) as Record<string, unknown>;
    return { ...out, picked: pickSummary(pick) };
  }
  if (r.via) return runPremium(env, r, input);

  if (r.category === "llm") {
    const { text, usage } = await chat(env, r.model!, input.system as string | undefined, input.prompt as string, (input.max_tokens as number) ?? 1024);
    return { text, model: r.name, usage };
  }

  if (r.category === "image") {
    const [width, height] = SIZES[(input.size as string) ?? "1024x1024"];
    const prompt = input.prompt as string;
    let out: any;
    if (r.model!.includes("flux-2")) {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(width));
      form.append("height", String(height));
      const body = new Response(form);
      out = await ai(env, r.model!, { multipart: { body: body.body, contentType: body.headers.get("content-type") } });
    } else if (r.model!.includes("flux-1-schnell")) {
      out = await ai(env, r.model!, { prompt, steps: 4 });
    } else {
      out = await ai(env, r.model!, { prompt, width, height });
    }
    return { image: await imageOut(out), model: r.name, size: `${width}x${height}` };
  }

  switch (r.id) {
    case "tts-aura-2": {
      const out = await ai(env, r.model!, { text: input.text, speaker: "luna", encoding: "mp3" });
      const bytes = out instanceof ReadableStream ? await streamBytes(out) : typeof out?.audio === "string" ? null : new Uint8Array(out);
      return { audio: bytes ? `data:audio/mpeg;base64,${b64(bytes)}` : `data:audio/mpeg;base64,${out.audio}` };
    }
    case "tts-melo": {
      const out = await ai(env, r.model!, { prompt: input.text, lang: (input.lang as string) ?? "en" });
      if (typeof out?.audio !== "string") throw new Fail(502, "model_failed", "No audio came back. You were not charged.");
      return { audio: `data:${out.audio.startsWith("UklGR") ? "audio/wav" : "audio/mpeg"};base64,${out.audio}` };
    }
    case "stt-whisper": {
      const { bytes } = await fetchCapped(env, input.url as string, "audio/*");
      const out = await ai(env, r.model!, { audio: b64(bytes) });
      return { text: String(out?.text ?? "").trim(), language: out?.transcription_info?.language ?? null };
    }
    case "vision-describe": {
      const { bytes, type } = await fetchCapped(env, input.url as string, "image/*");
      if (!/^image\/(png|jpe?g|webp|gif)/.test(type)) throw new Fail(422, "not_an_image", "That link is not a PNG, JPEG, WebP or GIF image. You were not charged.");
      const out = await ai(env, r.model!, {
        messages: [{ role: "user", content: [{ type: "text", text: (input.question as string) ?? "Describe this image in detail." }, { type: "image_url", image_url: { url: `data:${type.split(";")[0]};base64,${b64(bytes)}` } }] }],
        max_tokens: 700,
      });
      return { text: textOf(out).trim() };
    }
    case "translate": {
      const out = await ai(env, r.model!, { text: input.text, source_lang: (input.source as string) ?? "en", target_lang: input.target });
      return { text: String(out?.translated_text ?? "") };
    }
    case "web-read": {
      const { bytes, type } = await fetchCapped(env, input.url as string, "text/html,application/xhtml+xml,text/plain;q=0.8");
      const name = /pdf/.test(type) ? "page.pdf" : /plain/.test(type) ? "page.txt" : "page.html";
      let md = "";
      try {
        const res = await (env.AI as any).toMarkdown([{ name, blob: new Blob([bytes], { type: type || "text/html" }) }]);
        md = String(res?.[0]?.data ?? "");
      } catch (err) {
        throw aiFail(err);
      }
      const title = (new TextDecoder().decode(bytes.subarray(0, 200_000)).match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ?? "").trim();
      return { title, markdown: md.slice(0, 200_000), truncated: md.length > 200_000 };
    }

    case "token-snapshot":
      return snapshot(env, input);
    case "token-signal": {
      const snap = await snapshot(env, input);
      const signal = await chatJson<{ stance: string; summary: string; risks: string[] }>(
        env,
        FAST_MODEL,
        'You are a careful on-chain analyst. Reply with JSON only: {"stance":"bullish|neutral|bearish|insufficient data","summary":"2-3 sentences","risks":["short item", "..."]}. Base everything on the data given; never invent numbers; this is not financial advice.',
        `Token data:\n${JSON.stringify(snap)}`,
      );
      return { snapshot: snap, signal };
    }
    case "contract-check":
      return contractCheck(env, input.network as any ?? "robinhood", input.address as Address);
    case "trending-pools":
    case "new-pools": {
      const net = (input.network as any) ?? "robinhood";
      return { network: net, pools: await poolList(env, net, r.id === "trending-pools" ? "trending" : "new") };
    }
    case "market-brief": {
      const net = (input.network as any) ?? "robinhood";
      const [trending, fresh] = await Promise.all([poolList(env, net, "trending"), poolList(env, net, "new")]);
      const { text } = await chat(
        env,
        FAST_MODEL,
        "You write tight market briefs for traders. 5-7 bullet points, plain English, numbers from the data only, no hype, no advice. End with one line on what to watch.",
        `Network: ${net}\nTrending pools:\n${JSON.stringify(trending.slice(0, 10))}\nNew pools:\n${JSON.stringify(fresh.slice(0, 10))}`,
        900,
      );
      return { network: net, brief: text, pools: { trending: trending.slice(0, 10), new: fresh.slice(0, 10) } };
    }
    case "wallet-balances": {
      const extra = String(input.tokens ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((s) => addressOf(s, "tokens"));
      return walletBalances(env, (input.network as any) ?? "robinhood", input.address as Address, extra);
    }
    case "gas-now":
      return gasNow(env, (input.network as any) ?? "robinhood");

    case "stock-tokens":
      return stockTokens(input.query as string | undefined);
    case "stock-signal": {
      const q = await stockQuote(env, input.symbol as string);
      const signal = await chatJson<{ stance: string; summary: string; risks: string[] }>(
        env,
        FAST_MODEL,
        'You are a careful analyst of tokenized stocks on Robinhood Chain. The reference is the Chainlink price of the real share (it can lag up to a day when US markets are closed); the DEX price is where the token trades on-chain; premiumPct is DEX vs reference. Reply with JSON only: {"stance":"bullish|neutral|bearish|insufficient data","summary":"2-3 sentences","risks":["short item","..."]}. The stance describes only this data: a premium or discount above 0.5% or a 24h move above 3% can justify bullish or bearish; otherwise say neutral. Mention thin liquidity when it is under $50,000. Use only the numbers given; no outside news or macro context; this is not financial advice.',
        `Now: ${new Date().toISOString()}\nData:\n${JSON.stringify(q)}`,
      );
      return { ...q, signal };
    }
    case "prediction-markets":
      return predictionMarkets({ query: input.query as string | undefined, sort: input.sort as string | undefined, limit: input.limit as number | undefined });
    case "prediction-read": {
      const found = await findMarket(input.market as string);
      if (!found.markets.length) throw new Fail(404, "market_not_found", "That market has no open outcomes. You were not charged.");
      // Multi-market events: read the busiest few together; single markets get their price history.
      const markets = found.markets
        .slice()
        .sort((a: any, b: any) => Number(b.volume24hr ?? 0) - Number(a.volume24hr ?? 0))
        .slice(0, 8);
      const main = normalizeMarket(markets[0], found.event?.slug);
      const history = markets.length === 1 ? await priceHistory(markets[0]) : null;
      const read = await chatJson<{ summary: string; pricedIn: string; lean: string; confidence: string; catalysts: string[]; risks: string[] }>(
        env,
        FAST_MODEL,
        'You read prediction markets for an agent. Odds are crowd prices, not facts. Reply with JSON only: {"summary":"2-3 sentences on what is being bet on and where the odds sit","pricedIn":"one sentence on what the current odds imply","lean":"which outcome looks under- or over-priced given only this data, or \\"no edge\\"","confidence":"low|medium|high","catalysts":["dated events that could move it"],"risks":["resolution or liquidity risks"]}. Use only the data given and quote the probabilities. Do not add outside context (policy stances, news, polls, opinions) that is not in the data; if the data cannot support a lean, say \"no edge\". This is not financial advice.',
        `Now: ${new Date().toISOString()}\nEvent: ${JSON.stringify(found.event)}\nMarkets: ${JSON.stringify(markets.map((m: any) => normalizeMarket(m, found.event?.slug)))}\nResolution rules: ${String(markets[0].description ?? "").slice(0, 1500)}\nPrice history of the first outcome (percent): ${JSON.stringify(history?.filter((_, i, a) => i % 4 === 0 || i === a.length - 1) ?? null)}`,
        1100,
      );
      return { event: found.event, market: main, others: markets.slice(1).map((m: any) => normalizeMarket(m, found.event?.slug)), history, read };
    }

    case "token-starter-kit": {
      const idea = input.idea as string;
      const kit = await chatJson<{ names: { name: string; ticker: string }[]; tagline: string; lore: string; logoPrompt: string }>(
        env,
        FAST_MODEL,
        'You name crypto tokens. Reply with JSON only: {"names":[{"name":"","ticker":""}x3],"tagline":"under 12 words","lore":"3 sentences","logoPrompt":"one-line prompt for a clean flat mascot logo on a plain background"}. Tickers 3-6 capital letters. No promises of profit.',
        `Idea: ${idea}`,
      );
      const form = new FormData();
      form.append("prompt", `${kit.logoPrompt}. Centered logo, bold shapes, plain background, no text.`);
      form.append("width", "1024");
      form.append("height", "1024");
      const body = new Response(form);
      const img = await ai(env, "@cf/black-forest-labs/flux-2-klein-4b", { multipart: { body: body.body, contentType: body.headers.get("content-type") } });
      return { names: kit.names?.slice(0, 3) ?? [], tagline: kit.tagline, lore: kit.lore, logo: await imageOut(img) };
    }
    case "x-post-writer": {
      const out = await chatJson<{ posts: string[] }>(
        env,
        FAST_MODEL,
        `You write X posts. Reply with JSON only: {"posts":["","",""]}. Exactly three posts, each under 270 characters, tone: ${(input.tone as string) ?? "confident"}. No hashtags spam, no emojis unless playful, no financial promises.`,
        `Topic: ${input.topic}`,
      );
      return { posts: (out.posts ?? []).slice(0, 3).map((p) => String(p).slice(0, 280)) };
    }
    case "prompt-refine": {
      const out = await chatJson<{ prompt: string; negative?: string }>(
        env,
        FAST_MODEL,
        `You are a creative director. Turn the idea into one precise ${(input.target as string) ?? "image"} prompt. Reply with JSON only: {"prompt":"","negative":""}. For text prompts leave negative empty.`,
        `Idea: ${input.idea}`,
        600,
      );
      return { prompt: out.prompt, negative: out.negative ?? "" };
    }
  }
  throw new Fail(404, "unknown_resource", `No resource ${r.id}`);
}

async function snapshot(env: Env, input: Input) {
  const net = (input.network as any) ?? "robinhood";
  const address = input.address as Address;
  const [token, m] = await Promise.all([readToken(env, net, address), tokenMarket(env, net, address)]);
  return { token, ...m };
}
