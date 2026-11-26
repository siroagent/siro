# Roadmap

What is live today is in the [README](README.md) and the [changelog](CHANGELOG.md). This page lists what comes next; each item is tracked in an issue.

## Holder pricing everywhere

$SIRO holder price and free runs work over HTTP, on the site, in the CLI and in the local MCP server.

- [Remote MCP: holder price for `siro_call`](https://github.com/siroagent/siro/issues/1)

## Private results

Media links already expire after 7 days and a payer can delete a result with a signed request.

- [R2 lifecycle rule: delete media after 7 days](https://github.com/siroagent/siro/issues/2)

## Test coverage for the paid path

Quoting, payment matching, holder tiers and result receipts are tested in `test/`.

- [Tests for `v1.ts` with a mocked facilitator](https://github.com/siroagent/siro/issues/3)
- [Tests for the CLI wallet caps](https://github.com/siroagent/siro/issues/4)
