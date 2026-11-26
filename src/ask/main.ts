// Ask: chat with the agent. Talking is free (POST /api/agent). When a task needs a paid tool the agent
// proposes one call; the quote waits in the transcript until the visitor approves it (or autopay pays
// it within the caps set in Budget), and this browser signs with the Budget's key or a connected wallet.
import { byId, formatPrice, isPayKey, payNetworkOf } from "../../shared/catalog";
import { agentAccount, callExternal, callResource, connectedWallet, doSwap, getSwapQuote, limits, network, PayError, setNetwork, type Receipt } from "../lib/pay";
import { md, renderResult } from "../lib/render";
import { MARK, ballSvg, esc, mountShell, openSearch, toast } from "../shell";
import "../styles/result.css";
import "./ask.css";
import { shut } from "./dialog";
import { mountDrawer } from "./drawer";
import { isoOf, uid, utcStamp } from "./format";
import { mountInstruments } from "./instruments";
import { connectWallet, payEnv, payerKind, setPayerKind } from "./payer";
import { preflight, quoteHtml, quoteSay } from "./quote";
import { safeFragment, safeHtml } from "./safe";
import { loadChats, newChat, saveChats, titleFrom, type Chat, type ExternalProposal, type Msg, type Proposal, type ResourceProposal, type SwapProposal } from "./store";

mountShell("ask");

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $("log");
const logIn = $("log-in");
const emptyEl = $("empty");
const input = $<HTMLTextAreaElement>("msg");
const sendKey = $<HTMLButtonElement>("send");
const bar = $("abar");

$("mark").innerHTML = MARK;
// The empty state's S, engraved into its own small faceplate, with the ball at rest where a brief enters.
$("empty-s").innerHTML = MARK;
$("empty-ball").innerHTML = ballSvg(24, "empty");
$("search-kbd").textContent = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";
$("search-key").addEventListener("click", () => openSearch());
// Search opens outside the top layer, so an open drawer or sheet would leave it inert. Close them
// first: their after-close work puts focus back, and Search opens after it so it keeps focus.
addEventListener(
  "keydown",
  (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
    const open = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
    if (!open.length) return;
    e.preventDefault();
    e.stopPropagation();
    open.forEach(shut);
    openSearch();
  },
  true,
);

// Example briefs for the empty state. Each names the tool the agent is asked to quote; the first six
// that are switched on are shown.
const BRIEFS: { tool: string; text: string }[] = [
  { tool: "market-brief", text: "What is trending on Robinhood Chain right now?" },
  { tool: "nano-banana-2-1", text: "Draw a steel ball rolling along an S-shaped groove milled into brushed aluminium, studio light, 16:9" },
  { tool: "stock-signal", text: "Is TSLA trading at a premium on Robinhood Chain?" },
  { tool: "prediction-read", text: "What do the odds say about the next Fed rate decision?" },
  { tool: "web-read", text: "Read x402.org and sum it up for me" },
  { tool: "tts-aura-2", text: "Read this out loud: Your agent just paid for this sentence." },
  { tool: "x-post-writer", text: "Write X posts about an agent that pays for its own tools" },
  { tool: "gas-now", text: "What does gas cost on Base right now?" },
];

const chats = loadChats().sort((a, b) => b.at - a.at);
let chat: Chat = chats[0] ?? blank();
/** Chats waiting on the agent, with when the wait started. */
const replying = new Map<string, number>();
/** One payment at a time, so the daily cap is checked against settled spend. */
let paying: { mid: string; chat: string } | null = null;
/** Chats whose latest user message may still autopay one quote. */
const autoArmed = new Set<string>();
let toolHint: string | null = null;
let liveTools: Map<string, boolean> | null = null;
/** The transcript follows its newest line until the reader scrolls up. */
let stuck = true;
/** scrollTop after the last scroll, this page's own or the reader's, to tell which way a scroll went. */
let lastTop = 0;

const instruments = mountInstruments({ onChange: refreshQuotes, paying: () => paying?.mid ?? null, toast });
const drawer = mountDrawer({ chats: () => chats, current: () => chat, pick: openChat, fresh: () => openChat(blank()), composer: () => input });
const env = () => payEnv(instruments.live(), paying?.mid ?? null);
const save = () => saveChats(chats);

function blank(): Chat {
  const empty = chats.find((c) => !c.msgs.length);
  if (empty) return empty;
  const c = newChat();
  chats.unshift(c);
  return c;
}

function openChat(c: Chat) {
  chat = c;
  renderLog();
}

function say(text: string) {
  const el = $("say");
  el.textContent = "";
  // Set after a beat so the same words are announced again.
  window.setTimeout(() => (el.textContent = text), 60);
}

/** "11 Nov, 20:13 UTC" sets the day on a line of its own in the gutter (inline again on phones). */
const stamp = (at: number) => {
  const s = utcStamp(at);
  const cut = s.lastIndexOf(", ");
  return cut < 0 ? s : `<span class="msg__day">${s.slice(0, cut)}<span class="msg__comma">,</span> </span>${s.slice(cut + 2)}`;
};
const gutter = (role: string, at?: number) => `<p class="msg__gut"><b>${role}</b>${at ? `<time datetime="${isoOf(at)}">${stamp(at)}</time>` : ""}</p>`;
const wrap = (m: Msg, kind: string, role: string, inner: string) => `<div class="msg msg--${kind}" id="m-${m.id}">${gutter(role, m.at)}<div class="msg__body">${inner}</div></div>`;
const last = (c: Chat) => c.msgs[c.msgs.length - 1];

function msgHtml(m: Msg): string {
  if (m.quote) return wrap(m, "quote", "Quote", quoteHtml(m, env()));
  if (m.notice) {
    const again = m === last(chat) ? `<p class="msg__keys"><button class="key key--sm" type="button" data-act="retry-agent" data-mid="${m.id}">Ask again</button></p>` : "";
    return wrap(m, "notice", "Siro", `<p class="lamp lamp--refused">The agent did not answer.</p><p>${esc(m.content)}</p>${again}`);
  }
  if (m.role === "user") {
    const r = m.tool ? byId(m.tool) : undefined;
    return wrap(m, "user", "You", `<p class="msg__text">${esc(m.content)}</p>${r ? `<p class="msg__aside">Asked to quote with ${esc(r.name)}</p>` : ""}`);
  }
  if (m.role === "assistant" && m.ui) return wrap(m, "quote", "Quote", legacy(m.ui));
  if (m.role === "assistant" && m.content.trim()) return wrap(m, "siro", "Siro", md(m.content));
  if (m.role === "tool" && m.ui) return wrap(m, "result", "Result", `<div class="result">${safeHtml(m.ui)}</div>`);
  return "";
}

/** Quote cards saved by the earlier chat app: shown as they were, without their old keys. */
function legacy(html: string) {
  const box = document.createElement("div");
  box.className = "legacy";
  box.append(safeFragment(html));
  box.querySelectorAll("button, .q__act").forEach((el) => el.remove());
  // Failed cards linked to the old /wallet page, which is Budget now.
  box.querySelectorAll<HTMLAnchorElement>('a[href="/wallet"]').forEach((a) => {
    a.setAttribute("href", "/budget");
    a.textContent = "Open Budget";
  });
  return `${box.outerHTML}<p class="msg__aside">Saved by the earlier chat app. It can no longer be approved here.</p>`;
}

function renderLog() {
  emptyEl.hidden = chat.msgs.length > 0;
  logIn.innerHTML = chat.msgs.map(msgHtml).join("");
  $("chat-title").textContent = chat.title;
  renderThinking();
  // A transcript opens at its newest line; the empty state opens at its heading.
  stuck = chat.msgs.length > 0;
  scrollLog(stuck);
  syncComposer();
  if (drawer.isOpen()) drawer.render();
}

function appendMsg(m: Msg) {
  const html = msgHtml(m);
  if (!html) return;
  emptyEl.hidden = true;
  // Only the newest notice offers to ask again.
  logIn.querySelectorAll('[data-act="retry-agent"]').forEach((b) => b.closest(".msg__keys")?.remove());
  logIn.insertAdjacentHTML("beforeend", html);
  renderThinking();
  if (m.role === "user") stuck = true;
  if (stuck) scrollLog(true);
}

/** Moves the transcript to its newest line (or its top) and records the spot as this page's own move. */
function scrollLog(end: boolean) {
  logEl.scrollTop = end ? logEl.scrollHeight : 0;
  lastTop = logEl.scrollTop;
}

function renderThinking() {
  const el = document.getElementById("thinking");
  const since = replying.get(chat.id);
  if (since === undefined) return el?.remove();
  const words = Date.now() - since > 10_000 ? "Still writing a reply." : "Writing a reply.";
  if (el) {
    logIn.append(el);
    el.querySelector(".lamp")!.textContent = words;
    return;
  }
  logIn.insertAdjacentHTML("beforeend", `<div class="msg msg--wait" id="thinking">${gutter("Siro")}<div class="msg__body"><p class="lamp lamp--awaiting">${words}</p></div></div>`);
}

/** Redraws one message in place; focus stays on the same key, or moves to the quote's status line. */
function rerender(m: Msg) {
  const el = document.getElementById(`m-${m.id}`);
  if (!el) return;
  const had = el.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.act ?? "") : null;
  el.outerHTML = msgHtml(m);
  if (had === null) return;
  const same = had ? document.querySelector<HTMLElement>(`#m-${m.id} [data-act="${had}"]:not([disabled])`) : null;
  (same ?? document.getElementById(`qs-${m.id}`))?.focus({ preventScroll: true });
}

function updateMsg(c: Chat, m: Msg) {
  save();
  if (c !== chat) return;
  rerender(m);
  if (stuck) scrollLog(true);
  syncComposer();
}

/** Open quotes judge themselves against payer, network and caps; redraw them when those change. */
function refreshQuotes() {
  for (const m of chat.msgs) if (m.quote?.state === "open") rerender(m);
  syncComposer();
}

function addMsg(c: Chat, part: Omit<Msg, "id" | "at">): Msg {
  const at = Date.now();
  const m: Msg = { id: uid(), at, ...part };
  c.msgs.push(m);
  c.at = at;
  if (c.title === "New chat" && m.role === "user") {
    c.title = titleFrom(m.content);
    if (c === chat) $("chat-title").textContent = c.title;
  }
  save();
  if (c === chat) appendMsg(m);
  if (drawer.isOpen()) drawer.render();
  return m;
}

const grow = () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
};

function syncComposer() {
  const waiting = replying.has(chat.id);
  const payingHere = paying?.chat === chat.id;
  sendKey.disabled = waiting || payingHere || !input.value.trim();
  // While a quote waits for a yes, its Approve key is the one dark key on screen.
  sendKey.classList.toggle("key--ink", !chat.msgs.some((m) => m.quote?.state === "open"));
  $("composer-state").textContent = waiting
    ? "Siro is writing a reply. You can type the next message meanwhile."
    : payingHere
      ? "A payment is running. Send works again when it finishes."
      : payerKind() === "agent" && agentAccount() && limits().autopay
        ? "Autopay is on: one quote per message pays without asking, within your caps."
        : "Chatting is free. Nothing is paid until you approve a quote.";
}

async function send() {
  const c = chat;
  const text = input.value.trim();
  if (!text || replying.has(c.id) || paying?.chat === c.id) return;
  const tool = toolHint && liveTools?.get(toolHint) !== false ? toolHint : undefined;
  input.value = "";
  grow();
  setTool(null);
  addMsg(c, tool ? { role: "user", content: text, tool } : { role: "user", content: text });
  autoArmed.add(c.id);
  await agentTurn(c);
}

function setTool(id: string | null) {
  toolHint = id && byId(id) ? id : null;
  renderToolNote();
}

function renderToolNote() {
  const el = $("tool-note");
  const r = toolHint ? byId(toolHint) : undefined;
  el.hidden = !r;
  if (!r) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    liveTools?.get(r.id) === false
      ? `<span>${esc(r.name)} is listed but not switched on yet, so Siro will pick another tool.</span><button class="key key--sm" type="button" data-tool-clear>Clear</button>`
      : `<span>Quotes with <b>${esc(r.name)}</b> at <b class="num">${formatPrice(r.price)}</b></span><button class="key key--sm" type="button" data-tool-clear>Let Siro choose</button>`;
}

function renderBriefs() {
  const shown = BRIEFS.filter((b) => byId(b.tool) && liveTools?.get(b.tool) !== false).slice(0, 6);
  $("briefs").innerHTML = shown
    .map((b) => {
      const r = byId(b.tool)!;
      // A hyphenated word ("S-shaped") never breaks at its hyphen.
      const text = esc(b.text).replace(/\S+-\S+/g, (w) => `<span class="nowrap">${w}</span>`);
      return `<li><button class="brief" type="button" data-brief="${b.tool}"><span class="brief__text">${text}</span> <span class="brief__tool">${esc(r.name)} <b class="brief__price">${formatPrice(r.price)}</b></span></button></li>`;
    })
    .join("");
}

/** The hint rides along with the user's words so the agent quotes the tool they picked. */
const withTool = (text: string, id: string) => {
  const r = byId(id);
  return r ? `${text}\n\n(Quote this with ${r.name}, tool id ${r.id}.)` : text;
};

function agentMessages(c: Chat) {
  return c.msgs
    .filter((m) => !m.notice && !m.quote && m.content.trim() && !(m.role === "assistant" && m.ui))
    .map((m) => ({ role: m.role, content: m.role === "user" && m.tool ? withTool(m.content, m.tool) : m.content }));
}

function isProposal(p: any): p is Proposal {
  if (!p || typeof p !== "object" || (p.input !== undefined && (typeof p.input !== "object" || Array.isArray(p.input)))) return false;
  if (p.kind === "resource") return typeof p.resource === "string" && !!byId(p.resource) && typeof p.price === "string" && typeof p.name === "string";
  if (p.kind === "external") return typeof p.url === "string" && typeof p.name === "string" && typeof p.method === "string";
  if (p.kind === "swap") return (p.network === "robinhood" || p.network === "base") && [p.from, p.to, p.amount].every((v) => typeof v === "string");
  return false;
}

async function agentTurn(c: Chat) {
  replying.set(c.id, Date.now());
  if (c === chat) {
    renderThinking();
    syncComposer();
  }
  const slow = window.setTimeout(() => c === chat && renderThinking(), 10_500);
  let j: any = null;
  let problem = "";
  try {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: agentMessages(c) }) });
    j = await res.json().catch(() => null);
    if (!res.ok || typeof j?.reply !== "string") problem = j?.error?.message ?? `The agent answered with an error (HTTP ${res.status}).`;
  } catch {
    problem = "Could not reach Siro. Check the connection, then ask again.";
  }
  window.clearTimeout(slow);
  replying.delete(c.id);
  // Caps may have changed in Budget since the last turn; quotes below are judged on fresh numbers.
  instruments.render();

  let words = "";
  if (problem) {
    addMsg(c, { role: "assistant", content: problem, notice: true });
    words = `The agent did not answer. ${problem}`;
  } else {
    const text = j.reply.trim();
    if (text) {
      addMsg(c, { role: "assistant", content: text });
      words = `Siro: ${text.slice(0, 280)}`;
    }
    if (isProposal(j.proposal)) {
      const m = addQuote(c, { ...j.proposal, ...(j.proposal.kind === "swap" ? {} : { input: j.proposal.input ?? {} }) });
      words = `${words} ${quoteSay(m, env())}`.trim();
    } else if (!text) {
      addMsg(c, { role: "assistant", content: "The agent sent an empty reply. Ask again in other words.", notice: true });
    }
  }
  if (c === chat) {
    renderThinking();
    syncComposer();
    if (words) say(words);
  }
}

const label = (p: Proposal) => (p.kind === "swap" ? "the swap" : p.name);

function addQuote(c: Chat, p: Proposal): Msg {
  // One decision at a time: a newer quote sets the older open one aside.
  for (const old of c.msgs) {
    if (old.quote?.state !== "open") continue;
    old.quote.state = "declined";
    old.quote.why = "replaced";
    updateMsg(c, old);
  }
  const armed = autoArmed.delete(c.id);
  const m = addMsg(c, { role: "assistant", content: "", quote: p.kind === "swap" ? { p, state: "busy", step: "route" } : { p, state: "open" } });
  if (p.kind === "swap") void loadRoute(c, m);
  else if (payerKind() === "agent" && agentAccount() && limits().autopay) {
    // Autopay takes only the first quote after a message, and only one with a listed price; the rest wait.
    if (!armed) {
      m.quote!.manual = true;
      updateMsg(c, m);
    } else if (!paying && Number.isFinite(Number(p.price)) && !preflight(m.quote!, env())) void pay(c, m);
  }
  return m;
}

async function loadRoute(c: Chat, m: Msg, stale = false) {
  const q = m.quote!;
  const p = q.p as SwapProposal;
  q.state = "busy";
  q.step = "route";
  q.why = q.detail = q.issue = undefined;
  updateMsg(c, m);
  try {
    q.sq = await getSwapQuote(p.network, p.from, p.to, p.amount);
    q.state = "open";
    if (stale) q.detail = "The earlier quote was more than 80 seconds old. Check the new numbers, then approve again.";
  } catch (e) {
    q.state = "failed";
    q.why = "no_route";
    q.detail = (e as Error).message;
    addMsg(c, { role: "tool", content: `Swap quote failed: ${(e as Error).message}` });
  }
  q.step = undefined;
  updateMsg(c, m);
  if (c === chat) say(quoteSay(m, env()));
}

/** Never sign for more than the price the visitor approved; a higher quote comes back for a new yes. */
const guard = (shown: string) => (usd: number) => {
  const approved = Number(shown);
  if (Number.isFinite(approved) && usd > approved + 1e-9) throw new PayError("price_changed", String(Math.round(usd * 1e6) / 1e6));
  return true;
};

async function pay(c: Chat, m: Msg) {
  const q = m.quote;
  if (!q || q.state !== "open") return;
  if (paying) return toast("Another payment is still running. Approve this one when it finishes.");
  if (preflight(q, env())) return updateMsg(c, m);
  // Kyber routes go stale; a quote older than this is fetched again and shown before anything is sent.
  if (q.p.kind === "swap" && (!q.sq || Date.now() - q.sq.at > 80_000)) return loadRoute(c, m, true);
  paying = { mid: m.id, chat: c.id };
  q.state = "busy";
  q.step = "pay";
  q.issue = q.why = q.detail = undefined;
  updateMsg(c, m);
  // Open quotes on screen wait while this one pays, whichever chat it belongs to.
  refreshQuotes();
  if (c === chat) say(quoteSay(m, env()));
  let ok = false;
  try {
    if (q.p.kind === "resource") await payResource(c, m, q.p);
    else if (q.p.kind === "external") await payExternal(c, m, q.p);
    else await paySwap(c, m, q.p);
    ok = true;
  } catch (e) {
    failed(c, m, e);
  }
  paying = null;
  instruments.render();
  refreshQuotes();
  if (ok) await agentTurn(c);
}

async function payResource(c: Chat, m: Msg, p: ResourceProposal) {
  const q = m.quote!;
  const n = network();
  const out = await callResource(p.resource, p.input, { payer: { kind: payerKind() }, network: n, confirm: guard(p.price) });
  // A transfer broadcast but not yet confirmed still delivers the result, marked pending.
  const r = out.receipt as (Receipt & { status?: string }) | null;
  q.state = "settled";
  q.step = undefined;
  q.receipt = r ? { usd: r.amountUsd, network: payNetworkOf(r.network) ?? n, tx: r.tx || null, asset: r.asset, pending: r.status === "pending" } : { usd: null, network: n, tx: null, free: true };
  updateMsg(c, m);
  if (c === chat) say(quoteSay(m, env()));
  const { html, forAgent } = renderResult(p.resource, out.result);
  addMsg(c, { role: "tool", content: `${p.name} result:\n${forAgent}`, ui: html });
}

async function payExternal(c: Chat, m: Msg, p: ExternalProposal) {
  const q = m.quote!;
  const n = network();
  const out = await callExternal(p, p.input, { payer: { kind: payerKind() }, network: n, confirm: guard(p.price) });
  q.state = "settled";
  q.step = undefined;
  q.receipt = out.paid ? { usd: out.paid.usd, network: payNetworkOf(out.paid.network) ?? n, tx: out.paid.tx } : { usd: null, network: n, tx: null, free: true };
  updateMsg(c, m);
  if (c === chat) say(quoteSay(m, env()));
  const { html, forAgent } = renderResult("external", out.result);
  addMsg(c, { role: "tool", content: `${p.name} (third-party) result:\n${forAgent}`, ui: html });
}

async function paySwap(c: Chat, m: Msg, p: SwapProposal) {
  const q = m.quote!;
  const sq = q.sq!;
  const r = await doSwap(sq, { kind: payerKind() }, (s) => {
    q.step = s === "approving" || s === "building" ? s : "swapping";
    updateMsg(c, m);
  });
  q.state = "settled";
  q.step = undefined;
  q.receipt = { usd: sq.amountInUsd, network: p.network, tx: r.tx, min: r.amountOutMin };
  updateMsg(c, m);
  if (c === chat) say(quoteSay(m, env()));
  addMsg(c, { role: "tool", content: `Swap done on ${p.network}: ${sq.amountIn} ${sq.tokenIn.symbol} for about ${sq.amountOut} ${sq.tokenOut.symbol} (minimum ${r.amountOutMin}). Tx ${r.tx}.` });
}

// Refusals the strip explains from the live state (payer, network, caps), so the request stays open.
const KEPT_OPEN = new Set(["no_agent_wallet", "not_connected", "solana_agent_only", "over_payment_cap", "over_daily_cap", "over_swap_cap", "no_usd_value"]);

function failed(c: Chat, m: Msg, err: unknown) {
  const q = m.quote!;
  const code = String((err as PayError)?.code ?? "");
  const msg = String((err as Error)?.message ?? "Something went wrong.");
  q.step = undefined;
  if (code === "stale_quote") return void loadRoute(c, m, true);
  if (KEPT_OPEN.has(code)) {
    q.state = "open";
    if (code.startsWith("over_")) q.detail = "The Budget refused before signing: this payment would pass one of your caps.";
  } else if (code === "price_changed" && q.p.kind !== "swap") {
    q.was ??= q.p.price;
    q.p.price = msg;
    q.state = "open";
    q.issue = "price";
  } else if (/^Not enough\b/.test(msg) || ["insufficient_funds", "insufficient_balance", "no_gas"].includes(code)) {
    q.state = "open";
    q.issue = "funds";
    q.detail = msg;
  } else if (/reject|denied|cancel/i.test(msg) && (code === "sign_rejected" || code === "4001" || code === "ACTION_REJECTED" || /user/i.test(msg))) {
    q.state = "declined";
    q.why = "wallet";
    addMsg(c, { role: "tool", content: `User rejected the payment for ${label(q.p)} in their wallet. Do not propose it again unless asked.` });
  } else {
    q.state = "failed";
    q.why = code === "network_error" ? "network" : "error";
    q.detail = msg;
  }
  updateMsg(c, m);
  if (c === chat) say(quoteSay(m, env()));
}

function decline(c: Chat, m: Msg) {
  const q = m.quote;
  if (!q || q.state !== "open") return;
  q.state = "declined";
  q.why = "you";
  q.issue = q.detail = undefined;
  updateMsg(c, m);
  addMsg(c, { role: "tool", content: `User declined ${label(q.p)}. Do not propose it again unless asked.` });
  say("Declined. Nothing was signed.");
}

function retry(c: Chat, m: Msg) {
  const q = m.quote;
  if (!q || q.state !== "failed") return;
  if (q.p.kind === "swap") return void loadRoute(c, m);
  q.state = "open";
  q.why = q.detail = undefined;
  updateMsg(c, m);
  document.getElementById(`qs-${m.id}`)?.focus({ preventScroll: true });
}

async function connectOrSay() {
  try {
    await connectWallet();
  } catch (e) {
    toast((e as Error).message);
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Address copied.");
  } catch {
    toast("Copying is blocked here. Select the address and copy it by hand.");
  }
}

logIn.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
  if (!b || b.disabled) return;
  const c = chat;
  const m = c.msgs.find((x) => x.id === b.dataset.mid);
  if (!m) return;
  switch (b.dataset.act) {
    case "approve":
      return void pay(c, m);
    case "decline":
      return decline(c, m);
    case "retry":
      return retry(c, m);
    case "requote":
      return void loadRoute(c, m);
    case "retry-agent":
      if (replying.has(c.id)) return;
      b.closest(".msg__keys")?.remove();
      // The key is gone with its row; on a keyboard, carry on from the message box.
      if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
      return void agentTurn(c);
    case "copy":
      return void copy(b.dataset.value ?? "");
    case "use-net":
      if (isPayKey(b.dataset.value)) setNetwork(b.dataset.value);
      break;
    case "use-budget":
      setPayerKind("agent");
      break;
    case "use-wallet":
      setPayerKind("connected");
      if (!connectedWallet()) await connectOrSay();
      break;
    case "connect":
      b.disabled = true;
      await connectOrSay();
      break;
  }
  instruments.render();
  refreshQuotes();
  // Connect was disabled while the wallet answered, so focus fell to the page; keep it on this strip.
  if (document.activeElement === document.body) document.getElementById(`qs-${m.id}`)?.focus({ preventScroll: true });
});

$("briefs").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-brief]");
  const brief = b && BRIEFS.find((x) => x.tool === b.dataset.brief);
  if (!brief) return;
  input.value = brief.text;
  setTool(brief.tool);
  grow();
  syncComposer();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

$("tool-note").addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("[data-tool-clear]")) return;
  setTool(null);
  input.focus();
});

input.addEventListener("input", () => {
  grow();
  syncComposer();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  void send();
});

const nearBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
logEl.addEventListener(
  "scroll",
  () => {
    const top = logEl.scrollTop;
    // Only a scroll upward lets go of the newest line. Content that grows under a pinned transcript
    // (a result image or a font arriving) fires scroll events too, and must not unpin it.
    stuck = top < lastTop - 1 ? nearBottom() : stuck || nearBottom();
    lastTop = top;
    // The bar casts its shadow only once the transcript scrolls under it.
    bar.classList.toggle("is-over", top > 2);
  },
  { passive: true },
);
// Images and audio in results load late, and the transcript gets shorter when the message box grows
// or a phone keyboard opens; either way, keep the newest line in view if the reader was there.
const keepEnd = new ResizeObserver(() => {
  if (stuck && chat.msgs.length) scrollLog(true);
});
keepEnd.observe(logIn);
keepEnd.observe(logEl);

// Caps, keys and spend can change in another tab (Budget); open quotes re-judge themselves.
addEventListener("storage", (e) => {
  if (e.key === "siro.chats") return;
  instruments.render();
  refreshQuotes();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  instruments.render();
  refreshQuotes();
});

/** Pins the app to the visible viewport, so the composer sits above a phone keyboard. */
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const fit = () => {
    if (vv.scale > 1.01) return; // pinch zoom: leave the layout alone
    root.setProperty("--app-h", `${Math.round(vv.height)}px`);
    root.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  fit();
}

/** /ask?q=<text> prefills the composer and /ask?tool=<id> names the tool to quote. Nothing is sent. */
function applyUrl(): boolean {
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  const tool = params.get("tool");
  if (q === null && tool === null) return false;
  if (chat.msgs.length) chat = blank();
  if (q) input.value = q.slice(0, 6000);
  if (tool) setTool(tool);
  // Drop the parameters so a reload does not prefill another chat.
  history.replaceState(history.state, "", location.pathname + location.hash);
  return true;
}

// Tools that are listed but not switched on yet are left out of the examples and the tool note.
fetch("/v1/resources")
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    if (!Array.isArray(j?.data)) return;
    liveTools = new Map(j.data.map((d: { id: string; live?: boolean }) => [d.id, d.live !== false]));
    renderBriefs();
    renderToolNote();
  })
  .catch(() => {});

const prefilled = applyUrl();
renderBriefs();
renderToolNote();
renderLog();
grow();
instruments.render();
fitViewport();
if (prefilled && !matchMedia("(pointer: coarse)").matches) {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
