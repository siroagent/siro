// The quote faceplate: a live x402 quote for one tool, checked against the caps in this browser.
// Nothing here signs or pays; the faceplate only asks for the price and reads the answer.
import { RESOURCES, byId, formatPrice, type Resource } from "../../shared/catalog";
import { esc } from "../shell";
import { judge, readCaps, usd } from "./caps";
import { NoQuote, askQuote, cachedQuote, leadAccept, networkText, quotedNetworks, shortAddress, unitsToUsd, utc, type Capture } from "./quote";
import { mountRoute } from "./route";
import { copyText, curlFor } from "./snippets";

/** Tools the faceplate can quote, each with a brief that would make the agent in Ask pick it. */
const PICKS: [id: string, brief: string][] = [
  ["prediction-read", "Read the Polymarket odds on fed interest rates"],
  ["stock-signal", "Is the TSLA stock token trading above its Chainlink price?"],
  ["market-brief", "Brief me on what is trending on Robinhood Chain"],
  ["tts-aura-2", "Read this aloud: Your agent just paid for this sentence."],
  ["nano-banana-2-1", "Draw a steel ball rolling along an S-shaped groove milled into brushed aluminium, studio light"],
  ["seedance-2-mini", "Make a 5 second clip of a steel ball rolling along an S-shaped groove milled into brushed aluminium"],
];

type Pick = { r: Resource; brief: string };
export type HeroEvents = { tool: (r: Resource) => void; capture: (c: Capture | null, r: Resource) => void };
type Tone = "awaiting" | "settled" | "refused" | "plain";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const WAIT_NOTE_MS = 2000;
const GIVE_UP_MS = 10000;

export function mountHero(on: HeroEvents) {
  const picks: Pick[] = PICKS.flatMap(([id, brief]) => {
    const r = byId(id);
    return r ? [{ r, brief }] : [];
  });
  if (!picks.length) return;

  const select = $<HTMLSelectElement>("q-tool");
  const name = $("q-name");
  const ms = $("q-ms");
  const price = $("q-price");
  const from = $("q-from");
  const terms = $("q-terms");
  // The terms line keeps its height while it waits for the 402, so the quote landing moves nothing under it.
  terms.hidden = false;
  terms.classList.add("is-held");
  const lamp = $("q-lamp");
  const src = $("q-src");
  const retry = $<HTMLButtonElement>("q-retry");
  const spec = $("q-spec");
  const curlKey = $<HTMLButtonElement>("q-curl");
  const askKey = $<HTMLAnchorElement>("hero-ask");
  const route = mountRoute($("q-gauge"), $("q-strip"));

  const caps = readCaps();
  const overNote = (r: Resource) => (Number(r.price) > caps.perCall + 1e-9 ? (caps.source === "new" ? ", over the default cap" : ", over your cap") : "");
  select.innerHTML = picks.map(({ r }, i) => `<option value="${i}">${esc(r.name)} · ${formatPrice(r.price)}${overNote(r)}</option>`).join("");
  select.disabled = false;
  const cheapest = RESOURCES.reduce((a, r) => (Number(r.price) < Number(a.price) ? r : a));
  $("hero-all").textContent = `${RESOURCES.length} tools from ${formatPrice(cheapest.price)}`;
  curlKey.hidden = false;

  let pick = picks[0];
  let inflight: AbortController | null = null;
  let timers: number[] = [];

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function setSpec(note: string, version: unknown = 2) {
    spec.innerHTML = `x402 v${esc(version)} · <code>POST /v1/${esc(pick.r.id)}</code> · ${esc(note)}`;
  }

  function setPrice(decimal: string, quoted: boolean) {
    price.innerHTML = `${formatPrice(decimal)}<small>per call</small>`;
    price.classList.toggle("is-list", !quoted);
  }

  /** The two rail meters: this call against the per-call cap, and today with this call against the daily cap. */
  function setMeters(p: number) {
    const now = readCaps();
    const v = judge(p, now);
    const meter = (id: string, value: number, cap: number, share: number) => {
      const over = value > cap + 1e-9;
      $(id).innerHTML = `<b class="live-num">${usd(value)}</b> of ${usd(cap)}${over ? ", over" : ""}`;
      const bar = $(`${id}-bar`);
      bar.style.setProperty("--v", share.toFixed(4));
      bar.closest(".qm__m")?.classList.toggle("is-over", over);
    };
    meter("m-call", p, now.perCall, v.perCallShare);
    meter("m-day", v.dayTotal, now.perDay, v.dayShare);
    return v;
  }

  function setState(tone: Tone, text: string, note = "") {
    lamp.className = `lamp qd__verdict${tone === "plain" ? "" : ` lamp--${tone}`}`;
    lamp.textContent = text;
    lamp.hidden = false;
    src.textContent = note;
    src.hidden = !note;
    const failed = tone === "plain";
    if (!failed && document.activeElement === retry) select.focus();
    retry.hidden = !failed;
  }

  function showPick() {
    name.textContent = pick.r.name;
    askKey.href = `/ask?tool=${encodeURIComponent(pick.r.id)}&q=${encodeURIComponent(pick.brief)}`;
    on.tool(pick.r);
  }

  /** The 402 has reached Quote: the server's price, networks and terms, and the measured round trip. */
  function showQuote(c: Capture, cached: boolean) {
    const lead = leadAccept(c.body);
    const amount = unitsToUsd(lead.amount);
    setPrice(amount ?? pick.r.price, !!amount);
    const keys = quotedNetworks(c.body);
    const evmOnly = pick.r.slow && !keys.includes("solana") ? " Tools that take minutes are quoted on EVM chains only." : "";
    from.textContent = keys.length ? `Server quote, payable as ${networkText(keys)}.${evmOnly}` : "Server quote.";
    terms.innerHTML = `Pays to <code>${esc(shortAddress(lead.payTo))}</code> · signature valid ${Number(lead.maxTimeoutSeconds) || 0} s`;
    terms.classList.toggle("is-held", !lead.payTo);
    ms.innerHTML = `<span>402 in <b class="live-num">${c.ms}</b> ms${cached ? ", cached" : ""}</span>`;
    setSpec(`quoted ${utc(c.at)} UTC`, c.body.x402Version || 2);
  }

  /** The ball has reached Cap: the verdict against this browser's caps. */
  function showVerdict(p: number) {
    const v = setMeters(p);
    route.over(!v.ok);
    setState(v.ok ? "settled" : "refused", v.line, v.source);
    // The live region speaks the verdict; this gives it the price the verdict is about.
    lamp.insertAdjacentHTML("afterbegin", `<span class="sr">${esc(pick.r.name)}, ${formatPrice(String(p))} per call. </span>`);
  }

  const priceOf = (c: Capture) => Number(unitsToUsd(leadAccept(c.body).amount) ?? pick.r.price);

  async function quote(fresh = false) {
    inflight?.abort();
    inflight = null;
    clearTimers();
    const r = pick.r;
    setPrice(r.price, false);
    setMeters(Number(r.price));
    route.over(false);
    terms.classList.add("is-held");

    const hit = fresh ? null : cachedQuote(r.id);
    if (hit) {
      route.jump(2);
      showQuote(hit, true);
      showVerdict(priceOf(hit));
      on.capture(hit, r);
      return;
    }

    const ctrl = new AbortController();
    inflight = ctrl;
    from.textContent = "Price list, while the server quotes.";
    ms.textContent = "asking";
    setSpec("asking now");
    setState("awaiting", "Asking the server for a quote.");
    void route.reset().then((moved) => {
      if (moved && inflight === ctrl) route.depart();
    });
    timers.push(
      window.setTimeout(() => setState("awaiting", "Still waiting. The server is warming up."), WAIT_NOTE_MS),
      window.setTimeout(() => ctrl.abort(), GIVE_UP_MS),
    );
    const started = performance.now();
    try {
      const c = await askQuote(r, ctrl.signal);
      if (inflight !== ctrl) return;
      clearTimers();
      on.capture(c, r);
      await route.arrive(
        performance.now() - started,
        () => inflight === ctrl && showQuote(c, false),
        () => inflight === ctrl && showVerdict(priceOf(c)),
      );
    } catch (e) {
      if (inflight !== ctrl) return;
      clearTimers();
      const why = e instanceof NoQuote ? e.message : ctrl.signal.aborted ? "Nothing came back within 10 seconds." : "The request failed before an answer came back.";
      from.textContent = "Price list.";
      ms.textContent = "no 402";
      setSpec("no quote, price list shown");
      setState("plain", "No quote came back. Showing the price list.", why);
      on.capture(null, r);
      void route.reset();
    }
  }

  select.addEventListener("change", () => {
    pick = picks[Number(select.value)] ?? picks[0];
    showPick();
    void quote();
  });
  retry.addEventListener("click", () => void quote(true));
  curlKey.addEventListener("click", () => void copyText(curlFor(pick.r), `The curl for ${pick.r.name}`));

  showPick();
  void quote();
}
