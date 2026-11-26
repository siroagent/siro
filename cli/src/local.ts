// Opens the local wallet for the CLI and the MCP server: key from the encrypted keystore,
// caps and network from config.json, spending remembered in spend.jsonl.
import { Siro, type Approval } from "./core.js";
import { appendSpend, config, hasWallet, loadKey, rememberSolana, spendLog } from "./store.js";

export function openWallet(password: string, approve?: (a: Approval) => boolean | Promise<boolean>) {
  if (!hasWallet()) throw new Error("No wallet yet. Run `siro init` first.");
  const c = config();
  const wm = new Siro({
    privateKey: loadKey(password),
    baseUrl: process.env.SIRO_URL,
    network: c.network,
    limits: c.limits,
    ledger: { entries: spendLog, record: appendSpend },
    approve,
    rpc: { robinhood: process.env.SIRO_RPC_ROBINHOOD, base: process.env.SIRO_RPC_BASE, arbitrum: process.env.SIRO_RPC_ARBITRUM, polygon: process.env.SIRO_RPC_POLYGON, solana: process.env.SIRO_RPC_SOLANA },
  });
  if (wm.solanaAddress) rememberSolana(wm.solanaAddress);
  return wm;
}
