// The per-call cap knob and the price ruler beside it, on one log scale from $0.001 to $1.00. The knob
// snaps to 1-2-5 detents; the ruler stacks every catalog price on the same scale and shows where the cap cuts.
import { RESOURCES } from "../../shared/catalog";
import { usd } from "./caps";

const DETENTS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
const DECADES = [0.001, 0.01, 0.1, 1];
const LOW = DETENTS[0];
const HIGH = DETENTS[DETENTS.length - 1];
const SWEEP = 135; // degrees either side of 12 o'clock

/** Position on the log scale: 0 at $0.001, 1 at $1.00. */
const scale = (v: number) => Math.min(1, Math.max(0, Math.log10(v / LOW) / Math.log10(HIGH / LOW)));
const angle = (v: number) => -SWEEP + 2 * SWEEP * scale(v);
const pc = (t: number) => `${(t * 100).toFixed(2)}%`;
const runs = (cap: number) => RESOURCES.filter((r) => Number(r.price) <= cap + 1e-12).length;

// The knob image fills 10% to 90% of its seat (a 200-unit square here) and turns about (50.1%, 49.1%) of itself.
const CX = 20 + 160 * 0.501;
const CY = 20 + 160 * 0.491;
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const;
};

function ticks() {
  return DETENTS.map((v) => {
    const major = DECADES.includes(v);
    const [x1, y1] = polar(angle(v), major ? 73 : 77);
    const [x2, y2] = polar(angle(v), 84);
    return `<line data-v="${v}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" vector-effect="non-scaling-stroke"/>`;
  }).join("");
}

function seatLabels() {
  return DECADES.map((v) => {
    const [x, y] = polar(angle(v), 96);
    return `<span class="seat__lbl" aria-hidden="true" style="left:${pc(x / 200)};top:${pc(y / 200)}">${usd(v)}</span>`;
  }).join("");
}

function ruler() {
  const byPrice = new Map<number, number>();
  for (const r of RESOURCES) byPrice.set(Number(r.price), (byPrice.get(Number(r.price)) ?? 0) + 1);
  const stacks = [...byPrice].sort((a, b) => a[0] - b[0]);
  return `
    <div class="ruler__axis">
      ${DETENTS.map((v) => `<i class="ruler__tick${DECADES.includes(v) ? " ruler__tick--decade" : ""}" style="left:${pc(scale(v))}"></i>`).join("")}
      ${stacks.map(([p, n]) => `<span class="ruler__stack" data-p="${p}" style="left:${pc(scale(p))}">${"<i></i>".repeat(n)}</span>`).join("")}
      ${stacks
        .filter(([, n]) => n > 1)
        .map(([p, n]) => `<span class="ruler__count" data-n="${n}" style="left:${pc(scale(p))};--n:${n}">${n}</span>`)
        .join("")}
      <span class="ruler__cap"><b></b></span>
    </div>
    <div class="ruler__scale">${DECADES.map((v) => `<span style="left:${pc(scale(v))}">${usd(v)}</span>`).join("")}</div>`;
}

/** Same-price tools stack into one tick; their count shows above it unless a larger stack's count is in the way. */
function declutter(axis: HTMLElement) {
  const counts = [...axis.querySelectorAll<HTMLElement>(".ruler__count")].sort((a, b) => Number(b.dataset.n) - Number(a.dataset.n));
  const kept: DOMRect[] = [];
  for (const c of counts) {
    c.hidden = false;
    const r = c.getBoundingClientRect();
    const blocked = kept.some((k) => r.left < k.right + 3 && r.right > k.left - 3 && r.top < k.bottom && r.bottom > k.top);
    c.hidden = blocked;
    if (!blocked) kept.push(r);
  }
}

export function mountCapKnob() {
  const seat = document.getElementById("cap-knob");
  const img = document.getElementById("cap-img");
  const tickSvg = document.getElementById("cap-ticks");
  const value = document.getElementById("cap-val");
  const down = document.getElementById("cap-down");
  const up = document.getElementById("cap-up");
  const sum = document.getElementById("cap-sum");
  const budget = document.getElementById("cap-budget") as HTMLAnchorElement | null;
  const rulerEl = document.getElementById("ruler");
  if (!seat || !img || !tickSvg || !value || !down || !up || !sum || !budget || !rulerEl) return;

  const total = RESOURCES.length;
  const prices = RESOURCES.map((r) => Number(r.price));
  tickSvg.innerHTML = ticks();
  seat.insertAdjacentHTML("beforeend", seatLabels());
  rulerEl.innerHTML = ruler();
  rulerEl.setAttribute("role", "img");
  rulerEl.setAttribute("aria-label", `${total} catalog prices on a log scale from ${usd(LOW)} to ${usd(HIGH)}. The cheapest is ${usd(Math.min(...prices))}, the dearest ${usd(Math.max(...prices))}.`);
  const axis = rulerEl.querySelector<HTMLElement>(".ruler__axis")!;
  const capLine = axis.querySelector<HTMLElement>(".ruler__cap")!;
  const stacks = [...axis.querySelectorAll<HTMLElement>(".ruler__stack")];
  const lines = [...tickSvg.querySelectorAll<SVGLineElement>("line")];
  new ResizeObserver(() => declutter(axis)).observe(axis);

  seat.setAttribute("role", "slider");
  seat.tabIndex = 0;
  seat.setAttribute("aria-label", "Per-call cap");
  seat.setAttribute("aria-valuemin", String(LOW));
  seat.setAttribute("aria-valuemax", String(HIGH));
  down.hidden = false;
  up.hidden = false;

  let at = DETENTS.indexOf(0.1);

  const capLabel = capLine.querySelector("b")!;
  const set = (i: number) => {
    at = Math.max(0, Math.min(DETENTS.length - 1, i));
    const v = DETENTS[at];
    const n = runs(v);
    const refused = total - n;
    img.style.transform = `rotate(${angle(v).toFixed(2)}deg)`;
    lines.forEach((l) => l.classList.toggle("on", Number(l.dataset.v) <= v + 1e-12));
    value.textContent = usd(v);
    seat.setAttribute("aria-valuenow", String(v));
    seat.setAttribute("aria-valuetext", `${usd(v)} a call, ${n} of ${total} tools run`);
    down.setAttribute("aria-disabled", String(at === 0));
    up.setAttribute("aria-disabled", String(at === DETENTS.length - 1));
    capLine.style.left = pc(scale(v));
    capLine.classList.toggle("is-flip", scale(v) > 0.8);
    capLabel.textContent = `${usd(v)} cap`;
    stacks.forEach((s) => s.classList.toggle("is-over", Number(s.dataset.p) > v + 1e-12));
    sum.innerHTML = `At <b>${usd(v)}</b> a call, <b>${n}</b> of ${total} tools run.${refused ? ` The other ${refused} are refused before anything is signed.` : " Nothing in the catalog costs more."}`;
    budget.href = `/budget?per-call=${v}`;
  };

  // Pointer: the notch follows the pointer's angle around the knob and snaps to the nearest detent.
  const fromPointer = (e: PointerEvent) => {
    const b = seat.getBoundingClientRect();
    let deg = (Math.atan2(e.clientX - (b.left + (b.width * CX) / 200), -(e.clientY - (b.top + (b.height * CY) / 200))) * 180) / Math.PI;
    // Below the knob, between the two stops, hold the end the pointer came from.
    if (Math.abs(deg) > SWEEP) deg = at >= DETENTS.length / 2 ? SWEEP : -SWEEP;
    const t = (deg + SWEEP) / (2 * SWEEP);
    let best = 0;
    DETENTS.forEach((v, i) => {
      if (Math.abs(scale(v) - t) < Math.abs(scale(DETENTS[best]) - t)) best = i;
    });
    if (best !== at) set(best);
  };

  seat.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    seat.focus({ preventScroll: true });
    seat.setPointerCapture(e.pointerId);
    seat.classList.add("is-turning");
    fromPointer(e);
  });
  seat.addEventListener("pointermove", (e) => {
    if (seat.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  const release = () => seat.classList.remove("is-turning");
  seat.addEventListener("pointerup", release);
  seat.addEventListener("pointercancel", release);

  seat.addEventListener("keydown", (e) => {
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, PageUp: at + 3, PageDown: at - 3, Home: 0, End: DETENTS.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    set(moves[e.key]);
  });
  down.addEventListener("click", () => set(at - 1));
  up.addEventListener("click", () => set(at + 1));

  set(at);
}
