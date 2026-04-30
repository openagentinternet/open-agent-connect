# `metabot system` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## Goal

Introduce a new top-level CLI namespace:

- `metabot system update`
- `metabot system uninstall`

Required product semantics:

- `metabot system update` defaults to updating to `latest`.
- Update does **not** implement automatic rollback in this iteration; it must remain safely retryable.
- `metabot system uninstall` defaults to safe uninstall (Tier 1) and preserves identity/wallet-sensitive data.
- `metabot system uninstall --all` performs full erase (Tier 3) and requires explicit confirmation.
- For this milestone, full-erase confirmation is machine-first: `--confirm-token` is required (interactive typed prompt is out of scope).
- Tier 2 clean-reinstall behavior remains internal and is not exposed as a public command.

## Architecture

Add one new CLI command module (`src/cli/commands/system.ts`) and wire it through existing command dispatch and dependency injection:

- Routing in `src/cli/main.ts`
- Help specs in `src/cli/commandHelp.ts`
- Runtime handlers in `src/cli/runtime.ts`
- Dependency contracts in `src/cli/types.ts`

Core execution logic should live under `src/core/system/`:

- `update.ts` for release update orchestration
- `uninstall.ts` for safe/full uninstall behavior
- `types.ts` for machine-readable result payloads

This keeps CLI parsing thin and business logic testable.

---

## Command Contract

## `metabot system update`

### Intended behavior

- Default target: latest release.
- Non-interactive by default (cron-friendly).
- Idempotent behavior:
  - already latest -> success with `no_update`
  - newer release applied -> success with `updated`
- No rollback in this milestone.

### Flags (initial scope)

- `--host <codex|claude-code|openclaw>` optional host override.
- `--version <tag>` optional explicit release tag (if omitted, use latest).
- `--dry-run` prints planned actions without mutating local install.
- `--json` supported via common CLI result pattern.

### Host resolution algorithm (required)

When `--host` is omitted:

1. Scan `~/.metabot/installpacks/` for installed built-in host packs.
2. Keep only `codex|claude-code|openclaw`.
3. If exactly one host is found, use it.
4. If none are found, return `failed` with code `update_host_unresolved`.
5. If more than one host is found, return `manual_action_required` and list candidates; user must pass `--host`.

Update scope in this iteration: update one selected host pack only. Do not fan out to all hosts automatically.

### Result state and exit mapping (must match current CLI)

- Top-level state must remain in existing envelope: `success | awaiting_confirmation | waiting | manual_action_required | failed`.
- `updated` / `no_update` are payload-level outcomes under top-level `success`.
- `success` (`updated` / `no_update`) -> exit `0`
- `manual_action_required` (for example host ambiguous or explicit human step required) -> exit `2`
- `failed` -> exit `1`

Do not use `awaiting_confirmation` for cases that should exit `2` in this plan.

## `metabot system uninstall`

### Intended behavior

- Default (`metabot system uninstall`): safe uninstall (Tier 1).
- Optional full erase (`metabot system uninstall --all`): danger-zone Tier 3.

### Safety rules

- Default uninstall must preserve:
  - identity profiles
  - mnemonic/private-key files
  - manager/profile records
  - wallet-related local data
- `--all` requires explicit confirmation token in this iteration:
  - required `--confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS`

### Flags (initial scope)

- `--all` full erase mode.
- `--confirm-token <token>` non-interactive confirmation path for `--all`.
- `--yes` may skip non-critical prompts in safe uninstall, but must not bypass `--all` hard confirmation.
- `--json` supported via common CLI result pattern.

### Tier behavior and path-level constraints

Tier 1 (`metabot system uninstall`) removes:

- host `metabot-*` symlinks under built-in host roots only when symlink target points to `.metabot/skills/metabot-*`
- `~/.metabot/bin/metabot`
- `~/.agent-connect/bin/metabot` only when recognizable as OAC compatibility shim
- active daemon by best-effort stop

Tier 1 must preserve:

- `~/.metabot/manager/`
- `~/.metabot/profiles/`
- all identity and provider secret files
- mnemonics, private keys, wallet-related local data, profile workspace memory files

Tier 3 (`metabot system uninstall --all`) removes:

- full `~/.metabot` only after hard confirmation

Tier 2 behavior remains internal and is not exposed as a public command.

### Confirmation and state mapping

- `--all` without valid `--confirm-token` -> `manual_action_required` (exit `2`, code `confirmation_required`)
- invalid token -> `failed` with `invalid_confirmation_token` (exit `1`)
- confirmed full erase -> `success` (exit `0`)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/cli/main.ts` | Modify | Add top-level `system` command routing |
| `src/cli/commands/system.ts` | Add | Parse `update` / `uninstall` args and dispatch to dependencies |
| `src/cli/types.ts` | Modify | Extend `CliDependencies` with `system.update` and `system.uninstall` |
| `src/cli/runtime.ts` | Modify | Wire default implementations for `system` handlers |
| `src/cli/commandHelp.ts` | Modify | Add `system`, `system update`, `system uninstall` help specs |
| `src/core/system/types.ts` | Add | Define typed input/output contracts for update/uninstall flows |
| `src/core/system/update.ts` | Add | Implement release update orchestration |
| `src/core/system/uninstall.ts` | Add | Implement Tier 1 + Tier 3 uninstall logic |
| `tests/cli/system.test.mjs` | Add | Add CLI contract tests for update/uninstall |
| `tests/cli/help.test.mjs` | Modify | Add help assertions for `system` namespace and uninstall safety wording |
| `tests/docs/codexInstallDocs.test.mjs` | Modify | Keep install/uninstall docs consistency checks passing |
| `docs/install/open-agent-connect.md` | Modify | Add `metabot system update` as primary update path |
| `docs/install/uninstall-open-agent-connect.md` | Modify | Add CLI-first uninstall usage and safety wording |
| `docs/hosts/codex-agent-update.md` | Modify | Align host update runbook with `metabot system update` (or clearly mark fallback/manual path) |

---

## Implementation Tasks

## Task 1: Wire top-level `system` command

- [ ] Add `runSystemCommand` import in `src/cli/main.ts`.
- [ ] Add `case 'system':` branch to command switch.
- [ ] Ensure unknown subcommands continue to use current error shape.

Verification:

- [ ] `metabot system --help` resolves command help (after Task 2).

## Task 2: Add help specs and user-facing safety language

- [ ] Add root help entry for `system` in `ROOT_COMMAND_HELP`.
- [ ] Add help spec for `metabot system`.
- [ ] Add help spec for `metabot system update`.
- [ ] Add help spec for `metabot system uninstall`.
- [ ] Explicitly state in uninstall help: default uninstall preserves identity/mnemonic/private-key/wallet-related data.
- [ ] Explicitly state in uninstall help: `--all` requires confirmation token/typed confirmation.

Verification:

- [ ] `metabot system --help`
- [ ] `metabot system update --help`
- [ ] `metabot system uninstall --help`

## Task 3: Add command parser module

- [ ] Create `src/cli/commands/system.ts`.
- [ ] Implement argument parsing for:
  - `system update`
  - `system uninstall`
- [ ] Validate incompatible/missing args with existing helper style (`commandMissingFlag`, `commandFailed`, `commandUnknownSubcommand`).
- [ ] Parser-owned validation (must happen before handler call):
  - unsupported `--host`
  - `--confirm-token` provided without `--all`
  - unknown flags where behavior should be strict
  - malformed option values

Verification:

- [ ] Unit-style tests or CLI tests for missing flags and invalid combinations.

## Task 4: Extend CLI dependency contracts

- [ ] Update `src/cli/types.ts` to include:
  - `dependencies.system.update(input)`
  - `dependencies.system.uninstall(input)`
- [ ] Keep typings aligned with existing command dependency style.

Verification:

- [ ] TypeScript build passes (`npm run build`).

## Task 5: Implement runtime handlers

- [ ] In `src/cli/runtime.ts`, add `system` default handlers within `createDefaultCliDependencies`.
- [ ] Handler behavior:
  - `update`: call core update logic, return structured result
  - `uninstall`: enforce `--all` confirmation rules, call core uninstall logic
- [ ] Reuse existing command result helpers (`commandSuccess`, `commandFailed`, `commandManualActionRequired` style equivalent already used in repo patterns).
- [ ] Ensure confirmation-required flows return `manual_action_required` (not `awaiting_confirmation`) to preserve exit code contract.

Verification:

- [ ] CLI tests cover state/result shape.

## Task 6: Implement core update flow

- [ ] Create `src/core/system/update.ts` and `src/core/system/types.ts`.
- [ ] Implement:
  - host resolution/validation
  - release URL resolution (latest vs explicit tag)
  - host-pack artifact model: `oac-<host>.tar.gz`
  - package download/extract/install execution
  - extraction validation: expected files (`install.sh`, `runtime/dist/cli/main.js`)
  - execute packaged host `install.sh` as source-of-truth install/update path
  - packaged installer handles rebind (equivalent to existing install behavior)
  - post-install smoke checks
  - `dry-run` mode
- [ ] Return top-level states in existing CLI envelope only; place update outcome in payload (`updated` / `no_update`).
- [ ] Define canonical failure codes:
  - `update_host_unresolved`
  - `unsupported_host`
  - `download_failed`
  - `install_artifact_invalid`
  - `install_failed`

Verification:

- [ ] Tests for:
  - default latest path
  - explicit version path
  - dry-run path
  - failure mapping

## Task 7: Implement core uninstall flow

- [ ] Create `src/core/system/uninstall.ts`.
- [ ] Implement Tier 1 safe uninstall with path-level guard rules from uninstall guide.
- [ ] Implement Tier 3 full erase behind `--all` plus hard confirmation.
- [ ] Ensure default path preserves identity/secret/wallet data.
- [ ] Keep Tier 2 behavior internal only (not exposed via CLI command).
- [ ] Define canonical failure codes:
  - `confirmation_required`
  - `invalid_confirmation_token`
  - `uninstall_failed`

Verification:

- [ ] Tests for:
  - default uninstall preserves sensitive data
  - `--all` without confirmation blocked
  - `--all` with valid token allowed
  - invalid token rejected

## Task 8: Add CLI test coverage

- [ ] Add `tests/cli/system.test.mjs`.
- [ ] Cover:
  - command routing
  - required flags / invalid args
  - update result states and exit semantics
  - uninstall confirmation gate behavior
  - help text assertions for preservation warning
  - host resolution edge cases:
    - none installed and no `--host`
    - multiple installed and no `--host`
  - token edge cases:
    - `--all` non-interactive without token
    - invalid token
  - uninstall safe-mode guards:
    - removes only guarded symlinks
    - preserves sensitive paths

Verification:

- [ ] `npm run build`
- [ ] `node --test tests/cli/system.test.mjs`

## Task 9: Update install/uninstall docs

- [ ] In `docs/install/open-agent-connect.md`, introduce `metabot system update` as the user-facing update command.
- [ ] In `docs/install/uninstall-open-agent-connect.md`, add CLI-first uninstall command usage while retaining script fallback and existing safety semantics.
- [ ] In `docs/hosts/codex-agent-update.md`, align update procedure with `metabot system update` as preferred path, and keep manual sequence as fallback only.
- [ ] Ensure all docs describe legacy shim as optional compatibility artifact ("if present and recognizable"), not guaranteed install output.

Verification:

- [ ] Doc language remains aligned with Tier 1/Tier 3 definitions.

---

## Acceptance Criteria

- `metabot system update` runs non-interactively and defaults to latest.
- Re-running update when already current yields a success `no_update` outcome.
- Host resolution behavior is deterministic when `--host` is omitted (single host auto-selected; none/multi return actionable error).
- `metabot system uninstall` removes host bindings/shims but preserves identity and wallet-sensitive files.
- `metabot system uninstall --all` cannot proceed without explicit confirmation.
- Confirmation-required scenarios return `manual_action_required` and exit `2`.
- Help output clearly communicates uninstall preservation defaults and `--all` danger semantics.
- CLI tests and build pass.

---

## Out of Scope (This Iteration)

- Automatic rollback for failed update.
- Public Tier 2 uninstall command.
- New UI surface for update/uninstall.

