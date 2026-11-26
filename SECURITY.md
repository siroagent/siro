# Security policy

Siro moves real stablecoins, so payment and wallet bugs are taken seriously.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this repository. Please do not open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer within 3 working days, and a fix or a plan within 14 days for confirmed issues.

## In scope

- Payment handling in `worker/x402.ts` and `worker/v1.ts`: accepting a payment that does not match the quote, settling a call that failed, reusing a signed authorization, or charging without returning a result.
- Holder pricing in `worker/holder.ts`: getting a holder price or free runs without holding $SIRO in the paying wallet.
- The relay and discovery in `worker/discover.ts`: reaching an address that discovery did not return, or any server-side request forgery.
- Result privacy in `worker/proof.ts`: reading another payer's full result.
- The CLI wallet in `cli/`: key handling, cap bypasses, signing more than the quoted amount.

## Out of scope

- Denial of service by sending a high volume of requests.
- Prices, availability or output quality of upstream model providers.
- Findings that need a compromised device, browser or wallet extension.

## Supported versions

Only the deployed site and the latest CLI release are supported.
