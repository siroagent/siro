// The wallet picker. Every browser wallet that announces itself (EIP-6963) is listed with its own name and
// icon, so the visitor chooses which one connects or pays instead of Siro guessing. Resolves to the chosen
// wallet, `undefined` for a legacy window.ethereum wallet that does not announce itself, or null when closed.
import { injectedWallets } from "./pay";
import "./walletpick.css";

type Wallet = ReturnType<typeof injectedWallets>[number];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const iconOk = (s: string) => /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/.test(s);

let open: Promise<Wallet | undefined | null> | null = null;

/** Opens the picker. `purpose` is the line under the title, e.g. "Pays $0.02 on Robinhood Chain." */
export function pickWallet(purpose: string): Promise<Wallet | undefined | null> {
  if (open) return open;
  const wallets = injectedWallets();
  const legacy = !wallets.length && !!(window as unknown as { ethereum?: unknown }).ethereum;
  const back = document.activeElement as HTMLElement | null;

  const dlg = document.createElement("dialog");
  dlg.className = "wpick";
  dlg.setAttribute("aria-labelledby", "wpick-title");
  const rows = wallets
    .map(
      (w, i) => `<li><button class="wpick__wallet" type="button" data-i="${i}">
  ${iconOk(w.info.icon) ? `<img src="${esc(w.info.icon)}" alt="" width="28" height="28">` : '<span class="wpick__blank" aria-hidden="true"></span>'}
  <span>${esc(w.info.name)}</span></button></li>`,
    )
    .join("");
  dlg.innerHTML = `<div class="wpick__head">
  <h2 id="wpick-title">Choose a wallet</h2>
  <button class="wpick__x" type="button" data-close aria-label="Close">×</button>
</div>
<p class="wpick__why">${esc(purpose)}</p>
${
  wallets.length
    ? `<ul class="wpick__list">${rows}</ul><p class="wpick__note">Only wallets installed in this browser are listed. Siro never sees your key: the wallet signs in its own window.</p>`
    : legacy
      ? `<ul class="wpick__list"><li><button class="wpick__wallet" type="button" data-legacy><span class="wpick__blank" aria-hidden="true"></span><span>Browser wallet</span></button></li></ul>`
      : `<p class="wpick__none">No browser wallet found here. Install one such as MetaMask or Rabby and reload this page, or pay with a Budget.</p>`
}`;
  document.body.append(dlg);

  open = new Promise((resolve) => {
    let picked: Wallet | undefined | null = null;
    dlg.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      // A click on the backdrop lands on the dialog element itself.
      if (t === dlg || t.closest("[data-close]")) return dlg.close();
      const b = t.closest<HTMLElement>(".wpick__wallet");
      if (!b) return;
      picked = b.dataset.legacy !== undefined ? undefined : wallets[Number(b.dataset.i)];
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      open = null;
      back?.focus?.();
      resolve(picked);
    });
  });
  dlg.showModal();
  dlg.querySelector<HTMLElement>(".wpick__wallet, [data-close]")?.focus();
  return open;
}
