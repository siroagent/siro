// "Three ways in": HTTP, CLI and MCP snippets for the tool chosen on the faceplate, and the 402 the
// faceplate captured for it, decoded.
import type { Resource } from "../../shared/catalog";
import { esc } from "../shell";
import { utc, type Capture } from "./quote";
import { MCP_CONFIG, MCP_REMOTE, cliFor, copyText, curlFor } from "./snippets";

const WAYS = ["http", "cli", "mcp"] as const;

/** The bazaar discovery block is a long JSON schema; the panel names it instead of printing it. */
function shown(c: Capture) {
  const ext = c.body.extensions;
  return { ...c.body, ...(ext ? { extensions: Object.fromEntries(Object.keys(ext).map((k) => [k, "discovery metadata, trimmed here"])) } : {}) };
}

/** Turns the three panes into tabs (they stay stacked and readable without JavaScript). */
function tabsFor(list: HTMLElement) {
  const tabs = WAYS.map((w) => document.getElementById(`tab-${w}`)).filter((t): t is HTMLButtonElement => t instanceof HTMLButtonElement);
  const panes = WAYS.map((w) => document.getElementById(`way-${w}`)).filter((p): p is HTMLElement => p !== null);
  if (tabs.length !== WAYS.length || panes.length !== WAYS.length) return;

  const select = (i: number, focus: boolean) => {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      panes[j].hidden = i !== j;
    });
    if (focus) tabs[i].focus();
  };
  list.setAttribute("role", "tablist");
  list.hidden = false;
  list.closest(".dev__d")?.classList.add("is-tabbed");
  tabs.forEach((t, i) => {
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", panes[i].id);
    panes[i].setAttribute("role", "tabpanel");
    panes[i].setAttribute("aria-labelledby", t.id);
    panes[i].querySelector(".dev__way-h")?.classList.add("sr");
    t.addEventListener("click", () => select(i, false));
    t.addEventListener("keydown", (e) => {
      const n = tabs.length;
      const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      select(to, true);
    });
  });
  select(0, false);
}

/** A command keeps its lines, so its well can scroll sideways. data-more names the edge it continues
 *  past and home.css fades that edge, the same as the code boxes in Docs. */
function markScrolling(): (pre: HTMLElement) => void {
  const pres = [...document.querySelectorAll<HTMLElement>("pre.code.dev__code:not(.dev__resp-code)")];
  const mark = (pre: HTMLElement) => {
    const left = pre.scrollLeft > 2;
    const right = pre.scrollLeft < pre.scrollWidth - pre.clientWidth - 2;
    const more = left && right ? "both" : left ? "left" : right ? "right" : "";
    if (more) pre.dataset.more = more;
    else delete pre.dataset.more;
  };
  // A hidden tab measures zero; showing it resizes the well, which marks it.
  const sized = new ResizeObserver((entries) => entries.forEach((e) => mark(e.target as HTMLElement)));
  for (const pre of pres) {
    sized.observe(pre);
    pre.addEventListener("scroll", () => mark(pre), { passive: true });
  }
  // The mono face can land after the first measure and change every line's width.
  void document.fonts?.ready.then(() => pres.forEach(mark));
  return mark;
}

export function mountDev() {
  const list = document.getElementById("dev-tabs");
  if (list) tabsFor(list);
  const resp = document.getElementById("resp-code");
  const respSrc = document.getElementById("resp-src");
  const texts: Record<string, string> = { http: "", cli: "", mcp: MCP_CONFIG, remote: MCP_REMOTE };

  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
    b.hidden = false;
    b.addEventListener("click", () => void copyText(texts[b.dataset.copy ?? ""] ?? "", b.dataset.what ?? "The snippet"));
  });

  const mark = markScrolling();
  const fill = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (el.matches("pre.code.dev__code:not(.dev__resp-code)")) mark(el);
  };
  fill("code-mcp", MCP_CONFIG);

  return {
    /** The faceplate switched tools: the snippets follow it, and the last capture no longer applies. */
    tool(r: Resource) {
      texts.http = curlFor(r);
      texts.cli = cliFor(r);
      fill("code-http", texts.http);
      fill("code-cli", texts.cli);
      fill("dev-id", r.id);
      fill("resp-src", "waiting for the quote above");
      fill("resp-code", `Asking /v1/${r.id} for its 402.`);
    },
    capture(c: Capture | null, r: Resource) {
      if (!resp || !respSrc) return;
      if (!c) {
        respSrc.textContent = "nothing captured";
        resp.textContent = "No 402 came back. Retry the quote above, or run the curl to see the answer.";
        return;
      }
      respSrc.textContent = `${r.name} · captured ${utc(c.at)} UTC`;
      const header = c.header ? `${c.header.slice(0, 48)}…` : "(not sent; the body carried the terms)";
      resp.innerHTML = `<span class="k">402 Payment Required</span>
<span class="c">payment-required:</span> ${esc(header)}

<span class="c">decoded</span>
${esc(JSON.stringify(shown(c), null, 2))}`;
    },
  };
}
