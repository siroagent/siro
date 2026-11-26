// Spend: what this budget paid for. Siro's own settlements come from /v1/payments for both of the
// wallet's addresses; services outside the catalog and swaps are only in this browser's log.
import { byId, PAY_NETWORKS, payNetworkOf, type PayNetworkKey } from "../../shared/catalog";
import { spendLog } from "../lib/pay";
import { esc } from "../shell";
import type { Wallet } from "./funds";
import { clock, short, txUrl, usd, utc } from "./util";

type Row = { at: number; usd: number; resource: string; network: PayNetworkKey; tx: string };
type Loaded = { rows: Row[]; server: boolean; at: Date };
type Settlement = { at: number; amountUsd: number; resource: string; network: string; tx: string };

const PERIODS: [number, string][] = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
];
const SHOWN = 50;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const newest = (a: Row, b: Row) => b.at - a.at;
const isSwap = (r: Row) => r.resource.startsWith("swap ");

/** Local midnight: the daily cap and "Today" both start there. */
function midnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function when(ms: number) {
  const d = new Date(ms);
  return ms >= midnight() ? clock(d) : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(d)}`;
}

async function load(w: Wallet): Promise<Loaded> {
  const mine = new Set([w.evm.toLowerCase(), w.sol.toLowerCase()]);
  const local: Row[] = spendLog()
    .filter((s) => mine.has(String(s.payer).toLowerCase()))
    .map((s) => ({ at: s.at, usd: s.usd, resource: s.resource, network: s.network, tx: s.tx }));
  try {
    const lists = await Promise.all(
      [w.evm, w.sol].map(async (payer) => {
        const r = await fetch(`/v1/payments?payer=${encodeURIComponent(payer)}`);
        if (!r.ok) throw new Error(`status ${r.status}`);
        return ((await r.json())?.data ?? []) as Settlement[];
      }),
    );
    const server: Row[] = lists.flat().map((p) => ({ at: p.at * 1000, usd: Number(p.amountUsd), resource: p.resource, network: payNetworkOf(p.network) ?? "robinhood", tx: p.tx }));
    // The server already holds every Siro call; the log adds only what this browser alone knows.
    return { rows: [...server, ...local.filter((r) => !byId(r.resource))], server: true, at: new Date() };
  } catch {
    return { rows: local, server: false, at: new Date() };
  }
}

function tool(id: string) {
  const t = byId(id);
  return t ? `<a href="/tools/${t.id}">${esc(t.name)}</a>` : `<span class="bd-ext">${esc(id)}</span>`;
}
function tx(r: Row) {
  return r.tx ? `<a href="${esc(txUrl(r.network, r.tx))}" target="_blank" rel="noopener noreferrer" title="${esc(r.tx)}">${esc(short(r.tx, 6, 4))}</a>` : `<span class="muted">none</span>`;
}

function payments(rows: Row[]) {
  return `<table class="table bd-pt bd-grid-rows" role="table">
    <caption class="sr">Paid calls, newest first</caption>
    <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" aria-sort="descending">When</th><th role="columnheader" scope="col">Tool</th><th role="columnheader" scope="col">Network</th><th role="columnheader" scope="col" class="num">USD</th><th role="columnheader" scope="col">Transaction</th></tr></thead>
    <tbody role="rowgroup">${rows
      .map(
        (r, i) => `<tr role="row">
      <td role="cell" class="bd-pt__when">${i === 0 ? '<i class="ball" aria-hidden="true"></i>' : ""}${when(r.at)}</td>
      <td role="cell" class="bd-pt__tool">${tool(r.resource)}</td>
      <td role="cell" class="bd-pt__net">${PAY_NETWORKS[r.network].name}</td>
      <td role="cell" class="num bd-pt__usd">${usd(r.usd)}</td>
      <td role="cell" class="bd-pt__tx">${tx(r)}</td>
    </tr>`,
      )
      .join("")}</tbody></table>`;
}

function byTool(by: Map<string, { n: number; usd: number }>) {
  const rows = [...by].sort((a, b) => b[1].usd - a[1].usd);
  return `<table class="table bd-tt">
    <caption class="sr">Spend per tool, largest first</caption>
    <thead><tr><th scope="col">Tool</th><th scope="col" class="num">Calls</th><th scope="col" class="num" aria-sort="descending">USD</th></tr></thead>
    <tbody>${rows.map(([id, x]) => `<tr><td>${tool(id)}</td><td class="num">${x.n}</td><td class="num">${usd(x.usd)}</td></tr>`).join("")}</tbody></table>`;
}

function swaps(rows: Row[]) {
  return `<table class="table bd-st bd-grid-rows" role="table">
    <caption class="sr">Swaps sent from this browser, newest first</caption>
    <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" aria-sort="descending">When</th><th role="columnheader" scope="col">Swap</th><th role="columnheader" scope="col">Network</th><th role="columnheader" scope="col">Transaction</th></tr></thead>
    <tbody role="rowgroup">${rows
      .map(
        (r) => `<tr role="row">
      <td role="cell" class="bd-st__when">${when(r.at)}</td>
      <td role="cell" class="bd-st__what">${esc(r.resource.slice(5).replace(" → ", " to "))}</td>
      <td role="cell" class="bd-st__net">${PAY_NETWORKS[r.network].name}</td>
      <td role="cell" class="bd-st__tx">${tx(r)}</td>
    </tr>`,
      )
      .join("")}</tbody></table>`;
}

export function mountSpend(host: HTMLElement, w: Wallet): { reload(): Promise<void> } {
  let days = 1;
  let all = false;
  let data: Loaded | null = null;
  host.innerHTML = `
    <div class="bd-spend__top">
      <p class="bd-spend__sum" data-sum role="status">Reading the settlements for this wallet…</p>
      <div class="seg" role="group" aria-label="Period">${PERIODS.map(([d, name]) => `<button type="button" data-days="${d}" aria-pressed="${d === days}">${name}</button>`).join("")}</div>
    </div>
    <div class="bd-spend__list" data-list aria-busy="true"></div>
    <p class="bd-spend__src label" data-src tabindex="-1"></p>`;
  const sum = host.querySelector<HTMLElement>("[data-sum]")!;
  const list = host.querySelector<HTMLElement>("[data-list]")!;
  const src = host.querySelector<HTMLElement>("[data-src]")!;

  const paint = () => {
    if (!data) return;
    const since = days === 1 ? midnight() : Date.now() - days * 86_400_000;
    const period = data.rows.filter((r) => r.at >= since);
    const paid = period.filter((r) => !isSwap(r)).sort(newest);
    const swapped = period.filter(isSwap).sort(newest);
    const by = new Map<string, { n: number; usd: number }>();
    for (const r of paid) {
      const x = by.get(r.resource) ?? { n: 0, usd: 0 };
      x.n++;
      x.usd += r.usd;
      by.set(r.resource, x);
    }
    const span = days === 1 ? "today" : `in the last ${days} days`;
    const total = paid.reduce((a, r) => a + r.usd, 0);
    sum.textContent = paid.length ? `${usd(total)} ${span}, on ${plural(paid.length, "paid call")} to ${plural(by.size, "tool")}.` : `No paid calls ${span}.`;

    const more = paid.length > SHOWN && !all ? `<p class="bd-more"><span class="small muted">Showing the newest ${SHOWN} of ${paid.length}.</span><button class="key key--sm" type="button" data-all>Show all ${paid.length}</button></p>` : "";
    list.innerHTML = paid.length
      ? `<h3 class="bd-h3">Payments</h3>${payments(all ? paid : paid.slice(0, SHOWN))}${more}<h3 class="bd-h3">By tool</h3>${byTool(by)}`
      : `<div class="bd-empty"><p>Paid calls show up here with their transaction hash, whether they came from Ask, the CLI with this key, or a service paid below.</p><a class="key key--sm" href="/ask">Ask Siro</a></div>`;
    if (swapped.length) list.insertAdjacentHTML("beforeend", `<h3 class="bd-h3">Swaps</h3>${swaps(swapped)}`);
    list.removeAttribute("aria-busy");
    src.innerHTML = data.server
      ? `Siro settlements from /v1/payments, read ${utc(data.at)}, plus services outside Siro and swaps from this browser's log. Times are in your local time, the clock the daily cap uses.`
      : `<span class="lamp lamp--refused">Could not read /v1/payments, so this shows this browser's log only.</span><button class="key key--sm" type="button" data-retry>Retry</button>`;
  };

  const reload = async () => {
    list.setAttribute("aria-busy", "true");
    data = await load(w);
    if (host.isConnected) paint();
  };

  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const period = t.closest<HTMLButtonElement>("[data-days]");
    if (period) {
      days = Number(period.dataset.days);
      all = false;
      host.querySelectorAll("[data-days]").forEach((b) => b.setAttribute("aria-pressed", String(b === period)));
      paint();
    } else if (t.closest("[data-all]")) {
      all = true;
      paint();
      // The key that was pressed is gone; continue from the first row it revealed.
      list.querySelectorAll<HTMLElement>(".bd-pt tbody tr")[SHOWN]?.querySelector<HTMLElement>("a")?.focus();
    } else if (t.closest("[data-retry]")) {
      src.textContent = "Reading the settlements again…";
      src.focus();
      reload();
    }
  });

  reload();
  return { reload };
}
