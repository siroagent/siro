// Budget: the agent wallet's key, caps and funds. Without a key the page is a numbered setup sheet; with
// one it is an index of instruments (Caps, Funds, Spend, Move, Code) with the key zone last.
import { agentAccount, agentAddresses, agentSolana, createAgentWallet, importAgentWallet, limits, spentToday } from "../lib/pay";
import { esc, mountShell, quietAsk, toast } from "../shell";
import "../styles/result.css";
import "./budget.css";
import { mountCaps, type Caps, type CapsState } from "./caps";
import { mountUse } from "./code";
import { onDialogClosed } from "./dialog";
import { mountFunds, type FundsState, type Wallet } from "./funds";
import { mountKeyZone, showKey } from "./keyzone";
import { mountMove } from "./move";
import { mountServices } from "./services";
import { mountSpend } from "./spend";
import { copy, usd } from "./util";

mountShell("budget");
const app = document.getElementById("budget")!;
const BLOCKED = "This browser blocked site storage, so the key could not be kept. Allow storage for siroagent.com, or use the CLI.";
const SECTIONS = [
  ["caps", "Caps"],
  ["funds", "Funds"],
  ["spend", "Spend"],
  ["move", "Move"],
  ["code", "Code"],
  ["key", "Key"],
] as const;

/** A key made from the sheet during this visit keeps the sheet up until the user moves on. */
let settingUp = false;
let caps: Caps | null = null;
let spend: { reload(): Promise<void> } | null = null;
let use: { refresh(): void } | null = null;

// One dark key per screen. On phones that is the dock's Ask, so the page's primary key stays aluminium; wider up
// the rail's Ask turns aluminium while the page's key is in view.
const phone = matchMedia("(max-width: 759px)");
let lead: HTMLElement | null = null;
function leadWith(key: HTMLElement | null) {
  lead = key;
  key?.classList.toggle("key--ink", !phone.matches);
  quietAsk(key && !phone.matches ? key : null);
}
phone.addEventListener("change", () => leadWith(lead));
// A dialog borrows the dark key while it is open; this page's own primary key takes it back on close.
onDialogClosed(() => leadWith(lead));

function wallet(): Wallet | null {
  const a = agentAccount();
  const s = agentSolana();
  return a && s ? { evm: a.address, sol: s.address } : null;
}

type Lamp = ["settled" | "awaiting" | "refused" | "", string];
const lampClass = (kind: Lamp[0]) => (kind ? `lamp lamp--${kind}` : "lamp bd-quiet");
function stepLamp(id: string, [kind, text]: Lamp) {
  const el = document.querySelector<HTMLElement>(`#${id} [data-step-lamp]`);
  if (!el) return;
  el.className = lampClass(kind);
  el.textContent = text;
}

// ---- Before a key exists: the numbered setup sheet ----

function step(n: number, id: string, name: string, [kind, text]: Lamp, body: string) {
  return `<li class="bd-step" id="${id}">
    <div class="bd-step__head"><span class="bd-step__n" aria-hidden="true">${n}</span><h3 class="bd-step__name">${name}</h3><p class="${lampClass(kind)}" data-step-lamp>${text}</p></div>
    <div class="bd-step__body">${body}</div>
  </li>`;
}

function keyStep(w: Wallet | null) {
  if (!w)
    return `<p>Your key is made on this device and kept in this browser's storage, unencrypted. Export a backup. The CLI encrypts its key with your password.</p>
      <div class="bd-row"><button class="key" type="button" id="bd-make">Make a new key</button><button class="key" type="button" data-import-open aria-expanded="false" aria-controls="bd-import">Import a key</button></div>
      <form class="bd-import" id="bd-import" novalidate hidden>
        <div class="field"><label class="label" for="bd-import-key">Private key, 64 hex characters</label><input id="bd-import-key" class="mono" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" translate="no" data-1p-ignore data-lpignore="true"></div>
        <p class="small muted">Import only a key made for your agent, never your main wallet's key.</p>
        <p class="lamp lamp--refused" data-import-error role="alert" hidden></p>
        <div class="bd-row"><button class="key" type="submit">Import key</button><button class="key" type="button" data-import-close>Cancel</button></div>
      </form>`;
  const addr = (label: string, a: string) => `<div><dt>${label}</dt><dd class="bd-addrs__a">${esc(a)}</dd><dd><button class="key key--sm" type="button" data-copy="${esc(a)}" aria-label="Copy the ${label}">Copy</button></dd></div>`;
  return `<dl class="bd-addrs">${addr("EVM address", w.evm)}${addr("Solana address", w.sol)}</dl>
    <p>It is kept in this browser's storage, unencrypted. Clearing site data deletes it, so export a backup before you fund it.</p>
    <div class="bd-row"><button class="key" type="button" data-export>Export a backup</button></div>`;
}

const CAPS_LAMP: Record<CapsState, Lamp> = {
  defaults: ["", "Defaults in effect"],
  saved: ["settled", "Saved"],
  unsaved: ["awaiting", "Unsaved"],
  invalid: ["refused", "Check the values"],
};
const FUNDS_LAMP: Record<FundsState, Lamp> = {
  nokey: ["", "After step 1"],
  reading: ["", "Reading balances"],
  funded: ["settled", "Funded"],
  empty: ["awaiting", "Waiting for funds"],
  unreadable: ["refused", "Balances unreadable"],
};

function renderSheet() {
  const w = wallet();
  app.innerHTML = `
  <section class="face bd-sheet" aria-labelledby="bd-sheet-h">
    <div class="bd-sheet__bar"><h2 class="bd-sheet__title" id="bd-sheet-h">Set up this budget</h2><p class="label">${w ? "The key is in this browser. Set the caps and fund it, then open the budget view." : "There is no agent key in this browser yet."}</p></div>
    <ol class="bd-steps">
      ${step(1, "key", "Key", w ? ["settled", "In this browser"] : ["", "No key yet"], keyStep(w))}
      ${step(2, "caps", "Caps", CAPS_LAMP.defaults, `<p>Turn the knob to set the daily cap. Siro refuses a payment before signing if it costs more than the per-call cap, or would take today's spend past the daily cap.</p><div data-caps></div>`)}
      ${step(3, "funds", "Fund", FUNDS_LAMP[w ? "reading" : "nokey"], `<p>Send USDG or USDC to the address for its network. Any one network is enough to start.</p><div data-funds></div>`)}
      ${step(4, "code", "Use", ["", "Ready once funded"], `<div data-use></div>`)}
    </ol>
    ${w ? `<div class="bd-sheet__end"><p>That is the whole setup. From now on this page opens on the budget view: caps, funds, spend and the key.</p><button class="key" type="button" data-finish>Open the budget view</button></div>` : ""}
  </section>`;

  caps = mountCaps(app.querySelector<HTMLElement>("[data-caps]")!, {
    onSaved: () => use?.refresh(),
    onState: (s) => stepLamp("caps", CAPS_LAMP[s]),
  });
  leadWith(w ? caps.save : app.querySelector<HTMLElement>("#bd-make"));
  mountFunds(app.querySelector<HTMLElement>("[data-funds]")!, w, (s) => {
    stepLamp("funds", FUNDS_LAMP[s]);
    stepLamp("code", s === "funded" ? ["settled", "Ready"] : ["", "Ready once funded"]);
  });
  use = mountUse(app.querySelector<HTMLElement>("[data-use]")!, { withAsk: true, level: 4 });
  spend = null;

  app.querySelector("#bd-make")?.addEventListener("click", makeKey);
  app.querySelector("[data-export]")?.addEventListener("click", () => showKey("evm"));
  app.querySelector("[data-finish]")?.addEventListener("click", () => {
    settingUp = false;
    render();
    scrollTo(0, 0);
    document.querySelector<HTMLElement>("#main h1")?.focus();
  });
  app.querySelector(".bd-addrs")?.addEventListener("click", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-copy]");
    if (c) copy(c.dataset.copy!, "Address");
  });
  bindImport();
}

function bindImport() {
  const open = app.querySelector<HTMLButtonElement>("[data-import-open]");
  const form = app.querySelector<HTMLFormElement>("#bd-import");
  if (!open || !form) return;
  const input = form.querySelector<HTMLInputElement>("input")!;
  const error = form.querySelector<HTMLElement>("[data-import-error]")!;
  const toggle = (on: boolean) => {
    form.hidden = !on;
    open.setAttribute("aria-expanded", String(on));
    error.hidden = true;
    if (on) input.focus();
    else {
      input.value = "";
      open.focus();
    }
  };
  open.addEventListener("click", () => toggle(form.hidden !== false));
  form.querySelector("[data-import-close]")!.addEventListener("click", () => toggle(false));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fail = (msg: string) => {
      error.textContent = msg;
      error.hidden = false;
      input.focus();
    };
    try {
      importAgentWallet(input.value);
    } catch (err) {
      return fail((err as Error).message);
    }
    if (!agentAccount()) return fail(BLOCKED);
    input.value = "";
    settingUp = true;
    render();
    toast("Key imported. It is kept in this browser's storage, unencrypted.");
    app.querySelector<HTMLElement>("[data-export]")?.focus();
  });
}

function makeKey() {
  createAgentWallet();
  if (!agentAccount()) {
    const row = app.querySelector("#bd-make")?.parentElement;
    if (row && !row.nextElementSibling?.matches("[data-blocked]")) row.insertAdjacentHTML("afterend", `<p class="lamp lamp--refused" role="alert" data-blocked>${BLOCKED}</p>`);
    return;
  }
  settingUp = true;
  render();
  toast("Key made on this device. Export a backup before you fund it.");
  app.querySelector<HTMLElement>("[data-export]")?.focus();
}

// ---- Once a key exists: the index and its sections ----

function section(id: string, name: string, says: string, body: string, extra = "") {
  return `<section class="bd-sec" id="${id}" aria-labelledby="${id}-h">${extra}
    <header class="bd-sec__head"><h2 id="${id}-h">${name}</h2><p>${says}</p></header>
    ${body}
  </section>`;
}

function paintToday() {
  const el = app.querySelector<HTMLElement>("[data-today-mini]");
  if (!el) return;
  const spent = spentToday(agentAddresses());
  const cap = limits().perDay;
  el.querySelector("[data-today-text]")!.textContent = `${usd(spent)} of ${usd(cap)}`;
  el.querySelector<HTMLElement>(".meter")!.style.setProperty("--v", String(Math.min(1, spent / cap)));
}

function renderView(w: Wallet) {
  app.innerHTML = `
  <div class="bd-view">
    <nav class="bd-index" aria-label="Budget sections">
      <ol>${SECTIONS.map(([id, name]) => `<li><a href="#${id}">${name}</a></li>`).join("")}</ol>
      <div class="bd-index__today" data-today-mini><p class="label">Spent today · spend log</p><p class="num" data-today-text></p><div class="meter" aria-hidden="true"><i class="ball"></i></div></div>
    </nav>
    <div class="bd-secs">
      ${section("caps", "Caps", "Siro refuses a payment before signing if it costs more than the per-call cap, or would take today's spend past the daily cap.", `<div class="face bd-sec__face" data-caps></div>`)}
      ${section("funds", "Funds", "Stablecoin balances on the five networks this wallet pays on, read straight from each chain.", `<div data-funds></div>`)}
      ${section(
        "spend",
        "Spend",
        "What this budget paid for: Siro settlements by this wallet's addresses, plus the calls and swaps this browser made.",
        `<div data-spend></div>
        <section class="bd-outside" aria-labelledby="outside-h"><h3 id="outside-h">Pay a service outside Siro</h3><p>Search the open x402 index for paid APIs beyond Siro's tools. A call is paid from this budget, after the same cap checks and your yes.</p><div data-services></div></section>`,
      )}
      ${section("move", "Move", "Send stablecoins out of the agent wallet, or swap tokens on Robinhood Chain and Base.", `<div data-move></div>`)}
      ${section("code", "Code", "Use this key from a terminal or an MCP client, through the Siro CLI.", `<div data-use></div>`)}
      ${section("key", "Key", "The private key behind both addresses.", `<div class="bd-keyzone" data-keyzone></div>`, `<div class="rails bd-boundary" aria-hidden="true"></div>`)}
    </div>
  </div>`;

  const after = () => {
    caps?.refreshToday();
    paintToday();
    spend?.reload();
  };
  caps = mountCaps(app.querySelector<HTMLElement>("[data-caps]")!, {
    onSaved: () => {
      paintToday();
      use?.refresh();
    },
  });
  leadWith(caps.save);
  mountFunds(app.querySelector<HTMLElement>("[data-funds]")!, w);
  spend = mountSpend(app.querySelector<HTMLElement>("[data-spend]")!, w);
  mountServices(app.querySelector<HTMLElement>("[data-services]")!, after);
  mountMove(app.querySelector<HTMLElement>("[data-move]")!, w, after);
  use = mountUse(app.querySelector<HTMLElement>("[data-use]")!, { withAsk: false, level: 3 });
  mountKeyZone(app.querySelector<HTMLElement>("[data-keyzone]")!, () => {
    settingUp = false;
    render();
    scrollTo(0, 0);
    toast("The key is gone from this browser. The funds stay on-chain.");
    document.querySelector<HTMLElement>("#bd-make")?.focus();
  });
  paintToday();
  spy(app.querySelector<HTMLElement>(".bd-index")!);
}

/** Marks the index entry for the last section whose top has passed a line near the top of the screen;
 *  at the bottom of the page the last section wins, since a short one never reaches that line. */
let spying: (() => void) | null = null;
function spy(nav: HTMLElement) {
  const links = SECTIONS.map(([id]) => ({ id, a: nav.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`)!, el: document.getElementById(id)! }));
  let queued = false;
  const pick = () => {
    queued = false;
    if (!nav.isConnected) return;
    const line = Math.min(innerHeight * 0.35, 260);
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    let at = links[0].id;
    for (const l of links) if (l.el.getBoundingClientRect().top <= line) at = l.id;
    if (atEnd) at = links[links.length - 1].id;
    for (const l of links) l.id === at ? l.a.setAttribute("aria-current", "true") : l.a.removeAttribute("aria-current");
  };
  const onScroll = () => {
    if (!queued) requestAnimationFrame(pick);
    queued = true;
  };
  if (spying) removeEventListener("scroll", spying);
  spying = onScroll;
  addEventListener("scroll", onScroll, { passive: true });
  pick();
}

function render() {
  const w = wallet();
  app.removeAttribute("aria-busy");
  if (spying) removeEventListener("scroll", spying);
  spying = null;
  if (!w || settingUp) renderSheet();
  else renderView(w);
}

render();

// A link to a section, or to /budget?per-call=…, lands on it once the page has been drawn.
const target = location.hash ? document.getElementById(location.hash.slice(1)) : new URLSearchParams(location.search).has("per-call") ? document.getElementById("caps") : null;
target?.scrollIntoView();

// Another tab made, imported or forgot a key, saved caps, or paid for something.
addEventListener("storage", (e) => {
  if (e.key === null || e.key === "siro.agent.key") {
    settingUp = false;
    render();
  } else if (e.key === "siro.agent.limits") {
    caps?.reload();
    paintToday();
  } else if (e.key === "siro.agent.log") {
    caps?.refreshToday();
    paintToday();
    spend?.reload();
  }
});
