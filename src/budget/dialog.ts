// The dialog every risky action on this page goes through: a white L3 plate over a scrim. Focus stays
// inside, Escape or the scrim cancels, and focus goes back to the key that opened it.
import { esc, quietAsk } from "../shell";

export type DialogAction = { label: string; value: string; ink?: boolean };
export type DialogOptions = {
  title: string;
  /** HTML built by this page. Anything that came from outside is escaped by the caller. */
  body: string;
  actions: DialogAction[];
  /** The cancelling key's label; null leaves it out when an action closes the dialog. */
  cancel?: string | null;
  /** A checkbox the actions wait for, such as "I exported the key". */
  check?: string;
  /** Selector of the first element to focus. Defaults to the cancelling key, the safe choice. */
  initial?: string;
  /** Read the body out when the dialog opens. Off for dialogs that show a secret. */
  describe?: boolean;
};

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
let current: ((v: string | null) => void) | null = null;
let seq = 0;

// One dark key per screen: while a dialog shows its graphite key, the rail's Ask (visible under the scrim)
// turns aluminium. On close the page hands the dark key back to its own primary key.
let giveBack: () => void = () => quietAsk(null);
export function onDialogClosed(f: () => void) {
  giveBack = f;
}

export function dialog(o: DialogOptions): { el: HTMLElement; result: Promise<string | null> } {
  current?.(null);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const id = `bd-dlg-${++seq}`;
  const cancel = o.cancel === undefined ? "Cancel" : o.cancel;

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const el = document.createElement("div");
  el.className = "dialog bd-dialog";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", `${id}-t`);
  if (o.describe !== false) el.setAttribute("aria-describedby", `${id}-b`);
  el.innerHTML = `
    <h2 class="bd-dialog__title" id="${id}-t">${esc(o.title)}</h2>
    <div class="bd-dialog__body" id="${id}-b">${o.body}</div>
    ${o.check ? `<label class="bd-check"><input type="checkbox" data-check><span>${esc(o.check)}</span></label>` : ""}
    <div class="bd-dialog__keys">
      ${cancel ? `<button class="key" type="button" data-cancel>${esc(cancel)}</button>` : ""}
      ${o.actions.map((a) => `<button class="key${a.ink ? " key--ink" : ""}" type="button" data-value="${esc(a.value)}"${o.check ? " disabled" : ""}>${esc(a.label)}</button>`).join("")}
    </div>`;

  // The rest of the page stops taking focus, clicks and screen-reader attention while this is open.
  const muted = [...document.body.children].filter((n): n is HTMLElement => n instanceof HTMLElement && !n.inert);
  muted.forEach((n) => (n.inert = true));
  document.body.append(scrim, el);

  let resolve: (v: string | null) => void = () => {};
  const result = new Promise<string | null>((r) => (resolve = r));

  const close = (v: string | null) => {
    if (current !== close) return;
    current = null;
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    el.remove();
    muted.forEach((n) => (n.inert = false));
    giveBack();
    if (opener?.isConnected) opener.focus();
    resolve(v);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // Search would open on top of this dialog; it waits until this one is answered.
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Tab") {
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === f.length - 1)) {
        e.preventDefault();
        f[i === -1 || !e.shiftKey ? 0 : f.length - 1].focus();
      }
    }
  };

  const check = el.querySelector<HTMLInputElement>("[data-check]");
  check?.addEventListener("change", () => el.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((b) => (b.disabled = !check.checked)));
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-cancel")) close(null);
    else if (b.dataset.value !== undefined) close(b.dataset.value);
  });
  scrim.addEventListener("click", () => close(null));
  document.addEventListener("keydown", onKey, true);
  current = close;
  quietAsk(el);

  const first = (o.initial ? el.querySelector<HTMLElement>(o.initial) : null) ?? el.querySelector<HTMLElement>("[data-cancel]") ?? el.querySelector<HTMLElement>("[data-check], [data-value]");
  first?.focus();
  return { el, result };
}
