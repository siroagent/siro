// Caps: the daily-cap knob, the per-call and per-swap fields and Autopay. Nothing reaches storage
// before Save, not even a per-call cap that arrived in the link (/budget?per-call=0.05).
import { RESOURCES } from "../../shared/catalog";
import { agentAddresses, limits, setLimits, spentToday, type Limits } from "../lib/pay";
import { mountKnob } from "./knob";
import { clock, fieldValue, hold, parseUsd, untilMidnight, usd, utc } from "./util";

const STORE = "siro.agent.limits";
const EPS = 1e-9;
const CHEAPEST = Math.min(...RESOURCES.map((r) => Number(r.price)));

function isStored() {
  try {
    return localStorage.getItem(STORE) !== null;
  } catch {
    return false;
  }
}
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

type Draft = { perPayment: string; perDay: number; perSwap: string; autopay: boolean };
const draftOf = (l: Limits): Draft => ({ perPayment: fieldValue(l.perPayment), perDay: l.perDay, perSwap: fieldValue(l.perSwap), autopay: l.autopay });

export type CapsState = "defaults" | "saved" | "unsaved" | "invalid";
export type Caps = { refreshToday(): void; reload(): void; readonly save: HTMLButtonElement };

/** The link's value has been dealt with (saved, discarded or refused), so a reload must not bring it back. */
function dropLinkParam() {
  const u = new URL(location.href);
  if (!u.searchParams.has("per-call")) return;
  u.searchParams.delete("per-call");
  try {
    history.replaceState(history.state, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {
    /* a sandboxed frame may refuse; the caps work the same either way */
  }
}

export function mountCaps(host: HTMLElement, o: { onSaved(l: Limits): void; onState?(s: CapsState): void }): Caps {
  let saved = limits();
  let draft = draftOf(saved);
  let savedAt: Date | null = null;
  let linked = false;
  let note: { kind: "settled" | "refused"; text: string } | null = null;

  const link = new URLSearchParams(location.search).get("per-call");
  if (link !== null) {
    const n = parseUsd(link);
    if (!link.trim() || !Number.isFinite(n) || !(n > 0)) {
      note = { kind: "refused", text: `The link asked for a per-call cap of "${link.slice(0, 24)}", which is not an amount above $0. Nothing changed.` };
      dropLinkParam();
    } else if (n > 1000) {
      note = { kind: "refused", text: `The link asked for a per-call cap of ${usd(n)}, more than this page takes from a link. Nothing changed.` };
      dropLinkParam();
    } else if (same(Number(fieldValue(n)), saved.perPayment)) {
      note = { kind: "settled", text: `The link's per-call cap, ${usd(n)}, is already the one in effect.` };
      dropLinkParam();
    } else {
      draft.perPayment = fieldValue(n);
      linked = true;
    }
  }

  host.innerHTML = `
  <form class="bd-caps" novalidate>
    <div class="bd-caps__dial">
      <p class="bd-caps__name" id="cap-day-name">Daily cap</p>
      <div class="bd-dial" data-dial></div>
      <div class="bd-dial__turn">
        <button class="key" type="button" data-turn="-1" aria-label="Lower the daily cap" aria-describedby="cap-day-hint">−</button>
        <span class="small muted" id="cap-day-hint" data-hint></span>
        <button class="key" type="button" data-turn="1" aria-label="Raise the daily cap" aria-describedby="cap-day-hint">+</button>
      </div>
    </div>
    <div class="bd-caps__side">
      <div class="display bd-readout">
        <div class="display__bar"><b>Daily cap</b><span data-read></span></div>
        <p class="live-num bd-readout__num"><span data-day></span><small>a day</small></p>
        <div class="meter bd-readout__meter" data-meter aria-hidden="true"><i class="ball"></i></div>
        <p class="bd-readout__line" data-today></p>
      </div>
      <div class="bd-caps__fields">
        <div class="field">
          <label class="label" for="cap-call">Per call <span class="sr">in USD</span></label>
          <div class="bd-money"><input id="cap-call" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="cap-call-fits"><i aria-hidden="true">USD</i></div>
          <p class="small muted" id="cap-call-fits" data-fits></p>
        </div>
        <div class="field">
          <label class="label" for="cap-swap">Per swap <span class="sr">in USD</span></label>
          <div class="bd-money"><input id="cap-swap" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="cap-swap-says"><i aria-hidden="true">USD</i></div>
          <p class="small muted" id="cap-swap-says">Swaps always wait for your yes. The agent wallet refuses one worth more than this.</p>
        </div>
      </div>
      <div class="bd-auto">
        <label class="label" for="cap-auto">Autopay</label>
        <button class="bd-switch" id="cap-auto" type="button" role="switch" aria-checked="false" aria-describedby="cap-auto-says"><span aria-hidden="true">Off</span><span aria-hidden="true">On</span></button>
        <p class="small" id="cap-auto-says" data-auto></p>
      </div>
    </div>
    <div class="bd-caps__state">
      <p class="lamp" data-lamp role="status" tabindex="-1"></p>
      <div class="bd-caps__keys" data-keys hidden>
        <button class="key" type="submit" data-save>Save caps</button>
        <button class="key" type="button" data-discard>Discard</button>
      </div>
    </div>
  </form>`;

  const form = host.querySelector<HTMLFormElement>("form")!;
  const $ = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
  const call = $<HTMLInputElement>("#cap-call");
  const swap = $<HTMLInputElement>("#cap-swap");
  const sw = $<HTMLButtonElement>(".bd-switch");
  const lower = $<HTMLButtonElement>('[data-turn="-1"]');
  const raise = $<HTMLButtonElement>('[data-turn="1"]');
  const lamp = $<HTMLElement>("[data-lamp]");
  const keys = $<HTMLElement>("[data-keys]");
  const save = $<HTMLButtonElement>("[data-save]");

  const knob = mountKnob($("[data-dial]"), {
    value: draft.perDay,
    labelledBy: "cap-day-name",
    describedBy: "cap-day-hint",
    onInput: (v) => {
      draft.perDay = v;
      note = null;
      update();
    },
  });

  const writeFields = () => {
    call.value = draft.perPayment;
    swap.value = draft.perSwap;
    sw.setAttribute("aria-checked", String(draft.autopay));
    knob.set(draft.perDay);
  };
  const dirty = () =>
    !same(parseUsd(draft.perPayment), saved.perPayment) || !same(draft.perDay, saved.perDay) || !same(parseUsd(draft.perSwap), saved.perSwap) || draft.autopay !== saved.autopay;
  const problem = (): string | null => {
    const pp = parseUsd(draft.perPayment);
    const ps = parseUsd(draft.perSwap);
    if (!(pp > 0)) return "Per call needs an amount above $0, such as 0.10.";
    if (pp < 0.000001) return "Per call can go down to $0.000001, the smallest unit of USDG and USDC.";
    if (!(ps > 0)) return "Per swap needs an amount above $0, such as 25.00.";
    if (pp > draft.perDay + EPS) return `Per call, ${usd(pp)}, is above the daily cap of ${usd(draft.perDay)}. Lower it, or turn the knob up.`;
    return null;
  };
  const setLamp = (kind: "settled" | "awaiting" | "refused" | "", text: string) => {
    lamp.className = kind ? `lamp lamp--${kind}` : "lamp bd-quiet";
    if (lamp.textContent !== text) lamp.textContent = text;
  };

  const fits = () => {
    const pp = parseUsd(draft.perPayment);
    const all = RESOURCES.length;
    const n = RESOURCES.filter((r) => Number(r.price) <= pp + EPS).length;
    $("[data-fits]").textContent = !(pp > 0)
      ? "Siro refuses any call that costs more than this."
      : n === all
        ? `At ${usd(pp)} a call, all ${all} tools can run.`
        : n === 0
          ? `At ${usd(pp)} a call, no tool can run. The cheapest costs ${usd(CHEAPEST)}.`
          : `At ${usd(pp)} a call, ${n} of ${all} tools can run. Siro refuses the other ${all - n} before signing.`;
  };
  const autopay = () => {
    const pp = parseUsd(draft.perPayment);
    $("[data-auto]").textContent = draft.autopay
      ? `On: when Ask pays with this budget, one quote per message you send pays without asking, if it fits ${pp > 0 ? usd(pp) : "the per-call cap"} a call and ${usd(draft.perDay)} a day. Swaps always ask.`
      : "Off: Ask shows each quote and waits for your yes.";
  };
  const today = () => {
    const spent = spentToday(agentAddresses());
    const cap = draft.perDay;
    $("[data-meter]").style.setProperty("--v", String(Math.min(1, spent / cap)));
    $("[data-today]").textContent =
      spent > cap + EPS
        ? `${usd(spent)} spent today, already past this cap. Siro refuses every payment until midnight on this device, in ${untilMidnight()}.`
        : `${usd(spent)} spent today. The cap starts over at midnight on this device, in ${untilMidnight()}.`;
    $("[data-read]").textContent = `spend log · ${utc()}`;
  };
  const state = () => {
    const p = problem();
    const d = dirty();
    keys.hidden = !d;
    save.disabled = !!p;
    let s: CapsState = isStored() ? "saved" : "defaults";
    if (d && p) {
      s = "invalid";
      setLamp("refused", p);
    } else if (d) {
      s = "unsaved";
      setLamp("awaiting", linked ? `The link set per call to ${usd(parseUsd(draft.perPayment))}. Nothing is saved until you press Save.` : "Unsaved changes. Save them, or Discard to go back.");
    } else if (note) setLamp(note.kind, note.text);
    else if (s === "saved") setLamp("settled", savedAt ? `Saved in this browser at ${clock(savedAt)}.` : "Saved in this browser.");
    else setLamp("", `New-wallet defaults: ${usd(saved.perPayment)} a call, ${usd(saved.perDay)} a day, ${usd(saved.perSwap)} a swap, Autopay ${saved.autopay ? "on" : "off"}.`);
    o.onState?.(s);
  };
  const update = () => {
    $("[data-day]").textContent = usd(draft.perDay);
    hold(lower, knob.atEnd(-1));
    hold(raise, knob.atEnd(1));
    $("[data-hint]").textContent = knob.atEnd(-1) ? "This is the lowest setting." : knob.atEnd(1) ? "This is the highest setting." : "Drag the knob, or use the arrow keys on it.";
    fits();
    autopay();
    today();
    state();
  };

  call.addEventListener("input", () => {
    draft.perPayment = call.value;
    linked = false;
    note = null;
    update();
  });
  swap.addEventListener("input", () => {
    draft.perSwap = swap.value;
    note = null;
    update();
  });
  sw.addEventListener("click", () => {
    draft.autopay = !draft.autopay;
    sw.setAttribute("aria-checked", String(draft.autopay));
    note = null;
    update();
  });
  lower.addEventListener("click", () => knob.step(-1));
  raise.addEventListener("click", () => knob.step(1));

  // Save and Discard hide themselves; focus moves to the lamp so it is not lost with them.
  const settle = (fromKeys: boolean) => {
    dropLinkParam();
    writeFields();
    update();
    if (fromKeys) lamp.focus();
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (problem() || !dirty()) return;
    const fromKeys = keys.contains(document.activeElement);
    const next: Limits = { perPayment: parseUsd(draft.perPayment), perDay: draft.perDay, perSwap: parseUsd(draft.perSwap), autopay: draft.autopay };
    setLimits(next);
    const back = limits();
    if (!isStored() || !same(back.perPayment, next.perPayment) || !same(back.perDay, next.perDay) || !same(back.perSwap, next.perSwap) || back.autopay !== next.autopay) {
      setLamp("refused", "This browser blocked site storage, so the caps were not saved.");
      return;
    }
    saved = back;
    draft = draftOf(back);
    savedAt = new Date();
    linked = false;
    note = null;
    settle(fromKeys);
    o.onSaved(back);
  });
  $("[data-discard]").addEventListener("click", () => {
    const fromKeys = keys.contains(document.activeElement);
    saved = limits();
    draft = draftOf(saved);
    linked = false;
    note = null;
    settle(fromKeys);
  });

  // "Starts over in 3 h 20 min" goes stale; refresh it once a minute while the page is visible.
  const timer = window.setInterval(() => {
    if (!form.isConnected) return clearInterval(timer);
    if (!document.hidden) today();
  }, 60_000);

  writeFields();
  update();
  return {
    save,
    refreshToday: today,
    // Another tab saved caps. Take them unless there are unsaved edits here.
    reload() {
      const wasDirty = dirty();
      saved = limits();
      if (!wasDirty) {
        draft = draftOf(saved);
        writeFields();
      }
      update();
    },
  };
}
