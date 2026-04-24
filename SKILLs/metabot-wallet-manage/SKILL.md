---
name: metabot-wallet-manage
description: Use when a human asks to check wallet balances now, and route transfer intents through the wallet command group for future expansion across mvc/btc; do not use this skill for non-wallet on-chain content publishing or remote service delegation.
---

# MetaBot Wallet Manage

Handle wallet intents for balance checks now, with a transfer-ready command group for future extensions.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks wallet balance for all chains, MVC only, or BTC only.
- The user asks wallet transfer intent guidance under the `wallet` namespace.

Should not trigger when:

- The user asks to publish buzz/service/file content.
- The user asks to delegate paid remote services.
- The user asks to manage network sources or identities.

## Balance Command

For default multi-chain balance (mvc + btc):

```bash
{{METABOT_CLI}} wallet balance
```

When the human explicitly asks BTC-only (for example: `btc`, `比特币`, `bitcoin`):

```bash
{{METABOT_CLI}} wallet balance --chain btc
```

When the human explicitly asks MVC-only:

```bash
{{METABOT_CLI}} wallet balance --chain mvc
```

## Transfer Intent (Future-Proofing)

The `wallet` command group is reserved for transfer expansion, but transfer subcommands are not implemented yet in this release.

If a human asks to transfer now:

1. Run:
   ```bash
   {{METABOT_CLI}} wallet --help
   ```
2. If no transfer subcommand exists, report transfer is not available yet and do not fabricate transfer result.

## Required Semantics

- Use `wallet balance` as canonical balance query entrypoint.
- Default behavior is all supported chains; avoid forcing single-chain unless requested.
- BTC intent keywords (`btc`, `比特币`, `bitcoin`) map to `--chain btc`.
- Keep outputs machine-first and grounded in command response fields.

## In Scope

- Wallet balance checks across supported chains.
- Wallet command-group transfer intent triage for forward compatibility.

## Out of Scope

- On-chain social/service publish writes.
- Remote service order lifecycle.
- Identity or network source management.

## Handoff To

- `metabot-post-buzz` / `metabot-upload-file` / `metabot-post-skillservice` for publish flows.
- `metabot-call-remote-service` for service delegation.
- `metabot-network-manage` for network discovery/source operations.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
