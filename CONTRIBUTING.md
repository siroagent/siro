# Contributing

Thanks for taking the time. Bug reports, fixes and new tools are welcome.

## Before you start

- For a bug, open an issue with the request you sent, what came back and what you expected. Leave out keys and seed phrases.
- For a larger change, open an issue first so the approach can be agreed before you write it.
- Security problems go through private reporting, not issues: see [SECURITY.md](SECURITY.md).

## Working on the code

```bash
npm ci
npm run typecheck
npm test
npm run build
```

- Keep the rule that makes Siro safe to use: input is validated before payment, and a payment settles only after a result. A change that can charge for a failed call will not be merged.
- Add or update tests in `test/` for anything that touches pricing, payment matching, holder tiers or result receipts.
- Prices are strings of USD with up to six decimals in `shared/catalog.ts`; never use floats for amounts.
- Write user-facing text in plain English, in full sentences.

## Pull requests

- One topic per pull request, with a short description of what changed and why.
- CI must be green: typecheck, tests, build, CodeQL.
- Commits are squashed on merge.

By contributing you agree that your work is released under the [MIT License](LICENSE).
