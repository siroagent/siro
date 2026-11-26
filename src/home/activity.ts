// The Activity strip under "No result, no charge": the newest settlements from /api/ledger, up to eight.
import { PAY_NETWORKS, byId, payNetworkOf } from "../../shared/catalog";
import { esc } from "../shell";
import { usd } from "./caps";
import { shortAddress, utc } from "./quote";

type Row = { id: number; resource: string; network: string; payer: string; usd: number; tx: string; ms: number | null; at: number };

const SHOWN = 8;
const EMPTY = "No settlements yet. The first paid call appears here with its transaction hash.";

/** "15 Nov 14:05", in UTC. */
const when = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${utc(d.getTime())}`;
};

function row(r: Row, newest: boolean) {
  const key = payNetworkOf(r.network);
  const tool = byId(r.resource);
  const net = key ? PAY_NETWORKS[key] : null;
  const tx =
    net && r.tx
      ? `<a class="mono" href="${net.explorer}/tx/${esc(r.tx)}" target="_blank" rel="noopener noreferrer">${esc(shortAddress(r.tx))}<span class="sr"> on the ${esc(net.name)} explorer</span></a>`
      : `<span class="mono">${esc(shortAddress(r.tx || "none"))}</span>`;
  return `<tr${newest ? ' class="is-newest"' : ""}>
    <td class="act__time">${newest ? '<i class="ball" aria-hidden="true"></i>' : ""}${when(r.at)}</td>
    <td>${tool ? `<a href="/tools/${esc(tool.id)}">${esc(tool.name)}</a>` : esc(r.resource)}</td>
    <td class="act__net">${esc(net?.name ?? r.network)}</td>
    <td class="act__payer mono" title="${esc(r.payer)}">${esc(shortAddress(r.payer))}</td>
    <td class="num live-num">${usd(r.usd)}</td>
    <td>${tx}</td>
  </tr>`;
}

const table = (rows: Row[]) => `<table class="table act__table">
  <caption class="sr">The ${rows.length} newest settlements, newest first</caption>
  <thead><tr><th scope="col" aria-sort="descending">Time, UTC</th><th scope="col">Tool</th><th scope="col" class="act__net">Network</th><th scope="col" class="act__payer">Payer</th><th scope="col" class="num">USD</th><th scope="col">Transaction</th></tr></thead>
  <tbody>${rows.map((r, i) => row(r, i === 0)).join("")}</tbody>
</table>`;

export function mountActivity() {
  const body = document.getElementById("act-body");
  const src = document.getElementById("act-src");
  const retry = document.getElementById("act-retry") as HTMLButtonElement | null;
  if (!body || !src || !retry) return;

  const load = async () => {
    body.setAttribute("aria-busy", "true");
    src.textContent = "GET /api/ledger";
    body.innerHTML = `<p class="act__line">Reading the settlements table.</p>`;
    try {
      const res = await fetch("/api/ledger");
      if (!res.ok) throw new Error(`settlements answered ${res.status}`);
      const j = (await res.json()) as { rows?: Row[] } | null;
      const rows = Array.isArray(j?.rows) ? j.rows.slice(0, SHOWN) : [];
      src.textContent = `/api/ledger · read ${utc(Date.now())} UTC`;
      body.innerHTML = rows.length ? table(rows) : `<p class="act__line">${EMPTY}</p>`;
      if (document.activeElement === retry) body.focus();
      retry.hidden = true;
    } catch {
      src.textContent = "/api/ledger · not read";
      body.innerHTML = `<p class="act__line" role="status">The settlements table could not be read just now.</p>`;
      retry.hidden = false;
    } finally {
      body.removeAttribute("aria-busy");
    }
  };

  retry.addEventListener("click", () => void load());
  void load();
}
