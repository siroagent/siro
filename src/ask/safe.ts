// Results can come from third-party x402 services, and this page holds the Budget key in localStorage.
// Before a result is drawn, links and media keep only web URLs and inline images, audio and video.
const MEDIA = /^data:(image|audio|video)\//i;
const URL_ATTRS = new Set(["href", "src", "poster", "action", "formaction", "xlink:href"]);

function allowed(value: string) {
  const v = value.trim();
  if (MEDIA.test(v)) return true;
  // The URL parser drops tabs and newlines inside a scheme ("java\tscript:"), so ask it, not a regex.
  // A relative link resolves against an https base and stays allowed.
  try {
    const { protocol } = new URL(v, "https://siroagent.com/");
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Fills a fragment from HTML and strips scripts, event handlers and non-web URLs. */
export function safeFragment(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script, iframe, object, embed, frame, base, meta, link, style, form, animate, set").forEach((el) => el.remove());
  for (const el of t.content.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || (URL_ATTRS.has(name) && !allowed(a.value))) el.removeAttribute(a.name);
    }
  }
  return t.content;
}

export function safeHtml(html: string): string {
  const box = document.createElement("div");
  box.append(safeFragment(html));
  return box.innerHTML;
}
