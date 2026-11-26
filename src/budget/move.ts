// Move: stablecoins out of the agent wallet (an ordinary transfer) and swaps through KyberSwap. Both wait
// for a yes in a dialog, and a swap above the per-swap cap is stopped before its key can be pressed.
import { isAddress, type Address } from "viem";
import { EVM_PAY, NETWORKS, PAY_NETWORKS, type EvmPayKey, type NetworkKey } from "../../shared/catalog";
import type { SwapQuote } from "../../shared/swap";
import { CHAINS, dataNetwork, doSwap, getSwapQuote, limits, netOptions, network, publicClient, withdraw } from "../lib/pay";
import { esc } from "../shell";
import { dialog } from "./dialog";
import { onReading, readFunds, readingFor, type Wallet } from "./funds";
import { amount, held, hold, money, parseUsd, payText, short, txUrl, usd } from "./util";

const QUOTE_LIFE = 90_000;
const STEP: Record<string, string> = {
  approving: "Approving the token for the router…",
  building: "Building the route…",
  swapping: "Sending the swap, then waiting for it to land…",
};
const link = (n: EvmPayKey, hash: string) => `<a href="${esc(txUrl(n, hash))}" target="_blank" rel="noopener noreferrer">Transaction ${esc(short(hash, 6, 4))}</a>`;

function transferText(e: unknown, n: EvmPayKey) {
  const err = (e ?? {}) as { shortMessage?: string; message?: string };
  // viem words a gas shortfall as "exceeds the balance of the account"; the node's own words sit in the details.
  const all = `${err.shortMessage ?? ""} ${err.message ?? ""}`;
  if (/insufficient funds|exceeds the balance of the account/i.test(all)) return `Not enough ${CHAINS[n].nativeCurrency.symbol} on ${PAY_NETWORKS[n].name} to pay the gas.`;
  if (/exceeds balance|amount exceeds/i.test(all)) return `Not enough ${PAY_NETWORKS[n].asset} on ${PAY_NETWORKS[n].name}.`;
  return String(err.shortMessage ?? err.message ?? "").slice(0, 240) || "The transfer did not go through.";
}

function mountWithdraw(host: HTMLElement, w: Wallet, onMoved: () => void) {
  const now = network();
  const first: EvmPayKey = (EVM_PAY as readonly string[]).includes(now) ? (now as EvmPayKey) : "robinhood";
  host.innerHTML = `
  <form class="face bd-mform" novalidate aria-labelledby="wd-h">
    <h3 id="wd-h">Withdraw</h3>
    <p class="small bd-mform__lead">An ordinary transfer of USDG or USDC from the agent wallet to any address. It needs a little of the network's gas token.</p>
    <div class="field"><label class="label" for="wd-net">Network</label><select id="wd-net">${netOptions(first, EVM_PAY)}</select></div>
    <div class="field"><label class="label" for="wd-to">To address</label><input id="wd-to" class="mono" placeholder="0x…" autocomplete="off" spellcheck="false" autocapitalize="off"></div>
    <div class="field">
      <label class="label" for="wd-amt">Amount <span class="sr">in USD</span></label>
      <div class="bd-money"><input id="wd-amt" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><i aria-hidden="true">USD</i></div>
      <div class="bd-mform__have"><span class="small muted" data-have></span><button class="key key--sm" type="button" data-all hidden>Use all of it</button></div>
    </div>
    <p class="small" data-gas></p>
    <p class="small muted">On Solana, import the Solana key (under Key) into Phantom or Solflare to move USDC out.</p>
    <div class="bd-row"><button class="key" type="submit" data-send>Send</button></div>
    <div class="bd-mform__out" data-out role="status"></div>
  </form>`;
  const form = host.querySelector<HTMLFormElement>("form")!;
  const sel = form.querySelector<HTMLSelectElement>("#wd-net")!;
  const to = form.querySelector<HTMLInputElement>("#wd-to")!;
  const amt = form.querySelector<HTMLInputElement>("#wd-amt")!;
  const all = form.querySelector<HTMLButtonElement>("[data-all]")!;
  const send = form.querySelector<HTMLButtonElement>("[data-send]")!;
  const out = form.querySelector<HTMLElement>("[data-out]")!;
  const say = (kind: "settled" | "awaiting" | "refused", html: string) => (out.innerHTML = `<p class="lamp lamp--${kind}">${html}</p>`);
  const have = () => readingFor(w)?.by[sel.value as EvmPayKey];

  const paint = () => {
    const n = sel.value as EvmPayKey;
    const net = PAY_NETWORKS[n];
    const b = have();
    const gas = form.querySelector<HTMLElement>("[data-gas]")!;
    const line = form.querySelector<HTMLElement>("[data-have]")!;
    all.hidden = !(b && Number(b.usd) > 0);
    gas.className = "small";
    if (b === undefined) {
      line.textContent = "Balance not read yet.";
      gas.textContent = "";
    } else if (b === null) {
      line.textContent = `The ${net.name} balance did not answer. Read it again under Funds.`;
      gas.textContent = "";
    } else {
      line.textContent = `${money(Number(b.usd))} ${net.asset} on ${net.name}.`;
      // No gas blocks the transfer, so it reads as a state (lamp and words), not as a plain note.
      const dry = !(Number(b.eth) > 0);
      if (dry) gas.className = "small lamp lamp--awaiting";
      gas.textContent = dry
        ? `No ${b.gas} on ${net.name} for gas, so a transfer cannot go through yet. Send a little ${b.gas} to the EVM address first.`
        : `Gas on hand: ${amount(b.eth)} ${b.gas}.`;
    }
  };

  sel.addEventListener("change", paint);
  all.addEventListener("click", () => {
    const b = have();
    if (b) amt.value = b.usd;
    amt.focus();
  });
  onReading(form, paint);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (held(send)) return;
    const n = sel.value as EvmPayKey;
    const net = PAY_NETWORKS[n];
    const dest = to.value.trim();
    const value = amt.value.trim().replace(",", ".");
    const b = have();
    // Each refusal names the field to fix, and the caret goes there.
    const bad: [string, HTMLElement] | null = !isAddress(dest, { strict: false })
      ? ["That is not an EVM address: 0x followed by 40 hex characters.", to]
      : dest.toLowerCase() === w.evm.toLowerCase()
        ? ["That is this wallet's own address.", to]
        : !(parseUsd(value) > 0)
          ? ["Enter an amount above $0, such as 5.00.", amt]
          : !/^\d*(\.\d{0,6})?$/.test(value)
            ? ["USDG and USDC go to 6 decimals at most.", amt]
            : b && Number(value) > Number(b.usd)
              ? [`That is more than the ${money(Number(b.usd))} read on ${net.name}.`, amt]
              : null;
    if (bad) {
      say("refused", esc(bad[0]));
      bad[1].focus();
      return;
    }
    const yes = await dialog({
      title: `Send ${value} ${net.asset} on ${net.name}?`,
      body: `<p>To <code class="bd-dialog__addr">${esc(dest)}</code></p><p>This is an ordinary transfer from the agent wallet. Once the network confirms it, nobody can reverse it.</p>`,
      actions: [{ label: `Send ${value} ${net.asset}`, value: "send", ink: true }],
    }).result;
    if (yes !== "send") return;
    hold(send, true);
    say("awaiting", `Signing and sending on ${net.name}…`);
    try {
      const hash = await withdraw(n, dest as Address, value);
      say("awaiting", `Sent to ${net.name}, waiting for it to confirm. ${link(n, hash)}`);
      try {
        const r = await publicClient(n).waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (r.status === "success") say("settled", `Confirmed in block ${r.blockNumber}. ${link(n, hash)}`);
        else say("refused", `The transfer reverted on-chain, so no ${net.asset} moved. The gas was spent. ${link(n, hash)}`);
      } catch {
        say("awaiting", `Not confirmed after two minutes. Check it on the explorer: ${link(n, hash)}`);
      }
      readFunds(w, true);
      onMoved();
    } catch (err) {
      say("refused", esc(transferText(err, n)));
    } finally {
      hold(send, false);
    }
  });
  paint();
}

function mountSwap(host: HTMLElement, w: Wallet, onMoved: () => void) {
  const first: NetworkKey = dataNetwork();
  const stable = (n: string) => (n === "base" ? "USDC" : "USDG");
  host.innerHTML = `
  <form class="face bd-mform" novalidate aria-labelledby="sw-h">
    <h3 id="sw-h">Swap</h3>
    <p class="small bd-mform__lead">Routed by KyberSwap on Robinhood Chain or Base, with at most 1% slippage. The wallet pays the gas in ETH.</p>
    <div class="field"><label class="label" for="sw-net">Network</label><select id="sw-net">${(["robinhood", "base"] as const).map((n) => `<option value="${n}"${n === first ? " selected" : ""}>${NETWORKS[n].name}</option>`).join("")}</select></div>
    <div class="bd-pair">
      <div class="field"><label class="label" for="sw-from">From</label><input id="sw-from" value="ETH" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
      <div class="field"><label class="label" for="sw-to">To</label><input id="sw-to" value="${stable(first)}" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
    </div>
    <div class="field"><label class="label" for="sw-amt">Amount of the From token</label><input id="sw-amt" class="bd-num" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
    <p class="small muted">A symbol (ETH, WETH, USDG, USDC, or a stock token such as TSLA on Robinhood Chain) or a 0x address.</p>
    <div class="bd-row"><button class="key" type="submit" data-get>Get a quote</button></div>
    <div data-quote></div>
  </form>`;
  const form = host.querySelector<HTMLFormElement>("form")!;
  const sel = form.querySelector<HTMLSelectElement>("#sw-net")!;
  const from = form.querySelector<HTMLInputElement>("#sw-from")!;
  const to = form.querySelector<HTMLInputElement>("#sw-to")!;
  const amt = form.querySelector<HTMLInputElement>("#sw-amt")!;
  const get = form.querySelector<HTMLButtonElement>("[data-get]")!;
  const box = form.querySelector<HTMLElement>("[data-quote]")!;
  let quote: SwapQuote | null = null;
  let expiry: number | undefined;

  sel.addEventListener("change", () => {
    if (to.value === stable(sel.value === "base" ? "robinhood" : "base")) to.value = stable(sel.value);
  });

  // The quote expires after 90 seconds (executeSwap refuses it then); the key says so when it happens.
  const paintQuote = () => {
    const q = quote;
    if (!q) return;
    const cap = limits().perSwap;
    const age = Date.now() - q.at;
    const focused = !!document.activeElement?.matches("[data-swap]") && box.contains(document.activeElement);
    const stop =
      age > QUOTE_LIFE
        ? "This quote is older than 90 seconds. Get a new one."
        : q.amountInUsd === null
          ? "Siro could not value this swap in USD, so the agent wallet will not send it."
          : q.amountInUsd > cap
            ? `${usd(q.amountInUsd)} is above your per-swap cap of ${usd(cap)}. Raise it in Caps.`
            : null;
    box.innerHTML = `
      <div class="display bd-quote">
        <div class="display__bar"><b>Quote</b><span>KyberSwap · ${new Date(q.at).toISOString().slice(11, 19)} UTC</span></div>
        <dl class="bd-quote__grid">
          <div><dt>You pay</dt><dd class="live-num">${esc(q.amountIn)}<small>${esc(q.tokenIn.symbol)}</small></dd><dd class="small">${q.amountInUsd ? usd(q.amountInUsd) : "no USD price"}</dd></div>
          <div><dt>You get about</dt><dd class="live-num">${esc(amount(q.amountOut))}<small>${esc(q.tokenOut.symbol)}</small></dd><dd class="small">${q.amountOutUsd ? usd(q.amountOutUsd) : "no USD price"}</dd></div>
          <div><dt>Cost</dt><dd>${q.impactPct !== null ? `${q.impactPct}% in fees and impact` : "impact unknown"}</dd><dd class="small">gas ${q.gasUsd ? usd(q.gasUsd) : "unknown"}</dd></div>
        </dl>
        <p class="lamp ${stop ? "lamp--refused" : "lamp--settled"} bd-quote__cap" id="sw-cap">${esc(stop ?? `Within your per-swap cap of ${usd(cap)}.`)}</p>
      </div>
      <div class="bd-row"><button class="key" type="button" data-swap aria-describedby="sw-cap"${stop ? ' aria-disabled="true"' : ""}>Swap now</button><span class="small muted">A quote holds for 90 seconds.</span></div>
      <div data-swap-out role="status"></div>`;
    // Expiry redraws the panel; a keyboard user on Swap now stays on it.
    if (focused) box.querySelector<HTMLElement>("[data-swap]")?.focus();
    clearTimeout(expiry);
    if (age <= QUOTE_LIFE) expiry = window.setTimeout(paintQuote, QUOTE_LIFE - age + 50);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (held(get)) return;
    const value = amt.value.trim().replace(",", ".");
    clearTimeout(expiry);
    quote = null;
    if (!(parseUsd(value) > 0)) {
      box.innerHTML = `<p class="lamp lamp--refused" role="status">Enter an amount above zero.</p>`;
      amt.focus();
      return;
    }
    hold(get, true);
    box.innerHTML = `<p class="lamp bd-quiet" role="status">Finding a route…</p>`;
    try {
      quote = await getSwapQuote(sel.value as NetworkKey, from.value, to.value, value);
      paintQuote();
    } catch (err) {
      box.innerHTML = `<p class="lamp lamp--refused" role="status">${esc(payText(err))}</p>`;
    } finally {
      hold(get, false);
    }
  });

  box.addEventListener("click", async (e) => {
    const key = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-swap]");
    const q = quote;
    if (!key || held(key) || !q) return;
    const yes = await dialog({
      title: `Swap ${q.amountIn} ${q.tokenIn.symbol} for about ${amount(q.amountOut)} ${q.tokenOut.symbol}?`,
      body: `<p>On ${NETWORKS[q.network].name}, routed by KyberSwap. If the price moves more than 1% before it lands, the swap reverts and only the gas is spent.</p>`,
      actions: [{ label: "Swap now", value: "swap", ink: true }],
    }).result;
    if (yes !== "swap") return;
    const out = box.querySelector<HTMLElement>("[data-swap-out]")!;
    clearTimeout(expiry);
    hold(key, true);
    try {
      const r = await doSwap(q, { kind: "agent" }, (s) => (out.innerHTML = `<p class="lamp lamp--awaiting">${STEP[s] ?? "Swapping…"}</p>`));
      out.innerHTML = `<p class="lamp lamp--settled">Swapped. ${link(q.network, r.tx)}</p>`;
      quote = null;
      readFunds(w, true);
      onMoved();
    } catch (err) {
      out.innerHTML = `<p class="lamp lamp--refused">${esc(payText(err))}</p>`;
      // Still fresh: the same quote may be tried again until it expires, when the panel says so.
      const left = q.at + QUOTE_LIFE - Date.now();
      hold(key, left <= 0);
      if (left > 0) expiry = window.setTimeout(paintQuote, left + 50);
    }
  });
}

export function mountMove(host: HTMLElement, w: Wallet, onMoved: () => void) {
  host.innerHTML = `<div class="bd-move"><div data-withdraw></div><div data-swap-form></div></div>`;
  mountWithdraw(host.querySelector<HTMLElement>("[data-withdraw]")!, w, onMoved);
  mountSwap(host.querySelector<HTMLElement>("[data-swap-form]")!, w, onMoved);
}
