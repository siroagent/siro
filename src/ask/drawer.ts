// The saved-chats drawer: a native modal dialog from the left. Escape and the backdrop close it,
// focus goes back to the Chats key, or to the message box after a chat is picked.
import { esc } from "../shell";
import { shut, onShut } from "./dialog";
import { isoOf, utcStamp } from "./format";
import type { Chat } from "./store";

export function mountDrawer(o: { chats: () => Chat[]; current: () => Chat; pick: (c: Chat) => void; fresh: () => void; composer: () => HTMLElement }) {
  const drawer = document.getElementById("drawer") as HTMLDialogElement;
  const key = document.getElementById("chats-key")!;
  const list = document.getElementById("chat-list")!;
  let focusAfter: HTMLElement | null = null;

  function render() {
    const cur = o.current();
    const shown = o
      .chats()
      .filter((c) => c.msgs.length || c === cur)
      .sort((a, b) => b.at - a.at);
    list.innerHTML = shown.length ? shown.map((c) => item(c, c === cur)).join("") : `<li class="drawer__none">No saved chats yet. Chats stay in this browser.</li>`;
  }

  function item(c: Chat, on: boolean) {
    const asked = c.msgs.filter((m) => m.role === "user").length;
    return `<li><button type="button" data-chat="${esc(c.id)}"${on ? ' aria-current="true"' : ""}>
      <span class="drawer__t">${on ? '<i class="ball" aria-hidden="true"></i>' : ""}<span>${esc(c.title)}</span></span>
      <span class="drawer__m"><time datetime="${isoOf(c.at)}">${utcStamp(c.at)}</time>${asked ? ` · ${asked} ${asked === 1 ? "message" : "messages"}` : ""}</span>
    </button></li>`;
  }

  function open() {
    render();
    drawer.showModal();
    key.setAttribute("aria-expanded", "true");
    (list.querySelector<HTMLElement>('[aria-current="true"]') ?? document.getElementById("new-chat"))?.focus();
  }

  function close(next: HTMLElement | null) {
    focusAfter = next;
    shut(drawer);
  }

  key.addEventListener("click", open);
  onShut(drawer, () => {
    key.setAttribute("aria-expanded", "false");
    (focusAfter ?? key).focus();
    focusAfter = null;
  });
  drawer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // A click on the backdrop lands on the dialog itself; the content fills the rest.
    if (t === drawer || t.closest("[data-close-drawer]")) return close(null);
    if (t.closest("#new-chat")) {
      o.fresh();
      return close(o.composer());
    }
    const id = t.closest<HTMLElement>("[data-chat]")?.dataset.chat;
    const c = o.chats().find((x) => x.id === id);
    if (!c) return;
    o.pick(c);
    close(o.composer());
  });

  return { render, isOpen: () => drawer.open };
}
