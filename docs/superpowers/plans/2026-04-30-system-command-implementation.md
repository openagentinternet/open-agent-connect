# `metabot system` Implementation Plan

## Goal

Add a new top-level CLI namespace with two subcommands:

- `metabot system update`
- `metabot system uninstall`

Fixed product decisions:

- `system update` defaults to latest release.
- No automatic rollback in this iteration.
- `system uninstall` default is Tier 1 safe uninstall.
- Tier 2 remains internal-only and is not exposed.
- `system uninstall --all` requires token confirmation.
- Help text must clearly state default uninstall preserves identity and wallet-sensitive data.

## Contract

## `metabot system update`

- machine-first, non-interactive
- deterministic host resolution:
  - use `--host` when provided
  - if omitted and exactly one installed host pack exists, use it
  - if omitted and none exist -> `update_host_unresolved`
  - if omitted and multiple exist -> `manual_action_required`
- payload outcome values: `updated` or `no_update`
- top-level result envelope must stay in existing CLI contract (`success/manual_action_required/failed`)

## `metabot system uninstall`

- default mode: Tier 1 safe uninstall
- full erase mode: `--all --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS`
- missing token for `--all` -> `manual_action_required` (`confirmation_required`)
- invalid token -> `failed` (`invalid_confirmation_token`)

Tier 1 must preserve:

- `~/.metabot/manager/`
- `~/.metabot/profiles/`
- identity/provider secret files
- mnemonic/private key/wallet-related local data

Tier 1 removes:

- guarded host `metabot-*` symlinks pointing to `.metabot/skills/metabot-*`
- `~/.metabot/bin/metabot`
- optional legacy shim only if recognizable OAC compatibility shim
- active daemon with best-effort SIGTERM

## Scope / File Map

- `src/cli/main.ts`: route `system`
- `src/cli/commands/system.ts`: parse and validate `update/uninstall`
- `src/cli/types.ts`: add `dependencies.system`
- `src/cli/runtime.ts`: wire runtime handlers
- `src/core/system/update.ts`: update orchestration
- `src/core/system/uninstall.ts`: Tier 1 + Tier 3 behavior
- `src/core/system/types.ts`: shared types and error contract
- `src/cli/commandHelp.ts`: add `system` help tree
- `tests/cli/system.test.mjs`: behavior tests
- `tests/cli/help.test.mjs`: help assertions
- docs updates:
  - `docs/install/open-agent-connect.md`
  - `docs/install/uninstall-open-agent-connect.md`
  - `docs/hosts/codex-agent-update.md`

