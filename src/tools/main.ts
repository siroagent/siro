// Tools: the price list at /tools and one spec sheet per tool at /tools/:id, both drawn from
// shared/catalog.ts. The worker serves tools.html for both paths.
import { byId } from "../../shared/catalog";
import { mountShell } from "../shell";
import { detail, notFound } from "./detail";
import { list } from "./list";
import { sellers } from "./sellers";
import "../styles/result.css";
import "./tools.css";

const main = document.getElementById("main")!;
const slug = location.pathname.match(/^\/tools\/([^/]+)\/?$/)?.[1];

let id = slug ?? "";
try {
  id = decodeURIComponent(id);
} catch {
  /* a malformed escape is simply not a tool id */
}
const tool = slug === undefined ? undefined : byId(id);

if (slug === undefined) {
  list(main);
  void sellers(main);
}
else if (tool) detail(main, tool);
else notFound(main, id);

// The shell goes in after the page so it finds the pay key's data-quiet-ask: while that key is in view
// and able to pay, it is the one dark key on screen (the shell quiets the rail's and the dock's Ask).
mountShell("tools");
