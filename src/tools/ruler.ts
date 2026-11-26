// The price ruler on /tools: one tick per tool on a log scale of price per call, stacked where two
// tools cost the same, and the cap line (two rails) where the Budget starts refusing to sign.
import type { Resource } from "../../shared/catalog";
import { money } from "./format";

export type Ruler = {
  /** Dim the ticks of tools the current filter hides. */
  paint(shown: Set<string>): void;
  /** Light one tool's tick, or none. */
  light(id: string | null): void;
};

export function mountRuler(el: HTMLElement, tools: Resource[], cap: number, capLabel: string): Ruler {
  const prices = tools.map((r) => Number(r.price));
  const lo = Math.floor(Math.log10(Math.min(...prices, ...(cap > 0 ? [cap] : []))));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...prices, cap))));
  const x = (usd: number) => (usd > 0 ? Math.min(100, Math.max(0, ((Math.log10(usd) - lo) / (hi - lo)) * 100)) : 0);

  const stack = new Map<number, number>();
  const ticks = tools.map((r, i) => {
    const p = prices[i];
    const k = stack.get(p) ?? 0;
    stack.set(p, k + 1);
    return `<i class="tl-tick${p > cap + 1e-9 ? " is-over" : ""}" data-id="${r.id}" style="left:${x(p).toFixed(2)}%;--k:${k}"></i>`;
  });

  // 1-2-5 marks; on phones only the decades keep their numbers.
  const marks: string[] = [];
  for (let e = lo; e <= hi; e++) {
    for (const m of [1, 2, 5]) {
      if (e === hi && m > 1) break;
      const v = m * 10 ** e;
      marks.push(`<span${m === 1 ? "" : ' class="is-minor"'} style="left:${x(v).toFixed(2)}%"><b>${money(v)}</b></span>`);
    }
  }

  const cx = x(cap);
  el.style.setProperty("--stack", String(Math.max(...stack.values())));
  el.innerHTML = `<div class="tl-ticks">${ticks.join("")}</div><div class="tl-axis">${marks.join("")}</div><div class="tl-capline${cx > 62 ? " is-flip" : ""}" style="left:${cx.toFixed(2)}%"><span>${capLabel}</span></div>`;

  const byId = new Map([...el.querySelectorAll<HTMLElement>(".tl-tick")].map((t) => [t.dataset.id!, t]));
  let lit: HTMLElement | null = null;
  return {
    paint(shown) {
      for (const [id, t] of byId) t.classList.toggle("is-out", !shown.has(id));
    },
    light(id) {
      lit?.classList.remove("is-lit");
      lit = id ? (byId.get(id) ?? null) : null;
      lit?.classList.add("is-lit");
    },
  };
}
