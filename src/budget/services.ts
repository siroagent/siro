// Pay a service outside Siro: search the open x402 index, then call a result from this budget.
// pay.ts checks the caps against the service's own 402 before the confirm dialog opens.
import { PAY_NETWORKS, payNetworkOf } from "../../shared/catalog";
import { callExternal, discoverServices, network, type Service } from "../lib/pay";
import { renderResult } from "../lib/render";
import { esc } from "../shell";
import { dialog } from "./dialog";
import { held, hold, payText, short, txUrl, usd } from "./util";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 48);
  }
}

/** The index cuts descriptions at 400 characters, often mid-word ("event planning, logis"); end on a whole word. */
function blurb(d: string) {
  if (d.length < 400) return d;
  const at = d.lastIndexOf(" ", 399);
  return `${(at > 0 ? d.slice(0, at) : d).replace(/[\s,;:(-]+$/, "")}…`;
}

function item(s: Service, i: number) {
  const nets = s.networks.map((n) => {
    const k = payNetworkOf(n);
    return k ? PAY_NETWORKS[k].name : n;
  });
  const price = s.priceUsd !== null ? `<span class="live-num bd-svc__price">${usd(s.priceUsd)}<small>a call</small></span>` : "";
  const act = s.payable
    ? `<div class="bd-svc__act"><button class="key key--sm" type="button" data-try="${i}" aria-expanded="false" aria-controls="svc-try-${i}">Try it</button></div><div class="bd-svc__try" id="svc-try-${i}" hidden></div>`
    : `<p class="small muted bd-svc__act">Not payable from this budget: it takes ${esc(nets.join(", ") || "other networks")} only.</p>`;
  return `<li class="bd-svc${s.payable ? "" : " is-off"}">
    <div class="bd-svc__head"><b class="bd-svc__name">${esc(s.name ?? hostOf(s.url))}</b>${price}</div>
    <p class="bd-svc__desc small">${esc(blurb(s.description || "No description given."))}</p>
    <code class="bd-svc__url">${esc(s.method)} ${esc(s.url)}</code>
    ${act}
  </li>`;
}

function editor(s: Service, i: number) {
  const run = s.priceUsd !== null ? `Pay up to ${usd(s.priceUsd)} and run` : "Run and pay the quoted price";
  return `<div class="field"><label class="label" for="svc-in-${i}">${s.method === "GET" ? "Query parameters, as JSON" : "JSON body"}</label><textarea id="svc-in-${i}" class="mono" rows="5" spellcheck="false">${esc(JSON.stringify(s.input ?? {}, null, 2))}</textarea></div>
    <div class="bd-row"><button class="key key--sm" type="button" data-run="${i}">${run}</button></div>
    <p class="bd-svc__say" data-say role="status"></p>
    <div class="bd-svc__out" data-out></div>`;
}

/** The result came from a third party, so its links may only lead to web pages or media. */
function defuse(root: HTMLElement) {
  for (const el of root.querySelectorAll("[href], [src]"))
    for (const attr of ["href", "src"]) {
      const v = el.getAttribute(attr);
      if (v !== null && !/^(https?:|data:(image|audio|video)\/)/i.test(v.trim())) el.removeAttribute(attr);
    }
}

export function mountServices(host: HTMLElement, onPaid: () => void) {
  let found: Service[] = [];
  host.innerHTML = `
    <form class="bd-find" role="search" novalidate>
      <div class="field"><label class="label" for="svc-q">What should the service do?</label><input id="svc-q" type="search" placeholder="weather, token price, web search" autocomplete="off"></div>
      <button class="key" type="submit">Search the index</button>
    </form>
    <p class="small muted" data-status role="status"></p>
    <ul class="bd-svcs" data-found></ul>`;
  const form = host.querySelector<HTMLFormElement>("form")!;
  const q = host.querySelector<HTMLInputElement>("#svc-q")!;
  const status = host.querySelector<HTMLElement>("[data-status]")!;
  const list = host.querySelector<HTMLElement>("[data-found]")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const words = q.value.trim();
    if (!words) {
      status.textContent = "Type a few words first, such as weather or token price.";
      q.focus();
      return;
    }
    status.textContent = `Searching the x402 index for "${words}"…`;
    list.innerHTML = "";
    list.setAttribute("aria-busy", "true");
    try {
      found = await discoverServices(words);
      status.textContent = found.length ? `${found.length} result${found.length === 1 ? "" : "s"} for "${words}" from the open x402 index.` : `Nothing in the index matches "${words}". Try other words.`;
      list.innerHTML = found.map(item).join("");
    } catch (err) {
      found = [];
      status.textContent = `The search did not work: ${payText(err)} Search again in a moment.`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  });

  const confirmPay = async (amount: number, to: string, key: HTMLButtonElement) => {
    const yes = (await dialog({
      title: `Pay ${usd(amount)} to ${to}?`,
      body: `<p>This call is paid from this budget. Your per-call and daily caps were checked against the service's quote before this question.</p>`,
      actions: [{ label: `Pay ${usd(amount)}`, value: "pay", ink: true }],
    }).result) === "pay";
    if (yes) key.textContent = "Paying and running…";
    return yes;
  };

  const run = async (i: number, key: HTMLButtonElement) => {
    const s = found[i];
    const box = host.querySelector<HTMLElement>(`#svc-try-${i}`)!;
    const say = box.querySelector<HTMLElement>("[data-say]")!;
    const out = box.querySelector<HTMLElement>("[data-out]")!;
    const lamp = (kind: string, html: string) => (say.innerHTML = `<span class="lamp ${kind}">${html}</span>`);
    let input: unknown;
    try {
      input = JSON.parse(box.querySelector("textarea")!.value || "{}");
    } catch {
      lamp("lamp--refused", "That is not valid JSON, so nothing was sent.");
      return;
    }
    const label = key.textContent;
    hold(key, true);
    key.textContent = "Getting the quote…";
    say.textContent = "";
    out.innerHTML = "";
    try {
      const r = await callExternal(s, input, { payer: { kind: "agent" }, network: network(), confirm: (amount) => confirmPay(amount, hostOf(s.url), key) });
      const p = r.paid;
      if (p) lamp("lamp--settled", `Paid ${usd(p.usd)} on ${PAY_NETWORKS[p.network].name}.${p.tx ? ` <a href="${esc(txUrl(p.network, p.tx))}" target="_blank" rel="noopener noreferrer">Transaction ${esc(short(p.tx, 6, 4))}</a>` : ""}`);
      else lamp("bd-quiet", "No payment was needed for this call.");
      out.innerHTML = renderResult("external", r.result).html;
      defuse(out);
      if (p) onPaid();
    } catch (err) {
      const declined = (err as { code?: string }).code === "declined";
      lamp(declined ? "bd-quiet" : "lamp--refused", esc(payText(err)));
    } finally {
      hold(key, false);
      key.textContent = label;
    }
  };

  list.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest<HTMLButtonElement>("[data-try]");
    if (open) {
      const i = Number(open.dataset.try);
      const box = host.querySelector<HTMLElement>(`#svc-try-${i}`)!;
      if (!box.innerHTML) box.innerHTML = editor(found[i], i);
      box.hidden = !box.hidden;
      open.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.querySelector("textarea")?.focus();
      return;
    }
    const go = t.closest<HTMLButtonElement>("[data-run]");
    if (go && !held(go)) run(Number(go.dataset.run), go);
  });
}
