// Use and Code: the same budget from Ask, the CLI or an MCP client. The limits command carries the caps
// saved on this page, because the CLI keeps its own copy of them on your machine.
import { byId, formatPrice } from "../../shared/catalog";
import { limits } from "../lib/pay";
import { esc } from "../shell";
import { copy, plain } from "./util";

const EXAMPLE = byId("prediction-read")!;
const EXAMPLE_FIELD = EXAMPLE.fields[0];

function commands() {
  const l = limits();
  return [
    { cmd: "npm i -g https://siroagent.com/cli/siro.tgz", says: "Installs the siro command. Needs Node 20 or newer." },
    { cmd: "siro init --import", says: "Asks for this browser's key (show it under Key) and a password, then keeps the key encrypted. Plain siro init makes a separate wallet." },
    {
      cmd: `siro limits --per-payment ${plain(l.perPayment)} --per-day ${plain(l.perDay)} --per-swap ${plain(l.perSwap)}`,
      says: "Gives the CLI the caps saved on this page. It keeps its own copy and counts its own daily spend.",
    },
    { cmd: `siro call ${EXAMPLE.id} ${EXAMPLE_FIELD.name}="${EXAMPLE_FIELD.example}"`, says: `One ${formatPrice(EXAMPLE.price)} call to ${EXAMPLE.name}, checked against those caps first.` },
  ];
}

const MCP = `{
  "mcpServers": {
    "siro": {
      "command": "siro",
      "args": ["mcp"],
      "env": { "SIRO_PASSWORD": "your CLI wallet password" }
    }
  }
}`;

/** A narrow display wraps a command between words and after a URL's path slashes ("siroagent.com/" +
 *  "cli/siro.tgz"), never inside a flag or an id such as --per-payment or prediction-read. */
const breakable = (cmd: string) =>
  cmd
    .split(" ")
    .map((t) => (t.includes("/") ? esc(t).replace(/\/+/g, (s) => (s.length === 1 ? "/<wbr>" : s)) : `<span class="bd-word">${esc(t)}</span>`))
    .join(" ");

function cli() {
  return `<div class="display bd-code">
    <div class="display__bar"><b>CLI</b><span>Node 20 or newer</span></div>
    <ol class="bd-cmds">${commands()
      .map((c, i) => `<li class="bd-cmd"><code><span class="bd-cmd__prompt" aria-hidden="true">$ </span>${breakable(c.cmd)}</code><button class="key key--sm" type="button" data-cmd="${i}" aria-label="Copy ${esc(c.cmd)}">Copy</button><p>${esc(c.says)}</p></li>`)
      .join("")}</ol>
  </div>`;
}

function mcp() {
  return `<div class="display bd-code">
    <div class="display__bar bd-code__bar"><b>MCP client config</b><button class="key key--sm" type="button" data-mcp aria-label="Copy the MCP client config">Copy</button></div>
    <pre class="bd-code__pre"><code>${esc(MCP)}</code></pre>
  </div>
  <p class="small">For Claude Desktop, Cursor or another MCP client. <code class="inline">siro mcp</code> pays from the CLI wallet within its caps and brings 8 tools, <code class="inline">siro_call</code> and <code class="inline">siro_pay</code> among them. Swaps stay off until <code class="inline">siro limits --mcp-swaps on</code>.</p>
  <p class="small">Without the CLI, <code class="inline">https://siroagent.com/mcp</code> lists every tool and its price for free. A paid call there needs an x402 payment your agent signs itself.</p>`;
}

/** Ask (only in the setup sheet), the CLI and MCP as labelled rows. `level` is the heading level of each row. */
export function mountUse(host: HTMLElement, o: { withAsk: boolean; level: 3 | 4 }): { refresh(): void } {
  const h = `h${o.level}`;
  const row = (name: string, body: string) => `<div class="bd-use__row"><${h} class="bd-use__name">${name}</${h}><div class="bd-use__body">${body}</div></div>`;
  const paint = () => {
    host.innerHTML = `<div class="bd-use">
      ${o.withAsk ? row("Ask", `<p>Pay with Budget in Ask. Ask shows each tool's price before it runs and waits for your yes, unless Autopay is on.</p><a class="key key--sm" href="/ask">Ask Siro</a>`) : ""}
      ${row("CLI", `${cli()}<p class="small muted">The CLI keeps its own encrypted key, caps and spend log in ~/.siro on your machine.</p>`)}
      ${row("MCP", mcp())}
    </div>`;
  };
  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest<HTMLElement>("[data-cmd]");
    if (c) copy(commands()[Number(c.dataset.cmd)].cmd, "Command");
    else if (t.closest("[data-mcp]")) copy(MCP, "Config");
  });
  paint();
  return { refresh: paint };
}
