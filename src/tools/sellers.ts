// Tools listed by sellers (Sell a tool). They are not in the static catalog, so this section reads
// /api/listings after the price list is drawn. Each one links to its page at /sell/<id>.
import { formatPrice } from "../../shared/catalog";
import { esc } from "../shell";

type Listing = { id: string; name: string; summary: string; categoryLabel: string; price: string; host: string };

export async function sellers(main: HTMLElement) {
  const box = document.createElement("section");
  box.className = "wrap tl-sellers";
  box.setAttribute("aria-labelledby", "sellers-h");
  main.append(box);
  const j = await fetch("/api/listings")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const list: Listing[] = j?.data ?? [];
  const head = `<div class="rails" aria-hidden="true"></div>
<div class="tl-sellers__head"><h2 id="sellers-h" class="h3">Sold by others</h2>
<p class="tl-sellers__note">${
    list.length
      ? "APIs listed by their own makers. You pay the seller's address directly, and a failed call is not charged."
      : "No seller has listed a tool yet. Any HTTPS API can be listed at its own price per call; buyers pay the seller directly."
  } <a href="/sell">Sell a tool</a></p></div>`;
  if (!j) {
    box.innerHTML = head.replace(/<p class="tl-sellers__note">[\s\S]*<\/p>/, '<p class="tl-sellers__note">Seller listings could not be read right now. <a href="/sell">Sell a tool</a></p>');
    return;
  }
  box.innerHTML =
    head +
    (list.length
      ? `<table class="table tl-sellers__table"><caption class="sr">Tools sold by others, newest first</caption>
<thead><tr><th scope="col">Tool</th><th scope="col">Seller</th><th scope="col">Category</th><th scope="col" class="num">Per call</th></tr></thead>
<tbody>${list
          .map(
            (l) => `<tr><th scope="row"><a href="/sell/${encodeURIComponent(l.id)}">${esc(l.name)}</a><span class="tl-sellers__sum">${esc(l.summary)}</span></th><td>${esc(l.host)}</td><td>${esc(l.categoryLabel)}</td><td class="num live-num">${esc(formatPrice(l.price))}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : "");
}
