// Commands for a tool, built from its catalog entry, and the copy that puts them on the clipboard.
// No inline # comments: zsh, the default macOS shell, runs them as arguments when pasted.
import type { Resource } from "../../shared/catalog";
import { toast } from "../shell";
import { exampleInput } from "./quote";

/** Single-quotes a shell word when it needs it. */
const word = (v: string) => (/^[\w.,:/@%+=-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

/** This site's own origin when it is served over http(s), so a staging copy prints its own curl. */
const SITE = /^https?:/.test(location.origin) ? location.origin : "https://siroagent.com";

export function curlFor(r: Resource): string {
  return `curl -i -X POST ${SITE}/v1/${r.id} \\\n  -H 'content-type: application/json' \\\n  -d ${word(JSON.stringify(exampleInput(r)))}`;
}

export function cliFor(r: Resource): string {
  const args = Object.entries(exampleInput(r)).map(([k, v]) => `${k}=${word(String(v))}`);
  return ["npm i -g https://siroagent.com/cli/siro.tgz", "siro init", "siro limits --per-payment 0.10 --per-day 1", `siro call ${r.id} ${args.join(" ")}`.trim()].join("\n");
}

// The local server reads the keystore password from its env; without it `siro mcp` stops at start.
export const MCP_CONFIG = JSON.stringify({ mcpServers: { siro: { command: "siro", args: ["mcp"], env: { SIRO_PASSWORD: "your wallet password" } } } }, null, 2);
export const MCP_REMOTE = "https://siroagent.com/mcp";

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied.`);
  } catch {
    // The async clipboard can be refused (permissions, an embedded frame); a selected textarea still copies.
    // Selecting it moves focus, so the key that asked for the copy gets focus back.
    const back = document.activeElement as HTMLElement | null;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    back?.focus({ preventScroll: true });
    toast(ok ? `${what} copied.` : "Copy did not work here. Select the text and copy it by hand.");
  }
}
