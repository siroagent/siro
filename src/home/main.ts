// Home: the quote faceplate, the two-rail figure, the cap knob, a specimen quote, the newest
// settlements and the three ways in. The shell adds the rail, the phone dock and the footer.
import { byId, formatPrice } from "../../shared/catalog";
import { mountShell } from "../shell";
import { mountActivity } from "./activity";
import { judge, readCaps } from "./caps";
import { mountDev } from "./dev";
import { mountHero } from "./hero";
import { mountHolderCheck } from "./holder";
import { mountCapKnob } from "./knob";
import "./home.css";

mountShell("home");

/** The specimen quote in "Asking is free": catalog price and a verdict from this browser's caps. */
function mountSpecimen() {
  const r = byId("nano-banana-2-1");
  const lamp = document.getElementById("spec-lamp");
  const brief = document.getElementById("spec-brief");
  const tryLink = document.getElementById("spec-try") as HTMLAnchorElement | null;
  if (!r || !lamp || !brief || !tryLink) return;
  const price = formatPrice(r.price);
  document.querySelectorAll(".spec-price").forEach((el) => (el.textContent = price));
  const v = judge(Number(r.price), readCaps());
  lamp.className = `lamp sq__verdict ${v.ok ? "lamp--settled" : "lamp--refused"}`;
  lamp.textContent = v.short;
  tryLink.href = `/ask?tool=${encodeURIComponent(r.id)}&q=${encodeURIComponent(brief.textContent?.trim() ?? "")}`;
}

mountHero(mountDev());
mountCapKnob();
mountHolderCheck();
mountSpecimen();
mountActivity();
