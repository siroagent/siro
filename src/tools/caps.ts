import { limits } from "../lib/pay";
import { money } from "./format";

export type Caps = { perCall: number; perDay: number; saved: boolean };

/** The Budget caps this browser signs within. limits() quietly falls back to the new-wallet
 *  defaults, and the page has to say which of the two it is showing. */
export function caps(): Caps {
  const l = limits();
  let saved = false;
  try {
    saved = localStorage.getItem("siro.agent.limits") !== null;
  } catch {
    /* storage blocked: the defaults apply */
  }
  return { perCall: Number(l.perPayment) || 0, perDay: Number(l.perDay) || 0, saved };
}

export const capPhrase = (c: Caps) => (c.saved ? `your cap of ${money(c.perCall)} a call, saved in this browser` : `a new wallet's default cap of ${money(c.perCall)} a call`);
