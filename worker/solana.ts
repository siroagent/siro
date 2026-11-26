// Solana JSON-RPC from the Worker, over free public endpoints tried in order. Serves the
// read-only /api/solana proxy (wallets need a recent blockhash and balances) and the treasury
// check that decides whether Solana is offered in a 402.
const SOLANA_RPCS = ["https://solana-rpc.publicnode.com", "https://solana-mainnet.gateway.tatum.io", "https://api.mainnet-beta.solana.com"];
export const SOLANA_READS = new Set(["getLatestBlockhash", "getBalance", "getAccountInfo"]);

/** The first endpoint that answers with a result. Free plans reject some methods or rate-limit,
 *  so an error from one endpoint moves on to the next; the last error is returned if none answer. */
export async function solanaCall(env: Env, method: string, params: unknown[], id: unknown = 1): Promise<{ jsonrpc: "2.0"; id: unknown; result?: any; error?: { code: number; message: string } }> {
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  let last: any = { code: -32000, message: "No Solana RPC answered. Try again." };
  // Two passes: the free endpoints refuse Cloudflare's shared IPs now and then, not for long.
  const urls = [env.SOLANA_RPC_URL, ...SOLANA_RPCS].filter(Boolean) as string[];
  for (const url of [...urls, ...urls]) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
      const j: any = await r.json().catch(() => null);
      if (r.ok && j && "result" in j) return { jsonrpc: "2.0", id, result: j.result };
      if (j?.error) last = { code: Number(j.error.code) || -32000, message: String(j.error.message ?? "error") };
    } catch {
      /* next endpoint */
    }
  }
  return { jsonrpc: "2.0", id, error: last };
}
