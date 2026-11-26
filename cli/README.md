# siro

An x402 wallet for agents. It pays on Robinhood Chain, Base, Solana, Arbitrum and Polygon from one local, encrypted key that can:

- **call** Siro's pay-per-call resources (LLMs, image and audio models, web reading, on-chain data, tokenized stocks, prediction markets)
- **discover** third-party x402 services in the open x402 index and **pay** them
- **swap** tokens through the KyberSwap aggregator

Every payment is checked against a per-payment cap and a daily cap before anything is signed. Swaps have their own per-swap cap. Payments settle in USDG on Robinhood Chain or USDC on Solana, Base, Arbitrum or Polygon and are gasless; swaps need a little ETH for gas.

## Install

```bash
npm i -g https://siroagent.com/cli/siro.tgz
siro init
```

`init` creates a key and encrypts it with your password (scrypt + AES-256-GCM) in `~/.siro/keystore.json`. Back it up with `siro export-key`. Then send a few dollars of USDC on Solana to the Solana address it prints, or USDG (Robinhood Chain) or USDC (Base, Arbitrum, Polygon) to its EVM address.

The Solana address comes from the same key (derived with HMAC-SHA256), so one backup covers both. `siro export-key --solana` prints the Solana secret key in the form Phantom and Solflare import. `siro address` shows both addresses.

## CLI

```bash
siro balance
siro limits --per-payment 0.1 --per-day 1 --per-swap 25 --network robinhood
siro resources stock
siro call prediction-markets query="fed rates"
siro call flux-2-dev prompt="a chrome ball on brushed aluminium" --out tile.png
siro discover weather
siro pay https://x402.agentindex.world/weather city=Jakarta
siro swap 0.01 ETH USDG
siro history
```

Add `--yes` to skip the confirmation prompt (caps still apply), `--network base`, `arbitrum`, `polygon` or `solana` to pay in USDC on that network (swaps run on `robinhood` or `base`). Set `SIRO_PASSWORD` to avoid the password prompt in scripts.

**$SIRO holders.** `siro holder` shows what the wallet holds on Robinhood Chain. With 1,000,000 $SIRO every Siro tool is quoted 25% lower and Siro's own data tools (gas-now, wallet-balances, token-snapshot, contract-check, new-pools, stock-tokens, prediction-markets) run free 10 times a day; with 10,000,000 it is 50% and 30. `siro call` uses both on its own: a free run while the day's allowance lasts, the holder price otherwise. `--no-free` always pays. Payments stay in USDG or USDC; $SIRO is never spent.

## MCP server

Give Claude Desktop, Cursor or any MCP client the same wallet:

```json
{
  "mcpServers": {
    "siro": {
      "command": "siro",
      "args": ["mcp"],
      "env": { "SIRO_PASSWORD": "your wallet password" }
    }
  }
}
```

Tools: `siro_wallet`, `siro_resources`, `siro_call`, `siro_discover`, `siro_pay`, `siro_swap_quote`, `siro_swap`, `siro_history`. Swaps from MCP are off until you run `siro limits --mcp-swaps on`.

## SDK

```ts
import { Siro } from "siroagent";

const wm = new Siro({ privateKey: process.env.AGENT_KEY as `0x${string}`, limits: { perPayment: 0.05, perDay: 2 } });

const { result, receipt } = await wm.call("stock-signal", { symbol: "TSLA" });
const services = await wm.discover("token price");
const paid = await wm.pay(services[0].url, { method: "POST", input: { symbol: "ETH" }, network: "base" });
const quote = await wm.swapQuote("ETH", "USDG", "0.01");
await wm.swap(quote);
```

Pass `approve: (a) => boolean` to confirm each payment or swap yourself, and `ledger` to persist spending for the daily cap. Lower level: `x402fetch(url, init, { signer })` pays any x402 v1 or v2 endpoint.

## Files

`~/.siro/keystore.json` (encrypted key), `config.json` (caps, network), `spend.jsonl` (history). Override the folder with `SIRO_HOME`, the RPCs with `SIRO_RPC_ROBINHOOD` / `SIRO_RPC_BASE`.

Docs: https://siroagent.com/docs#cli · MIT
