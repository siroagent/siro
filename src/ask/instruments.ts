// The instrument column: who pays, on which network, today's spend against the daily cap, autopay
// and the last payments from this browser. Below 960px it folds into a one-line cap strip that
// opens the same display in a sheet (the node moves, so its controls keep their state).
import { PAY_NETWORKS, byId, type PayNetworkKey } from "../../shared/catalog";
import { liveNetworks, liveSelect, netOptions, network, setNetwork, spendLog, type Payer, type Spend } from "../lib/pay";
import { esc } from "../shell";
import { onShut, shut } from "./dialog";
import { isoOf, money, short, txUrl, utcStamp } from "./format";
import { capsSaved, connectWallet, payEnv, payingAddress, setPayerKind, type PayEnv } from "./payer";

/** Robinhood Chain first (the default), then Base, Solana, Arbitrum, Polygon. */
const UI_ORDER: PayNetworkKey[] = ["robinhood", "base", "solana", "arbitrum", "polygon"];

export type Instruments = {
  render(): void;
  /** Networks the server quotes now: null while reading, [] when it could not be read. */
  live(): PayNetworkKey[] | null;
};

export function mountInstruments(o: { onChange: () => void; paying: () => string | null; toast: (msg: string) => void }): Instruments {
  const $ = (id: string) => document.getElementById(id)!;
  const sel = $("net") as HTMLSelectElement;
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="payer"]')];
  let live: PayNetworkKey[] | null = null;
  let checked = 0;
  // A part is redrawn only when its markup changes, so a refresh after an agent reply or a payment
  // does not pull keyboard focus off a key or link inside it.
  const drawn = new Map<string, string>();
  const paint = (id: string, html: string) => {
    if (drawn.get(id) === html) return;
    drawn.set(id, html);
    $(id).innerHTML = html;
  };

  sel.innerHTML = netOptions(network(), UI_ORDER);
  liveSelect(sel);
  // liveSelect may move the choice off a network that stopped quoting; this runs after it.
  liveNetworks().then((keys) => {
    live = keys;
    checked = Date.now();
    changed();
  });

  function changed() {
    render();
    o.onChange();
  }

  sel.addEventListener("change", () => {
    setNetwork(sel.value as PayNetworkKey);
    changed();
  });
  for (const r of radios)
    r.addEventListener("change", () => {
      if (!r.checked) return;
      setPayerKind(r.value as Payer["kind"]);
      changed();
    });
  $("payer-who").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-connect]");
    if (!b) return;
    b.disabled = true;
    b.textContent = "Connecting…";
    try {
      await connectWallet();
    } catch (err) {
      o.toast((err as Error).message);
    }
    drawn.delete("payer-who");
    changed();
    // The key was redrawn, so focus fell to the page: put it back on the connect key, or on the readout.
    if (document.activeElement === document.body) ($("payer-who").querySelector<HTMLElement>("[data-connect]") ?? $("payer-who")).focus();
  });

  mountSheet();

  function render() {
    const env = payEnv(live, o.paying());
    const l = env.limits;
    for (const r of radios) r.checked = r.value === env.payer;
    if (sel.value !== env.network) sel.value = env.network;
    paint("payer-who", who(env));
    $("net-note").textContent = netNote(env);

    const fill = String(l.perDay > 0 ? Math.min(1, env.spent / l.perDay) : 0);
    paint("today-num", `${money(env.spent)}<small>of ${money(l.perDay)} today</small>`);
    $("today-meter").style.setProperty("--v", fill);
    $("caps-line").textContent = `Caps: ${money(l.perPayment)} a call, ${money(l.perDay)} a day${capsSaved() ? "" : " (a new Budget's defaults)"}.${env.payer === "connected" ? " They apply to Budget payments only." : ""}`;
    paint(
      "autopay-line",
      env.payer === "connected"
        ? "<b>Not used.</b> Your wallet asks before each payment."
        : l.autopay
          ? `<b>On.</b> One quote per message you send pays without asking, when it fits ${money(l.perPayment)} a call and ${money(l.perDay)} a day. Swaps and quotes without a listed price always ask.`
          : "<b>Off.</b> Siro asks before every payment.",
    );

    const rows = spendLog().slice(0, 5);
    paint("paylog", rows.length ? rows.map((s, i) => payRow(s, i === 0)).join("") : `<li class="paylog__none">None yet. Payments from this browser show here with their transaction hash.</li>`);
    $("instr-src").textContent = `this browser, ${utcStamp(Date.now())}`;

    const payer = env.payer === "agent" ? (env.budget ? "Budget" : "Budget (none yet)") : env.wallet ? env.wallet.name : "My wallet (not connected)";
    const net = PAY_NETWORKS[env.network].name;
    paint("bar-pay", `<span class="label">Pays with</span> <b>${esc(payer)}</b> on ${net}`);
    // The strip is one line on a 375px phone: who pays and where on the left, the state on the right.
    paint("cap-who", `<b>${esc(env.payer === "agent" ? "Budget" : (env.wallet?.name ?? "My wallet"))}</b> on ${net}`);
    // Caps only bind a Budget that exists; otherwise the strip says what is missing or who signs.
    const capped = env.payer === "agent" && !!env.budget;
    $("cap-today").textContent = capped ? `${money(env.spent)} of ${money(l.perDay)} today` : env.payer === "agent" ? "not set up" : env.wallet ? "signs each payment" : "not connected";
    $("cap-meter").hidden = !capped;
    $("cap-meter").style.setProperty("--v", fill);
  }

  function netNote(env: PayEnv) {
    const parts = [
      live === null
        ? "Checking which networks quote now."
        : live.length
          ? `${live.length} ${live.length === 1 ? "network" : "networks"} quoting, checked ${utcStamp(checked)}.`
          : "Could not check which networks quote. All five are listed.",
    ];
    if (env.network === "solana") parts.push(env.payer === "connected" ? "A connected wallet cannot pay on Solana." : "Video and music tools are paid on EVM networks only.");
    return parts.join(" ");
  }

  return { render, live: () => live };
}

function who(env: PayEnv) {
  const addr = payingAddress(env);
  if (env.payer === "agent") {
    if (!addr) return `<p class="instr__note">No Budget on this device yet. A Budget is a key kept in this browser, with a cap per call and per day.</p><a class="key key--sm instr__key" href="/budget">Create a Budget</a>`;
    return `<p class="instr__addr">${esc(short(addr))}</p><p class="instr__note">Agent key kept in this browser${env.network === "solana" ? ", paying from its Solana address" : ""}.</p>`;
  }
  if (!addr) return `<button class="key key--sm instr__key" type="button" data-connect>Connect wallet</button><p class="instr__note">Pays on EVM networks. Your wallet asks before every payment.</p>`;
  return `<p class="instr__addr">${esc(short(addr))}</p><p class="instr__note">${esc(env.wallet?.name ?? "Your wallet")} signs each payment.</p>`;
}

function payRow(s: Spend, newest: boolean) {
  const swap = s.resource.startsWith("swap ");
  // The spend log puts an arrow between a swap's two tokens; the list reads it as words.
  const name = swap ? `Swap ${s.resource.slice(5).replace(/\s*→\s*/, " for ")}` : (byId(s.resource)?.name ?? s.resource);
  const n = s.network in PAY_NETWORKS ? s.network : null;
  const tx = s.tx && n ? `<a href="${txUrl(n, s.tx)}" target="_blank" rel="noopener noreferrer">${esc(short(s.tx))}</a>` : "no hash";
  return `<li>
    <span class="paylog__what">${newest ? '<i class="ball" aria-hidden="true"></i>' : ""}<span>${esc(name)}</span></span>
    <span class="paylog__usd">${swap ? "" : money(s.usd)}</span>
    <span class="paylog__meta"><time datetime="${isoOf(s.at)}">${utcStamp(s.at)}</time> · ${n ? PAY_NETWORKS[n].name : esc(s.network)} · ${tx}</span>
  </li>`;
}

/** Phones and tablets: the cap strip opens the display in a sheet; it moves back on close. */
function mountSheet() {
  const sheet = document.getElementById("sheet") as HTMLDialogElement;
  const strip = document.getElementById("capstrip")!;
  const display = document.getElementById("instr-display")!;
  const home = display.parentElement!;
  const wide = matchMedia("(min-width: 960px)");

  strip.addEventListener("click", () => {
    if (sheet.open) return;
    document.getElementById("sheet-body")!.append(display);
    sheet.showModal();
    strip.setAttribute("aria-expanded", "true");
  });
  onShut(sheet, () => {
    home.append(display);
    strip.setAttribute("aria-expanded", "false");
    if (!wide.matches) strip.focus();
  });
  // A click on the backdrop lands on the dialog itself; the content fills the rest.
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || (e.target as HTMLElement).closest("[data-close-sheet]")) shut(sheet);
  });
  wide.addEventListener("change", (e) => {
    if (e.matches) shut(sheet);
  });
}
