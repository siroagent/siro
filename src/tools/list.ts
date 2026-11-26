// /tools: the price ruler, then every tool in one table. Category, search and sort live in the URL
// (?c= ?q= ?sort=) so a filtered list can be linked.
import { CATEGORIES, PAY_KEYS, RESOURCES, formatPrice, logoOf, type Category, type Resource } from "../../shared/catalog";
import { liveNetworks, liveNetworkText } from "../lib/pay";
import { esc } from "../shell";
import { capPhrase, caps, type Caps } from "./caps";
import { money, utc } from "./format";
import { readLive, type LiveRead } from "./live";
import { mountRuler } from "./ruler";

type SortKey = "name" | "maker" | "price" | "time";
type Sort = { key: SortKey; dir: 1 | -1 } | null;
type View = { cat: Category | null; q: string; sort: Sort };

const CATS = Object.keys(CATEGORIES) as Category[];
const SORT_KEYS: SortKey[] = ["name", "maker", "price", "time"];
const HAYSTACK = new Map(RESOURCES.map((r) => [r.id, `${r.name} ${r.provider} ${CATEGORIES[r.category]} ${r.summary} ${r.tags?.join(" ") ?? ""} ${r.id}`.toLowerCase()]));

const byName = (a: Resource, b: Resource) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
const COMPARE: Record<SortKey, (a: Resource, b: Resource) => number> = {
  name: byName,
  maker: (a, b) => a.provider.localeCompare(b.provider, "en", { sensitivity: "base" }) || byName(a, b),
  price: (a, b) => Number(a.price) - Number(b.price) || byName(a, b),
  time: (a, b) => Number(!!a.slow) - Number(!!b.slow) || Number(a.price) - Number(b.price) || byName(a, b),
};
const SORT_OPTIONS: [string, string][] = [
  ["", "Catalog order"],
  ["price", "Price, low to high"],
  ["-price", "Price, high to low"],
  ["name", "Name, A to Z"],
  ["-name", "Name, Z to A"],
  ["maker", "Maker, A to Z"],
  ["-maker", "Maker, Z to A"],
  ["time", "Seconds first"],
  ["-time", "Minutes first"],
];

const sortParam = (s: Sort) => (s ? `${s.dir < 0 ? "-" : ""}${s.key}` : "");
function parseSort(v: string | null): Sort {
  const raw = v ?? "";
  const key = raw.replace(/^-/, "") as SortKey;
  return SORT_KEYS.includes(key) ? { key, dir: raw.startsWith("-") ? -1 : 1 } : null;
}

function readView(): View {
  const p = new URLSearchParams(location.search);
  const c = p.get("c") ?? "";
  return { cat: Object.hasOwn(CATEGORIES, c) ? (c as Category) : null, q: (p.get("q") ?? "").slice(0, 80), sort: parseSort(p.get("sort")) };
}

function writeView(v: View) {
  const p = new URLSearchParams();
  if (v.cat) p.set("c", v.cat);
  if (v.q.trim()) p.set("q", v.q.trim());
  if (v.sort) p.set("sort", sortParam(v.sort));
  const qs = p.toString();
  try {
    history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  } catch {
    /* a sandboxed frame can refuse; the list still works */
  }
}

function pick(v: View): Resource[] {
  const words = v.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = RESOURCES.filter((r) => (!v.cat || r.category === v.cat) && words.every((w) => HAYSTACK.get(r.id)!.includes(w)));
  if (!v.sort) return out;
  const { key, dir } = v.sort;
  return out.sort((a, b) => dir * COMPARE[key](a, b));
}

const scope = (v: View) => [v.cat ? `in ${CATEGORIES[v.cat]}` : "", v.q.trim() ? `matching “${v.q.trim()}”` : ""].filter(Boolean).join(", ");
const countLine = (n: number, v: View) => (scope(v) ? `Showing ${n} of ${RESOURCES.length} tools ${scope(v)}.` : `Showing all ${n} tools.`);
const emptyLine = (v: View) => `No tool matches${v.q.trim() ? ` “${v.q.trim()}”` : ""}${v.cat ? ` in ${CATEGORIES[v.cat]}` : ""}.`;

function capLine(shown: Resource[], cap: Caps) {
  const budget = ` <a href="/budget">Change it in Budget</a>.`;
  if (!shown.length) return `No tool in this filter. The double line marks ${capPhrase(cap)}.${budget}`;
  const under = shown.filter((r) => Number(r.price) <= cap.perCall + 1e-9).length;
  if (shown.length === 1) return `<b>This tool ${under ? "fits under" : "costs more than"}</b> ${capPhrase(cap)}.${budget}`;
  const noun = shown.length === RESOURCES.length ? "tools" : "tools shown";
  const lead = under === shown.length ? `All ${shown.length} ${noun}` : under === 0 ? `None of the ${shown.length} ${noun}` : `${under} of ${shown.length} ${noun}`;
  return `<b>${lead}</b> fit under ${capPhrase(cap)}.${budget}`;
}

function lamp(id: string, live: LiveRead | null, failed: boolean) {
  const flag = live?.flags.get(id);
  if (flag === true) return '<span class="lamp lamp--settled">Live</span>';
  if (flag === false) return '<span class="lamp lamp--awaiting">Not live yet</span>';
  return `<span class="lamp">${live || failed ? "Not checked" : "Checking"}</span>`;
}

function row(r: Resource, live: LiveRead | null, failed: boolean) {
  const time = r.slow ? "minutes" : "seconds";
  return `<tr data-id="${r.id}">
<td class="tl-c-tool"><span class="tl-tool"><img src="${logoOf(r.id)}" width="20" height="20" alt="" loading="lazy" decoding="async"><span class="tl-tool__text"><a href="/tools/${r.id}">${esc(r.name)}</a><span class="tl-meta">${esc(r.provider)} · ${CATEGORIES[r.category]} · ${time}</span></span></span></td>
<td class="tl-c-maker">${esc(r.provider)}</td>
<td class="tl-c-cat">${CATEGORIES[r.category]}</td>
<td class="tl-c-price num"><span class="live-num">${formatPrice(r.price)}</span></td>
<td class="tl-c-time">${time}</td>
<td class="tl-c-live">${lamp(r.id, live, failed)}</td>
<td class="tl-c-end"><code>POST /v1/${r.id}</code></td>
</tr>`;
}

function frame() {
  const choices = [{ value: "", name: "All", n: RESOURCES.length }, ...CATS.map((c) => ({ value: c, name: CATEGORIES[c], n: RESOURCES.filter((r) => r.category === c).length }))];
  const th = (key: SortKey | null, cls: string, text: string) => `<th scope="col" class="${cls}"${key ? ` data-key="${key}"` : ""}>${key ? `<button type="button" data-sort="${key}">${text}</button>` : text}</th>`;
  return `
<div class="wrap tl-list">
  <header class="grid tl-band">
    <h1>Tools</h1>
    <div class="tl-band__side">
      <p class="lede">Each tool quotes its price over x402 before it runs, and the payment settles only when the result comes back.</p>
      <p class="small tl-band__more">Paid in <span data-nets>${liveNetworkText([...PAY_KEYS])}</span>. Tools that take minutes are quoted on EVM networks only. <a href="/docs#x402">How x402 pays for a call</a> · <a href="/v1/resources">Catalog JSON</a></p>
    </div>
  </header>

  <figure class="display tl-ruler" aria-labelledby="ruler-h">
    <div class="display__bar"><b id="ruler-h">Price per call, one tick per tool</b><span>From the catalog · log scale</span></div>
    <div class="tl-ruler__plot" id="ruler-plot" aria-hidden="true"></div>
    <figcaption class="tl-ruler__sum"><span id="ruler-sum"></span> <span class="tl-ruler__key">Ticks right of the double line cost more than the cap, so Budget refuses them before signing.</span></figcaption>
  </figure>

  <form class="tl-filters" id="filters" role="search" aria-label="Filter tools">
    <label class="field tl-search"><span>Search tools</span><input id="q" type="search" placeholder="Name, maker or task" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
    <fieldset class="tl-cats" id="cats">
      <legend class="label">Category</legend>
      <div class="tl-cats__tray" style="--half:${Math.ceil(choices.length / 2)}">${choices.map((c) => `<label class="tl-cat"><input type="radio" name="c" value="${c.value}"><span>${c.name}<small aria-hidden="true">${c.n}</small><span class="sr"> (${c.n} tools)</span></span></label>`).join("")}</div>
    </fieldset>
    <label class="field tl-catsel"><span>Category</span><select id="catsel">${choices.map((c) => `<option value="${c.value}">${c.name} (${c.n})</option>`).join("")}</select></label>
    <label class="field tl-sortsel"><span>Sort</span><select id="sortsel">${SORT_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
  </form>

  <div class="tl-status">
    <p class="tl-count" id="count" aria-live="polite"></p>
    <p class="label tl-livestate" id="livestate" tabindex="-1" aria-live="polite"></p>
  </div>

  <table class="table tl-table" id="table">
    <caption class="sr">Every Siro tool with its maker, category, price per call, time to run and live status. The column headers that are buttons sort the table.</caption>
    <thead><tr>${th("name", "tl-c-tool", "Tool")}${th("maker", "tl-c-maker", "Maker")}${th(null, "tl-c-cat", "Category")}${th("price", "tl-c-price num", "Price per call")}${th("time", "tl-c-time", "Time")}${th(null, "tl-c-live", "Status")}${th(null, "tl-c-end", "Endpoint")}</tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="tl-empty" id="empty" hidden>
    <p id="empty-what"></p>
    <button class="key" type="button" id="clear">Clear the filter</button>
  </div>
</div>`;
}

export function list(main: HTMLElement) {
  const view = readView();
  let cap = caps();
  let live: LiveRead | null = null;
  let liveFailed = false;

  main.innerHTML = frame();
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const rows = el("rows");
  const table = el<HTMLTableElement>("table");
  const cats = el<HTMLFieldSetElement>("cats");
  const catsel = el<HTMLSelectElement>("catsel");
  const sortsel = el<HTMLSelectElement>("sortsel");
  const q = el<HTMLInputElement>("q");

  const capLabel = () => `${cap.saved ? "Your cap" : "Default cap"} ${money(cap.perCall)}`;
  let ruler = mountRuler(el("ruler-plot"), RESOURCES, cap.perCall, capLabel());

  const syncControls = () => {
    q.value = view.q;
    catsel.value = view.cat ?? "";
    const radio = cats.querySelector<HTMLInputElement>(`input[value="${view.cat ?? ""}"]`);
    if (radio) radio.checked = true;
    sortsel.value = sortParam(view.sort);
  };

  const paint = () => {
    const shown = pick(view);
    rows.innerHTML = shown.map((r) => row(r, live, liveFailed)).join("");
    table.hidden = !shown.length;
    el("empty").hidden = shown.length > 0;
    el("empty-what").textContent = emptyLine(view);
    el("count").textContent = countLine(shown.length, view);
    el("ruler-sum").innerHTML = capLine(shown, cap);
    ruler.paint(new Set(shown.map((r) => r.id)));
    const s = view.sort;
    for (const h of table.querySelectorAll<HTMLElement>("th[data-key]")) {
      if (s && s.key === h.dataset.key) h.setAttribute("aria-sort", s.dir > 0 ? "ascending" : "descending");
      else h.removeAttribute("aria-sort");
    }
  };
  const update = () => {
    paint();
    writeView(view);
  };

  el("filters").addEventListener("submit", (e) => e.preventDefault());
  cats.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value;
    view.cat = v ? (v as Category) : null;
    catsel.value = v;
    update();
  });
  catsel.addEventListener("change", () => {
    view.cat = catsel.value ? (catsel.value as Category) : null;
    syncControls();
    update();
  });
  sortsel.addEventListener("change", () => {
    view.sort = parseSort(sortsel.value);
    update();
  });
  q.addEventListener("input", () => {
    view.q = q.value;
    update();
  });
  table.tHead!.addEventListener("click", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-sort]")?.dataset.sort as SortKey | undefined;
    if (!key) return;
    view.sort = view.sort?.key === key ? { key, dir: view.sort.dir > 0 ? -1 : 1 } : { key, dir: 1 };
    sortsel.value = sortParam(view.sort);
    update();
  });
  el("clear").addEventListener("click", () => {
    view.cat = null;
    view.q = "";
    syncControls();
    update();
    q.focus();
  });

  // Pointing at a row lights its tick on the ruler.
  const lightFrom = (e: Event) => ruler.light((e.target as HTMLElement).closest<HTMLElement>("tr[data-id]")?.dataset.id ?? null);
  rows.addEventListener("pointerover", lightFrom);
  rows.addEventListener("focusin", lightFrom);
  rows.addEventListener("pointerleave", () => ruler.light(null));
  rows.addEventListener("focusout", () => ruler.light(null));

  const paintLive = () => {
    const box = el("livestate");
    if (live) {
      const off = [...live.flags.values()].filter((f) => !f).length;
      box.textContent = `Status from /v1/resources, read ${utc(live.at)}: ${live.flags.size - off} live${off ? `, ${off} not live yet` : ""}.`;
    } else if (liveFailed) {
      box.innerHTML = `Could not read the live status from /v1/resources. <button class="key key--sm" type="button" id="live-retry">Retry</button>`;
      el("live-retry").addEventListener("click", () => {
        loadLive();
        box.focus();
      });
    } else box.textContent = "Checking which tools are live…";
  };
  const loadLive = () => {
    live = null;
    liveFailed = false;
    paintLive();
    paint();
    readLive()
      .then(
        (l) => void (live = l),
        () => void (liveFailed = true),
      )
      .then(() => {
        paintLive();
        paint();
      });
  };

  // Caps saved in Budget in another tab move the cap line here too.
  addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== "siro.agent.limits") return;
    cap = caps();
    ruler = mountRuler(el("ruler-plot"), RESOURCES, cap.perCall, capLabel());
    paint();
  });

  syncControls();
  loadLive();
  // The sentence is drawn with every network at first paint; this only narrows it to the live ones.
  liveNetworks().then((k) => document.querySelectorAll("[data-nets]").forEach((n) => (n.textContent = liveNetworkText(k))));

  // Phones hide the header sort buttons (the Sort select does that job), so keep them out of the Tab order.
  const phone = matchMedia("(max-width: 759px)");
  const sortTabs = () => table.tHead!.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((b) => (b.tabIndex = phone.matches ? -1 : 0));
  phone.addEventListener("change", sortTabs);
  sortTabs();
}
