// Served for any path nothing else answers, so it names the path that missed. Search needs this script,
// which is why its key starts hidden in the HTML.
import { RESOURCES } from "../shared/catalog";
import { esc, mountShell, openSearch } from "./shell";

mountShell("404");

const what = document.getElementById("lost-what");
if (what) {
  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* a malformed escape: show the raw path */
  }
  if (path.length > 120) path = `${path.slice(0, 119)}…`;
  what.innerHTML = `Nothing lives at <code class="inline">${esc(path)}</code>.`;
}

const tools = document.getElementById("lost-tools");
if (tools) tools.textContent = `${RESOURCES.length} tools`;

const search = document.getElementById("lost-search");
if (search) {
  search.hidden = false;
  search.addEventListener("click", openSearch);
}
