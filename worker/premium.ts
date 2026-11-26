// Premium models, all on Replicate: frontier LLMs, image, video and audio.
// Same contract as run.ts: throw Fail for anything that should not be charged.
import type { Resource } from "../shared/catalog";
import { Fail } from "./fail";
import type { Input } from "./run";
import { RESULT_TTL_SECONDS } from "../shared/privacy";

/** A premium resource is offered only once the Replicate token is set. */
export const premiumReady = (env: Env, r: Resource) => (r.via === "replicate" ? !!env.REPLICATE_API_TOKEN : true);

/** Longest a job may run before we give up. Slow jobs must finish inside the payment window (300 s)
 *  with room left to settle; quick ones inside the 120 s window. */
const DEADLINE_MS = { slow: 240_000, quick: 90_000 };
export const SLOW_PAYMENT_SECONDS = 300;

function upstreamFail(id: string, status: number, message?: string): Fail {
  console.error(JSON.stringify({ event: "upstream_failed", provider: "replicate", resource: id, status, message: String(message ?? "").slice(0, 300) }));
  if (status === 429) return new Fail(429, "model_busy", "The model is at capacity. Retry in a few seconds. You were not charged.");
  if (status === 422 || status === 400) return new Fail(422, "model_refused", `The model refused this request${message ? `: ${String(message).slice(0, 160)}` : ""}. You were not charged.`);
  return new Fail(502, "model_failed", "The model did not answer. You were not charged.");
}

// ---- Input for each kind of model ----

const SIZE_OF: Record<string, string> = { "1:1": "1024x1024", "16:9": "1344x768", "9:16": "768x1344", "4:3": "1280x896", "3:4": "896x1280" };
const WH_OF: Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 864], "3:4": [864, 1152] };
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, Number(v ?? dflt) || dflt));

function inputFor(r: Resource, input: Input): Record<string, unknown> {
  const b: Record<string, unknown> = { ...r.params };
  if (r.category === "llm") {
    const keys = r.keys!;
    const system = input.system as string | undefined;
    // A model without a system input gets the instructions in front of the prompt.
    b.prompt = system && !keys.system ? `${system}\n\n${input.prompt}` : input.prompt;
    if (system && keys.system) b[keys.system] = system;
    b[keys.max] = (input.max_tokens as number) ?? 1024;
    return b;
  }
  if (r.category === "image" || r.category === "video") {
    b.prompt = input.prompt;
    const aspect = (input.aspect as string) ?? (r.category === "video" ? "16:9" : "1:1");
    if (r.shape === "size") b.size = SIZE_OF[aspect] ?? SIZE_OF["1:1"];
    else if (r.shape === "wh") [b.width, b.height] = WH_OF[aspect] ?? WH_OF["1:1"];
    else b.aspect_ratio = aspect;
    return b;
  }
  switch (r.id) {
    case "eleven-v3":
      return { ...b, prompt: input.text, voice: input.voice ?? "Rachel" };
    case "eleven-music":
      return { ...b, prompt: input.prompt, music_length_ms: clamp(input.seconds, 10, 60, 30) * 1000, force_instrumental: input.instrumental !== "no" };
    case "minimax-music":
      return { ...b, prompt: input.prompt, lyrics: input.lyrics ?? "", is_instrumental: !input.lyrics };
    case "lyria-3":
      return { ...b, prompt: input.prompt };
  }
  throw new Fail(500, "not_wired", "This resource is not wired yet. You were not charged.");
}

// ---- Replicate predictions ----

const headers = (env: Env, wait?: number) => ({
  authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
  "content-type": "application/json",
  ...(wait ? { prefer: `wait=${wait}` } : {}),
});

async function call(id: string, url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Fail(502, "model_failed", "Could not reach the model. You were not charged.");
  }
  const j: any = await res.json().catch(() => null);
  if (!res.ok) throw upstreamFail(id, res.status, j?.detail ?? j?.title);
  return j;
}

/** Create the prediction and hold for up to 60 s; anything slower is polled until the deadline. */
async function predict(env: Env, r: Resource, input: Record<string, unknown>): Promise<any> {
  let p = await call(r.id, `https://api.replicate.com/v1/models/${r.model}/predictions`, { method: "POST", headers: headers(env, 60), body: JSON.stringify({ input }) });
  const deadline = Date.now() + (r.slow ? DEADLINE_MS.slow : DEADLINE_MS.quick);
  let wait = 2000;
  while (p.status === "starting" || p.status === "processing") {
    if (Date.now() > deadline) {
      if (p.urls?.cancel) fetch(p.urls.cancel, { method: "POST", headers: headers(env) }).catch(() => {});
      throw new Fail(504, "render_timeout", "The model took too long and the job was cancelled. You were not charged.");
    }
    await new Promise((ok) => setTimeout(ok, wait));
    wait = Math.min(6000, wait + 1000);
    p = await call(r.id, p.urls.get, { headers: headers(env) });
  }
  if (p.status !== "succeeded") throw upstreamFail(r.id, /safety|nsfw|flagged|sensitive|copyright/i.test(String(p.error)) ? 422 : 502, p.error);
  console.log(JSON.stringify({ event: "upstream_cost", provider: "replicate", resource: r.id, price: r.price, predictSeconds: p.metrics?.predict_time ?? null }));
  return p.output;
}

const firstUrl = (out: unknown): string | null => {
  const v = Array.isArray(out) ? out[0] : out;
  return typeof v === "string" && /^https:\/\//.test(v) ? v : typeof (v as any)?.url === "string" ? (v as any).url : null;
};

export async function runPremium(env: Env, r: Resource, input: Input): Promise<unknown> {
  const out = await predict(env, r, inputFor(r, input));
  const empty = () => new Fail(502, "model_failed", "The model returned nothing. You were not charged.");
  if (r.category === "llm") {
    // Language models stream tokens, so the output arrives as an array of text pieces.
    const text = (Array.isArray(out) ? out.join("") : String(out ?? "")).trim();
    if (!text) throw new Fail(502, "empty_answer", "The model returned an empty answer. You were not charged.");
    return { text, model: r.name };
  }
  const url = firstUrl(out);
  if (!url) throw empty();
  // Replicate deletes API outputs after an hour. Keep a copy in R2 when the bucket is bound; if that
  // fails, the call still succeeded, so hand back the Replicate link with its expiry instead.
  const stored = await keep(env, r, url);
  // Either way the link expires: Siro serves its copy for RESULT_TTL_DAYS, Replicate's own link lasts an hour.
  const kept = { model: r.name, expiresAt: Math.floor(Date.now() / 1000) + (stored ? RESULT_TTL_SECONDS : 3600) };
  const link = stored ?? url;
  if (r.category === "image") return { image: link, ...kept };
  if (r.category === "video") return { video: link, ...kept };
  return { audio: link, ...kept };
}

const MAX_KEEP_BYTES = 100_000_000;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

/** Copies one output into the MEDIA bucket and returns its /media/ URL (served for RESULT_TTL_DAYS), or null. */
async function keep(env: Env, r: Resource, url: string): Promise<string | null> {
  if (!env.MEDIA) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_KEEP_BYTES) throw new Error(`too large ${body.byteLength}`);
    const ext = EXT[type] ?? url.split("?")[0].split(".").pop()?.slice(0, 5) ?? "bin";
    const key = `${new Date().toISOString().slice(0, 10)}/${r.id}-${crypto.randomUUID().slice(0, 12)}.${ext}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: "private, max-age=3600" } });
    return `${env.ALLOWED_ORIGINS.split(",")[0]}/media/${key}`;
  } catch (e) {
    console.error(JSON.stringify({ event: "media_keep_failed", resource: r.id, err: String(e).slice(0, 200) }));
    return null;
  }
}
