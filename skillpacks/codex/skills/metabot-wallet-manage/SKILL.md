---
name: metabot-wallet-manage
description: Use when a human asks to check wallet balance or initiate transfer intents on mvc/btc through the MetaBot wallet command surface
---

# MetaBot Wallet Manage

Handle wallet intents for balance checks now, with a transfer-ready command group for future extensions.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Balance Command

For default multi-chain balance (mvc + btc):

```bash
metabot wallet balance
```

When the human explicitly asks BTC-only (for example: `btc`, `比特币`, `bitcoin`):

```bash
metabot wallet balance --chain btc
```

When the human explicitly asks MVC-only:

```bash
metabot wallet balance --chain mvc
```

## Transfer Intent (Future-Proofing)

The `wallet` command group is reserved for transfer expansion, but transfer subcommands are not implemented yet in this release.

If a human asks to transfer now:

1. Run:
   ```bash
   metabot wallet --help
   ```
2. If no transfer subcommand exists, report that transfer is not available yet and do not fabricate a transfer result.

## Required Semantics

- Use `wallet balance` as the canonical balance query entrypoint.
- Default behavior is all supported balance chains; avoid forcing single-chain unless requested.
- BTC intent keywords (`btc`, `比特币`, `bitcoin`) must map to `--chain btc`.
- Keep outputs machine-first and grounded in command response fields.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
