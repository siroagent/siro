// "Hold $SIRO, pay less": the wallet check reads /api/holder/<address> and says which tier it is in.
const EVM = /^0x[0-9a-fA-F]{40}$/;

export function mountHolderCheck() {
  const form = document.getElementById("hold-check") as HTMLFormElement | null;
  const input = document.getElementById("hold-addr") as HTMLInputElement | null;
  const out = document.getElementById("hold-out");
  if (!form || !input || !out) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = input.value.trim();
    if (!EVM.test(a)) {
      input.setAttribute("aria-invalid", "true");
      out.textContent = "Paste a 0x address: 0x and 40 hex characters.";
      return;
    }
    input.removeAttribute("aria-invalid");
    out.textContent = "Reading the balance on Robinhood Chain…";
    try {
      const r = await fetch(`/api/holder/${a}`);
      if (!r.ok) throw new Error(String(r.status));
      const h = (await r.json()) as { siro: number; tier: { name: string; discountPct: number; freePerDay: number } | null; freeLeftToday: number };
      const held = `${Math.floor(h.siro).toLocaleString("en-US")} $SIRO`;
      out.textContent = h.tier
        ? `${held}: ${h.tier.discountPct}% off every tool, ${h.freeLeftToday} of ${h.tier.freePerDay} free data runs left today.`
        : `${held}: list prices. 1,000,000 $SIRO gets 25% off.`;
    } catch {
      out.textContent = "The balance could not be read right now. Try again in a moment.";
    }
  });
}
