// The live checks behind the Docs panel. Each one runs something real against siroagent.com from
// the reader's browser, says where the answer came from and when, and never signs a payment.
import { PAY_NETWORKS, RESOURCES, formatPrice, payNetworkOf, type PayNetworkKey } from "../../shared/catalog";
import { DEFAULT_LIMITS } from "../lib/caps";
import { esc } from "../shell";
import { canUnpack, packageJsonOf, type PackageJson } from "./tgz";

export type CheckId = "catalog" | "rows" | "unpaid" | "networks" | "stats" | "badInput" | "browser" | "package" | "mcp" | "discover" | "tokens";

/** Where a check draws: the desktop panel, or one section's inline details. */
export type Host = {
  name: HTMLElement | null;
  src: HTMLElement;
  out: HTMLElement;
  say: HTMLElement;
  /** Checks that run on their own speak up only where the reader opened them. */
  announce: boolean;
  check: CheckId | null;
  /** Bumped on every mount, so an answer that arrives late never paints over another check. */
  run: number;
};

export function hostIn(el: HTMLElement, announce: boolean): Host {
  return {
    name: el.querySelector<HTMLElement>("[data-check-name]"),
    src: el.querySelector<HTMLElement>("[data-check-src]")!,
    out: el.querySelector<HTMLElement>("[data-check-out]")!,
    say: el.querySelector<HTMLElement>("[data-check-say]")!,
    announce,
    check: null,
    run: 0,
  };
}

type Stamp = { ms: number; at: Date };
/** What a check paints, what it says aloud, and when its answer was read (shown beside the source).
 *  `keys` are extra keys that sit in one row with Read again. */
type Drawn = { html: string; said: string; at?: Date; keys?: string };
type Mount = (h: Host, run: number) => void;

/** A failure already worded for the reader. */
class Miss extends Error {}

const ORDER: PayNetworkKey[] = ["robinhood", "base", "solana", "arbitrum", "polygon"];
const netName = (n: string) => {
  const k = payNetworkOf(n);
  return k ? PAY_NETWORKS[k].name : n;
};
const utc = (d: Date) => `${d.toISOString().slice(11, 19)} UTC`;
const took = (s: Stamp) => `${s.ms.toLocaleString("en-US")} ms`;
const dated = (unix?: number) => (typeof unix === "number" ? `${new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "time unknown");
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "$0.10", "$0.045", "$25.00": two decimals at least, more only when the value has them. */
function usd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0.00";
  const [w, f = ""] = (v >= 0.1 ? v.toFixed(2) : v.toFixed(6).replace(/0+$/, "")).split(".");
  return `$${w}.${f.padEnd(2, "0")}`;
}

// ---- Reading from the server ----

async function timed(url: string, init: RequestInit = {}): Promise<{ res: Response } & Stamp> {
  const stop = new AbortController();
  const timer = window.setTimeout(() => stop.abort(), 15_000);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store", ...init, signal: stop.signal });
    return { res, ms: Math.round(performance.now() - t0), at: new Date() };
  } catch {
    throw new Miss(stop.signal.aborted ? "No answer after 15 seconds. The server may be busy, so try again." : "Could not reach siroagent.com. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

const errText = (b: any): string => (typeof b?.error === "string" ? b.error : typeof b?.error?.message === "string" ? b.error.message : "");

async function readJson<T>(url: string, init?: RequestInit): Promise<{ value: T } & Stamp> {
  const { res, ms, at } = await timed(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const why = errText(body);
    throw new Miss(`HTTP ${res.status}${why ? `: ${why}` : "."}`);
  }
  if (body === null) throw new Miss("The answer was not JSON.");
  return { value: body as T, ms, at };
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type Accept = { scheme?: string; network: string; amount: string; payTo?: string; maxTimeoutSeconds?: number };
type Quote = { x402Version?: number; accepts?: Accept[]; inputError?: { code?: string; message?: string } };

/** The 402's quote: from PAYMENT-REQUIRED when it decodes, else from the body. */
function quoteOf(res: Response, body: unknown): { quote: Quote | null; fromHeader: boolean } {
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      return { quote: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0)))) as Quote, fromHeader: true };
    } catch {
      /* the body carries the same quote */
    }
  }
  return { quote: body && typeof body === "object" ? (body as Quote) : null, fromHeader: false };
}
const acceptsOf = (q: Quote | null): Accept[] => (Array.isArray(q?.accepts) ? (q?.accepts as Accept[]) : []);

const memo = new Map<string, { at: number; p: Promise<unknown> }>();
/** One read shared by every check that asks within a minute; `force` reads again. */
function shared<T>(key: string, load: () => Promise<T>, force: boolean, ttl = 60_000): Promise<T> {
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = load();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => {
    if (memo.get(key)?.p === p) memo.delete(key);
  });
  return p;
}

// ---- Painting ----

/** Replaces an element's content. Focus that was inside it, or parked on the fallback while it loaded,
 *  goes to the new Read again key first: the first control in the answer can be a link off the page. */
function fill(el: HTMLElement, html: string, fallback: HTMLElement) {
  const active = document.activeElement;
  const had = !!active && (el.contains(active) || active === fallback);
  el.innerHTML = html;
  if (had) (el.querySelector<HTMLElement>("[data-again]") ?? el.querySelector<HTMLElement>("button, a[href], input") ?? fallback).focus();
}
const put = (h: Host, run: number, html: string) => {
  if (h.run === run) fill(h.out, html, h.out);
};
const tell = (h: Host, run: number, text: string) => {
  if (h.run !== run) return;
  // Emptied first, so the same answer read again is spoken again.
  h.say.textContent = "";
  window.setTimeout(() => {
    if (h.run === run) h.say.textContent = text;
  }, 80);
};
/** The source line reads "GET /api/stats · 14:05:12 UTC" once an answer is in, and loses the time while reading. */
function stamp(h: Host, run: number, at?: Date) {
  if (h.run !== run || !h.check) return;
  const src = CHECKS[h.check].src;
  h.src.textContent = at ? `${src} · ${utc(at)}` : src;
}
const again = (label: string, keys = "") => `<p class="check__keys"><button class="key key--sm" type="button" data-again>${label}</button>${keys}</p>`;

function missed(e: unknown): Drawn {
  const msg = e instanceof Miss ? e.message : "This check broke in the page. Try again.";
  return { html: `<p class="lamp lamp--refused">${esc(msg)}</p>`, said: msg };
}
function safely(draw: () => Drawn): Drawn {
  try {
    return draw();
  } catch {
    return missed(new Miss("The answer came back in a shape this page does not know."));
  }
}

/** Says what is being read; after three seconds, says that it is still waiting. */
function waiting(paint: (html: string) => void, what: string): () => void {
  paint(`<p class="check__wait">${what}</p>`);
  const t = window.setTimeout(() => paint(`<p class="check__wait">Still waiting. The server may be warming up.</p>`), 3000);
  return () => clearTimeout(t);
}

type Reading<T> = {
  h: Host;
  run: number;
  paint: (html: string) => void;
  key: string;
  what: string;
  load: () => Promise<T>;
  draw: (v: T) => Drawn;
  force: boolean;
  speak: boolean;
  ttl?: number;
  /** False once the reader has moved on inside the same check (Swaps: Robinhood Chain, then Base). */
  fresh?: () => boolean;
};

/** Reads (or reuses a fresh read), then paints the answer or the failure with a key to read again. */
function readAndPaint<T>(o: Reading<T>) {
  const done = waiting(o.paint, o.what);
  stamp(o.h, o.run);
  const finish = (d: Drawn, label: string) => {
    done();
    if (o.fresh && !o.fresh()) return;
    o.paint(d.html + again(label, d.keys));
    stamp(o.h, o.run, d.at);
    if (o.speak) tell(o.h, o.run, d.said);
  };
  shared(o.key, o.load, o.force, o.ttl).then(
    (v) => finish(safely(() => o.draw(v)), "Read again"),
    (e) => finish(missed(e), "Try again"),
  );
}

/** A check that reads as soon as it is shown. */
function auto<T>(key: string, what: string, load: () => Promise<T>, draw: (v: T) => Drawn, ttl?: number): Mount {
  return (h, run) => {
    const go = (force: boolean) => readAndPaint({ h, run, paint: (html) => put(h, run, html), key, what, load, draw, force, speak: force || h.announce, ttl });
    h.out.onclick = (e) => {
      if ((e.target as Element).closest("[data-again]")) go(true);
    };
    go(false);
  };
}

const kept = new Map<CheckId, Drawn>();

/** A check that waits for the reader's key. The last answer is still there when they come back. */
function keyed(id: CheckId, intro: string, label: string, what: string, send: () => Promise<Drawn>): Mount {
  return (h, run) => {
    const last = kept.get(id);
    put(h, run, `${intro}<p><button class="key key--sm" type="button" data-send>${label}</button></p><div class="check__result" data-result>${last?.html ?? ""}</div>`);
    stamp(h, run, last?.at);
    h.out.onclick = async (e) => {
      const key = (e.target as Element).closest<HTMLButtonElement>("[data-send]");
      const slot = h.out.querySelector<HTMLElement>("[data-result]");
      if (!key || !slot || key.getAttribute("aria-disabled") === "true") return;
      key.setAttribute("aria-disabled", "true");
      key.textContent = "Sending…";
      stamp(h, run);
      const done = waiting((html) => h.run === run && fill(slot, html, h.out), what);
      let d: Drawn;
      try {
        d = await send();
      } catch (err) {
        d = missed(err);
      }
      done();
      kept.set(id, d);
      if (h.run !== run) return;
      fill(slot, d.html, h.out);
      stamp(h, run, d.at);
      tell(h, run, d.said);
      key.removeAttribute("aria-disabled");
      key.textContent = "Send again";
    };
  };
}

// ---- The catalog ----

type CatalogRow = { id: string; price: string; live?: boolean };
type Catalog = { value: { data?: CatalogRow[]; count?: number } } & Stamp;
const readCatalog = () => readJson<{ data?: CatalogRow[]; count?: number }>("/v1/resources");
const rowsOf = (v: Catalog) => (Array.isArray(v.value.data) ? v.value.data : []);

function drawCount(v: Catalog): Drawn {
  const rows = rowsOf(v);
  const count = typeof v.value.count === "number" ? v.value.count : rows.length;
  if (!count) return { html: `<p>The catalog came back empty.</p><p class="check__note">Answered in ${took(v)}.</p>`, said: "The catalog came back empty.", at: v.at };
  const on = rows.filter((r) => r.live).length;
  const drift = count !== RESOURCES.length ? ` This page was built with ${RESOURCES.length}.` : "";
  return {
    html: `<p class="check__big live-num">${count}<small>tools listed</small></p>
<p class="lamp ${on ? "lamp--settled" : "lamp--refused"}">${on ? `${on} live now` : "none live right now"}</p>
${on && on < rows.length ? `<p class="lamp">${rows.length - on} listed, not switched on yet</p>` : ""}
<p class="check__note">Answered in ${took(v)}.${drift}</p>`,
    said: `${count} tools listed, ${on} live now.`,
    at: v.at,
  };
}

function drawRows(v: Catalog): Drawn {
  const rows = rowsOf(v).slice(0, 5);
  if (!rows.length) return { html: `<p>The catalog came back empty.</p><p class="check__note">Answered in ${took(v)}.</p>`, said: "The catalog came back empty.", at: v.at };
  const items = rows.map((r) => `<li><code>${esc(r.id)}</code><span class="num">${esc(formatPrice(String(r.price)))}</span><span class="lamp${r.live ? " lamp--settled" : ""}">${r.live ? "live" : "off"}</span></li>`).join("");
  return {
    html: `<ol class="check__list">${items}</ol>
<p class="check__note">The first 5 of ${typeof v.value.count === "number" ? v.value.count : rowsOf(v).length}, in catalog order. Answered in ${took(v)}.</p>`,
    said: `First five tools: ${rows.map((r) => r.id).join(", ")}.`,
    at: v.at,
  };
}

// ---- The 402 itself ----

const UNPAID = `<p>Sends <code>POST /v1/gas-now</code> with <code>{"network":"robinhood"}</code> and no payment, then decodes the 402. Nothing is signed and nothing is charged.</p>`;

async function sendUnpaid(): Promise<Drawn> {
  const t = await timed("/v1/gas-now", post({ network: "robinhood" }));
  const body: unknown = await t.res.json().catch(() => null);
  if (t.res.status !== 402) throw new Miss(`Expected a 402 and got HTTP ${t.res.status}${errText(body) ? `: ${errText(body)}` : "."}`);
  const { quote, fromHeader } = quoteOf(t.res, body);
  const accepts = acceptsOf(quote);
  if (!quote || !accepts.length) throw new Miss("The 402 came back with no networks to pay on.");
  const evm = accepts.find((a) => String(a.network).startsWith("eip155:"))?.payTo;
  const sol = accepts.find((a) => String(a.network).startsWith("solana:"))?.payTo;
  const payTo = [evm ? `<code>${esc(short(evm))}</code> on EVM chains` : "", sol ? `<code>${esc(short(sol))}</code> on Solana` : ""].filter(Boolean).join(", ");
  const schemes = [...new Set(accepts.map((a) => a.scheme ?? "unknown"))].join(", ");
  const rows = accepts
    .map((a) => `<tr><td>${esc(netName(String(a.network)))}</td><td class="num">${esc(a.amount)}<small>${usd(Number(a.amount) / 1e6)}</small></td><td class="num">${esc(a.maxTimeoutSeconds ?? "?")} s</td></tr>`)
    .join("");
  return {
    html: `<p class="check__big live-num">402<small>Payment Required</small></p>
<p class="check__note">Round trip ${took(t)}. Nothing was signed.</p>
<p class="check__label">${fromHeader ? "The PAYMENT-REQUIRED header, decoded" : "The 402 body. No PAYMENT-REQUIRED header came back."}</p>
<table class="check__table"><caption class="sr">accepts, in quote order</caption><thead><tr><th scope="col">accepts</th><th scope="col" class="num">amount</th><th scope="col" class="num">window</th></tr></thead><tbody>${rows}</tbody></table>
<p class="check__note">x402Version ${esc(quote.x402Version ?? "unknown")}, scheme ${esc(schemes)}.${payTo ? ` payTo ${payTo}.` : ""}</p>
<details class="check__raw"><summary>The whole quote as JSON</summary><pre class="code" tabindex="0" aria-label="The whole quote as JSON">${esc(JSON.stringify(quote, null, 2))}</pre></details>`,
    said: `402 Payment Required in ${t.ms} milliseconds, ${plural(accepts.length, "network")} quoted.`,
    at: t.at,
  };
}

const BAD_INPUT = `<p>Sends <code>{"network":"solana"}</code> to Gas Now, which only reads Robinhood Chain or Base. No payment is attached.</p>`;

async function sendBadInput(): Promise<Drawn> {
  const t = await timed("/v1/gas-now", post({ network: "solana" }));
  const body: unknown = await t.res.json().catch(() => null);
  if (t.res.status !== 402) throw new Miss(`Expected a 402 and got HTTP ${t.res.status}${errText(body) ? `: ${errText(body)}` : "."}`);
  const { quote } = quoteOf(t.res, body);
  const problem = quote?.inputError;
  if (!problem?.code) {
    return { html: `<p>The server answered 402 without an inputError, so it took this input as valid.</p><p class="check__note">Round trip ${took(t)}.</p>`, said: "402 without an inputError.", at: t.at };
  }
  const quoted = acceptsOf(quote).length;
  return {
    html: `<p class="check__big live-num">402<small>with inputError</small></p>
<dl class="check__rows">${row("code", `<code>${esc(problem.code)}</code>`)}${row("message", esc(problem.message ?? ""))}${row("accepts", `${plural(quoted, "network")}, still quoted`)}</dl>
<p class="check__note">Round trip ${took(t)}. Siro's own clients stop at inputError and sign nothing. With a payment attached, the same input gets HTTP 400 and nothing is charged.</p>`,
    said: `402 with inputError ${problem.code}: ${problem.message ?? ""}`,
    at: t.at,
  };
}

// ---- Networks ----

type Listing = { networks?: string[] };
type NetRead = Stamp & { quick: PayNetworkKey[]; slow: PayNetworkKey[]; window: number | null };
const keysOf = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((x) => payNetworkOf(String(x))).filter((k): k is PayNetworkKey => !!k);

async function readNetworks(): Promise<NetRead> {
  // Quick tools are quoted like Gas Now. Video and music are quoted on their own terms, so those
  // come from a real unpaid quote for Seedance 2.0 Mini (an empty body: nothing runs, nothing is signed).
  const [quick, slow] = await Promise.all([readJson<Listing>("/v1/resources/gas-now"), timed("/v1/seedance-2-mini", post({}))]);
  const body: unknown = await slow.res.json().catch(() => null);
  const accepts = slow.res.status === 402 ? acceptsOf(quoteOf(slow.res, body).quote) : [];
  const first = accepts.at(0);
  return {
    quick: keysOf(quick.value.networks),
    slow: keysOf(accepts.map((a) => a.network)),
    window: typeof first?.maxTimeoutSeconds === "number" ? first.maxTimeoutSeconds : null,
    ms: Math.max(quick.ms, slow.ms),
    at: quick.at.getTime() > slow.at.getTime() ? quick.at : slow.at,
  };
}

function drawNetworks(v: NetRead): Drawn {
  const on = new Set(v.quick);
  const items = ORDER.map((k) => `<li><span>${PAY_NETWORKS[k].name}<small>${PAY_NETWORKS[k].asset}</small></span><span class="lamp${on.has(k) ? " lamp--settled" : ""}">${on.has(k) ? "quoting" : "not quoting now"}</span></li>`).join("");
  const slow = ORDER.filter((k) => v.slow.includes(k)).map((k) => PAY_NETWORKS[k].name);
  const minutes = slow.length ? `${and(slow)}${v.window ? `, with a ${v.window}-second window` : ""}` : "not quoted right now";
  return {
    html: `${on.size ? "" : `<p class="lamp lamp--refused">No network is quoting right now.</p>`}<ul class="check__nets">${items}</ul>
<p class="check__note">Tools that run for minutes: ${minutes}. Read from the Gas Now listing and an unpaid Seedance 2.0 Mini quote in ${took(v)}.</p>`,
    said: `${on.size} of ${ORDER.length} networks quoting.`,
    at: v.at,
  };
}

// ---- Live totals ----

type Stats = { resources?: number; networks?: number; paidCalls?: number; volumeUsd?: number; payers?: number; last?: { resource?: string; network?: string; at?: number } | null };
const readStats = () => readJson<Stats>("/api/stats");

function drawStats(v: { value: Stats } & Stamp): Drawn {
  const s = v.value;
  const n = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en-US") : "not reported");
  const last = s.last?.resource ? `${esc(s.last.resource)} on ${esc(netName(s.last.network ?? ""))}, ${dated(s.last.at)}` : "none yet";
  return {
    html: `<dl class="check__rows">${row("<code>resources</code>", n(s.resources))}${row("<code>networks</code>", n(s.networks))}${row("<code>paidCalls</code>", n(s.paidCalls))}${row("<code>volumeUsd</code>", typeof s.volumeUsd === "number" ? usd(s.volumeUsd) : "not reported")}${row("<code>payers</code>", n(s.payers))}${row("<code>last</code>", last)}</dl>
<p class="check__note">Answered in ${took(v)}.</p>`,
    said: `${n(s.paidCalls)} paid calls settled, ${n(s.networks)} networks quoting.`,
    at: v.at,
  };
}

// ---- This browser ----

type Caps = { perPayment: number; perDay: number; perSwap: number; autopay: boolean };
/** A new Budget's caps (src/lib/caps.ts). */
const NEW_WALLET: Caps = { ...DEFAULT_LIMITS };
type BrowserRead = { at: Date; blocked: boolean; key: boolean; caps: Caps; saved: boolean; paid: number; spent: number };

async function readBrowser(): Promise<BrowserRead> {
  const at = new Date();
  let store: Storage;
  try {
    store = window.localStorage;
    store.getItem("siro.agent.key");
  } catch {
    return { at, blocked: true, key: false, caps: NEW_WALLET, saved: false, paid: 0, spent: 0 };
  }
  const json = (k: string): unknown => {
    try {
      const raw = store.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const key = json("siro.agent.key");
  const saved = json("siro.agent.limits");
  const caps = { ...NEW_WALLET };
  if (saved && typeof saved === "object") {
    const s = saved as Record<string, unknown>;
    for (const k of ["perPayment", "perDay", "perSwap"] as const) {
      const v = s[k];
      if (typeof v === "number" && v > 0) caps[k] = v;
    }
    if (typeof s.autopay === "boolean") caps.autopay = s.autopay;
  }
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const log = json("siro.agent.log");
  const today = (Array.isArray(log) ? log : []).filter((e) => e && typeof e.at === "number" && e.at >= midnight.getTime() && Number(e.usd) > 0);
  return {
    at,
    blocked: false,
    key: typeof key === "string" && /^0x[0-9a-fA-F]{64}$/.test(key),
    caps,
    saved: !!saved,
    paid: today.length,
    spent: today.reduce((sum, e) => sum + Number(e.usd), 0),
  };
}

function drawBrowser(v: BrowserRead): Drawn {
  if (v.blocked) {
    return { html: `<p class="lamp lamp--refused">This browser blocks storage for siroagent.com, so it cannot keep a key or caps.</p>`, said: "Storage is blocked in this browser.", at: v.at };
  }
  const c = v.caps;
  return {
    html: `<dl class="check__rows">${row("Key", v.key ? "stored here, unencrypted" : "none in this browser")}${row("Per payment", usd(c.perPayment))}${row("Per day", usd(c.perDay))}${row("Per swap", usd(c.perSwap))}${row("Autopay", c.autopay ? "on, up to the per-payment cap" : "off, Ask waits for your yes")}${row("Paid today", v.paid ? `${plural(v.paid, "payment")}, ${usd(v.spent)}` : "none yet")}</dl>
<p class="check__note">${v.saved ? "Caps saved in this browser." : "No caps saved here yet, so these are a new wallet's defaults."} Read from this browser's localStorage. This check never shows the key.</p>`,
    said: v.key ? "A key is stored in this browser, unencrypted." : "No key in this browser.",
    at: v.at,
    keys: `<a class="key key--sm" href="/budget">Open Budget</a>`,
  };
}

// ---- The package ----

type PackageRead = Stamp & { bytes: number; pkg: PackageJson | null };

async function readPackage(): Promise<PackageRead> {
  const t0 = performance.now();
  const t = await timed("/cli/siro.tgz");
  if (!t.res.ok) throw new Miss(`HTTP ${t.res.status} for /cli/siro.tgz.`);
  const buf = await t.res.arrayBuffer();
  const pkg = await packageJsonOf(buf).catch(() => null);
  return { bytes: buf.byteLength, pkg, ms: Math.round(performance.now() - t0), at: new Date() };
}

function drawPackage(v: PackageRead): Drawn {
  const kb = (v.bytes / 1024).toFixed(1);
  const p = v.pkg;
  if (!p?.version) {
    const why = canUnpack() ? "The package came down, but its package.json could not be read." : "This browser cannot unpack .tgz files, so only the size is shown.";
    return { html: `<p class="check__big live-num">${kb}<small>KB, siro.tgz</small></p><p class="check__note">${why} Downloaded in ${took(v)}.</p>`, said: `siro.tgz, ${kb} kilobytes.`, at: v.at };
  }
  const bin = typeof p.bin === "string" ? (p.name ?? "") : Object.keys(p.bin ?? {}).join(", ");
  return {
    html: `<p class="check__big live-num">${esc(p.version)}<small>${esc(p.name ?? "")}</small></p>
<dl class="check__rows">${row("npm name", `<code>${esc(p.name ?? "unnamed")}</code>`)}${row("command", bin ? `<code>${esc(bin)}</code>` : "none")}${row("node", esc(p.engines?.node ?? "any"))}${row("download", `${kb} KB`)}</dl>
<p class="check__note">Downloaded and unpacked in your browser in ${took(v)}.</p>`,
    said: `${p.name ?? "The package"} version ${p.version}.`,
    at: v.at,
  };
}

// ---- MCP ----

type McpTool = { name?: string; title?: string };
type McpRead = Stamp & { tools: McpTool[] };

async function readMcp(): Promise<McpRead> {
  const r = await readJson<{ result?: { tools?: McpTool[] }; error?: { message?: string } }>("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const tools = r.value.result?.tools;
  if (!Array.isArray(tools)) throw new Miss(r.value.error?.message ? `JSON-RPC error: ${r.value.error.message}` : "No tool list came back.");
  return { tools, ms: r.ms, at: r.at };
}

function drawMcp(v: McpRead): Drawn {
  if (!v.tools.length) return { html: `<p>The server answered with no tools.</p><p class="check__note">tools/list answered in ${took(v)}.</p>`, said: "No MCP tools came back.", at: v.at };
  return {
    html: `<p class="check__big live-num">${v.tools.length}<small>tools on the remote server</small></p>
<ul class="check__tools">${v.tools.map((t) => `<li><code>${esc(t.name)}</code><span>${esc(t.title ?? "")}</span></li>`).join("")}</ul>
<p class="check__note">tools/list answered in ${took(v)}.</p>`,
    said: `${plural(v.tools.length, "MCP tool")}: ${v.tools.map((t) => t.name).join(", ")}.`,
    at: v.at,
  };
}

// ---- Third-party services ----

type Found = { source?: string; services?: { url: string; method?: string; priceUsd?: number | null; payable?: boolean }[] };
const where = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
};

function drawServices(q: string, v: { value: Found } & Stamp): Drawn {
  const list = Array.isArray(v.value.services) ? v.value.services : [];
  if (!list.length) {
    return { html: `<p>Nothing in the index matches "${esc(q)}". Try one or two plain words.</p><p class="check__note">Searched in ${took(v)}.</p>`, said: `Nothing found for ${q}.`, at: v.at };
  }
  const items = list
    .map(
      (s) =>
        `<li><span class="lamp${s.payable ? " lamp--settled" : ""}">${s.payable ? "Siro can pay" : "other networks only"}</span><span class="num">${typeof s.priceUsd === "number" ? usd(s.priceUsd) : "no USD price"}</span><code>${esc(s.method ?? "GET")} ${esc(where(s.url))}</code></li>`,
    )
    .join("");
  return {
    html: `<ul class="check__svc">${items}</ul>
<p class="check__note">${list.length} from ${esc(v.value.source ?? "the x402 index")}, found in ${took(v)}. Their owners run them, not Siro.</p>`,
    said: `${plural(list.length, "service")} found for ${q}.`,
    at: v.at,
  };
}

let words = "weather";
const mountDiscover: Mount = (h, run) => {
  put(
    h,
    run,
    `<form class="check__form" novalidate>
<label class="field"><span>Search words</span><input class="well" name="q" value="${esc(words)}" maxlength="80" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
<p><button class="key key--sm" type="submit">Search the index</button></p>
</form><div class="check__result" data-result>${kept.get("discover")?.html ?? ""}</div>`,
  );
  stamp(h, run, kept.get("discover")?.at);
  h.out.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("q") as HTMLInputElement | null;
    const key = form.querySelector<HTMLButtonElement>("button");
    const slot = h.out.querySelector<HTMLElement>("[data-result]");
    if (!input || !key || !slot || key.getAttribute("aria-disabled") === "true") return;
    const q = input.value.trim();
    if (q.length < 2) {
      fill(slot, `<p class="lamp lamp--refused">Type at least two letters.</p>`, h.out);
      tell(h, run, "Type at least two letters.");
      input.focus();
      return;
    }
    words = q;
    key.setAttribute("aria-disabled", "true");
    key.textContent = "Searching…";
    stamp(h, run);
    const done = waiting((html) => h.run === run && fill(slot, html, h.out), `Searching the x402 index for "${esc(q)}"`);
    let d: Drawn;
    try {
      d = drawServices(q, await readJson<Found>(`/api/discover?q=${encodeURIComponent(q)}&limit=5`));
    } catch (err) {
      d = missed(err);
    }
    done();
    kept.set("discover", d);
    if (h.run !== run) return;
    fill(slot, d.html, h.out);
    stamp(h, run, d.at);
    tell(h, run, d.said);
    key.removeAttribute("aria-disabled");
    key.textContent = "Search the index";
  };
};

// ---- Swappable tokens ----

type SwapNet = "robinhood" | "base";
type Tokens = { value: { tokens?: { symbol?: string; kind?: string }[] } } & Stamp;

function drawTokens(net: SwapNet, v: Tokens): Drawn {
  const tokens = Array.isArray(v.value.tokens) ? v.value.tokens : [];
  const name = PAY_NETWORKS[net].name;
  if (!tokens.length) return { html: `<p>No tokens came back for ${name}.</p><p class="check__note">Answered in ${took(v)}.</p>`, said: `No tokens for ${name}.`, at: v.at };
  const plain = tokens.filter((t) => t.kind !== "stock").map((t) => esc(t.symbol));
  const stocks = tokens.filter((t) => t.kind === "stock").map((t) => esc(t.symbol));
  const text = stocks.length ? `${plain.join(", ")} and ${stocks.length} stock tokens: ${stocks.slice(0, 6).join(", ")}${stocks.length > 6 ? " and more" : ""}.` : `${and(plain)}.`;
  return {
    html: `<p class="check__big live-num">${tokens.length}<small>tokens on ${name}</small></p><p>${text}</p><p class="check__note">Answered in ${took(v)}.</p>`,
    said: `${plural(tokens.length, "token")} on ${name}.`,
    at: v.at,
  };
}

const mountTokens: Mount = (h, run) => {
  let net: SwapNet = "robinhood";
  put(
    h,
    run,
    `<div class="check__seg" role="group" aria-label="Network">
<button class="key key--sm" type="button" data-net="robinhood" aria-pressed="true">Robinhood Chain</button>
<button class="key key--sm" type="button" data-net="base" aria-pressed="false">Base</button>
</div><div class="check__result" data-result></div>`,
  );
  const slot = h.out.querySelector<HTMLElement>("[data-result]");
  if (!slot) return;
  const go = (force: boolean, speak: boolean) => {
    const want = net;
    readAndPaint({
      h,
      run,
      paint: (html) => {
        if (h.run === run && net === want) fill(slot, html, h.out);
      },
      key: `tokens:${want}`,
      what: `Reading the tokens on ${PAY_NETWORKS[want].name}`,
      load: () => readJson<Tokens["value"]>(`/api/tokens?network=${want}`),
      draw: (v) => drawTokens(want, v),
      force,
      speak,
      fresh: () => net === want,
    });
  };
  h.out.onclick = (e) => {
    const t = e.target as Element;
    const pick = t.closest<HTMLButtonElement>("[data-net]");
    if (pick) {
      net = pick.dataset.net === "base" ? "base" : "robinhood";
      h.out.querySelectorAll("[data-net]").forEach((b) => b.setAttribute("aria-pressed", String(b === pick)));
      go(false, true);
    } else if (t.closest("[data-again]")) go(true, true);
  };
  go(false, h.announce);
};

// ---- The registry ----

const CHECKS: Record<CheckId, { name: string; src: string; mount: Mount }> = {
  catalog: { name: "Catalog count", src: "GET /v1/resources", mount: auto("catalog", "Reading the catalog", readCatalog, drawCount) },
  rows: { name: "Catalog rows", src: "GET /v1/resources", mount: auto("catalog", "Reading the catalog", readCatalog, drawRows) },
  unpaid: { name: "Unpaid request", src: "POST /v1/gas-now", mount: keyed("unpaid", UNPAID, "Send unpaid request", "Waiting for the 402", sendUnpaid) },
  networks: { name: "Networks quoting", src: "GET /v1/resources/gas-now", mount: auto("networks", "Reading what the server quotes", readNetworks, drawNetworks) },
  stats: { name: "Live totals", src: "GET /api/stats", mount: auto("stats", "Reading /api/stats", readStats, drawStats) },
  badInput: { name: "Bad input", src: "POST /v1/gas-now", mount: keyed("badInput", BAD_INPUT, "Send a bad input", "Waiting for the 402", sendBadInput) },
  browser: { name: "This browser", src: "localStorage", mount: auto("browser", "Reading this browser's storage", readBrowser, drawBrowser, 0) },
  package: { name: "The package", src: "GET /cli/siro.tgz", mount: auto("package", "Downloading and unpacking siro.tgz", readPackage, drawPackage) },
  mcp: { name: "MCP tools", src: "POST /mcp tools/list", mount: auto("mcp", "Asking /mcp for its tools", readMcp, drawMcp) },
  discover: { name: "x402 index search", src: "GET /api/discover", mount: mountDiscover },
  tokens: { name: "Swappable tokens", src: "GET /api/tokens", mount: mountTokens },
};

/** Shows one check in a host; a late answer for the check it replaces is dropped. */
export function mountCheck(id: CheckId, h: Host) {
  const c = CHECKS[id];
  h.check = id;
  const run = ++h.run;
  if (h.name) h.name.textContent = c.name;
  h.src.textContent = c.src;
  h.out.onclick = null;
  h.out.onsubmit = null;
  c.mount(h, run);
}
