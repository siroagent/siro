// Closing a modal dialog without its "close" event. Chrome 157 stops firing "close" on later dialogs
// once one was closed with Escape, so each dialog's after-close work runs straight after close(),
// and Escape is turned into the same path through "cancel".
const after = new Map<HTMLDialogElement, () => void>();

/** Registers the work to run each time `d` closes, and routes Escape through it. */
export function onShut(d: HTMLDialogElement, fn: () => void) {
  after.set(d, fn);
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    shut(d);
  });
}

/** Closes `d` and runs its after-close work once. Does nothing when `d` is already closed. */
export function shut(d: HTMLDialogElement) {
  if (!d.open) return;
  d.close();
  after.get(d)?.();
}
