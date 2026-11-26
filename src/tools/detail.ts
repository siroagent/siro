// /tools/:id: one tool as a spec sheet. The price with a live 402 quote, the input table, what comes
// back, code to call it, and the Run deck that pays from Budget or a browser wallet.
import { CATEGORIES, PAY_KEYS, PAY_NETWORKS, RESOURCES, formatPrice, toUnits, isPayKey, logoOf, payNetworkOf, type Field, type PayNetworkKey, type Resource } from "../../shared/catalog";
import { PayError, agentAccount, agentAddresses, callFree, callResource, forgetResult, connect, connectedWallet, holderInfo, payingAddress, dataNetwork, injectedWallets, liveNetworks, liveNetworkText, liveSelect, netOptions, network, setNetwork, spentToday, type Receipt } from "../lib/pay";
import { pickWallet } from "../lib/walletpick";
import { FREE_TOOLS, TIERS, discounted } from "../../shared/holder";
import { RESULT_TTL_DAYS } from "../../shared/privacy";

/** A stablecoin amount to its last unit: 750 units is $0.00075, never rounded up to $0.0008. Two decimals at least. */
function exactUsd(units: bigint) {
  const whole = units / 1_000_000n;
  let frac = (units % 1_000_000n).toString().padStart(6, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `$${whole.toLocaleString("en-US")}.${frac}`;
}
import { renderResult } from "../lib/render";
import { esc, openSearch, quietAsk, toast } from "../shell";
import { caps } from "./caps";
import { duration, either, money, short, utc } from "./format";
import { readLiveOne } from "./live";
import { QuoteError, liveQuote, type LiveQuote } from "./quote";
import { cliSnippet, curlSnippet, exampleInput, mcpSnippet } from "./snippets";

const EVM: PayNetworkKey[] = PAY_KEYS.filter((k) => PAY_NETWORKS[k].vm === "evm");
const SITE = "https://siroagent.com";

// Codes the server gives a bad input. x402fetch stops on them before anything is signed.
const INPUT_ERRORS = new Set(["missing_field", "invalid_field", "invalid_url", "field_too_long", "invalid_body", "invalid_json", "invalid_network", "invalid_address", "invalid_input"]);

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const names = (keys: PayNetworkKey[]) => either(keys.map((k) => PAY_NETWORKS[k].name));
const sentence = (s: string) => {
  const t = s.trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
};

function setHead(title: string, description: string, path: string) {
  document.title = title;
  const set = (selector: string, attr: string, value: string) => document.head.querySelector(selector)?.setAttribute(attr, value);
  set('meta[name="description"]', "content", description);
  set('meta[property="og:title"]', "content", title);
  set('meta[property="og:description"]', "content", description);
  set('meta[property="og:url"]', "content", `${SITE}${path}`);
  set('link[rel="canonical"]', "href", `${SITE}${path}`);
}

// Back to the list the visitor came from, filters and all.
function backHref() {
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && from.pathname.replace(/\/$/, "") === "/tools") return `/tools${from.search}`;
  } catch {
    /* no referrer */
  }
  return "/tools";
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Copy did not work here. Select the text and copy it by hand.");
  }
}

function typeOf(f: Field) {
  if (f.options) return `one of ${f.options.map((o) => `<code class="inline">${esc(o)}</code>`).join(" ")}`;
  if (f.type === "number") return f.max ? `number, up to ${f.max}` : "number";
  if (f.type === "address") return "address, 0x…";
  if (f.type === "url") return "https:// link";
  return f.max ? `text, up to ${f.max.toLocaleString("en-US")} characters` : "text";
}

function inputTable(r: Resource) {
  return `
<section class="tl-spec tl-spec--in" aria-labelledby="in-h">
  <h2 class="h3" id="in-h">Input</h2>
  <p class="tl-spec__lede">Send a JSON body with these fields. Input is checked before any payment, so a bad request is never charged.</p>
  <table class="table tl-fields">
    <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Required</th><th scope="col">Description</th></tr></thead>
    <tbody>${r.fields
      .map((f) => `<tr><td class="tl-f-name"><code>${esc(f.name)}</code></td><td class="tl-f-type">${typeOf(f)}</td><td class="tl-f-req">${f.required ? "required" : "optional"}</td><td class="tl-f-desc">${esc(f.description)}</td></tr>`)
      .join("")}</tbody>
  </table>
</section>`;
}

function deckField(f: Field) {
  const id = `in-${f.name}`;
  const label = `<span><code>${esc(f.name)}</code> ${f.required ? "required" : "optional"}</span>`;
  const req = f.required ? " required" : "";
  const example = f.example !== undefined ? String(f.example) : "";
  if (f.options) {
    const opts = `${f.required ? "" : '<option value="">Default</option>'}${f.options.map((o) => `<option${example === o ? " selected" : ""}>${esc(o)}</option>`).join("")}`;
    return `<label class="field" for="${id}">${label}<select id="${id}" name="${esc(f.name)}"${req}>${opts}</select></label>`;
  }
  const hint = !f.required && example ? ` placeholder="${esc(`e.g. ${example}`)}"` : "";
  if (f.type === "string" && (f.max ?? 0) > 300) return `<label class="field" for="${id}">${label}<textarea id="${id}" name="${esc(f.name)}" rows="3" maxlength="${f.max}"${hint}${req}>${f.required ? esc(example) : ""}</textarea></label>`;
  const kind = f.type === "number" ? ` type="number" min="1" step="1" inputmode="numeric"${f.max ? ` max="${f.max}"` : ""}` : f.type === "url" ? ' type="url" inputmode="url"' : ` type="text"${f.max ? ` maxlength="${f.max}"` : ""}`;
  return `<label class="field" for="${id}">${label}<input id="${id}" name="${esc(f.name)}"${kind} value="${f.required ? esc(example) : ""}"${hint} autocomplete="off" spellcheck="false"${f.type === "address" ? ' class="mono"' : ""}${req}></label>`;
}

// One block per line of code, so a line that wraps continues two characters in from its own indent
// instead of at the left edge, and a shell line's closing " \" never wraps onto a line of its own.
// The Copy key copies the snippet text, not this markup.
const codeLines = (text: string) =>
  text
    .split("\n")
    .map((line) => {
      const body = line.trimStart();
      const html = body.endsWith(" \\") ? `${esc(body.slice(0, -2))}<span class="tl-nw"> \\</span>` : esc(body) || " ";
      return `<span class="tl-ln" style="--i:${line.length - body.length}">${html}</span>`;
    })
    .join("");

function view(r: Resource) {
  const price = formatPrice(r.price);
  const input = exampleInput(r);
  const pre = (id: string, text: string, extra = "") => `<div class="tl-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0"${id === "curl" ? "" : " hidden"}><pre class="tl-pre">${codeLines(text)}</pre>${extra}</div>`;
  return `
<div class="wrap tl-detail">
  <div class="tl-sheet">
    <header class="tl-head">
      <a class="tl-back" href="${esc(backHref())}">All tools</a>
      <p class="tl-head__maker"><img src="${logoOf(r.id)}" width="24" height="24" alt=""><span>${esc(r.provider)} · <a href="/tools?c=${r.category}">${CATEGORIES[r.category]}</a> · ${r.slow ? "takes minutes" : "takes seconds"}</span></p>
      <h1>${esc(r.name)}</h1>
      <p class="lede">${esc(r.summary)}</p>
    </header>

    <section class="face tl-quote" aria-labelledby="quote-h">
      <div class="display">
        <div class="display__bar"><b id="quote-h">Price per call</b><span id="quote-src">price list</span></div>
        <div class="tl-quote__read">
          <p class="live-num tl-quote__price" id="quote-price">${price}<small>USD</small></p>
          <p class="tl-quote__nets" id="quote-nets">Paid in USD stablecoins.</p>
          <dl class="tl-quote__facts" id="quote-facts" hidden></dl>
          <p class="small tl-quote__note" id="quote-note" aria-live="polite">An unpaid call returns this price and runs nothing.</p>
        </div>
      </div>
      <div class="tl-quote__foot">
        <code class="tl-quote__path">x402 v2 · POST /v1/${r.id}</code>
        <button class="key" type="button" id="quote-go">Get live quote</button>
      </div>
    </section>

    <form class="face tl-deck" id="deck" aria-labelledby="deck-h">
      <div class="display tl-deck__display">
        <div class="display__bar"><b id="deck-h">Run</b><span>${price} a call</span></div>
        <div class="tl-deck__body">
          <fieldset class="tl-deck__inputs" id="deck-inputs"><legend class="sr">Input</legend>${r.fields.map(deckField).join("")}</fieldset>
          <div class="tl-deck__pay">
            <fieldset class="tl-seg" id="payer">
              <legend>Pays with</legend>
              <div class="tl-seg__tray">
                <label><input type="radio" name="payer" value="agent"><span>Budget</span></label>
                <label><input type="radio" name="payer" value="connected"><span>My wallet</span></label>
              </div>
            </fieldset>
            <p class="tl-who" id="who"></p>
            <p class="tl-who tl-holder" id="holder" hidden></p>
            <label class="field" for="net"><span>Pay on</span><select id="net"></select></label>
            ${r.slow ? '<p class="tl-who">Quoted on EVM networks only: a signed Solana payment expires before a render this long finishes.</p>' : ""}
          </div>
        </div>
        <p class="tl-verdict" id="verdict" aria-live="polite"></p>
      </div>
      <div class="tl-deck__foot">
        <button class="key key--ink tl-pay" type="submit" id="pay" aria-describedby="verdict" data-quiet-ask>Pay ${price} and run</button>
        ${FREE_TOOLS.includes(r.id) ? '<button class="key tl-free" type="button" id="free">Run free as a $SIRO holder</button>' : ""}
        <p class="small tl-deck__note" id="note" aria-live="polite">Nothing is signed until you press Pay.</p>
        <div class="display tl-receipt" id="receipt" hidden></div>
      </div>
    </form>

    <section class="paper tl-result" id="result" aria-labelledby="result-h" hidden>
      <div class="tl-result__head"><h2 class="h3" id="result-h">Result</h2><p class="label" id="result-meta"></p></div>
      <div class="tl-result__body" id="result-body"></div>
    </section>

    ${inputTable(r)}

    <section class="tl-spec tl-spec--out" aria-labelledby="out-h">
      <h2 class="h3" id="out-h">Returns</h2>
      <p class="tl-spec__lede">A paid call answers <code class="inline">{ resource, result, receipt }</code>. The receipt carries the network, amount and transaction hash; <code class="inline">result</code> looks like this:</p>
      <code class="tl-returns">${esc(r.returns)}</code>
    </section>

    <section class="tl-code" aria-labelledby="code-h">
      <h2 class="h3" id="code-h">Call it from code</h2>
      <div class="display">
        <div class="display__bar">
          <div class="tl-tabs" role="tablist" aria-label="Ways to call ${esc(r.name)}" id="code-tabs">
            <button type="button" role="tab" id="tab-curl" aria-controls="panel-curl" aria-selected="true">curl</button><button type="button" role="tab" id="tab-cli" aria-controls="panel-cli" aria-selected="false" tabindex="-1">CLI</button><button type="button" role="tab" id="tab-mcp" aria-controls="panel-mcp" aria-selected="false" tabindex="-1">MCP</button>
          </div>
          <button class="key key--sm" type="button" id="code-copy">Copy curl</button>
        </div>
        ${pre("curl", curlSnippet(r, input), '<p class="tl-panel__note">Without a payment the answer is <code>402</code> with the quote in the <code>PAYMENT-REQUIRED</code> header. Sign it and send the same request with <code>PAYMENT-SIGNATURE</code>. <a href="/docs#quickstart">Quickstart</a></p>')}
        ${pre("cli", cliSnippet(r, input), '<p class="tl-panel__note">The CLI asks before each payment unless you add <code>--yes</code>, and holds to the caps you set with <code>siro limits</code>. <a href="/docs#cli">CLI docs</a></p>')}
        ${pre("mcp", mcpSnippet(r, input), `<p class="tl-panel__note">Local: <code>siro mcp</code> pays from the CLI wallet within its caps. Remote: <code>${SITE}/mcp</code> returns the payment requirements until <code>params._meta["x402/payment"]</code> carries a signed payment. <a href="/docs#mcp">MCP docs</a></p>`)}
      </div>
    </section>
  </div>
</div>`;
}

function wireQuote(r: Resource) {
  const go = el<HTMLButtonElement>("quote-go");
  const note = el("quote-note");
  const nets = el("quote-nets");
  const facts = el("quote-facts");
  const listed = Number(r.price);
  let busy = false;

  liveNetworks().then((keys) => {
    const usable = r.slow ? keys.filter((k) => PAY_NETWORKS[k].vm === "evm") : keys;
    nets.textContent = `Paid in ${liveNetworkText(usable)}.`;
  });

  // A failed retry must not leave an older quote on the display under "Showing the price list".
  const priceList = () => {
    el("quote-src").textContent = "price list";
    el("quote-price").innerHTML = `${formatPrice(r.price)}<small>USD</small>`;
    facts.hidden = true;
    nets.hidden = false;
  };

  const paint = (q: LiveQuote) => {
    el("quote-src").textContent = `quoted ${utc(q.at, true)}`;
    el("quote-price").innerHTML = `${money(q.usd)}<small>USD</small>`;
    const payTo = q.payTo.map((p) => `<span class="mono">${esc(short(p.address))}</span>${q.payTo.length > 1 ? ` on ${names(p.networks)}` : ""}`).join("<br>");
    facts.innerHTML = [
      ["Pays on", esc(liveNetworkText(q.networks))],
      ["Pays to", payTo],
      ["Payment window", q.windows.map((w) => `${w.seconds} s${q.windows.length > 1 ? ` on ${names(w.networks)}` : ""}`).join("<br>")],
      ["Round trip", `<span class="live-num">${q.ms}<small>ms</small></span> from this browser`],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join("");
    facts.hidden = false;
    nets.hidden = true;
    const same = Math.abs(q.usd - listed) < 1e-9;
    note.textContent = `${same ? "Matches the price list. Nothing was charged." : `The price list says ${formatPrice(r.price)}. The Run deck pays only the listed price, so it would stop before signing.`}${q.inputError ? ` The example input was refused: ${sentence(q.inputError)}` : ""}`;
  };

  go.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.setAttribute("aria-disabled", "true");
    go.textContent = "Asking…";
    note.textContent = "Asking the server for a quote. Nothing is charged.";
    const slow = setTimeout(() => (note.textContent = "Still waiting. The server is warming up."), 2000);
    let failed = false;
    try {
      paint(await liveQuote(r.id, exampleInput(r)));
    } catch (e) {
      failed = true;
      priceList();
      const qe = e instanceof QuoteError ? e : new QuoteError("unknown", "No quote came back.");
      const why =
        qe.code === "payments_not_configured"
          ? "The server is not taking payments yet, so it sent no quote."
          : qe.code === "not_live"
            ? `${r.name} is listed but not switched on yet, so it has no quote.`
            : sentence(qe.message);
      note.textContent = `${why} Showing the price list.`;
    } finally {
      clearTimeout(slow);
      busy = false;
      go.removeAttribute("aria-disabled");
      go.textContent = failed ? "Retry" : "Get live quote";
    }
  });
}

function wireCode(r: Resource) {
  const input = exampleInput(r);
  const kinds = [
    { id: "curl", copy: "Copy curl", done: "Copied the curl command.", text: curlSnippet(r, input) },
    { id: "cli", copy: "Copy CLI", done: "Copied the CLI commands.", text: cliSnippet(r, input) },
    { id: "mcp", copy: "Copy MCP", done: "Copied the MCP request.", text: mcpSnippet(r, input) },
  ];
  const tabs = kinds.map((k) => el<HTMLButtonElement>(`tab-${k.id}`));
  const copy = el<HTMLButtonElement>("code-copy");
  let at = 0;
  const select = (i: number, focus = false) => {
    at = i;
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(j === i));
      t.tabIndex = j === i ? 0 : -1;
      el(`panel-${kinds[j].id}`).hidden = j !== i;
    });
    copy.textContent = kinds[i].copy;
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => t.addEventListener("click", () => select(i)));
  el("code-tabs").addEventListener("keydown", (e) => {
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select((next + tabs.length) % tabs.length, true);
  });
  copy.addEventListener("click", () => copyText(kinds[at].text, kinds[at].done));
}

type PayerKind = "agent" | "connected";
type Verdict = { tone: "settled" | "awaiting" | "refused" | ""; word: string; text: string; block: boolean };

function wireDeck(r: Resource) {
  const form = el<HTMLFormElement>("deck");
  const pay = el<HTMLButtonElement>("pay");
  const sel = el<HTMLSelectElement>("net");
  const verdictBox = el("verdict");
  const note = el("note");
  const receipt = el("receipt");
  const price = Number(r.price);
  const p = formatPrice(r.price);
  const st = { payer: (agentAccount() ? "agent" : "connected") as PayerKind, live: null as boolean | null, busy: false };
  const hasExtension = () => injectedWallets().length > 0 || !!(window as unknown as { ethereum?: unknown }).ethereum;
  const selected = (): PayNetworkKey => (isPayKey(sel.value) ? sel.value : network());

  form.querySelector<HTMLInputElement>(`input[name="payer"][value="${st.payer}"]`)!.checked = true;

  // Pay on: the networks the server quotes right now. Slow renders are quoted on EVM chains only,
  // and picking one for them does not move the saved network off Solana for other tools.
  if (r.slow) {
    const pick = (keys: PayNetworkKey[]) => (keys.includes(network()) ? network() : keys[0]);
    sel.innerHTML = netOptions(pick(EVM), EVM);
    liveNetworks().then((live) => {
      const keys = live.filter((k) => EVM.includes(k));
      if (!keys.length) return;
      sel.innerHTML = netOptions(keys.includes(selected()) ? selected() : pick(keys), keys);
    });
  } else {
    sel.innerHTML = netOptions(network(), PAY_KEYS);
    liveSelect(sel);
  }

  const orBudget = () => (agentAccount() ? "or pay with Budget" : 'or create a <a href="/budget">Budget</a>');
  const verdict = (): Verdict => {
    if (st.live === false) return { tone: "awaiting", word: "Not live yet", text: "This tool is listed, but its provider is not switched on, so it cannot be paid for yet.", block: true };
    if (st.payer === "connected") {
      if (selected() === "solana") return { tone: "refused", word: "Not on Solana", text: `My wallet pays on EVM networks. Pick another network, ${orBudget()}.`, block: true };
      if (!connectedWallet() && !hasExtension()) return { tone: "refused", word: "No wallet found", text: `This browser has no wallet extension. Install MetaMask or Rabby, ${orBudget()}.`, block: true };
      return { tone: "", word: "You sign", text: `Your wallet shows the ${p} payment for you to approve. Budget caps cover the Budget wallet only.`, block: false };
    }
    if (!agentAccount()) return { tone: "refused", word: "No Budget yet", text: 'Create a Budget on this device, or pay with My wallet. <a href="/budget">Open Budget</a>', block: true };
    const c = caps();
    const whose = c.saved ? "Your" : "A new wallet's default";
    if (price > c.perCall + 1e-9) return { tone: "refused", word: "Over the cap", text: `${whose} cap is ${money(c.perCall)} a call and this call is ${p}. Siro refuses before signing. <a href="/budget">Raise it in Budget</a>`, block: true };
    const spent = spentToday(agentAddresses());
    if (spent + price > c.perDay + 1e-9) return { tone: "refused", word: "Over today's cap", text: `${money(spent)} of ${money(c.perDay)} is spent today (this browser's log), and this call is ${p}. <a href="/budget">Raise the cap in Budget</a>, or wait until midnight.`, block: true };
    return { tone: "settled", word: "Within caps", text: `${p} of ${money(c.perCall)} a call, and ${money(spent + price)} of ${money(c.perDay)} today with this one. ${c.saved ? "Caps saved in this browser" : "A new wallet's default caps"}; today's spend from this browser's log.`, block: false };
  };

  const paintWho = () => {
    const who = el("who");
    if (st.payer === "agent") {
      const a = agentAccount();
      who.innerHTML = a ? `Budget wallet <b class="mono">${short(a.address)}</b> in this browser.` : "No Budget on this device yet.";
      return;
    }
    const c = connectedWallet();
    const found = injectedWallets().map((w) => esc(w.info.name));
    who.innerHTML = c ? `${esc(c.name)} <b class="mono">${short(c.address)}</b> connected.` : found.length ? `Connects when you pay: ${either(found)}.` : hasExtension() ? "Connects to your browser wallet when you pay." : "No browser wallet found.";
  };
  const paintWhoAndHolder = () => {
    paintWho();
    paintHolder();
  };

  let shownVerdict = "";
  const paint = () => {
    paintWhoAndHolder();
    const v = verdict();
    // The space keeps the pay key's description (aria-describedby) from reading "Within caps$0.02".
    const html = `<span class="lamp${v.tone ? ` lamp--${v.tone}` : ""}">${v.word}</span> <span>${v.text}</span>`;
    if (html !== shownVerdict) verdictBox.innerHTML = shownVerdict = html;
    const blocked = v.block || st.busy;
    if (blocked) pay.setAttribute("aria-disabled", "true");
    else pay.removeAttribute("aria-disabled");
    pay.textContent = st.busy ? "Paying and running…" : st.live === false ? "Not live yet" : `Pay ${p} and run`;
    // One dark key per screen: the pay key is graphite only while the verdict lets it pay, and the
    // shell keeps the rail's and the dock's Ask aluminium only while that graphite key is in view.
    // A refused key is dashed with its reason written, so Ask takes the dark key back.
    if (pay.classList.contains("key--ink") === v.block) {
      pay.classList.toggle("key--ink", !v.block);
      quietAsk(pay);
    }
  };

  const say = (text: string) => (note.textContent = text);

  // On phones the deck is in the page flow, so a new strip under the pay key can start out of view.
  const showStrip = (html: string) => {
    receipt.innerHTML = html;
    receipt.hidden = false;
    receipt.scrollIntoView({ block: "nearest" });
  };

  const media = r.category === "image" || r.category === "video" || r.category === "audio";
  const showReceipt = (rc: Receipt) => {
    const key = payNetworkOf(rc.network) ?? selected();
    const n = PAY_NETWORKS[key];
    const pending = rc.status === "pending";
    const tx = rc.tx ? `<a class="mono" href="${n.explorer}/tx/${encodeURIComponent(rc.tx)}" target="_blank" rel="noopener noreferrer">${esc(short(rc.tx))}<span class="sr">, transaction on the ${n.name} explorer, opens in a new tab</span></a>` : "";
    showStrip(`
      <div class="display__bar"><b>Receipt</b><span>${utc(new Date(), true)}</span></div>
      <div class="tl-receipt__row">
        <span class="lamp ${pending ? "lamp--awaiting" : "lamp--settled"}">${pending ? "Pending" : "Settled"}</span>
        <span class="live-num tl-receipt__usd">${money(rc.amountUsd)}<small>${esc(rc.asset)}</small></span>
        <span>${n.name}</span>
        ${tx}
      </div>
      <p class="small tl-receipt__more">${pending ? "The transfer was sent and is not confirmed yet. Follow the hash on the explorer until it lands." : `Ran for ${duration(rc.ms)} before it settled.`} <a href="/activity">Activity</a> lists every paid call with its hash.</p>
      ${
        media
          ? `<p class="small tl-receipt__keep" id="keep">Siro keeps this file for ${RESULT_TTL_DAYS} days, then deletes it. ${rc.tx ? '<button class="key key--sm" type="button" id="forget">Delete it now</button>' : ""}</p>`
          : `<p class="small tl-receipt__keep">Siro did not keep this result. Only the payment and the result's sha256 are on the ledger. <a href="/privacy">Privacy</a></p>`
      }`);
    const forget = document.getElementById("forget") as HTMLButtonElement | null;
    forget?.addEventListener("click", async () => {
      if (forget.getAttribute("aria-disabled") === "true") return;
      forget.setAttribute("aria-disabled", "true");
      forget.textContent = "Sign in your wallet…";
      try {
        await forgetResult(rc.tx, rc.payer, { kind: st.payer });
        el("keep").textContent = "Deleted. The file is gone from Siro's storage and its link no longer works. The payment stays on the ledger.";
      } catch (err) {
        forget.removeAttribute("aria-disabled");
        forget.textContent = "Delete it now";
        toast(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const showFailure = (err: unknown, quoted: number | null, net: PayNetworkKey) => {
    const pe = err instanceof PayError ? err : new PayError("error", err instanceof Error ? err.message : String(err));
    let title = "Nothing settled";
    let tone: Verdict["tone"] = "refused";
    let word = "Not paid";
    let text = esc(sentence(pe.message));
    switch (pe.code) {
      case "declined":
        tone = "awaiting";
        word = "Stopped";
        text = quoted !== null ? `The server quoted ${money(quoted)}, not the listed ${p}. Nothing was signed.` : "Declined. Nothing was signed.";
        break;
      case "sign_rejected":
        text = "The signature was declined in your wallet. Nothing was paid.";
        break;
      case "not_connected":
        word = "Not connected";
        break;
      case "no_agent_wallet":
        text = 'There is no Budget on this device any more. <a href="/budget">Open Budget</a>';
        break;
      case "insufficient_funds":
        word = "Not enough funds";
        text += st.payer === "agent" ? ' Nothing was settled. <a href="/budget">Add funds in Budget</a>' : " Nothing was settled.";
        break;
      case "solana_agent_only":
        text = "My wallet pays on EVM networks. Pick another network, or pay with Budget.";
        break;
      case "no_supported_payment":
        text = `${esc(r.name)} is not quoted on ${PAY_NETWORKS[net].name} right now. Pick another network. Nothing was signed.`;
        break;
      case "not_live":
        st.live = false;
        text = `${esc(r.name)} is listed but not switched on yet. Nothing was charged.`;
        break;
      case "payments_not_configured":
        text = "The server is not taking payments yet. Nothing was charged.";
        break;
      // The cap check runs on the server's quote, which can differ from the listed price, so the
      // live verdict (worked out from the listed price) is not the reason here.
      case "over_payment_cap":
        word = "Over the cap";
        text = `The quote is over the cap of ${money(caps().perCall)} a call, so Siro refused before signing. <a href="/budget">Raise it in Budget</a>`;
        break;
      case "over_daily_cap":
        word = "Over today's cap";
        text = `This payment would take today's spend past the cap of ${money(caps().perDay)}, so Siro refused before signing. <a href="/budget">Raise it in Budget</a>, or wait until midnight.`;
        break;
      case "network_error":
        title = "No answer";
        tone = "awaiting";
        word = "Unknown";
        text = 'The connection dropped before an answer came back. If a payment went through, <a href="/activity">Activity</a> lists it; check there before paying again.';
        break;
      default:
        if (INPUT_ERRORS.has(pe.code)) {
          word = "Input refused";
          text += " Nothing was signed.";
        } else if (!/charged|settle/i.test(pe.message)) text += " Failed calls are never settled.";
    }
    showStrip(`<div class="display__bar"><b>${title}</b><span>${utc(new Date(), true)}</span></div><p class="tl-receipt__msg"><span class="lamp lamp--${tone}">${word}</span> <span>${text}</span></p>`);
    say(title === "No answer" ? "No answer came back." : "Nothing was settled.");
  };

  const showResult = (result: unknown) => {
    el("result-meta").textContent = `${r.name} · ${utc(new Date(), true)}`;
    el("result-body").innerHTML = renderResult(r.id, result).html;
    const box = el("result");
    box.hidden = false;
    box.scrollIntoView({ block: "start" });
  };

  const readInput = () => {
    const input: Record<string, string> = {};
    el("deck-inputs")
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]")
      .forEach((c) => {
        const v = c.value.trim();
        if (v) input[c.name] = v;
      });
    if (r.fields.some((f) => f.name === "network") && !input.network) input.network = dataNetwork();
    return input;
  };

  // A blocked key stays focusable so its reason is read out; a click on it does nothing.
  pay.addEventListener("click", (e) => {
    if (pay.getAttribute("aria-disabled") === "true") e.preventDefault();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (st.busy || verdict().block) return;
    const net = selected();
    const input = readInput();
    let quoted = null as number | null;
    st.busy = true;
    form.setAttribute("aria-busy", "true");
    receipt.hidden = true;
    paint();
    say(r.slow ? "Getting the quote. This tool takes a few minutes; keep this tab open." : "Getting the quote.");
    try {
      if (st.payer === "connected" && !connectedWallet()) {
        say("Choose the wallet that pays.");
        const pick = await pickWallet(`Pays ${p} for ${r.name} on ${PAY_NETWORKS[net]?.name ?? net}. The wallet asks you before anything is signed.`);
        if (pick === null) throw new PayError("not_connected", "No wallet chosen. Nothing was signed.");
        try {
          await connect(pick);
        } catch (err) {
          throw new PayError("not_connected", `The wallet did not connect: ${sentence(err instanceof Error ? err.message : String(err))} Nothing was signed.`);
        }
        paintWho();
      }
      const res = await callResource(r.id, input, {
        payer: { kind: st.payer },
        network: net,
        confirm: (usd) => {
          // A holder price is lower than the list price and is fine; a higher quote is never signed.
          if (usd - price > 1e-9) {
            quoted = usd;
            return false;
          }
          const amt = usd < price - 1e-9 ? `${exactUsd(BigInt(Math.round(usd * 1e6)))} (holder price)` : p;
          say(
            st.payer === "agent"
              ? `Signing ${amt} from Budget, then running ${r.name}. It settles only when the result comes back.`
              : `Approve the ${amt} payment in your wallet. ${r.name} runs next and settles only when the result comes back.`,
          );
          return true;
        },
      });
      const rc = (res.receipt as Receipt | undefined) ?? null;
      if (rc) showReceipt(rc);
      showResult(res.result);
      const on = rc ? PAY_NETWORKS[payNetworkOf(rc.network) ?? net].name : "";
      say(!rc ? "The result is ready." : rc.status === "pending" ? `The ${money(rc.amountUsd)} payment on ${on} is not confirmed yet. The result is ready.` : `Paid ${money(rc.amountUsd)} on ${on}. The result is ready.`);
    } catch (err) {
      showFailure(err, quoted, net);
    } finally {
      st.busy = false;
      form.removeAttribute("aria-busy");
      paint();
    }
  });

  // $SIRO holders: the paying wallet's tier, read from /api/holder, and free runs of Siro's own data tools.
  const holderLine = el("holder");
  const freeKey = document.getElementById("free") as HTMLButtonElement | null;
  const tierText = `1M $SIRO gets ${TIERS[1].discountPct}% off every tool, 10M gets ${TIERS[0].discountPct}%`;
  let holderFor = "";
  const paintHolder = () => {
    const addr = selected() === "solana" ? null : payingAddress({ kind: st.payer });
    if (!addr) {
      holderLine.hidden = false;
      holderLine.textContent = `${tierText}${freeKey ? `, and ${TIERS[1].freePerDay} free runs of this tool a day` : ""}. Pay from the wallet that holds it.`;
      return;
    }
    if (addr === holderFor) return;
    holderFor = addr;
    void holderInfo(addr).then((h) => {
      if (holderFor !== addr || !h) return;
      holderLine.hidden = false;
      const held = `${Math.floor(h.siro).toLocaleString("en-US")} $SIRO`;
      holderLine.innerHTML = h.tier
        ? `This wallet holds <b>${held}</b>: ${h.tier.discountPct}% off, so this call is <b>${exactUsd(discounted(toUnits(r.price), h.tier.discountPct))}</b>.${freeKey ? ` ${h.freeLeftToday} of ${h.tier.freePerDay} free runs left today.` : ""}`
        : `This wallet holds ${held}. ${tierText}.`;
    });
  };
  freeKey?.addEventListener("click", async () => {
    if (st.busy) return;
    st.busy = true;
    freeKey.setAttribute("aria-disabled", "true");
    receipt.hidden = true;
    try {
      if (!connectedWallet()) {
        const pick = await pickWallet(`Runs ${r.name} free if this wallet holds at least 1,000,000 $SIRO. The wallet signs a one-day holder pass; no payment is made.`);
        if (pick === null) throw new PayError("not_connected", "No wallet chosen. Nothing was signed.");
        await connect(pick);
        st.payer = "connected";
        (el("payer").querySelector('input[value="connected"]') as HTMLInputElement).checked = true;
        paint();
      }
      say("Sign the holder pass in your wallet. It lasts 24 hours and moves no money.");
      const out = await callFree(r.id, readInput());
      showResult(out.result);
      holderFor = "";
      paintHolder();
      say(`Free holder run. ${out.free.leftToday} left today.`);
    } catch (err) {
      say(sentence(err instanceof Error ? err.message : String(err)));
    } finally {
      st.busy = false;
      freeKey.removeAttribute("aria-disabled");
      paint();
    }
  });

  el("payer").addEventListener("change", (e) => {
    st.payer = (e.target as HTMLInputElement).value === "agent" ? "agent" : "connected";
    paint();
  });
  sel.addEventListener("change", () => {
    if (isPayKey(sel.value)) setNetwork(sel.value);
    paint();
  });
  // Wallet extensions announce themselves a moment after load; caps can change in Budget in another tab.
  addEventListener("eip6963:announceProvider", () => setTimeout(paint));
  addEventListener("storage", () => paint());
  liveNetworks().then(() => paint());
  readLiveOne(r.id).then((live) => {
    st.live = live;
    paint();
  });
  paint();
}

export function detail(main: HTMLElement, r: Resource) {
  setHead(`${r.name} · Tools · Siro`, `${r.name} from ${r.provider}: ${r.summary} ${formatPrice(r.price)} a call, quoted over x402 before it runs.`, `/tools/${r.id}`);
  main.innerHTML = view(r);
  wireQuote(r);
  wireCode(r);
  wireDeck(r);
}

export function notFound(main: HTMLElement, slug: string) {
  setHead("No such tool · Tools · Siro", "There is no Siro tool at this address. The tools list has every tool with its price per call.", "/tools");
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex";
  document.head.append(robots);
  main.innerHTML = `
<div class="wrap tl-missing">
  <h1>No tool with that name.</h1>
  <p class="lede">Nothing in the catalog answers to <code class="inline">${esc(slug.slice(0, 80))}</code>. The list has all ${RESOURCES.length} tools with their prices.</p>
  <p class="tl-missing__keys"><a class="key" href="/tools">All tools</a><button class="key" type="button" id="find">Search tools</button></p>
</div>`;
  el("find").addEventListener("click", () => openSearch());
}
