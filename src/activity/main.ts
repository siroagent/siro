// Activity: every settled call, read live. /api/stats gives the one-line totals, /api/ledger the 30-day
// strip and the newest rows (50 a page), /v1/payments?payer= one payer's rows. Refreshes every 20 s, and
// only while the tab is visible.
import { CATEGORIES, PAY_KEYS, PAY_NETWORKS, RESOURCES, byId, isPayKey, payNetworkOf, type Category, type PayNetworkKey } from "../../shared/catalog";
import { esc, mountShell } from "../shell";
import "./activity.css";
import { size } from "./proofs";

mountShell("activity");

type Stats = { resources: number; networks: number; paidCalls: number; volumeUsd: number; payers: number };
type Day = { day: string; calls: number; usd: number; payers: number };
type LedgerRow = { id: number; resource: string; network: string; payer: string; usd: number; tx: string; ms: number | null; at: number; resultSha?: string | null; resultBytes?: number | null; resultKind?: string | null; shown?: number };
/** What a call returned: sha256 of the JSON, its size and kind, and whether the full result is on this page. */
type Result = { sha: string; bytes: number; kind: string; shown: boolean };
type PaymentRow = { resource: string; network: string; amountUsd: number; tx: string; at: number };
/** One settled call from either feed. A payer lookup carries no id and no run time. */
type Settlement = { id: number | null; tool: string; network: string; payer: string; usd: number; tx: string; ms: number | null; at: number; result?: Result };
type Load = "idle" | "loading" | "ready" | "error";

const POLL_MS = 20_000;
const PAGE = 50; // rows per /api/ledger page
const PAYER_LIMIT = 200; // /v1/payments answers with at most this many
const EXPLORER: Record<PayNetworkKey, string> = { robinhood: "Blockscout", base: "Basescan", solana: "Solscan", arbitrum: "Arbiscan", polygon: "Polygonscan" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NOT_AN_ADDRESS = "That is not a wallet address. Paste a 0x address (0x and 40 hex characters) or a Solana address.";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const deck = $("act-deck");
const nameEl = $("act-name");
const lamp = $("act-lamp");
const srcEl = $("act-src");
const readEl = $<HTMLTimeElement>("act-read");
const sumEl = $("act-sum");
const sumNote = $("act-sum-note");
const daysEl = $("act-days");
const bars = $("act-bars");
const fromEl = $("act-from");
const toEl = $("act-to");
const peakEl = $("act-peak");
const daysSum = $("act-days-sum");
const form = $<HTMLFormElement>("act-filters");
const netSel = $<HTMLSelectElement>("f-net");
const toolSel = $<HTMLSelectElement>("f-tool");
const payerIn = $<HTMLInputElement>("f-payer");
const payerMsg = $("f-payer-msg");
const mineEl = $("f-mine");
const rowsWrap = $("act-rows-wrap");
const scope = $("act-scope");
const scopeText = $("act-scope-text");
const table = $<HTMLTableElement>("act-table");
const body = $<HTMLTableSectionElement>("act-rows");
const stateEl = $("act-state");
const countEl = $("act-count");
const olderKey = $<HTMLButtonElement>("act-older");
const pollEl = $("act-poll");
const retryKey = $<HTMLButtonElement>("act-retry");
const liveEl = $("act-live");

const view = {
  stats: null as Stats | null,
  statsAt: 0,
  statsFailed: false,
  days: null as Day[] | null,
  ledger: [] as Settlement[],
  ledgerState: "loading" as Load,
  ledgerAt: 0,
  ledgerFailedAt: 0,
  more: false,
  newestTx: "",
  payer: null as string | null,
  payerRows: [] as Settlement[],
  payerState: "idle" as Load,
  payerAt: 0,
  payerFailedAt: 0,
  network: "" as PayNetworkKey | "",
  tool: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const dayName = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
function when(at: number) {
  const d = new Date(at * 1000);
  const year = d.getUTCFullYear() === new Date().getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${dayName(d)}${year} ${clock(d.getTime())}`;
}
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** "$0.045", "$0.02", "$12.385": exact to the stablecoins' 6 decimals, never fewer than two. A total is
 *  not rounded to cents, so $0.105 stays $0.105 instead of becoming $0.11. */
function dollars(v: number) {
  const [whole, frac = ""] = (Math.round(v * 1e6) / 1e6).toFixed(6).split(".");
  return `$${Number(whole).toLocaleString("en-US")}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}
const runTime = (ms: number) => (ms < 10_000 ? `${ms.toLocaleString("en-US")}<small> ms</small>` : `${(ms / 1000).toFixed(ms < 100_000 ? 1 : 0)}<small> s</small>`);
const netName = (n: string) => {
  const k = payNetworkOf(n);
  return k ? PAY_NETWORKS[k].name : n;
};

/** The form the API expects (EVM lowercased), or null when it is not a wallet address. */
function payerOf(raw: string) {
  const v = raw.trim();
  if (EVM_ADDRESS.test(v)) return v.toLowerCase();
  return SOLANA_ADDRESS.test(v) ? v : null;
}

/** Labels a reading with the server's Date header, so a cached answer shows when it was made. */
async function getJson<T>(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return { data: (await res.json()) as T, at: Date.parse(res.headers.get("date") ?? "") || Date.now() };
}

const fromLedger = (r: LedgerRow): Settlement => ({
  id: r.id, tool: r.resource, network: r.network, payer: r.payer, usd: r.usd, tx: r.tx, ms: r.ms, at: r.at,
  ...(r.resultSha ? { result: { sha: r.resultSha, bytes: r.resultBytes ?? 0, kind: r.resultKind ?? "data", shown: !!r.shown } } : {}),
});
const fromPayment = (payer: string, r: PaymentRow): Settlement => ({ id: null, tool: r.resource, network: r.network, payer, usd: r.amountUsd, tx: r.tx, ms: null, at: r.at });

async function readStats() {
  try {
    const { data, at } = await getJson<Stats>("/api/stats");
    view.stats = data;
    view.statsAt = at;
    view.statsFailed = false;
  } catch {
    view.statsFailed = true;
  }
  paintSum();
}

/** Puts the first page in front of what is loaded and returns the rows not seen before. */
function mergeNewest(page: Settlement[]) {
  const seen = new Set(view.ledger.map((s) => s.id));
  const added = page.filter((s) => !seen.has(s.id));
  if (view.ledger.length && added.length >= PAGE) {
    // A full page of unseen rows leaves a gap behind it, so the list starts again from this page.
    view.ledger = page;
    view.more = true;
  } else view.ledger = [...added, ...view.ledger];
  return added;
}

async function readLedger() {
  const first = view.ledgerState !== "ready";
  try {
    const { data, at } = await getJson<{ rows: LedgerRow[]; days: Day[] }>("/api/ledger");
    const page = data.rows.map(fromLedger);
    const added = mergeNewest(page);
    if (first) view.more = page.length >= PAGE;
    const newest = view.ledger[0]?.tx ?? "";
    const moved = newest !== view.newestTx;
    view.newestTx = newest;
    view.days = data.days;
    view.ledgerAt = at;
    view.ledgerState = "ready";
    view.ledgerFailedAt = 0;
    paintDays();
    if (first || added.length || moved) paintRows();
    if (!first && added.length && view.payer === null) announceNew(added);
  } catch {
    if (first) view.ledgerState = "error";
    else view.ledgerFailedAt = Date.now();
    paintDays();
    paintRows();
  }
  paintFoot();
  paintFeed();
}

let olderBusy = false;
function appendOlder(page: Settlement[]) {
  const seen = new Set(view.ledger.map((s) => s.id));
  const fresh = page.filter((s) => !seen.has(s.id));
  view.ledger = [...view.ledger, ...fresh];
  return fresh.length;
}
async function readOlder() {
  const oldest = view.ledger.at(-1);
  if (!oldest || olderBusy) return;
  const hadFocus = document.activeElement === olderKey;
  olderBusy = true;
  olderKey.setAttribute("aria-disabled", "true");
  olderKey.textContent = "Reading older rows";
  const pageBefore = async (t: number) => (await getJson<{ rows: LedgerRow[] }>(`/api/ledger?before=${t}`)).data.rows.map(fromLedger);
  try {
    // Ask from one second later and drop rows already shown, so rows sharing the oldest second are not skipped.
    let page = await pageBefore(oldest.at + 1);
    let added = appendOlder(page);
    if (!added && page.length >= PAGE) {
      page = await pageBefore(oldest.at);
      added = appendOlder(page);
    }
    view.more = page.length >= PAGE;
    paintRows();
    announce(added ? `${count(added, "older settlement", "older settlements")} loaded.` : "There are no older settlements.");
  } catch {
    announce("The older rows did not load. Press Older rows to try again.");
  } finally {
    olderBusy = false;
    olderKey.removeAttribute("aria-disabled");
    olderKey.textContent = "Older rows";
  }
  // The key hides once the last page is in; keep keyboard focus nearby instead of losing it.
  if (hadFocus && olderKey.hidden && (document.activeElement === olderKey || document.activeElement === document.body)) countEl.focus();
}

let payerTicket = 0;
async function readPayer(quiet: boolean) {
  const payer = view.payer;
  if (payer === null) return;
  const ticket = ++payerTicket;
  if (!quiet) {
    view.payerState = "loading";
    paintRows();
    paintFeed();
  }
  try {
    const { data, at } = await getJson<{ payer: string; data: PaymentRow[] }>(`/v1/payments?payer=${encodeURIComponent(payer)}`);
    if (ticket !== payerTicket) return;
    const first = view.payerState !== "ready";
    const known = new Set(view.payerRows.map((s) => s.tx));
    const rows = data.data.map((r) => fromPayment(payer, r));
    const added = first ? [] : rows.filter((s) => !known.has(s.tx));
    view.payerRows = rows;
    view.payerAt = at;
    view.payerState = "ready";
    view.payerFailedAt = 0;
    if (first || added.length) paintRows();
    if (first) announce(rows.length ? `${count(rows.length, "payment", "payments")} from ${short(payer)}.` : `No settlements from ${short(payer)} yet.`);
    else if (added.length) announceNew(added);
  } catch {
    if (ticket !== payerTicket) return;
    if (view.payerState === "ready") view.payerFailedAt = Date.now();
    else {
      view.payerState = "error";
      announce(`The payments from ${short(payer)} did not load.`);
    }
    paintRows();
  }
  paintFoot();
  paintFeed();
}

function paintSum() {
  const s = view.stats;
  sumEl.classList.toggle("is-state", !s);
  if (!s) {
    // The foot already says the page reads again every 20 s.
    sumEl.textContent = view.statsFailed ? "The totals did not load." : "Reading the totals";
    sumNote.textContent = "";
    return;
  }
  // A number stays on the line of the word it counts (the non-breaking space).
  const n = (v: number, one: string, many: string) => `<span class="live-num">${Number(v).toLocaleString("en-US")}</span>&nbsp;${v === 1 ? one : many}`;
  // `networks` counts the networks quoting now, not where these calls settled, so it is said apart from them.
  const nets = s.networks ? `with ${n(s.networks, "network", "networks")} quoting` : "and no network is quoting right now";
  if (!s.paidCalls) sumEl.innerHTML = `No paid calls settled yet, ${nets}.`;
  else {
    const paid = `<span class="live-num">${dollars(Number(s.volumeUsd))}</span> from ${n(s.payers, "wallet", "wallets")}`;
    sumEl.innerHTML = `${n(s.paidCalls, "paid call", "paid calls")} settled so far, ${paid}, ${nets}.`;
  }
  sumNote.innerHTML = `From <span class="mono">/api/stats</span>, read ${clock(view.statsAt)} UTC.${view.statsFailed ? " The latest read failed, so this is the last one that came back." : ""}`;
}

/** The 30 UTC days the strip covers, oldest first, ending today. */
function stripDates() {
  const now = new Date();
  return Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29 + i)));
}

function paintDays() {
  const dates = stripDates();
  fromEl.textContent = dayName(dates[0]);
  toEl.textContent = `Today, ${dayName(dates[29])}`;
  // Flat while no day on the strip has a call: the sentence then sits in the plot (see activity.css).
  daysEl.classList.add("is-flat");
  if (!view.days) {
    if (view.ledgerState === "error") daysSum.textContent = "The last 30 days did not load.";
    return;
  }
  const byDay = new Map(view.days.map((d) => [d.day, d]));
  const strip = dates.map((date) => {
    const d = byDay.get(date.toISOString().slice(0, 10));
    return { date, calls: d?.calls ?? 0, usd: d?.usd ?? 0 };
  });
  const peak = Math.max(...strip.map((d) => d.calls));
  bars.innerHTML = strip
    .map((d, i) => `<i class="${d.calls ? "" : "is-zero"}${i === 29 ? " is-today" : ""}" style="--h:${peak ? ((d.calls / peak) * 100).toFixed(1) : 0}%"></i>`)
    .join("");
  peakEl.textContent = peak ? `Peak ${count(peak, "call", "calls")}` : "";
  const active = strip.filter((d) => d.calls);
  if (!active.length) {
    daysSum.textContent = "No paid calls in the last 30 days.";
    return;
  }
  daysEl.classList.remove("is-flat");
  const calls = active.reduce((a, d) => a + d.calls, 0);
  const paid = active.reduce((a, d) => a + d.usd, 0);
  const busiest = active.reduce((a, d) => (d.calls > a.calls ? d : a));
  daysSum.textContent = `${count(calls, "paid call", "paid calls")} on ${count(active.length, "day", "days")} of the last 30, ${dollars(paid)} in all. Busiest: ${dayName(busiest.date)}, ${count(busiest.calls, "call", "calls")}.`;
}

const matches = (s: Settlement) => (!view.network || payNetworkOf(s.network) === view.network) && (!view.tool || s.tool === view.tool);

/** Under the hash: the fingerprint of what the call returned, linked to the full result when it is shown. */
function resultLine(r: Result, tx: string) {
  const text = `result ${size(r.bytes)} · ${r.sha.slice(0, 8)}`;
  return `<span class="act__result" title="sha256 ${esc(r.sha)}">${r.shown ? `<a href="/api/proofs/${encodeURIComponent(tx)}" target="_blank" rel="noopener noreferrer">${text}<span class="sr">, the full result as JSON, opens in a new tab</span></a>` : text}</span>`;
}

function rowHtml(s: Settlement) {
  const tool = byId(s.tool);
  const net = payNetworkOf(s.network);
  const newest = s.tx === view.newestTx;
  const hash = net
    ? `<a class="act__hash" href="${esc(`${PAY_NETWORKS[net].explorer}/tx/${encodeURIComponent(s.tx)}`)}" target="_blank" rel="noopener noreferrer" data-focus="t:${esc(s.tx)}">${esc(short(s.tx))}<span class="sr"> on ${EXPLORER[net]}, opens in a new tab</span></a>`
    : `<span class="act__hash">${esc(short(s.tx))}</span>`;
  return `<tr role="row">
<td role="cell" class="act__when">${newest ? '<i class="ball" aria-hidden="true"></i><span class="sr">Newest: </span>' : ""}<time datetime="${new Date(s.at * 1000).toISOString()}">${when(s.at)}</time></td>
<td role="cell" class="act__tool">${tool ? `<a href="/tools/${encodeURIComponent(tool.id)}" data-focus="l:${esc(s.tx)}">${esc(tool.name)}</a>` : esc(s.tool)}</td>
<td role="cell" class="act__net"><span class="act__k" aria-hidden="true">on </span>${esc(netName(s.network))}</td>
<td role="cell" class="act__payer c-payer"><span class="act__k" aria-hidden="true">Payer </span><button class="act__addr" type="button" data-payer="${esc(s.payer)}" data-focus="p:${esc(s.tx)}" title="${esc(s.payer)}"><span class="sr">Show payments from </span>${esc(short(s.payer))}</button></td>
<td role="cell" class="num live-num act__usd">${dollars(s.usd)}</td>
<td role="cell" class="num act__ms c-ms">${s.ms == null ? '<span class="act__k" aria-hidden="true">run time </span><span class="act__none">not recorded</span>' : `<span class="act__k" aria-hidden="true">ran </span>${runTime(s.ms)}`}</td>
<td role="cell" class="act__tx"><span class="act__k" aria-hidden="true">Tx </span>${hash}${s.result ? resultLine(s.result, s.tx) : ""}</td>
</tr>`;
}

function filterMiss(total: number) {
  const tool = view.tool ? ` for ${esc(byId(view.tool)?.name ?? view.tool)}` : "";
  const net = view.network ? ` on ${PAY_NETWORKS[view.network].name}` : "";
  const pool = view.payer
    ? `${total === 1 ? "the one payment" : `the ${total.toLocaleString("en-US")} payments`} from <span class="mono">${esc(short(view.payer))}</span>`
    : `${total === 1 ? "the one row" : `the ${total.toLocaleString("en-US")} rows`} loaded`;
  const older = !view.payer && view.more ? " Older rows may have one." : "";
  return `No match${tool}${net} in ${pool}.${older}`;
}

// In payer view the scope line above the table already holds "Show all payers", so the states here do not repeat it.
function stateHtml(load: Load, total: number) {
  const who = view.payer ? `<span class="mono">${esc(short(view.payer))}</span>` : "";
  const keys = (...k: string[]) => `<div class="act__keys">${k.join("")}</div>`;
  const key = (act: string, label: string) => `<button class="key" type="button" data-act="${act}" data-focus="s:${act}">${label}</button>`;
  if (load === "loading" || load === "idle") return `<p>${who ? `Reading payments from ${who}` : "Reading the settlements table"}</p>`;
  if (load === "error")
    return who
      ? `<p>The payments from ${who} did not load.</p>${keys(key("retry", "Retry"))}`
      : `<p>The settlements table did not answer. This page tries again every 20 s.</p>${keys(key("retry", "Retry"))}`;
  if (!total)
    return who
      ? `<p>No settlements from ${who} yet.</p>`
      : `<p>No settlements yet. The first paid call appears here with its transaction hash.</p>${keys('<a class="key" href="/ask" data-focus="s:ask">Ask Siro</a>', '<a class="key" href="/tools" data-focus="s:tools">Pick a tool</a>')}`;
  return `<p>${filterMiss(total)}</p>${keys(key("clear", "Clear filters"))}`;
}

/** Re-renders without dropping keyboard focus from a control that is still there afterwards. Polling
 *  repaints every 20 s, so a key someone has tabbed to must survive it. */
function keepFocus(paint: () => void) {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.focus;
  paint();
  if (key) deck.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

/** What the table shows now: the active feed (all payers or one), narrowed by the filters. */
function shownRows() {
  const payerMode = view.payer !== null;
  const load = payerMode ? view.payerState : view.ledgerState;
  const all = payerMode ? view.payerRows : view.ledger;
  return { payerMode, load, all, rows: load === "ready" ? all.filter(matches) : [] };
}

let stateShown = "";
function paintRows() {
  const { payerMode, load, all, rows } = shownRows();
  rowsWrap.setAttribute("aria-busy", String(load === "loading"));
  table.classList.toggle("is-payer", payerMode);
  table.hidden = rows.length === 0;
  stateEl.hidden = rows.length > 0;
  keepFocus(() => {
    const state = rows.length ? stateShown : stateHtml(load, all.length);
    if (state !== stateShown) stateEl.innerHTML = stateShown = state;
    body.innerHTML = rows.map(rowHtml).join("");
  });
  scope.hidden = !payerMode;
  if (view.payer) scopeText.innerHTML = `Payments from <span class="mono">${esc(view.payer)}</span>`;
  paintFoot();
}

function paintFoot() {
  const { load, all, rows } = shownRows();
  const total = all.length;
  let text = "";
  if (load === "ready" && total) {
    const what = view.payer ? count(total, "payment", "payments") : `${count(total, "settlement", "settlements")} loaded`;
    text = rows.length === total ? `${what}, newest first.` : `${rows.length.toLocaleString("en-US")} of ${what} match.`;
    if (view.payer && total >= PAYER_LIMIT) text += ` A lookup returns the newest ${PAYER_LIMIT}.`;
  }
  countEl.textContent = text;
  olderKey.hidden = view.payer !== null || view.ledgerState !== "ready" || !view.more;
  const failedAt = view.payer !== null ? view.payerFailedAt : view.ledgerFailedAt;
  pollEl.textContent = failedAt ? `The refresh at ${clock(failedAt)} UTC failed. This page tries again every 20 s.` : "Refreshes every 20 s while this tab is in view.";
  // Retry now leaves once a read comes back; keyboard focus moves to the line beside it instead of the page top.
  if (!failedAt && document.activeElement === retryKey) pollEl.focus();
  retryKey.hidden = !failedAt;
}

/** The display bar: a lamp for the feed's state, its source and when it was read. */
function paintFeed() {
  const payerMode = view.payer !== null;
  const load = payerMode ? view.payerState : view.ledgerState;
  const at = payerMode ? view.payerAt : view.ledgerAt;
  const failed = load === "error" || (payerMode ? view.payerFailedAt : view.ledgerFailedAt) > 0;
  lamp.className = `lamp ${failed ? "lamp--refused" : load === "ready" ? "lamp--settled" : "lamp--awaiting"}`;
  lamp.textContent = failed ? "Not answering" : load === "ready" ? "Live" : "Reading";
  srcEl.textContent = payerMode ? "/v1/payments" : "/api/ledger";
  readEl.textContent = at ? `${failed ? "last read " : ""}${clock(at)} UTC` : "";
  if (at) readEl.dateTime = new Date(at).toISOString();
  else readEl.removeAttribute("datetime");
}

function announce(msg: string) {
  liveEl.textContent = msg;
}

function announceNew(added: Settlement[]) {
  const shown = added.filter(matches);
  if (!shown.length) return announce(`${count(added.length, "new settlement", "new settlements")}, outside your filters.`);
  const s = shown[0];
  announce(shown.length === 1 ? `New settlement: ${byId(s.tool)?.name ?? s.tool} on ${netName(s.network)}, ${dollars(s.usd)}.` : `${count(shown.length, "new settlement", "new settlements")}.`);
}

function fillSelects() {
  netSel.insertAdjacentHTML("beforeend", PAY_KEYS.map((k) => `<option value="${k}">${PAY_NETWORKS[k].name} (${PAY_NETWORKS[k].asset})</option>`).join(""));
  const groups = (Object.keys(CATEGORIES) as Category[]).map((c) => {
    const tools = RESOURCES.filter((r) => r.category === c);
    return tools.length ? `<optgroup label="${esc(CATEGORIES[c])}">${tools.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</optgroup>` : "";
  });
  toolSel.insertAdjacentHTML("beforeend", groups.join(""));
}

/** Payers this browser has paid from, read from the spend log that Ask, Tools and Budget write. */
function devicePayers() {
  try {
    const log: unknown = JSON.parse(localStorage.getItem("siro.agent.log") ?? "[]");
    if (!Array.isArray(log)) return [];
    const found = new Set<string>();
    for (const s of log as { payer?: unknown }[]) {
      const p = payerOf(typeof s?.payer === "string" ? s.payer : "");
      if (p) found.add(p);
      if (found.size === 3) break;
    }
    return [...found];
  } catch {
    return [];
  }
}

function paintMine() {
  const mine = devicePayers();
  mineEl.hidden = !mine.length;
  if (mine.length)
    mineEl.innerHTML = `Paid from this browser: ${mine.map((p) => `<button class="act__addr" type="button" data-payer="${esc(p)}" title="${esc(p)}"><span class="sr">Show payments from </span>${esc(short(p))}</button>`).join(" ")}`;
}

function setPayerError(msg: string) {
  payerMsg.textContent = msg;
  if (msg) payerIn.setAttribute("aria-invalid", "true");
  else payerIn.removeAttribute("aria-invalid");
}

function syncUrl() {
  const q = new URLSearchParams();
  if (view.network) q.set("network", view.network);
  if (view.tool) q.set("tool", view.tool);
  if (view.payer) q.set("payer", view.payer);
  const s = q.toString();
  history.replaceState(null, "", s ? `${location.pathname}?${s}` : location.pathname);
}

function applyUrl() {
  const q = new URLSearchParams(location.search);
  const n = q.get("network") ?? "";
  const t = q.get("tool") ?? "";
  view.network = isPayKey(n) ? n : "";
  view.tool = byId(t) ? t : "";
  netSel.value = view.network;
  toolSel.value = view.tool;
  const raw = q.get("payer")?.trim();
  if (!raw) return;
  const p = payerOf(raw);
  payerIn.value = p ?? raw;
  if (p) {
    view.payer = p;
    view.payerState = "loading";
  } else setPayerError(NOT_AN_ADDRESS); // a shared link with a broken address says why nothing was looked up
}

function announceCount() {
  announce((table.hidden ? stateEl.querySelector("p")?.textContent : countEl.textContent) ?? "");
}

function lookUp(payer: string, focusScope: boolean) {
  view.payer = payer;
  view.payerRows = [];
  view.payerFailedAt = 0;
  payerIn.value = payer;
  setPayerError("");
  syncUrl();
  void readPayer(false);
  if (focusScope) scopeText.focus();
}

function showAll() {
  view.payer = null;
  payerTicket++; // drops a lookup still in flight
  view.payerRows = [];
  view.payerState = "idle";
  view.payerFailedAt = 0;
  payerIn.value = "";
  setPayerError("");
  syncUrl();
  paintRows();
  paintFeed();
  payerIn.focus();
  announce("Showing every payer.");
}

function clearFilters() {
  view.network = "";
  view.tool = "";
  netSel.value = "";
  toolSel.value = "";
  syncUrl();
  paintRows();
  netSel.focus();
  announceCount();
}

/** Reads again now. A failed refresh keeps its red lamp until a read actually comes back. */
function retry() {
  const fromState = stateEl.contains(document.activeElement);
  if (view.ledgerState === "error") view.ledgerState = "loading";
  if (view.payer !== null && view.payerState === "error") void readPayer(false);
  paintRows();
  paintFeed();
  // The state's Retry key is replaced by the loading line, so focus goes to the heading of what is being read.
  if (fromState) nameEl.focus();
  void tick();
}

netSel.addEventListener("change", () => {
  view.network = isPayKey(netSel.value) ? netSel.value : "";
  syncUrl();
  paintRows();
  announceCount();
});
toolSel.addEventListener("change", () => {
  view.tool = byId(toolSel.value) ? toolSel.value : "";
  syncUrl();
  paintRows();
  announceCount();
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = payerIn.value.trim();
  if (!raw) {
    if (view.payer !== null) showAll();
    else setPayerError("Paste a payer address first.");
    return;
  }
  const payer = payerOf(raw);
  if (!payer) {
    setPayerError(NOT_AN_ADDRESS);
    payerIn.focus();
    return;
  }
  lookUp(payer, false);
});
payerIn.addEventListener("input", () => {
  if (payerIn.hasAttribute("aria-invalid")) setPayerError("");
});
deck.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-payer], [data-act]");
  if (!t) return;
  if (t.dataset.payer) return lookUp(t.dataset.payer, true);
  if (t.dataset.act === "retry") retry();
  else if (t.dataset.act === "clear") clearFilters();
  else if (t.dataset.act === "all-payers") showAll();
});
olderKey.addEventListener("click", () => void readOlder());
retryKey.addEventListener("click", retry);

// Polls every 20 s while the tab is visible; a hidden tab reads nothing and catches up when shown again.

let timer = 0;
let lastTick = 0;
let ticking: Promise<void> | null = null;
function tick() {
  clearTimeout(timer);
  lastTick = Date.now();
  ticking ??= Promise.allSettled([readStats(), readLedger(), view.payer !== null && view.payerState !== "loading" ? readPayer(true) : null]).then(() => {
    ticking = null;
    schedule();
  });
  return ticking;
}
function schedule() {
  clearTimeout(timer);
  if (document.visibilityState === "visible") timer = window.setTimeout(tick, POLL_MS);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return clearTimeout(timer);
  if (Date.now() - lastTick >= POLL_MS) void tick();
  else schedule();
});

fillSelects();
applyUrl();
paintMine();
paintSum();
paintDays();
paintRows();
paintFeed();
if (view.payer !== null) void readPayer(false);
void tick();
