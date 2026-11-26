// Docs: a sticky index, the reading column, and a live panel that runs a real check for the section
// in view. Below 1180px each section carries its own check inline, collapsed until opened.
import { RESOURCES, formatPrice } from "../../shared/catalog";
import { esc, mountShell, toast } from "../shell";
import { hostIn, mountCheck, type CheckId } from "./live";
import "./docs.css";

mountShell("docs");

/** Wide enough for the index, the reading column and the live panel side by side. */
const THREE_PANELS = matchMedia("(min-width: 1180px)");
/** Wide enough for the sticky index beside the text. */
const WITH_INDEX = matchMedia("(min-width: 760px)");

for (const el of document.querySelectorAll("[data-count]")) el.textContent = String(RESOURCES.length);
drawCatalog();
wireCopyKeys();
markScrollingCode();
wireIndex();
followSections();
wireInlineChecks();

function drawCatalog() {
  const body = document.getElementById("cat");
  if (!body) return;
  body.innerHTML = RESOURCES.map(
    (r) => `<tr><td><a href="/tools/${r.id}">${esc(r.name)}</a><code class="cat__ep">POST /v1/${r.id}</code></td><td class="num">${formatPrice(r.price)}</td><td>${r.slow ? "minutes" : "seconds"}</td></tr>`,
  ).join("");
}

/** Clipboard API first; where it is missing, refused or never answers, select the code and copy that. */
async function copyCode(code: HTMLElement): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard API");
    await Promise.race([navigator.clipboard.writeText(code.textContent ?? ""), new Promise((_, no) => window.setTimeout(() => no(new Error("no answer")), 1500))]);
    return true;
  } catch {
    const sel = getSelection();
    sel?.selectAllChildren(code);
    try {
      if (!document.execCommand("copy")) return false;
      sel?.removeAllRanges();
      return true;
    } catch {
      return false;
    }
  }
}

function wireCopyKeys() {
  document.addEventListener("click", async (e) => {
    const key = (e.target as Element).closest<HTMLButtonElement>("[data-copy]");
    const box = key?.closest("figure");
    const code = box?.querySelector("pre");
    if (!key || !box || !code) return;
    const what = box.querySelector("figcaption b")?.textContent ?? "the code";
    if (await copyCode(code)) {
      key.textContent = "Copied";
      window.setTimeout(() => (key.textContent = "Copy"), 1600);
      toast(`Copied: ${what}.`);
    } else {
      toast("The browser blocked copying. The code is selected: press ⌘C or Ctrl C.");
    }
  });
}

/** Code lines stay whole, so a box can scroll sideways. data-more names the edge it continues past,
 *  and the CSS fades that edge. */
function markScrollingCode() {
  const pres = [...document.querySelectorAll<HTMLElement>(".code-box pre.code")];
  const mark = (pre: HTMLElement) => {
    const left = pre.scrollLeft > 2;
    const right = pre.scrollLeft < pre.scrollWidth - pre.clientWidth - 2;
    const more = left && right ? "both" : left ? "left" : right ? "right" : "";
    if (more) pre.dataset.more = more;
    else delete pre.dataset.more;
  };
  const sized = new ResizeObserver((entries) => entries.forEach((e) => mark(e.target as HTMLElement)));
  for (const pre of pres) {
    sized.observe(pre);
    pre.addEventListener("scroll", () => mark(pre), { passive: true });
  }
  // The mono face can land after the first measure and change every line's width.
  void document.fonts?.ready.then(() => pres.forEach(mark));
}

/** The index is open beside the text, where its summary is only a title; on phones it stays a
 *  one-line disclosure above the page. */
function wireIndex() {
  const toc = document.querySelector<HTMLDetailsElement>("[data-toc]");
  const summary = toc?.querySelector("summary");
  if (!toc || !summary) return;
  const sync = () => {
    toc.open = WITH_INDEX.matches;
    summary.tabIndex = WITH_INDEX.matches ? -1 : 0;
  };
  sync();
  WITH_INDEX.addEventListener("change", sync);
  // A screen reader can still press the summary; beside the text that would only empty the column.
  toc.addEventListener("toggle", () => {
    if (WITH_INDEX.matches && !toc.open) toc.open = true;
  });
}

function followSections() {
  const sections = [...document.querySelectorAll<HTMLElement>(".doc[id]")];
  const links = new Map([...document.querySelectorAll<HTMLAnchorElement>(".toc a")].map((a) => [a.hash.slice(1), a] as const));
  const aside = document.getElementById("live");
  const panel = aside ? hostIn(aside, false) : null;
  const forLine = aside?.querySelector<HTMLElement>("[data-check-for]") ?? null;
  const back = forLine?.querySelector<HTMLAnchorElement>("[data-check-back]") ?? null;
  const inView = new Set<string>();
  let current = "";
  let shown = "";
  let settle: number | undefined;

  const mark = (id: string) => {
    current = id;
    for (const [key, a] of links) {
      if (key === id) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
  };

  /** `asked`: the reader jumped here on purpose, so the check speaks its answer. Scrolling past stays quiet. */
  const show = (asked = false) => {
    if (!panel || !THREE_PANELS.matches || !current || shown === current) return;
    const check = document.getElementById(current)?.dataset.check as CheckId | undefined;
    if (!check) return;
    shown = current;
    // The panel sits after the article, so this link is the keyboard's way back to the section.
    if (forLine && back) {
      back.href = `#${current}`;
      back.textContent = links.get(current)?.textContent ?? current;
      forLine.hidden = false;
    }
    // Quickstart and x402 share a check: keep its answer instead of starting over.
    if (panel.check !== check) {
      panel.announce = asked;
      mountCheck(check, panel);
    }
  };

  // A section is in view while it crosses a thin band a fifth of the way down the screen.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inView.add(e.target.id);
        else inView.delete(e.target.id);
      }
      const next = sections.find((s) => inView.has(s.id))?.id;
      if (!next || next === current) return;
      mark(next);
      // Sections scrolled past quickly never fire a request; the panel follows once scrolling settles.
      clearTimeout(settle);
      settle = window.setTimeout(() => show(), 200);
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  for (const s of sections) io.observe(s);
  THREE_PANELS.addEventListener("change", () => {
    shown = "";
    show();
  });

  // Keyboard users reach the panel from any section through its focus-only link. Focus lands on the
  // answer itself, so it is read first; the keys follow on Tab.
  document.addEventListener("click", (e) => {
    const jump = (e.target as Element).closest<HTMLAnchorElement>("[data-to-live]");
    const section = jump?.closest<HTMLElement>(".doc");
    if (!jump || !section || !aside || !THREE_PANELS.matches) return;
    e.preventDefault();
    clearTimeout(settle);
    mark(section.id);
    show(true);
    (aside.querySelector<HTMLElement>("[data-check-out]") ?? aside).focus();
  });
}

/** Tablet and phone: a section's check mounts the first time its details opens. */
function wireInlineChecks() {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.check-inline[data-check]")) {
    let mounted = false;
    d.addEventListener("toggle", () => {
      if (!d.open || mounted) return;
      mounted = true;
      mountCheck(d.dataset.check as CheckId, hostIn(d, true));
    });
  }
}
