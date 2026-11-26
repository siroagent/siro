// Funds: the address to send each asset to, and what each network holds right now. balances() reads
// every chain directly; a network that does not answer says so instead of showing $0.00.
import type { Address } from "viem";
import { PAY_NETWORKS, RESOURCES, type PayNetworkKey } from "../../shared/catalog";
import { balances, liveNetworks } from "../lib/pay";
import { esc } from "../shell";
import { copy, held, hold, money, NET_ORDER, short, utc } from "./util";

export type Wallet = { evm: Address; sol: string };
export type Balance = { eth: string; gas: string; usd: string } | null;
/** `who` is the EVM address read, so a reading never lands on a wallet made after it started. */
export type Reading = { who: string; at: Date; by: Record<PayNetworkKey, Balance> };
export type FundsState = "nokey" | "reading" | "funded" | "empty" | "unreadable";

let last: Reading | null = null;
let pending: { who: string; p: Promise<Reading> } | null = null;
const watchers = new Set<(r: Reading) => void>();
const whoOf = (w: Wallet) => w.evm.toLowerCase();

/** The latest reading for this wallet, if there is one. */
export const readingFor = (w: Wallet) => (last?.who === whoOf(w) ? last : null);

/** Runs `f` after every new reading for as long as `owner` stays on the page. */
export function onReading(owner: HTMLElement, f: (r: Reading) => void) {
  const w = (r: Reading) => (owner.isConnected ? f(r) : watchers.delete(w));
  watchers.add(w);
}
/** One read of every network at a time. `fresh` starts a new read even when one is cached. */
export function readFunds(w: Wallet, fresh = false): Promise<Reading> {
  const who = whoOf(w);
  if (pending?.who === who) return pending.p;
  if (!fresh && last?.who === who) return Promise.resolve(last);
  const p: Promise<Reading> = balances(w.evm, w.sol)
    .then((by) => {
      const r: Reading = { who, at: new Date(), by };
      last = r;
      watchers.forEach((f) => f(r));
      return r;
    })
    .finally(() => {
      if (pending?.p === p) pending = null;
    });
  pending = { who, p };
  return p;
}

const gasOf = (b: NonNullable<Balance>) => (Number(b.eth) > 0 ? `${Number(b.eth).toLocaleString("en-US", { maximumSignificantDigits: 3 })} ${b.gas}` : `no ${b.gas}`);

function row(n: PayNetworkKey, w: Wallet | null) {
  const net = PAY_NETWORKS[n];
  const addr = w ? (n === "solana" ? w.sol : w.evm) : null;
  const send = addr
    ? `<div class="bd-ft__send"><code class="bd-addr" title="${esc(addr)}"><span class="sr">${esc(addr)}</span><span class="bd-addr__wide" aria-hidden="true">${esc(short(addr, 10, 8))}</span><span class="bd-addr__phone" aria-hidden="true">${esc(short(addr))}</span></code><button class="key key--sm" type="button" data-copy="${esc(addr)}" aria-label="Copy the ${net.name} address">Copy</button></div>`
    : `<span class="small muted">After step 1</span>`;
  return `<tr role="row" data-net="${n}">
    <th role="rowheader" scope="row" class="bd-ft__net"><b>${net.name}</b><span class="small muted">${net.asset}${n === "robinhood" ? ", the default" : ""}</span></th>
    <td role="cell" class="bd-ft__addr">${send}</td>
    <td role="cell" class="num bd-ft__bal" data-bal><span class="small muted">${addr ? "Reading…" : "No key yet"}</span></td>
    <td role="cell" class="bd-ft__q" data-q><span class="small muted">checking</span></td>
  </tr>`;
}

export function mountFunds(host: HTMLElement, w: Wallet | null, onState?: (s: FundsState) => void) {
  const slow = RESOURCES.filter((r) => r.slow).length;
  host.innerHTML = `
  <div class="bd-funds">
    <div class="bd-funds__main">
      <table class="table bd-ft bd-grid-rows" role="table" data-table>
        <caption class="sr">Deposit address and stablecoin balance on each network this wallet pays on</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Network</th><th role="columnheader" scope="col">Send to</th><th role="columnheader" scope="col" class="num">Balance</th><th role="columnheader" scope="col">Server</th></tr></thead>
        <tbody role="rowgroup">${NET_ORDER.map((n) => row(n, w)).join("")}</tbody>
      </table>
      <div class="bd-funds__foot">
        <p class="bd-funds__total" data-total role="status" tabindex="-1">${w ? "Reading balances…" : "Balances show here once the key exists."}</p>
        ${w ? `<button class="key key--sm" type="button" data-reread>Read again</button>` : ""}
      </div>
      <p class="label" data-src></p>
      <ul class="bd-notes small">
        <li>Paying needs no gas, because each payment is a signature. Withdrawing and swapping need a little of the network's gas token.</li>
        <li>The ${slow} tools that take minutes (video and the longer music tracks) are quoted on EVM networks only, not on Solana.</li>
        <li>The key sits unencrypted in this browser, so keep here only what the agent needs.</li>
      </ul>
    </div>
    <figure class="plate bd-plate">
      <img src="/img/05-stack-640.webp" srcset="/img/05-stack-640.webp 640w, /img/05-stack-1122.webp 1122w" sizes="(max-width: 899px) 72px, 168px" width="640" height="800" alt="Five stacked aluminium plates, one per network, with the S milled into the top plate and a chrome ball in its groove." loading="lazy" decoding="async">
      <figcaption>The top plate is the default: USDG on Robinhood Chain.</figcaption>
    </figure>
  </div>`;

  const cell = (n: PayNetworkKey, part: "bal" | "q") => host.querySelector<HTMLElement>(`tr[data-net="${n}"] [data-${part}]`);
  const total = host.querySelector<HTMLElement>("[data-total]")!;
  const src = host.querySelector<HTMLElement>("[data-src]")!;
  const reread = host.querySelector<HTMLButtonElement>("[data-reread]");
  let balanceNote = "";
  let quoteNote = "";
  const paintSrc = () => (src.textContent = [balanceNote, quoteNote].filter(Boolean).join(" "));

  const paint = (r: Reading) => {
    if (!w || r.who !== whoOf(w)) return;
    let sum = 0;
    let funded = 0;
    let unread = 0;
    for (const n of NET_ORDER) {
      const c = cell(n, "bal");
      const b = r.by[n];
      if (!c) continue;
      if (!b) {
        unread++;
        c.innerHTML = `<span class="bd-unread">unreadable · <button class="key key--sm" type="button" data-reread aria-label="Retry reading the ${PAY_NETWORKS[n].name} balance">Retry</button></span>`;
        continue;
      }
      const v = Number(b.usd);
      sum += v;
      if (v > 0) funded++;
      c.innerHTML = `<b class="live-num bd-bal">${money(v)}</b><span class="small muted bd-gas">${gasOf(b)}</span>`;
    }
    total.textContent =
      unread === NET_ORDER.length
        ? "No network answered. Try again in a moment."
        : sum > 0
          ? `${money(sum)} in stablecoins across ${funded} network${funded > 1 ? "s" : ""}.`
          : unread
            ? "No funds on the networks that answered."
            : "No funds yet. Send USDG or USDC to the address for one of these networks.";
    // The time says when each network was asked; it claims a reading only for the ones that answered.
    const answered = NET_ORDER.length - unread;
    balanceNote = !answered
      ? `Asked each network at ${utc(r.at)}.`
      : unread
        ? `Balances read at ${utc(r.at)} from the ${answered} network${answered > 1 ? "s" : ""} that answered.`
        : `Balances read from each network at ${utc(r.at)}.`;
    paintSrc();
    host.querySelector("[data-table]")?.removeAttribute("aria-busy");
    if (reread) hold(reread, false);
    onState?.(unread === NET_ORDER.length ? "unreadable" : sum > 0 ? "funded" : "empty");
  };

  const read = (fresh: boolean) => {
    if (!w) return;
    host.querySelector("[data-table]")?.setAttribute("aria-busy", "true");
    if (reread) hold(reread, true);
    if (fresh) for (const n of NET_ORDER) cell(n, "bal")!.innerHTML = `<span class="small muted">Reading…</span>`;
    total.textContent = "Reading balances…";
    onState?.("reading");
    readFunds(w, fresh).then(paint);
  };

  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest<HTMLElement>("[data-copy]");
    if (c) return void copy(c.dataset.copy!, "Address");
    const again = t.closest<HTMLElement>("[data-reread]");
    if (!again || held(again)) return;
    read(true);
    // A row's Retry key is redrawn by the read, so focus moves to the line that reports it.
    if (again !== reread) total.focus();
  });

  liveNetworks().then((keys) => {
    if (!host.isConnected) return;
    for (const n of NET_ORDER) {
      const c = cell(n, "q");
      if (!c) continue;
      c.innerHTML = !keys.length ? `<span class="small muted">unknown</span>` : keys.includes(n) ? `<span class="lamp lamp--settled">quoting</span>` : `<span class="lamp bd-quiet">not quoting</span>`;
    }
    quoteNote = keys.length ? `Server: the networks Siro quotes prices on, checked ${utc()}.` : "Server: Siro's price list did not answer, so no network is marked.";
    paintSrc();
  });

  if (w) {
    onReading(host, paint);
    read(false);
  } else onState?.("nokey");
}
