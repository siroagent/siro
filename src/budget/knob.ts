// The daily-cap knob: render 03 turned about its own axis. A log scale with 1-2-5 detents puts $1.00,
// the new-wallet default, at twelve o'clock, which is where the render's notch already points.
import { usd } from "./util";

const DETENTS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
const MIN = DETENTS[0];
const MAX = DETENTS[DETENTS.length - 1];
const SWEEP = 270;
// The scale is drawn in a 140-unit box. The render's 100-unit box sits in the middle of it, and the knob
// turns about (50.1%, 49.1%) of the render, its real centre in the image.
const BOX = 140;
const CX = 20 + 50.1;
const CY = 20 + 49.1;
const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const angleOf = (v: number) => -SWEEP / 2 + (SWEEP * Math.log(clamp(v, MIN, MAX) / MIN)) / Math.log(MAX / MIN);
const nearest = (deg: number) => DETENTS.reduce((best, d) => (Math.abs(angleOf(d) - deg) < Math.abs(angleOf(best) - deg) ? d : best), MIN);
function polar(r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)];
}

function scale() {
  const ticks = DETENTS.map((d) => {
    const major = d === MIN || d === 1 || d === MAX;
    const [x1, y1] = polar(47.5, angleOf(d));
    const [x2, y2] = polar(major ? 55 : 52, angleOf(d));
    return `<line class="bd-dial__tick${major ? " is-major" : ""}" data-v="${d}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join("");
  const marks = [MIN, 1, MAX]
    .map((d) => {
      const [x, y] = polar(62, angleOf(d));
      return `<span class="bd-dial__mark" style="left:${((x / BOX) * 100).toFixed(2)}%;top:${((y / BOX) * 100).toFixed(2)}%">${usd(d)}</span>`;
    })
    .join("");
  return `<svg class="bd-dial__scale" viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true" focusable="false">${ticks}</svg><div aria-hidden="true">${marks}</div>`;
}

export type Knob = {
  readonly value: number;
  /** Moves the knob without reporting it, e.g. after Discard. */
  set(v: number): void;
  /** One detent (or n) up or down, reported like a turn by hand. */
  step(dir: 1 | -1, n?: number): void;
  atEnd(dir: 1 | -1): boolean;
};

export function mountKnob(host: HTMLElement, o: { value: number; labelledBy: string; describedBy: string; onInput(v: number): void }): Knob {
  let v = o.value;
  host.innerHTML = `${scale()}<div class="bd-knob" role="slider" tabindex="0" aria-labelledby="${o.labelledBy}" aria-describedby="${o.describedBy}"><img src="/img/03-knob-900.webp" width="900" height="900" alt="" draggable="false" decoding="async" fetchpriority="high"></div>`;
  const knob = host.querySelector<HTMLElement>(".bd-knob")!;
  const img = knob.querySelector("img")!;
  const ticks = [...host.querySelectorAll<SVGLineElement>(".bd-dial__tick")];

  const turn = (deg: number) => (img.style.transform = `rotate(${deg.toFixed(2)}deg)`);
  // A value saved outside the knob's range (older pages allowed any number) widens the reported range,
  // so aria-valuenow never falls outside aria-valuemin/max.
  const report = () => {
    knob.setAttribute("aria-valuemin", String(Math.min(MIN, v)));
    knob.setAttribute("aria-valuemax", String(Math.max(MAX, v)));
    knob.setAttribute("aria-valuenow", String(v));
    knob.setAttribute("aria-valuetext", `${usd(v)} a day`);
    for (const t of ticks) t.classList.toggle("is-on", Math.abs(Number(t.dataset.v) - v) < EPS);
  };
  const change = (nv: number) => {
    if (Math.abs(nv - v) < EPS) return;
    v = nv;
    report();
    o.onInput(v);
  };
  const next = (dir: 1 | -1, n = 1) => {
    let i = -1;
    if (dir > 0) i = DETENTS.findIndex((d) => d > v + EPS);
    else for (let j = DETENTS.length - 1; j >= 0 && i < 0; j--) if (DETENTS[j] < v - EPS) i = j;
    if (i < 0) return v;
    return DETENTS[clamp(i + dir * (n - 1), 0, DETENTS.length - 1)];
  };

  knob.addEventListener("keydown", (e) => {
    const to: Record<string, () => number> = {
      ArrowUp: () => next(1),
      ArrowRight: () => next(1),
      "+": () => next(1),
      "=": () => next(1),
      ArrowDown: () => next(-1),
      ArrowLeft: () => next(-1),
      "-": () => next(-1),
      PageUp: () => next(1, 2),
      PageDown: () => next(-1, 2),
      Home: () => MIN,
      End: () => MAX,
    };
    if (!to[e.key]) return;
    e.preventDefault();
    change(to[e.key]());
    turn(angleOf(v));
  });

  // Dragging turns the render freely; the value is the nearest detent, and the knob settles on it on release.
  let drag: { last: number; deg: number } | null = null;
  const pointerDeg = (e: PointerEvent) => {
    const r = knob.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), r.top + r.height / 2 - e.clientY) * 180) / Math.PI;
  };
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    knob.focus();
    knob.setPointerCapture(e.pointerId);
    knob.classList.add("is-turning");
    drag = { last: pointerDeg(e), deg: angleOf(v) };
  });
  knob.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const a = pointerDeg(e);
    drag.deg = clamp(drag.deg + (((a - drag.last + 540) % 360) - 180), -SWEEP / 2, SWEEP / 2);
    drag.last = a;
    turn(drag.deg);
    change(nearest(drag.deg));
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    knob.classList.remove("is-turning");
    turn(angleOf(v));
  };
  knob.addEventListener("pointerup", release);
  knob.addEventListener("pointercancel", release);
  knob.addEventListener("lostpointercapture", release);

  report();
  turn(angleOf(v));
  return {
    get value() {
      return v;
    },
    set(nv) {
      v = nv;
      report();
      turn(angleOf(v));
    },
    step(dir, n = 1) {
      change(next(dir, n));
      turn(angleOf(v));
    },
    atEnd(dir) {
      return dir > 0 ? v >= MAX - EPS : v <= MIN + EPS;
    },
  };
}
