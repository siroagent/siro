// The engraved S on the quote faceplate. Six stations sit in the lane between its two rails and the
// chrome ball reports where the quote is. Phones get the same route as a one-line strip.
import { MARK, ballSvg } from "../shell";

type Pt = readonly [number, number];

// The lane's centre line in the mark's own units (viewBox 0 0 741 980), entering at the top right.
// Traced against the mark: it stays midway between the rails all the way to the exit at the bottom left.
const LANE: Pt[][] = [
  [[741, 98.5], [326, 98.5]],
  [[326, 98.5], [205, 98.5], [112, 190], [112, 305]],
  [[112, 305], [112, 400], [200, 440], [300, 477]],
  [[300, 477], [545, 562]],
  [[545, 562], [610, 585], [635, 640], [635, 709]],
  [[635, 709], [635, 820], [560, 887], [435, 887]],
  [[435, 887], [0, 887]],
];
const W = 741;
const H = 980;

type Side = "r" | "l" | "t" | "b";
export const STATIONS: { name: string; at: Pt; side: Side }[] = [
  { name: "Brief", at: [700, 98.5], side: "r" },
  { name: "Quote", at: [420, 98.5], side: "t" },
  { name: "Cap", at: [112, 305], side: "l" },
  { name: "Sign", at: [635, 709], side: "r" },
  { name: "Run", at: [300, 887], side: "b" },
  { name: "Settle", at: [40, 887], side: "l" },
];
/** Brief, Quote and Cap happen on this page; Sign, Run and Settle happen in Ask, after the yes. */
export const HERE = 3;

function along(seg: Pt[], t: number): Pt {
  const [a, b, c, d] = seg;
  if (seg.length === 2) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const u = 1 - t;
  const mix = (i: 0 | 1) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i];
  return [mix(0), mix(1)];
}

// The lane as a dense polyline with running lengths, so a position along it is a lookup.
const POINTS: Pt[] = [];
for (const seg of LANE) {
  const n = seg.length === 2 ? 1 : 40;
  for (let i = POINTS.length ? 1 : 0; i <= n; i++) POINTS.push(along(seg, i / n));
}
const RUN: number[] = [0];
for (let i = 1; i < POINTS.length; i++) RUN.push(RUN[i - 1] + Math.hypot(POINTS[i][0] - POINTS[i - 1][0], POINTS[i][1] - POINTS[i - 1][1]));

function pointAt(s: number): Pt {
  let lo = 0;
  let hi = RUN.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (RUN[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = RUN[hi] === RUN[lo] ? 0 : Math.min(1, Math.max(0, (s - RUN[lo]) / (RUN[hi] - RUN[lo])));
  return [POINTS[lo][0] + (POINTS[hi][0] - POINTS[lo][0]) * f, POINTS[lo][1] + (POINTS[hi][1] - POINTS[lo][1]) * f];
}

const nearest = (p: Pt) => RUN[POINTS.reduce((best, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(POINTS[best][0] - p[0], POINTS[best][1] - p[1]) ? i : best), 0)];
const STOPS = STATIONS.map((st) => nearest(st.at));

/** A position in station units (0 = Brief, 2 = Cap) as a length along the lane. */
function lengthAt(p: number) {
  const i = Math.max(0, Math.min(STOPS.length - 2, Math.floor(p)));
  return STOPS[i] + (STOPS[i + 1] - STOPS[i]) * Math.max(0, Math.min(1, p - i));
}

const pathOf = (segs: Pt[][]) => segs.map((s, i) => (i ? "" : `M${s[0]}`) + (s.length === 2 ? `L${s[1]}` : `C${s[1]} ${s[2]} ${s[3]}`)).join("");
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;

function labelStyle({ at: [x, y], side }: { at: Pt; side: Side }) {
  if (side === "r") return `left:100%;top:${pct(y, H)}`;
  if (side === "l") return `right:100%;top:${pct(y, H)}`;
  if (side === "t") return `left:${pct(x, W)};bottom:100%`;
  return `left:${pct(x, W)};top:100%`;
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export type Route = ReturnType<typeof mountRoute>;

export function mountRoute(gauge: HTMLElement, strip: HTMLElement) {
  const rails = MARK.match(/ d="([^"]+)"/)?.[1] ?? "";
  const capSeg = LANE.findIndex((s) => s[0][0] === STATIONS[2].at[0] && s[0][1] === STATIONS[2].at[1]);
  gauge.innerHTML = `
    <svg class="gauge__s" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
      <path class="gauge__rails" fill-rule="evenodd" d="${rails}"/>
      <path class="gauge__later" d="${pathOf(LANE.slice(capSeg))}"/>
    </svg>
    ${STATIONS.map((st, i) => `<i class="gauge__stn${i >= HERE ? " is-later" : ""}" style="left:${pct(st.at[0], W)};top:${pct(st.at[1], H)}"></i>`).join("")}
    ${STATIONS.map((st, i) => `<span class="gauge__lbl gauge__lbl--${st.side}${i >= HERE ? " is-later" : ""}" style="${labelStyle(st)}">${st.name}</span>`).join("")}
    <span class="gauge__ball">${ballSvg(24, "route-s")}</span>`;
  strip.innerHTML = `
    <ol class="strip__stns">${STATIONS.map((st, i) => `<li class="strip__stn${i >= HERE ? " is-later" : ""}"><i></i><span>${st.name}</span></li>`).join("")}</ol>
    <span class="strip__ball">${ballSvg(24, "route-l")}</span>`;

  const gBall = gauge.querySelector<HTMLElement>(".gauge__ball")!;
  const sBall = strip.querySelector<HTMLElement>(".strip__ball")!;
  const marks = [gauge.querySelectorAll<HTMLElement>(".gauge__stn"), strip.querySelectorAll<HTMLElement>(".strip__stn")];
  const labels = gauge.querySelectorAll<HTMLElement>(".gauge__lbl");

  let pos = 0;
  let raf = 0;
  let settle: ((finished: boolean) => void) | null = null;

  function place(p: number) {
    pos = p;
    const [x, y] = pointAt(lengthAt(p));
    gBall.style.left = pct(x, W);
    gBall.style.top = pct(y, H);
    sBall.style.left = `${(((p + 0.5) / STATIONS.length) * 100).toFixed(2)}%`;
    for (const list of marks) list.forEach((m, i) => m.classList.toggle("is-on", i <= p + 0.001));
    labels.forEach((l, i) => l.classList.toggle("is-on", i <= p + 0.001));
  }

  function stop() {
    cancelAnimationFrame(raf);
    settle?.(false);
    settle = null;
  }

  /** Moves the ball to a station position; resolves false when something else moved it first. */
  function glide(to: number, ms: number, ease = easeOut): Promise<boolean> {
    stop();
    if (reduced() || ms <= 0) {
      place(to);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const from = pos;
      const t0 = performance.now();
      // Frames stop in a background tab; the timer still lands the ball so the verdict is not held back.
      const guard = window.setTimeout(() => finish(true), ms + 150);
      const finish = (arrived: boolean) => {
        if (settle !== finish) return;
        settle = null;
        clearTimeout(guard);
        cancelAnimationFrame(raf);
        if (arrived) place(to);
        resolve(arrived);
      };
      settle = finish;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        place(from + (to - from) * ease(k));
        if (k < 1) raf = requestAnimationFrame(step);
        else finish(true);
      };
      raf = requestAnimationFrame(step);
    });
  }

  place(0);
  return {
    /** Straight to a station, no travel: a quote read from the cache was never in flight. */
    jump(p: number) {
      stop();
      place(p);
    },
    /** Back to Brief. */
    reset() {
      return glide(0, pos ? 220 : 0, easeInOut);
    },
    /** The request is out: the ball leaves Brief and closes in on Quote without reaching it. */
    depart() {
      stop();
      if (reduced()) return;
      const from = pos;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = now - t0;
        place(from + (0.82 - from) * (1 - Math.exp(-t / 500)));
        if (t < 3000) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    /** The 402 is back after `elapsed` ms: reach Quote (240 ms of travel at least), then Cap in 280 ms. */
    async arrive(elapsed: number, atQuote: () => void, atCap: () => void) {
      if (!(await glide(1, Math.max(120, 240 - elapsed)))) return;
      atQuote();
      if (!(await glide(2, 280, easeInOut))) return;
      atCap();
    },
    /** Marks the Cap station refused when the quote is over a cap. */
    over(refused: boolean) {
      for (const list of marks) list[2]?.classList.toggle("is-over", refused);
      labels[2]?.classList.toggle("is-over", refused);
    },
  };
}
