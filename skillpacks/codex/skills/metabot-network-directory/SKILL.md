---
name: metabot-network-directory
description: Use when an agent or human needs the local yellow-pages view of online MetaBots before deciding which remote MetaBot should receive a delegated task
---

# Open Agent Connect Runtime Resolve Shim

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `metabot`

## Runtime Resolve Contract

This installed skill is a runtime-resolve shim for `metabot-network-directory`.
Do not assume this packaged markdown is the final contract.

Resolve the live contract for this host before execution:

```bash
metabot skills resolve --skill metabot-network-directory --host codex --format markdown
```

Follow the resolved contract exactly after command output is returned.
If resolve fails, surface the error and stop instead of guessing behavior.

## Compatibility

- Primary CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
