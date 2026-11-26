# Siro

**Pay-per-call tools for AI agents, over x402. The price comes first.**

Every Siro tool answers an unpaid call with an HTTP 402 quote: the amount, the network and the address. The agent pays from a budget with a cap per call and a cap per day, and the payment settles only after the tool has returned a result. A call that fails is never charged.

[siroagent.com](https://siroagent.com) · [Docs](https://siroagent.com/docs) · [Activity](https://siroagent.com/activity) · [Privacy](https://siroagent.com/privacy)

[![ci](https://github.com/siroagent/siro/actions/workflows/ci.yml/badge.svg)](https://github.com/siroagent/siro/actions/workflows/ci.yml)
[![codeql](https://github.com/siroagent/siro/actions/workflows/codeql.yml/badge.svg)](https://github.com/siroagent/siro/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/siroagent/siro/badge)](https://scorecard.dev/viewer/?uri=github.com/siroagent/siro)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

- **67 tools in one catalog**: language, image, video and audio models, web reading and translation, on-chain reads on Robinhood Chain and Base, tokenized stocks and prediction markets. Prices run from $0.001 to $0.95 a call.
- **Five payment networks**: USDG on Robinhood Chain, USDC on Base, Solana, Arbitrum and Polygon. No account and no API key.
- **Capped budgets**: the wallet refuses a quote above its per-call or daily cap before anything is signed.
- **Settle on result**: the work runs after the signature is verified; the transfer settles only when the result is ready.
- **Public ledger**: every settled call is listed with its transaction hash and a sha256 of the result it returned (`/api/ledger`, `/activity`).
- **Three ways in**: plain HTTP, the `siro` CLI and SDK, or MCP (local through the CLI, remote at `/mcp`).
- **Sell a tool**: list your own HTTPS API; buyers pay your address directly over x402 and Siro takes no cut.
- **$SIRO holder pricing**: a paying wallet holding 1,000,000 $SIRO on Robinhood Chain is quoted 25% less and gets 10 free runs a day of Siro's data tools; 10,000,000 gets 50% and 30. Payments stay in stablecoins; $SIRO is never spent.

## Status

Live since November 2026; this repository was opened on 26 November 2026, and the service it holds was running before that. Everything below can be checked from outside:

- **Payments on-chain.** The first settled call was on 15 November 2026, on Base ([tx](https://basescan.org/tx/0xe54c4a781f8076f9a0fe94945150a77eaa88b8c643d3c96b501f719d696ab012)). Every call since is in the public ledger with its transaction: [`/api/ledger?limit=500`](https://siroagent.com/api/ledger?limit=500), totals in [`/api/stats`](https://siroagent.com/api/stats).
- **Results.** Calls paid by Siro's own wallets show the full result next to the payment: [`/api/proofs`](https://siroagent.com/api/proofs).
- **Listed elsewhere.** The remote MCP server is in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=com.siroagent) as `com.siroagent/siro`, and the tools are listed in Coinbase's x402 Bazaar discovery index.
- **$SIRO.** The only official contract is [`0x4471866fee3309c542386ff2a2ffa755e8298497`](https://robinhoodchain.blockscout.com/token/0x4471866fee3309c542386ff2a2ffa755e8298497) on Robinhood Chain; holder balances are read from it on every quote.
- **Not yet.** No external security audit has been done. Usage is small: see the totals above rather than any number written here.

## Try it

```bash
# An unpaid call returns the quote and runs nothing.
curl -i -X POST https://siroagent.com/v1/gas-now -H 'content-type: application/json' -d '{}'
```

```bash
# The CLI keeps an encrypted wallet on your machine and pays within its caps.
npm i -g https://siroagent.com/cli/siro.tgz
siro init
siro limits --per-payment 0.1 --per-day 1
siro call gas-now network=robinhood
```

The SDK and MCP server ship in the same package; see [cli/README.md](cli/README.md).

## How a paid call works

```
agent ── POST /v1/<tool> ──────────────▶ 402 + PAYMENT-REQUIRED (amount, network, payTo)
agent ── checks caps, signs EIP-3009 ──▶ POST /v1/<tool> + PAYMENT-SIGNATURE
siro  ── input check → lock nonce → facilitator verify → run the tool
siro  ── result ready → facilitator settle → ledger row + result sha256
agent ◀─ 200 { result, receipt: { tx, amountUsd, resultSha256 } } + PAYMENT-RESPONSE
```

- Input is validated before any payment is verified, so a bad request is never charged.
- One signed authorization pays for one call: nonces are locked in D1 before verification.
- The amount and recipient the client signed must equal the quote, to the base unit (`worker/x402.ts`, `termsMatch`).
- Tool failures release the nonce and settle nothing.

## Repository layout

```
worker/        Cloudflare Worker (Hono): paid API, ledger, holder pricing, MCP, discovery, sell
  v1.ts          POST /v1/<id>: quote, verify, run, settle
  x402.ts        quotes, payment matching, facilitator calls, nonce locks
  run.ts         input validation (prepare) and execution of the built-in tools
  proof.ts       result receipts (sha256 of each result)
  holder.ts      $SIRO balance reads, holder passes, /api/holder
  mcp.ts         remote MCP server at /mcp
shared/        code used by the Worker, the site and the CLI: catalog, x402 client, tiers
src/           the site (vanilla TypeScript + Vite): Ask, Tools, Budget, Activity, Docs
cli/           the siro CLI, SDK and local MCP server (published as siroagent)
migrations/    D1 schema, applied in order
test/          unit tests (Vitest), no network
mcp-registry/  server.json for the official MCP Registry
```

## Develop

Node 20 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Local development runs the Worker and the site together through the Cloudflare Vite plugin (`npm run dev`). Copy the variable names from `worker/env.d.ts` into a `.dev.vars` file for local secrets; none are needed for the tests.

```bash
cd cli && npm ci && npm run build && node dist/cli.js --help
```

## Roadmap

Planned work and its issues: [ROADMAP.md](ROADMAP.md).

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md). The design assumptions and what Siro does and does not protect are in [docs/threat-model.md](docs/threat-model.md). How a wallet derives its Solana key from its EVM key is in [docs/solana-keys.md](docs/solana-keys.md).

## License

[MIT](LICENSE)
