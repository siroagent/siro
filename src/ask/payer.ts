// Who signs: the Budget (the agent key kept in this browser, with caps) or the visitor's own wallet.
// The choice is remembered per browser; a connected wallet is not, the wallet itself decides that.
import { agentAccount, agentAddresses, agentSolana, connect, connectedWallet, limits, network, spentToday, type Limits, type Payer } from "../lib/pay";
import { pickWallet } from "../lib/walletpick";
import { EVM_PAY, type PayNetworkKey } from "../../shared/catalog";

const KEY = "siro.ask.payer";

function stored(): Payer["kind"] {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "agent" || v === "connected") return v;
  } catch {
    /* storage blocked */
  }
  return "agent";
}

let kind: Payer["kind"] = stored();

export const payerKind = () => kind;
export function setPayerKind(k: Payer["kind"]) {
  kind = k;
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* storage blocked: the choice holds for this visit */
  }
}

/** Opens the wallet picker and connects the wallet chosen there. Null when the picker was closed. */
export async function connectWallet(purpose = "Connect a wallet to pay for tools. Every payment still asks you in the wallet first.") {
  const pick = await pickWallet(purpose);
  if (pick === null) return null;
  try {
    return await connect(pick);
  } catch (e: any) {
    if (/no browser wallet/i.test(e?.message ?? "")) throw new Error("No browser wallet found here. Install one such as MetaMask or Rabby, or pay with a Budget.");
    throw new Error(`The wallet did not connect: ${e?.shortMessage ?? e?.message ?? "no answer"}.`);
  }
}

/** True when the browser holds caps the visitor saved, false when limits() is showing the defaults. */
export function capsSaved() {
  try {
    return localStorage.getItem("siro.agent.limits") !== null;
  } catch {
    return false;
  }
}

/** Everything a quote needs to judge itself, read once per render. */
export type PayEnv = {
  payer: Payer["kind"];
  network: PayNetworkKey;
  limits: Limits;
  /** Budget spend today, EVM and Solana together. */
  spent: number;
  budget: string | null;
  wallet: { address: string; name: string } | null;
  /** An EVM network to offer when Solana cannot carry a payment. */
  evm: PayNetworkKey;
  /** Id of the quote being paid right now, if any. */
  paying: string | null;
};

export function payEnv(live: PayNetworkKey[] | null, paying: string | null): PayEnv {
  const acct = agentAccount();
  const cw = connectedWallet();
  return {
    payer: kind,
    network: network(),
    limits: limits(),
    spent: acct ? spentToday(agentAddresses()) : 0,
    budget: acct?.address ?? null,
    wallet: cw ? { address: cw.address, name: cw.name } : null,
    evm: (live ?? []).find((k) => (EVM_PAY as readonly string[]).includes(k)) ?? "robinhood",
    paying,
  };
}

/** The address that pays on this network, for deposits and for the payer readout. */
export function payingAddress(env: PayEnv): string | null {
  if (env.payer === "connected") return env.wallet?.address ?? null;
  if (env.network === "solana") return agentSolana()?.address ?? null;
  return env.budget;
}
