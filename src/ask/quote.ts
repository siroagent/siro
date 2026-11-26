// The quote strip: one faceplate per proposal. It is drawn from data every time, so it can change
// in place (open, paying, settled, declined, failed) and judge itself against the live caps.
import { CATEGORIES, NETWORKS, PAY_NETWORKS, byId, formatPrice, logoOf, type PayNetworkKey } from "../../shared/catalog";
import { esc } from "../shell";
import { assetOn, money, short, txUrl } from "./format";
import { payingAddress, type PayEnv } from "./payer";
import type { Issue, Msg, Proposal, Quote } from "./store";

/** Problems that block Approve, read from the live state. Funds and price problems only show after a try. */
export function preflight(q: Quote, env: PayEnv): Issue | null {
  const p = q.p;
  if (env.payer === "agent" && !env.budget) return "no_budget";
  if (env.payer === "connected" && !env.wallet) return "no_wallet";
  if (p.kind === "swap") {
    if (env.payer !== "agent" || !q.sq) return null;
    if (!q.sq.amountInUsd) return "no_usd";
    return q.sq.amountInUsd > env.limits.perSwap + 1e-9 ? "over_swap" : null;
  }
  if (env.payer === "connected" && env.network === "solana") return "wallet_solana";
  if (p.kind === "resource" && byId(p.resource)?.slow && env.network === "solana") return "slow_solana";
  const usd = Number(p.price);
  if (env.payer === "agent" && Number.isFinite(usd)) {
    if (usd > env.limits.perPayment + 1e-9) return "over_call";
    if (env.spent + usd > env.limits.perDay + 1e-9) return "over_day";
  }
  return null;
}

const issueOf = (q: Quote, env: PayEnv) => preflight(q, env) ?? (q.issue === "funds" || q.issue === "price" ? q.issue : null);
const blocks = (i: Issue | null) => !!i && i !== "funds" && i !== "price";

export function quoteHtml(m: Msg, env: PayEnv): string {
  const q = m.quote!;
  return `<article class="quote face" data-state="${q.state}" aria-labelledby="qn-${m.id}">
    ${top(q, m.id)}
    ${body(q)}
    <div class="quote__foot">
      ${q.state === "open" || q.state === "busy" ? `<p class="quote__net">${esc(route(q, env))}</p>` : ""}
      <div class="quote__status" id="qs-${m.id}" tabindex="-1">${status(q, env, m.id)}</div>
      ${keys(q, env, m.id)}
    </div>
  </article>`;
}

/** One line for the screen-reader status region. */
export function quoteSay(m: Msg, env: PayEnv): string {
  const q = m.quote!;
  const t = document.createElement("div");
  t.innerHTML = status(q, env, m.id);
  const words = t.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (q.state !== "open") return words;
  const price = q.p.kind === "swap" ? "" : ` ${Number.isFinite(Number(q.p.price)) ? formatPrice(q.p.price) : "price set at payment"}.`;
  return `Quote: ${name(q.p)}.${price} ${words} Approve or decline.`;
}

const name = (p: Proposal) => (p.kind === "swap" ? `Swap ${p.from} for ${p.to}` : p.name);

function top(q: Quote, id: string) {
  const p = q.p;
  const heading = `<h3 class="quote__name" id="qn-${id}">${esc(name(p))}</h3>`;
  if (p.kind === "resource") {
    const r = byId(p.resource);
    const meta = [r?.provider, r ? CATEGORIES[r.category] : p.category].filter(Boolean).map((s) => esc(s)).join(" · ");
    return `<div class="quote__top">
      <span class="quote__logo"><img src="${logoOf(p.resource)}" width="22" height="22" alt="" loading="lazy" decoding="async"></span>
      <div class="quote__id">${heading}<p class="quote__meta">${meta}<code>POST /v1/${esc(p.resource)}</code></p></div>
      ${price(p.price, q.was ? "quoted by the server" : "price list")}
    </div>`;
  }
  if (p.kind === "external") {
    let host = p.url;
    try {
      host = new URL(p.url).host;
    } catch {
      /* keep the raw url */
    }
    return `<div class="quote__top quote__top--bare">
      <div class="quote__id">${heading}<p class="quote__meta">Third-party x402 service<code>${esc(p.method)} ${esc(host)}</code></p></div>
      ${price(p.price, q.was ? "quoted by the service" : "listed by the service")}
    </div>`;
  }
  const usd = q.sq?.amountInUsd;
  return `<div class="quote__top quote__top--bare">
    <div class="quote__id">${heading}<p class="quote__meta">KyberSwap route on ${NETWORKS[p.network].name} · 1% max slippage</p></div>
    ${usd ? `<p class="quote__price"><span class="live-num">${money(usd)}</span><span class="quote__src">what you pay, valued by KyberSwap</span></p>` : ""}
  </div>`;
}

function price(p: string, src: string) {
  if (!Number.isFinite(Number(p))) return `<p class="quote__price"><span class="quote__src">The service sets the price when it is paid</span></p>`;
  return `<p class="quote__price"><span class="live-num">${formatPrice(p)}<small>per call</small></span><span class="quote__src">${esc(src)}</span></p>`;
}

function body(q: Quote) {
  const p = q.p;
  if (p.kind === "swap") {
    const sq = q.sq;
    if (!sq) return `<dl class="quote__input"><dt>pay</dt><dd>${esc(p.amount)} ${esc(p.from)}</dd><dt>for</dt><dd>${esc(p.to)}</dd></dl>`;
    const amt = (v: string) => Number(v).toLocaleString("en-US", { maximumSignificantDigits: 6 });
    return `<div class="squote quote__swap">
      <div><span>Pay</span><b>${amt(sq.amountIn)} ${esc(sq.tokenIn.symbol)}</b><small>${sq.amountInUsd ? money(sq.amountInUsd) : "USD value unknown"}</small></div>
      <div><span>Get about</span><b>${amt(sq.amountOut)} ${esc(sq.tokenOut.symbol)}</b><small>${sq.amountOutUsd ? money(sq.amountOutUsd) : "USD value unknown"}</small></div>
      <div><span>Route cost</span><b>${sq.impactPct !== null ? `${sq.impactPct}%` : "unknown"}</b><small>${sq.gasUsd ? `gas ${money(sq.gasUsd)}` : "gas unknown"}</small></div>
    </div>`;
  }
  const rows = Object.entries(p.input ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const input = rows.length
    ? `<dl class="quote__input">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(clip(typeof v === "string" ? v : JSON.stringify(v)))}</dd>`).join("")}</dl>`
    : "";
  return p.kind === "external" && p.description ? `<p class="quote__desc">${esc(clip(p.description))}</p>${input}` : input;
}

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function route(q: Quote, env: PayEnv) {
  // With no Budget or no connected wallet yet, the line names no payer; the status below says what is missing.
  const from = env.payer === "agent" ? (env.budget ? "your Budget" : null) : env.wallet ? `your wallet (${env.wallet.name})` : null;
  const p = q.p;
  if (p.kind === "swap") return `Sent${from ? ` from ${from}` : ""} on ${NETWORKS[p.network].name}. Gas is paid in ETH.`;
  if (p.kind === "external") return `Pays in ${assetOn(env.network)} if the service takes it, else on another network it lists.${from ? ` From ${from}.` : ""}`;
  return `Pays in ${assetOn(env.network)}${from ? `, from ${from}` : ""}.`;
}

const lamp = (tone: "settled" | "awaiting" | "refused" | "", text: string) => `<p class="lamp${tone ? ` lamp--${tone}` : ""}">${esc(text)}</p>`;
const note = (text: string) => `<p class="quote__note">${esc(text)}</p>`;
const fix = (inner: string) => `<div class="quote__fix">${inner}</div>`;
const act = (action: string, label: string, id: string, value = "") =>
  `<button class="key key--sm" type="button" data-act="${action}" data-mid="${id}"${value ? ` data-value="${esc(value)}"` : ""}>${esc(label)}</button>`;
const go = (href: string, label: string) => `<a class="key key--sm" href="${href}">${esc(label)}</a>`;
const netName = (n: PayNetworkKey) => PAY_NETWORKS[n].name;

function status(q: Quote, env: PayEnv, id: string): string {
  switch (q.state) {
    case "open":
      return openStatus(q, env, id);
    case "busy":
      return lamp("awaiting", busyText(q, env));
    case "settled":
      return settledStatus(q);
    case "declined":
      return q.why === "replaced"
        ? lamp("", "Not approved. Nothing was signed.") + note("A newer quote replaced this one.")
        : lamp("", "Declined. Nothing was signed.") + (q.why === "wallet" ? note("You rejected the signature in your wallet.") : "");
    case "failed":
      return failedStatus(q);
  }
}

function openStatus(q: Quote, env: PayEnv, id: string) {
  const issue = issueOf(q, env);
  if (issue) return issueStatus(issue, q, env, id);
  let html: string;
  const p = q.p;
  const l = env.limits;
  if (env.payer === "connected") html = lamp("", p.kind === "swap" ? "Your wallet asks you to confirm. Budget caps do not apply." : "Your wallet asks you to sign. Budget caps do not apply.");
  else if (p.kind === "swap") html = lamp("settled", `Within your ${money(l.perSwap)} per-swap cap.`);
  else if (!Number.isFinite(Number(p.price))) {
    html = lamp("awaiting", `Your caps still hold when the service names its price: ${money(l.perPayment)} a call, ${money(l.perDay)} a day.`);
    if (l.autopay && env.budget && !q.manual) html += note("Autopay only pays quotes with a listed price, so this one waits for you.");
  } else {
    const usd = Number(p.price);
    html = lamp("settled", `Within your caps: ${money(usd)} of ${money(l.perPayment)} a call, ${money(env.spent + usd)} of ${money(l.perDay)} today.`);
  }
  if (q.detail) html += note(q.detail);
  if (q.manual) html += note("Autopay pays one quote per message you send, so this one waits for you.");
  if (env.paying && env.paying !== id) html += note("Another payment is running. Approve this one when it finishes.");
  return html;
}

function issueStatus(issue: Issue, q: Quote, env: PayEnv, id: string) {
  const l = env.limits;
  const p = q.p;
  const usd = p.kind === "swap" ? (q.sq?.amountInUsd ?? 0) : Number(p.price);
  switch (issue) {
    case "no_budget":
      return (
        lamp("refused", "No Budget on this device yet.") +
        note("A Budget is a key kept in this browser, with a cap per call and a cap per day. Create one, or pay from your own wallet. This quote waits here.") +
        fix(go("/budget", "Create a Budget") + act("use-wallet", p.kind === "swap" ? "Swap with my wallet" : "Pay with my wallet", id))
      );
    case "no_wallet":
      return (
        lamp("refused", "No wallet connected.") +
        note(`Connect a wallet to sign this ${p.kind === "swap" ? "swap" : "payment"}, or use your Budget.`) +
        fix(act("connect", "Connect wallet", id) + (env.budget ? act("use-budget", "Pay with Budget", id) : go("/budget", "Create a Budget")))
      );
    case "wallet_solana":
      return (
        lamp("refused", "A connected wallet pays on EVM networks only.") +
        note(`Pay this on ${netName(env.evm)}, or from your Budget, which also pays on Solana.`) +
        fix(act("use-net", `Use ${netName(env.evm)}`, id, env.evm) + act("use-budget", "Pay with Budget", id))
      );
    case "slow_solana":
      return (
        lamp("refused", "Not payable on Solana.") +
        note("Video and music tools take minutes, and a signed Solana payment expires in about a minute, so they are paid on EVM networks.") +
        fix(act("use-net", `Use ${netName(env.evm)}`, id, env.evm))
      );
    case "over_call":
      return (
        lamp("refused", `Over your ${money(l.perPayment)} per-call cap.`) +
        note(`This call costs ${money(usd)}. Siro refuses before signing. If you want it, raise the cap in Budget and approve here. Ask never changes caps.`) +
        fix(go("/budget#caps", "Change caps in Budget"))
      );
    case "over_day":
      return (
        lamp("refused", `Over today's cap: ${money(env.spent)} of ${money(l.perDay)} spent.`) +
        note(`This call would bring today to ${money(env.spent + usd)}. Raise the daily cap in Budget, or approve it tomorrow. Ask never changes caps.`) +
        fix(go("/budget#caps", "Change caps in Budget"))
      );
    case "over_swap":
      return (
        lamp("refused", `Over your ${money(l.perSwap)} per-swap cap.`) +
        note(`This swap is worth ${money(usd)}. Raise the cap in Budget, or swap from your own wallet.`) +
        fix(go("/budget#caps", "Change caps in Budget") + act("use-wallet", "Swap with my wallet", id))
      );
    case "no_usd":
      return (
        lamp("refused", "No USD value for this swap.") +
        note("The Budget only sends swaps it can check against its cap. Swap from your own wallet instead.") +
        fix(act("use-wallet", "Swap with my wallet", id))
      );
    case "funds": {
      const addr = p.kind === "swap" ? (env.payer === "agent" ? env.budget : (env.wallet?.address ?? null)) : payingAddress(env);
      const what = p.kind === "swap" ? (q.detail ?? "Not enough funds for this swap.") : `Not enough ${assetOn(env.network)}.`;
      const ask = p.kind === "swap" ? "Fund this address, then approve again." : `Send ${assetOn(env.network)} to this address, then approve again. Nothing was settled.`;
      return lamp("refused", what) + note(ask) + (addr ? `<p class="quote__addr">${esc(addr)}</p>${fix(act("copy", "Copy address", id, addr))}` : "");
    }
    case "price":
      if (p.kind === "swap") return "";
      return lamp("awaiting", `The price is now ${formatPrice(p.price)}${q.was ? `, not ${formatPrice(q.was)}` : ""}.`) + note("Nothing was signed. Approve again if the new price is fine.");
  }
}

function busyText(q: Quote, env: PayEnv) {
  const p = q.p;
  const wallet = env.payer === "connected";
  switch (q.step) {
    case "route":
      return "Getting a route from KyberSwap.";
    case "approving":
      return "Approving the token for the route. Confirm in your wallet if it asks.";
    case "building":
      return "Building the swap.";
    case "swapping":
      return wallet ? "Confirm the swap in your wallet." : "Sending the swap.";
  }
  if (p.kind === "swap") return "Sending the swap.";
  if (wallet) return "Sign the payment in your wallet. It settles only when the result comes back.";
  if (p.kind === "external") return "Paying the service and waiting for its answer.";
  return byId(p.resource)?.slow
    ? `Running ${p.name}. This tool takes minutes, so keep this tab open. It settles only when the result comes back.`
    : `Running ${p.name}. It settles only when the result comes back.`;
}

function settledStatus(q: Quote) {
  const r = q.receipt;
  if (!r || r.free) return lamp("settled", "Done.") + note("The service answered without asking for a payment.");
  const where = PAY_NETWORKS[r.network]?.name ?? r.network;
  const tx = r.tx ? `<p><a class="quote__tx" href="${txUrl(r.network, r.tx)}" target="_blank" rel="noopener noreferrer">Transaction ${esc(short(r.tx))}</a></p>` : "";
  if (q.p.kind === "swap") {
    const sq = q.sq;
    const what = sq ? `${sq.amountIn} ${sq.tokenIn.symbol} for at least ${r.min ? Number(r.min).toLocaleString("en-US", { maximumSignificantDigits: 6 }) : sq.amountOut} ${sq.tokenOut.symbol} on ${where}.` : `On ${where}.`;
    return lamp("settled", "Swapped") + note(what) + tx;
  }
  const amount = `${r.usd !== null ? money(r.usd) : ""} ${r.asset ?? PAY_NETWORKS[r.network]?.asset ?? ""} on ${where}.`.trim();
  if (r.pending) return lamp("awaiting", "Pending") + note(`${amount} Sent to the chain, not confirmed yet. The result is below.`) + tx;
  return lamp("settled", "Settled") + note(amount) + (tx || note("The service sent no transaction hash."));
}

function failedStatus(q: Quote) {
  const p = q.p;
  const detail = q.detail ? note(q.detail) : "";
  if (p.kind === "swap") {
    if (q.why === "no_route") return lamp("refused", "No swap route.") + (detail || note("KyberSwap returned no route for this pair and amount."));
    if (q.why === "interrupted") return lamp("refused", "This page closed while the swap ran.") + note("Check your wallet's history before you swap again.");
    return lamp("refused", "The swap did not complete.") + detail;
  }
  if (p.kind === "external") {
    const head = q.why === "interrupted" ? "This page closed while the payment ran." : q.why === "network" ? "No answer came back: the connection dropped." : "The service returned no result.";
    return lamp("refused", head) + detail + note("Third-party services settle on their own terms. If this one charged, the transfer shows in the paying address's history.");
  }
  if (q.why === "network") return lamp("refused", "No result came back: the connection dropped.") + note("If a payment settled anyway, Activity lists it with its transaction hash.");
  if (q.why === "interrupted") return lamp("refused", "This page closed while the payment ran.") + note("If it settled, Activity lists it with its transaction hash. Check before you try again.");
  return lamp("refused", "No result, no charge. Nothing was settled.") + detail;
}

function keys(q: Quote, env: PayEnv, id: string) {
  if (q.state === "open") {
    const stop = blocks(issueOf(q, env)) || (env.paying !== null && env.paying !== id);
    const label = q.p.kind === "swap" ? "Approve and swap" : Number.isFinite(Number(q.p.price)) ? `Approve and pay ${formatPrice(q.p.price)}` : "Approve and pay";
    return `<div class="quote__keys">
      <button class="key" type="button" data-act="decline" data-mid="${id}">Decline</button>
      <button class="key${stop ? "" : " key--ink"}" type="button" data-act="approve" data-mid="${id}"${stop ? ` disabled aria-describedby="qs-${id}"` : ""}>${esc(label)}</button>
    </div>`;
  }
  if (q.state === "failed") {
    const again = q.p.kind === "swap" ? act("requote", "Get a new quote", id) : act("retry", "Try again", id);
    // Activity lists Siro's own settlements, so it only helps for a Siro tool.
    const check = q.p.kind === "resource" && (q.why === "network" || q.why === "interrupted") ? go("/activity", "Check Activity") : "";
    return `<div class="quote__keys">${check}${again}</div>`;
  }
  return "";
}
