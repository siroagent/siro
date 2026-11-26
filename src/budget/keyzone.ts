// Key: the private key behind both addresses. Showing it, saving a backup and forgetting the wallet each
// go through a confirm dialog; a shown key lives only inside its dialog and leaves with it.
import { agentAccount, agentKey, agentSolana, forgetAgentWallet } from "../lib/pay";
import { esc, toast } from "../shell";
import { dialog } from "./dialog";
import { copy } from "./util";

function saveBackup(key: string) {
  const a = agentAccount();
  const s = agentSolana();
  if (!a || !s) return;
  const text = [
    "Siro agent wallet backup",
    `Saved ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from siroagent.com/budget`,
    "",
    `EVM address: ${a.address}`,
    `Solana address: ${s.address}`,
    `Private key: ${key}`,
    "",
    "Anyone with this private key can spend the wallet on every network. Keep this file offline.",
    "The Solana key comes from this private key, so this one backup covers both addresses.",
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `siro-agent-key-${a.address.slice(2, 8).toLowerCase()}.txt` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Backup file handed to your browser's downloads.");
}

/** Asks first, then shows the key in a dialog with Copy (and, for the private key, a backup file). */
export async function showKey(kind: "evm" | "solana") {
  const evm = kind === "evm";
  const asked = await dialog({
    title: evm ? "Show the private key?" : "Show the Solana key?",
    body: evm
      ? "<p>Anyone who sees this key can spend everything in this wallet, on all five networks. Check that nobody else can see your screen.</p>"
      : "<p>This key controls the Solana address. The private key already backs it up, so show this one only to import the wallet into Phantom or Solflare.</p>",
    actions: [{ label: evm ? "Show key" : "Show Solana key", value: "show", ink: true }],
  }).result;
  if (asked !== "show") return;
  const secret = evm ? agentKey() : (agentSolana()?.secretKey ?? null);
  if (!secret) {
    toast("There is no agent key on this browser any more.");
    return;
  }
  const shown = dialog({
    title: evm ? "Private key" : "Solana key",
    body: `<pre class="bd-secret">${esc(secret)}</pre>
      <p class="small">${evm ? "Store it offline. The CLI takes it with <code class=\"inline\">siro init --import</code>." : "In Phantom or Solflare, choose Import private key and paste it."}</p>
      <div class="bd-row"><button class="key" type="button" data-copy-secret>Copy key</button>${evm ? `<button class="key" type="button" data-save-secret>Save as a text file</button>` : ""}</div>`,
    actions: [{ label: "Done", value: "done", ink: true }],
    cancel: null,
    initial: "[data-copy-secret]",
    describe: false,
  });
  shown.el.querySelector("[data-copy-secret]")!.addEventListener("click", () => copy(secret, "Key"));
  shown.el.querySelector("[data-save-secret]")?.addEventListener("click", () => saveBackup(secret));
  await shown.result;
}

/** The key zone of the budget view. `onForget` runs once the key is gone from this browser. */
export function mountKeyZone(host: HTMLElement, onForget: () => void) {
  host.innerHTML = `
    <p>The key exists only in this browser's storage, unencrypted. Clearing site data deletes it. The Solana key is derived from it, so one backup covers both addresses.</p>
    <ul class="bd-keyrows">
      <li><div><b>Private key</b><span class="small muted">Back it up, or move this wallet into the CLI with <code class="inline">siro init --import</code>.</span></div><button class="key" type="button" data-show="evm">Show private key</button></li>
      <li><div><b>Solana key</b><span class="small muted">Only to import this wallet into Phantom or Solflare, for example to move USDC out on Solana.</span></div><button class="key" type="button" data-show="solana">Show Solana key</button></li>
      <li><div><b>Forget this wallet</b><span class="small muted">Removes the key from this browser. The funds stay on-chain.</span></div><button class="key" type="button" data-forget>Forget wallet</button></li>
    </ul>`;
  host.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const show = t.closest<HTMLElement>("[data-show]");
    if (show) return showKey(show.dataset.show === "solana" ? "solana" : "evm");
    if (!t.closest("[data-forget]")) return;
    const a = agentAccount();
    const s = agentSolana();
    if (!a || !s) return;
    const yes = await dialog({
      title: "Forget this wallet on this browser?",
      body: `<p>This deletes the key from this browser's storage. The funds stay on-chain at:</p><p><code class="bd-dialog__addr">${esc(a.address)}</code><br><code class="bd-dialog__addr">${esc(s.address)}</code></p><p>Without an exported key, nobody can reach them again.</p>`,
      check: "I exported the key, or the wallet is empty.",
      actions: [{ label: "Forget wallet", value: "forget", ink: true }],
    }).result;
    if (yes !== "forget") return;
    forgetAgentWallet();
    if (agentKey()) {
      toast("This browser kept the key: its storage could not be changed.");
      return;
    }
    onForget();
  });
}
