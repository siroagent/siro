# Threat model

What Siro protects, against whom, and where its guarantees stop.

## Assets

| Asset | Where it lives | Who can move it |
|---|---|---|
| Payer funds | The payer's wallet (browser Budget key, CLI keystore or a wallet extension) | Only the payer's key. Siro never holds a payer key. |
| Treasury income | Siro's treasury address on each network | The treasury owner, off this codebase. |
| Seller income | The seller's own address | The seller. Buyer payments go buyer to seller on-chain. |
| Results | The response to the payer; media files in R2 | The payer. Only a sha256 of each result is public. |

## Trust boundaries

1. **Agent to Siro.** Untrusted input. Every body is validated against the catalog in `prepare` before any payment is read, so malformed input is never charged.
2. **Siro to facilitator.** Signatures are verified and settled by an x402 facilitator. Siro checks that what the client signed equals the quote (`termsMatch`): network, amount to the base unit, recipient and asset.
3. **Siro to upstream tools.** Model providers and public data APIs can fail or answer slowly. A failure throws before settlement and releases the nonce.
4. **Siro to the web, for sellers and discovery.** Calls go only to `https` URLs; private, loopback and link-local hosts are refused. The relay forwards only to services that discovery returned.

## Threats and controls

| Threat | Control |
|---|---|
| Replaying one signed authorization for several calls | Nonce locked in D1 before verification; one authorization pays for one call. |
| Paying less than the quote, or to another address | `termsMatch` compares amount, recipient, network and asset exactly. |
| Charging for a failed call | The tool runs before settlement; any failure releases the nonce and settles nothing. |
| Claiming a holder price without holding $SIRO | The quote is made for the address in `x-siro-holder`, and the verified payer must be that same address. The balance is read on-chain. |
| Free runs without holding $SIRO | A holder pass is a signed message bound to the address and an expiry of at most 24 hours; the balance is checked on every use and the daily count is kept in D1. |
| Server-side request forgery through `url` fields or the relay | `https` only, private host patterns refused, relay limited to discovered services. |
| Reading another payer's result | Full results are kept only for Siro's own test wallets; everyone else gets a hash on the ledger. Media links expire and can be deleted by the payer. |
| An agent overspending | Per-call and per-day caps are checked on the payer's side before signing; swaps have their own cap. |

## Out of scope

- A compromised payer device, browser or wallet extension.
- The security of the facilitator, the chains and the stablecoin contracts.
- Correctness of model output from upstream providers.
