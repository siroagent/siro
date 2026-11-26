// Turns tool results into HTML for Ask, Tools and Budget, plus a compact text version the agent
// can read back (no base64, no huge arrays).
import { esc } from "../shell";

/**
 * Only web links and generated media reach an href or src. A result can come from a third-party x402
 * service, and a javascript: link on this origin could read the Budget key in localStorage, so any
 * other scheme becomes "" (the element then points nowhere).
 */
export function safeUrl(u: unknown, media = false): string {
  if (typeof u !== "string") return "";
  const s = u.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  if (media && /^data:(image\/(png|jpe?g|webp|gif|avif)|audio\/[\w.+-]+|video\/[\w.+-]+);base64,/i.test(s)) return s;
  return "";
}
const href = (u: unknown, media = false) => esc(safeUrl(u, media));

/** Tiny, safe markdown: escape first, then **bold**, `code`, links, lists, paragraphs. */
export function md(src: string): string {
  const lines = esc(src).split(/\r?\n/);
  let html = "";
  let list: "ul" | "ol" | null = null;
  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = l.match(/^\s*[-*•]\s+(.*)/);
    const ol = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${inline((ul ?? ol)![1])}</li>`;
      continue;
    }
    close();
    if (!l.trim()) continue;
    const h = l.match(/^#{1,4}\s+(.*)/);
    html += h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(l)}</p>`;
  }
  close();
  return html;
}

const NA = '<span class="muted">n/a</span>';
const usd = (v: unknown) => (typeof v === "number" ? `$${v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toPrecision(3)}` : NA);
const pct = (v: unknown) => (typeof v === "number" ? `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>` : NA);
const prob = (v: unknown) => (typeof v === "number" ? `${v}%` : "n/a");

function poolsTable(pools: any[]) {
  if (!pools?.length) return '<p class="muted">No pools.</p>';
  return `<div class="tbl"><table><thead><tr><th>Pool</th><th>Price</th><th>24h</th><th>Liquidity</th><th>Volume 24h</th></tr></thead><tbody>${pools
    .slice(0, 12)
    .map((p) => `<tr><td>${esc(p.name)}</td><td>${usd(p.priceUsd)}</td><td>${pct(p.change24h)}</td><td>${usd(p.liquidityUsd)}</td><td>${usd(p.volume24hUsd)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

function trim(v: any, depth = 0): any {
  if (typeof v === "string") return v.startsWith("data:") ? "[media]" : v.length > 600 ? v.slice(0, 600) + "…" : v;
  if (Array.isArray(v)) return v.slice(0, depth ? 5 : 10).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]));
  return v;
}

export function renderResult(id: string, r: any): { html: string; forAgent: string } {
  const forAgent = JSON.stringify(trim(r)).slice(0, 3500);
  let html = "";
  if (r?.image) html = `<img class="r-img" src="${href(r.image, true)}" alt="Generated image" loading="lazy"><a class="btn btn--sm" download="siro-${esc(id)}" href="${href(r.image, true)}" target="_blank" rel="noopener">Download</a>`;
  else if (r?.video) html = `<video class="r-img" src="${href(r.video, true)}" controls playsinline loop></video><a class="btn btn--sm" href="${href(r.video, true)}" target="_blank" rel="noopener">Open video</a>`;
  else if (r?.audio) html = `<audio controls src="${href(r.audio, true)}"></audio>`;
  else if (r?.logo) html = `<div class="kit"><img class="r-img" src="${href(r.logo, true)}" alt="Logo"><div>${(r.names ?? []).map((n: any) => `<p><b>${esc(n.name)}</b> <span class="tag">$${esc(n.ticker)}</span></p>`).join("")}<p><i>${esc(r.tagline)}</i></p><p class="muted">${esc(r.lore)}</p></div></div>`;
  else if (r?.posts) html = r.posts.map((p: string) => `<blockquote class="post">${esc(p)}<small class="mono">${p.length}/280</small></blockquote>`).join("");
  else if (r?.brief) html = `${md(r.brief)}<details><summary>Trending pools</summary>${poolsTable(r.pools?.trending)}</details>`;
  else if (r?.pools && Array.isArray(r.pools)) html = poolsTable(r.pools);
  else if (Array.isArray(r?.markets)) html = marketsTable(r.markets);
  else if (r?.read && r?.market) html = `<p><b><a href="${href(r.market.url)}" target="_blank" rel="noopener">${esc(r.event?.title ?? r.market.question)}</a></b></p>${odds(r.market)}${md(r.read.summary ?? "")}<p class="muted">${esc(r.read.pricedIn ?? "")}</p><p><span class="tag tag--ink">${esc(r.read.lean ?? "no edge")}</span> <span class="tag">confidence ${esc(r.read.confidence ?? "low")}</span></p>${list("Catalysts", r.read.catalysts)}${list("Risks", r.read.risks)}<p class="muted small">Crowd odds, not facts. Not financial advice.</p>`;
  else if (Array.isArray(r?.stocks)) html = `<p class="muted">${esc(r.stocks.length)} of ${esc(r.total)} stock tokens</p><div class="tbl"><table><thead><tr><th>Ticker</th><th>Name</th><th>Chainlink</th><th>Contract</th></tr></thead><tbody>${r.stocks.map((s: any) => `<tr><td><b>${esc(s.symbol)}</b></td><td>${esc(s.name)}</td><td>${s.chainlink ? "yes" : "no"}</td><td class="mono">${esc(String(s.address).slice(0, 10))}…</td></tr>`).join("")}</tbody></table></div>`;
  else if (r?.stock) html = `<div class="snap"><p><b>${esc(r.stock.name)}</b> <span class="tag">${esc(r.stock.symbol)}</span></p><div class="snap__grid"><div><span>Chainlink</span><b>${usd(r.reference?.priceUsd)}</b></div><div><span>DEX</span><b>${usd(r.dex?.priceUsd)}</b></div><div><span>Premium</span><b>${pct(r.premiumPct)}</b></div><div><span>Liquidity</span><b>${usd(r.dex?.liquidityUsd)}</b></div></div></div>${r.signal ? `<p><span class="tag tag--ink">${esc(r.signal.stance)}</span></p>${md(r.signal.summary ?? "")}${list("Risks", r.signal.risks)}` : ""}<p class="muted small">Not financial advice.</p>`;
  else if (r?.signal) html = `<p><span class="tag tag--ink">${esc(r.signal.stance)}</span></p>${md(r.signal.summary ?? "")}${r.signal.risks?.length ? `<ul>${r.signal.risks.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${snapshot(r.snapshot)}`;
  else if (r?.token) html = snapshot(r);
  else if (r?.markdown !== undefined) html = `<p><b>${esc(r.title || "Page")}</b></p><div class="r-md">${md(String(r.markdown).slice(0, 4000))}</div>`;
  else if (typeof r?.text === "string") html = md(r.text);
  else if (r?.prompt) html = `<p class="mono">${esc(r.prompt)}</p>${r.negative ? `<p class="muted mono">negative: ${esc(r.negative)}</p>` : ""}`;
  else if (r?.notes) html = `<ul>${r.notes.map((n: string) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  else if (r?.balances) html = `<div class="tbl"><table><tbody>${r.balances.map((b: any) => `<tr><td>${esc(b.symbol)}</td><td class="mono">${esc(Number(b.amount).toLocaleString("en-US", { maximumFractionDigits: 6 }))}</td></tr>`).join("")}</tbody></table></div>`;
  else if (r?.gasPriceGwei !== undefined) html = `<p>Block <b>${esc(r.block)}</b> · gas <b>${esc(r.gasPriceGwei)}</b> gwei</p>`;
  if (r?.expiresAt && (r.image || r.video || r.audio)) html += `<p class="muted small">This link stops working about an hour after the call (${new Date(r.expiresAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}). Download what you want to keep.</p>`;
  html += `<details class="raw"><summary>JSON</summary><pre class="code">${esc(JSON.stringify(trim(r), null, 2))}</pre></details>`;
  return { html, forAgent };
}

function list(title: string, items: unknown) {
  return Array.isArray(items) && items.length ? `<p><b>${esc(title)}</b></p><ul>${items.map((x) => `<li>${esc(String(x))}</li>`).join("")}</ul>` : "";
}

function odds(m: any) {
  return `<div class="odds">${(m.outcomes ?? []).map((o: any) => `<span><b>${esc(prob(o.probability))}</b> ${esc(o.name)}</span>`).join("")}</div>`;
}

function marketsTable(markets: any[]) {
  if (!markets.length) return '<p class="muted">No open markets match.</p>';
  return `<div class="tbl"><table><thead><tr><th>Market</th><th>Odds</th><th>Volume 24h</th><th>Ends</th></tr></thead><tbody>${markets
    .map((m) => `<tr><td style="white-space:normal"><a href="${href(m.url)}" target="_blank" rel="noopener">${esc(m.question)}</a></td><td>${(m.outcomes ?? []).slice(0, 2).map((o: any) => `${esc(o.name)} ${esc(prob(o.probability))}`).join(" · ")}</td><td>${usd(m.volume24hUsd)}</td><td class="mono">${esc(String(m.endDate ?? "").slice(0, 10))}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

function snapshot(s: any) {
  if (!s?.token) return "";
  const t = s.token;
  const m = s.market;
  return `<div class="snap"><p><b>${esc(t.name ?? "Unknown")}</b> <span class="tag">${esc(t.symbol ?? "?")}</span> ${safeUrl(t.explorer) ? `<a href="${href(t.explorer)}" target="_blank" rel="noopener">Explorer</a>` : ""}</p>
  <div class="snap__grid"><div><span>Price</span><b>${usd(m?.priceUsd)}</b></div><div><span>24h</span><b>${pct(m?.change24h)}</b></div><div><span>Liquidity</span><b>${usd(m?.liquidityUsd)}</b></div><div><span>Volume 24h</span><b>${usd(m?.volume24hUsd)}</b></div></div></div>`;
}
