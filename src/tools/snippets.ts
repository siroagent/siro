// The three ways to call one tool from code, built from the catalog's example input.
import type { Resource } from "../../shared/catalog";

const ORIGIN = "https://siroagent.com";

export type Example = Record<string, string | number>;

/** Every required field with its catalog example, plus the data network for tools that read a chain. */
export function exampleInput(r: Resource): Example {
  const out: Example = {};
  for (const f of r.fields) if (f.example !== undefined && (f.required || f.name === "network")) out[f.name] = f.example;
  return out;
}

const singleQuoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// The URL gets its own line, so the first line stays short enough not to strand its trailing "\".
export function curlSnippet(r: Resource, input: Example) {
  return [`curl -i -X POST \\`, `  ${ORIGIN}/v1/${r.id} \\`, `  -H "content-type: application/json" \\`, `  -d ${singleQuoted(JSON.stringify(input))}`].join("\n");
}

// The CLI takes field=value pairs and splits at the first "="; quote what a shell would split or expand.
const cliValue = (v: string | number) => {
  const s = String(v);
  return /^[\w.,:@%+/=-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
};

export function cliSnippet(r: Resource, input: Example) {
  return [
    "# once: install (Node 20+), then make a wallet encrypted with your password",
    "npm i -g https://siroagent.com/cli/siro.tgz",
    "siro init",
    "",
    ["siro call", r.id, ...Object.entries(input).map(([k, v]) => `${k}=${cliValue(v)}`)].join(" "),
  ].join("\n");
}

/** The MCP tools/call request for siro_call, as an MCP client sends it. */
export function mcpSnippet(r: Resource, input: Example) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "siro_call", arguments: { resource: r.id, input } } }, null, 2);
}
