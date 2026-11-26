// The frame every page shares: the aluminium rail (desktop), the More menu (tablet), the bottom dock
// (phone), Search (⌘K / Ctrl K) and the footer strip. Pages call mountShell("<page>").
import "./styles/base.css";
import "./styles/shell.css";
import { RESOURCES, formatPrice } from "../shared/catalog";
import { TOKEN } from "../shared/token";

/** The Siro mark: one S-shaped lane between two rails, traced from the master symbol. */
export const MARK = `<svg viewBox="0 0 741 980" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M729 121 328 121 312 123 283 129 261 136 229 151 209 164 194 176 177 193 162 213 149 237 141 259 137 282 137 309 141 330 146 345 154 361 165 377 180 393 200 409 219 421 243 433 270 444 320 461 355 471 428 495 454 502 505 519 552 540 582 559 598 572 620 595 636 618 648 643 657 675 660 698 660 721 656 751 649 775 637 801 623 822 610 837 594 852 571 869 550 881 522 893 483 904 443 909 1 909 0 911 0 978 1 980 439 980 487 975 531 965 573 950 598 938 617 927 643 909 657 897 685 868 709 833 726 797 731 782 737 756 741 717 739 673 731 633 715 592 700 566 689 551 663 522 639 502 615 486 581 468 555 457 524 446 344 389 293 370 264 356 240 339 226 322 220 310 218 302 217 279 225 254 236 238 249 225 268 212 292 202 315 197 324 196 415 196 416 195 730 194 730 122Z M730 1 329 0 278 6 248 13 223 21 194 33 168 46 141 63 117 81 102 94 76 121 61 140 47 161 30 193 19 221 12 246 8 270 7 294 6 295 7 324 9 340 13 360 20 383 34 415 44 432 59 453 89 485 112 504 141 523 176 541 232 562 242 564 294 581 393 610 445 627 484 645 500 656 517 673 521 679 527 692 529 700 530 717 527 734 521 748 514 758 504 768 483 781 461 788 440 791 1 792 0 793 0 864 1 865 426 865 427 864 451 863 490 855 508 849 526 841 554 824 575 805 590 785 598 770 607 742 610 721 610 696 604 664 595 643 580 621 569 609 548 592 525 578 502 567 458 551 393 532 250 486 230 477 225 476 200 464 166 443 146 427 128 408 111 384 99 360 90 330 87 306 87 286 90 262 97 236 109 208 124 184 139 165 163 141 182 126 215 106 239 95 277 83 303 78 323 77 324 76 729 76 730 75Z"/></svg>`;

const X_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;

export const X_URL = "https://x.com/siro_agent";
export const GITHUB_URL = "https://github.com/siroagent/siro";
const GITHUB_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>`;

export type Page = "home" | "ask" | "tools" | "budget" | "activity" | "docs" | "shipped" | "sell" | "privacy" | "404";

/** The chrome ball as SVG: sky, horizon band, specular and rim light, lit from the top left. */
export function ballSvg(size = 24, id = "b") {
  return `<svg class="ball-svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbfbfc"/><stop offset=".44" stop-color="#cfd2d6"/>
        <stop offset=".5" stop-color="#4f545b"/><stop offset=".62" stop-color="#7d838a"/><stop offset="1" stop-color="#dfe2e6"/>
      </linearGradient>
      <radialGradient id="${id}-spec" cx=".32" cy=".26" r=".22"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}-rim" cx=".74" cy=".8" r=".3"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="13" cy="21.6" rx="7" ry="1.6" fill="rgba(16,20,26,.22)"/>
    <circle cx="12" cy="12" r="9" fill="url(#${id}-body)"/>
    <circle cx="12" cy="12" r="9" fill="url(#${id}-rim)"/>
    <circle cx="12" cy="12" r="9" fill="url(#${id}-spec)"/>
    <circle cx="12" cy="12" r="8.6" fill="none" stroke="rgba(16,20,26,.35)" stroke-width=".8"/>
  </svg>`;
}

// Where things are. `alias` holds the old names so people who learned them still land right.
const PAGES: { page: Page; href: string; name: string; what: string; alias: string }[] = [
  { page: "ask", href: "/ask", name: "Ask", what: "Chat with the agent. It quotes a price and waits for your yes.", alias: "app chat agent" },
  { page: "tools", href: "/tools", name: "Tools", what: `${RESOURCES.length} paid tools, each priced per call.`, alias: "resources catalog models prices" },
  { page: "budget", href: "/budget", name: "Budget", what: "The agent wallet: key, caps per call and per day, funds.", alias: "wallet caps limits fund" },
  { page: "activity", href: "/activity", name: "Activity", what: "Every settled payment with its transaction hash.", alias: "ledger settlements payments receipts" },
  { page: "docs", href: "/docs", name: "Docs", what: "HTTP, CLI and MCP. How x402 pays for a call.", alias: "api developers cli mcp" },
  { page: "sell", href: "/sell", name: "Sell a tool", what: "List your API at a price per call. Buyers pay your address.", alias: "seller marketplace list earn provider" },
  { page: "shipped", href: "/shipped", name: "Shipped", what: "What is live, and what comes next.", alias: "roadmap changelog releases" },
  { page: "privacy", href: "/privacy", name: "Privacy", what: "What Siro keeps about a call, and how to delete a result.", alias: "data retention delete forget gdpr" },
];
const DOC_SECTIONS: [string, string][] = [
  ["overview", "Overview"],
  ["quickstart", "Quickstart"],
  ["x402", "How x402 pays for a call"],
  ["networks", "Networks and assets"],
  ["endpoints", "Endpoints"],
  ["errors", "Errors and charges"],
  ["privacy", "What Siro keeps"],
  ["wallet", "The agent wallet"],
  ["cli", "CLI"],
  ["mcp", "MCP server"],
  ["sdk", "SDK"],
  ["discovery", "Paying x402 services outside Siro"],
  ["swaps", "Swaps"],
  ["catalog", "Catalog JSON"],
];

const MAIN_KEYS: Page[] = ["ask", "tools", "budget", "activity", "docs"];
const pageOf = (p: Page) => PAGES.find((x) => x.page === p)!;

function rail(page: Page) {
  const key = (p: Page) => {
    const x = pageOf(p);
    const on = p === page;
    const ink = p === "ask" ? " key--ink" : "";
    return `<a class="key key--sm rail__key${ink}${on ? " is-on" : ""}" href="${x.href}"${on ? ' aria-current="page"' : ""}${p === "ask" ? " data-ask" : ""}>${on ? '<i class="ball" aria-hidden="true"></i>' : ""}${x.name}</a>`;
  };
  return `
<a class="skip" href="#main">Skip to content</a>
<header class="rail" id="rail">
  <div class="wrap rail__in">
    <a class="brand" href="/" aria-label="Siro home"><span class="brand__mark">${MARK}</span><span class="brand__word">siro</span></a>
    <nav class="rail__keys" aria-label="Main">
      ${MAIN_KEYS.map(key).join("")}
      <div class="more" data-more>
        <button class="key key--sm" type="button" aria-expanded="false" aria-controls="more-menu">More</button>
        <div class="more__menu" id="more-menu" hidden>
          <a href="/activity"${page === "activity" ? ' aria-current="page"' : ""}>Activity<small>${pageOf("activity").what}</small></a>
          <a href="/docs"${page === "docs" ? ' aria-current="page"' : ""}>Docs<small>${pageOf("docs").what}</small></a>
          <a href="/shipped"${page === "shipped" ? ' aria-current="page"' : ""}>Shipped<small>${pageOf("shipped").what}</small></a>
          <a href="${X_URL}" target="_blank" rel="noopener noreferrer">Siro on X<small>@siro_agent</small></a>
          <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">Source on GitHub<small>siroagent/siro</small></a>
        </div>
      </div>
    </nav>
    <div class="rail__end">
      <button class="search-well" type="button" data-search aria-label="Search pages and tools (Command K)"><span>Search</span><kbd>⌘K</kbd></button>
      <a class="icon-key" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="Siro source on GitHub" title="siroagent/siro on GitHub">${GITHUB_ICON}</a>
      <a class="icon-key" href="${X_URL}" target="_blank" rel="noopener noreferrer" aria-label="Siro on X">${X_ICON}</a>
    </div>
  </div>
</header>`;
}

const GLYPH: Record<string, string> = {
  ask: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v9H8l-4 3v-3H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  tools: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  budget: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 8h16M2 12h16" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>`,
  activity: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" stroke-width="1.6"/></svg>`,
  menu: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h14M3 13h14" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

function dock(page: Page) {
  const item = (p: Page, glyph: string) => {
    const x = pageOf(p);
    return `<a class="dock__key${p === "ask" ? " dock__key--ink" : ""}" href="${x.href}"${p === page ? ' aria-current="page"' : ""}${p === "ask" ? " data-ask" : ""}>${GLYPH[glyph]}<span>${x.name}</span></a>`;
  };
  return `
<nav class="dock" aria-label="Main">
  ${item("ask", "ask")}${item("tools", "tools")}${item("budget", "budget")}${item("activity", "activity")}
  <button class="dock__key" type="button" data-menu aria-haspopup="dialog">${GLYPH.menu}<span>Menu</span></button>
</nav>`;
}

/** The one official $SIRO contract, shown only once tools/fill_after_launch.py has checked it on-chain. */
function tokenLine() {
  if (!TOKEN) return "";
  const chart = TOKEN.chart ? `<a href="${esc(TOKEN.chart)}" target="_blank" rel="noopener noreferrer">Chart</a>` : "";
  return `<p class="foot__token label"><span>$${esc(TOKEN.ticker)} on ${esc(TOKEN.chain)}, the only official contract</span>
        <code class="foot__ca">${esc(TOKEN.ca)}</code>
        <button class="foot__copy" type="button" data-copy-ca>Copy</button>
        <a href="${esc(TOKEN.explorer)}" target="_blank" rel="noopener noreferrer">Explorer</a>${chart}</p>`;
}

const COPY_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;

/** A slim graphite strip under the top bar on every page: the official contract; clicking it copies it. */
function tokenStrip() {
  if (!TOKEN) return "";
  const ca = esc(TOKEN.ca);
  return `<aside class="tok" aria-label="Official $${esc(TOKEN.ticker)} contract">
  <div class="wrap tok__in">
    <span class="tok__name"><b>$${esc(TOKEN.ticker)}</b><span class="tok__chain"> on ${esc(TOKEN.chain)}</span></span>
    <span class="tok__label">Official contract</span>
    <button class="tok__ca" type="button" data-copy-ca title="Copy ${ca}" aria-label="Copy contract address ${ca}">
      <code><span class="tok__ca-full">${ca}</span><span class="tok__ca-short">${ca.slice(0, 8)}…${ca.slice(-6)}</span></code>
      <span class="tok__icon" aria-hidden="true">${COPY_ICON}</span>
    </button>
  </div>
</aside>`;
}

function footer() {
  const year = new Date().getUTCFullYear();
  return `
<footer class="foot">
  <div class="wrap">
    <div class="foot__plate face">
      <div class="foot__id"><span class="brand__mark">${MARK}</span><p>Siro routes your agent's paid calls through one capped budget.</p></div>
      <nav class="foot__links" aria-label="Footer">
        <p><span class="label">Use</span><a href="/ask">Ask</a><a href="/tools">Tools</a><a href="/budget">Budget</a></p>
        <p><span class="label">Check</span><a href="/activity">Activity</a><a href="/shipped">Shipped</a><a href="/privacy">Privacy</a></p>
        <p><span class="label">Build</span><a href="/docs">Docs</a><a href="/sell">Sell a tool</a><a href="/v1/resources">Catalog JSON</a><a href="/docs#mcp">MCP</a><a href="/docs#cli">CLI</a><a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">Source on GitHub</a></p>
        <p class="foot__social"><a class="foot__x" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="Siro source on GitHub (siroagent/siro)" title="siroagent/siro on GitHub">${GITHUB_ICON}</a><a class="foot__x" href="${X_URL}" target="_blank" rel="noopener noreferrer" aria-label="Siro on X (@siro_agent)" title="@siro_agent on X">${X_ICON}</a></p>
      </nav>
      ${tokenLine()}
      <p class="foot__status label" id="foot-status" aria-live="polite">${RESOURCES.length} tools listed</p>
    </div>
    <p class="foot__legal label">© ${year} Siro. Independent software; not affiliated with any chain, model maker or exchange named here. Prices are per call and settle on-chain.</p>
  </div>
</footer>`;
}

// ---- Search (⌘K): one dialog, a filtered list of pages, tools and docs sections ----

type Hit = { href: string; title: string; meta: string; words: string };
const HITS: Hit[] = [
  ...PAGES.map((p) => ({ href: p.href, title: p.name, meta: p.what, words: `${p.name} ${p.what} ${p.alias}`.toLowerCase() })),
  ...RESOURCES.map((r) => ({ href: `/tools/${r.id}`, title: r.name, meta: `${r.provider} · ${formatPrice(r.price)} per call`, words: `${r.name} ${r.provider} ${r.category} ${r.tags?.join(" ") ?? ""} ${r.id}`.toLowerCase() })),
  ...DOC_SECTIONS.map(([id, t]) => ({ href: `/docs#${id}`, title: t, meta: "Docs", words: `docs ${t} ${id}`.toLowerCase() })),
];

let lastFocus: HTMLElement | null = null;
function openSearch() {
  if (document.getElementById("search")) return;
  // A page's modal <dialog> makes everything outside it inert, Search included, so it closes first.
  // Search opens on the next task, after the page's own close work (which may move focus). The close
  // event is not waited for: Chrome stops firing it after a dialog was closed with Escape.
  const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (modal) {
    modal.close();
    setTimeout(openSearch, 0);
    return;
  }
  // The phone Menu sheet has a Search key of its own; from the keyboard, close the sheet first.
  if (document.getElementById("menu-sheet")) closeMenu?.();
  lastFocus = document.activeElement as HTMLElement | null;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="scrim" data-close></div>
<div class="dialog search" id="search" role="dialog" aria-modal="true" aria-label="Search">
  <div class="search__top">
    <label class="search__label label" for="search-q">Search pages, tools and docs</label>
    <input class="well" id="search-q" type="search" placeholder="Search pages, ${RESOURCES.length} tools, docs" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="search-list" aria-autocomplete="list">
    <button class="key key--sm" type="button" data-close>Close</button>
  </div>
  <ul class="search__list" id="search-list" role="listbox" aria-label="Results"></ul>
  <p class="search__none" id="search-none" hidden></p>
  <p class="search__hint label">Arrow keys move, Enter opens, Escape closes.</p>
</div>`,
  );
  const q = document.getElementById("search-q") as HTMLInputElement;
  const list = document.getElementById("search-list")!;
  let shown: Hit[] = [];
  let at = 0;
  const paint = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = (words.length ? HITS.filter((h) => words.every((w) => h.words.includes(w))) : HITS.slice(0, PAGES.length)).slice(0, 40);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((h, i) => `<li role="option" id="hit-${i}" aria-selected="${i === at}"><a href="${h.href}" tabindex="-1"><b>${esc(h.title)}</b><span>${esc(h.meta)}</span></a></li>`).join("");
    list.hidden = !shown.length;
    const none = document.getElementById("search-none")!;
    none.hidden = !!shown.length;
    none.textContent = shown.length ? "" : `Nothing matches "${q.value}". Try a model maker, a category or a page name.`;
    q.setAttribute("aria-activedescendant", shown.length ? `hit-${at}` : "");
    document.getElementById(`hit-${at}`)?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    document.getElementById("search")?.remove();
    document.querySelector(".scrim[data-close]")?.remove();
    document.removeEventListener("keydown", onKey, true);
    lastFocus?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) at = (at + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      paint();
    } else if (e.key === "Enter" && document.activeElement === q && shown[at]) {
      e.preventDefault();
      location.href = shown[at].href;
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog: the field and the Close key.
      const close = document.querySelector<HTMLElement>("#search [data-close]")!;
      e.preventDefault();
      (document.activeElement === q ? close : q).focus();
    }
  };
  q.addEventListener("input", () => {
    at = 0;
    paint();
  });
  list.addEventListener("pointermove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[role=option]");
    if (!li) return;
    at = Number(li.id.slice(4));
    list.querySelectorAll("li[role=option]").forEach((x) => x.setAttribute("aria-selected", String(x === li)));
    q.setAttribute("aria-activedescendant", li.id);
  });
  document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", close));
  document.addEventListener("keydown", onKey, true);
  paint();
  q.focus();
}

// ---- Menu sheet (phone): the destinations the dock has no room for ----
let closeMenu: (() => void) | null = null;
function openMenu() {
  if (document.getElementById("menu-sheet")) return;
  lastFocus = document.activeElement as HTMLElement | null;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="scrim" data-close-menu></div>
<div class="dialog menu-sheet" id="menu-sheet" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="menu-sheet__top"><b>Menu</b><button class="key key--sm" type="button" data-close-menu>Close</button></div>
  <nav aria-label="All pages">${PAGES.map((p) => `<a href="${p.href}"><b>${p.name}</b><span>${p.what}</span></a>`).join("")}<a href="${X_URL}" target="_blank" rel="noopener noreferrer"><b>Siro on X</b><span>@siro_agent</span></a><a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer"><b>Source on GitHub</b><span>siroagent/siro</span></a></nav>
  <button class="key menu-sheet__search" type="button" data-search-from-menu>Search pages and tools</button>
</div>`,
  );
  const sheet = document.getElementById("menu-sheet")!;
  const close = () => {
    closeMenu = null;
    sheet.remove();
    document.querySelector(".scrim[data-close-menu]")?.remove();
    document.removeEventListener("keydown", onKey, true);
    lastFocus?.focus();
  };
  closeMenu = close;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const f = [...sheet.querySelectorAll<HTMLElement>("a, button")];
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.querySelectorAll("[data-close-menu]").forEach((el) => el.addEventListener("click", close));
  sheet.querySelector("[data-search-from-menu]")!.addEventListener("click", () => {
    close();
    openSearch();
  });
  document.addEventListener("keydown", onKey, true);
  sheet.querySelector<HTMLElement>("a")?.focus();
}

export function mountShell(page: Page) {
  document.documentElement.dataset.page = page;
  // Ask draws its own 48px app bar and has no dock or footer; every other page gets the full frame.
  if (page !== "ask") {
    document.body.insertAdjacentHTML("afterbegin", rail(page));
    document.querySelector(".rail")?.insertAdjacentHTML("afterend", tokenStrip());
    document.body.insertAdjacentHTML("beforeend", footer() + dock(page));
    stats();
  } else {
    document.getElementById("abar")?.insertAdjacentHTML("afterend", tokenStrip());
  }
  document.querySelectorAll("[data-copy-ca]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!TOKEN) return;
      navigator.clipboard?.writeText(TOKEN.ca).then(() => toast("Contract address copied"), () => toast(TOKEN!.ca));
    }),
  );

  const rl = document.getElementById("rail");
  if (rl) {
    // The rail casts its shadow (L2) only once content is scrolling underneath it.
    const onScroll = () => rl.classList.toggle("is-over", scrollY > 2);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  quietAsk(document.querySelector("[data-quiet-ask]"));

  const more = document.querySelector<HTMLElement>("[data-more]");
  if (more) {
    const b = more.querySelector("button")!;
    const menu = more.querySelector<HTMLElement>(".more__menu")!;
    const set = (open: boolean) => {
      menu.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
      b.classList.toggle("is-down", open);
    };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      set(menu.hidden === true);
      if (!menu.hidden) menu.querySelector<HTMLElement>("a")?.focus();
    });
    document.addEventListener("click", (e) => {
      if (!more.contains(e.target as Node)) set(false);
    });
    more.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        set(false);
        b.focus();
      }
    });
    // Tabbing out of the menu closes it, so it never hangs open over the page.
    more.addEventListener("focusout", (e) => {
      if (!more.contains(e.relatedTarget as Node | null)) set(false);
    });
  }

  document.querySelectorAll("[data-search]").forEach((el) => el.addEventListener("click", openSearch));
  document.querySelectorAll("[data-menu]").forEach((el) => el.addEventListener("click", openMenu));
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  });
}
export { openSearch };

let quietObs: IntersectionObserver | null = null;
/**
 * One dark key per screen. While `el` (a page's primary key, or the block that holds it) is on screen
 * and shows a graphite key, the rail's Ask and the phone dock's Ask turn aluminium. A block whose dark
 * key is hidden at this width (the home hero on phones) leaves Ask graphite. Pages that redraw their
 * primary key, or enable or disable it, call this again; null gives Ask its graphite back.
 */
export function quietAsk(el: Element | null) {
  quietObs?.disconnect();
  quietObs = null;
  const rail = document.querySelector<HTMLElement>("#rail [data-ask]");
  const dock = document.querySelector<HTMLElement>(".dock [data-ask]");
  const quiet = (on: boolean) => {
    rail?.classList.toggle("key--ink", !on);
    dock?.classList.toggle("dock__key--ink", !on);
  };
  quiet(false);
  if (!el || (!rail && !dock)) return;
  // A disabled graphite key is drawn dashed, so it does not count as the screen's dark key.
  const lit = ".key--ink:not([disabled], [aria-disabled='true'])";
  const inkShown = () => [el, ...el.querySelectorAll(".key--ink")].some((k) => k.matches(lit) && k.getClientRects().length > 0);
  // The rail covers the top 60px on wide screens and the dock the bottom 56px on phones.
  quietObs = new IntersectionObserver((seen) => quiet(seen[seen.length - 1].isIntersecting && inkShown()), { rootMargin: "-60px 0px -56px 0px" });
  quietObs.observe(el);
}

/** The footer's status line, from one /api/stats read. */
function stats() {
  const el = document.getElementById("foot-status");
  if (!el) return;
  fetch("/api/stats")
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s) return;
      const t = new Date().toISOString().slice(11, 16);
      const paid = Number(s.paidCalls) || 0;
      const settled = paid ? `${paid.toLocaleString("en-US")} paid ${paid === 1 ? "call" : "calls"} settled` : "no paid calls settled yet";
      el.textContent = `${s.resources} tools listed · ${s.networks} networks quoting · ${settled} · checked ${t} UTC`;
    })
    .catch(() => {});
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.hidden = true), 3200);
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
