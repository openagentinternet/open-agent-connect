# MetaBot CLI-First V2 Design

**Date:** 2026-05-14

## Goal

Complete the second CLI-first cleanup pass for the remaining MetaBot CLI surface outside the V1 UI-page commands. V2 focuses on commands that still implicitly use the active identity for chain writes or profile-local state:

- `buzz post`
- `chain write`
- `file upload`
- `chat private`
- `wallet balance`
- `wallet transfer`
- profile-local `chat`, `config`, and `llm` read/write commands where the selected local Bot matters

Every command that creates chain data or consumes a local Bot private key must accept optional `--from <bot-slug>`. If `--from` is omitted, the command continues to use the active identity as the default/fallback Bot.

## Principles

1. CLI remains the product capability boundary.
2. `--from <bot-slug>` means "execute this command as this local MetaBot profile."
3. Chain-write commands must resolve the actor profile before selecting a signer, chat private key, payment address, default write network, runtime state store, or local history store.
4. `--from` is optional for actor-scoped commands unless the command already requires an explicit actor.
5. `--all` is read-only and mutually exclusive with `--from`.
6. `--slug` remains only as a compatibility alias where it already exists; new help and examples prefer `--from`.
7. JSON request files carry task payloads, not actor selection. Actor selection belongs in CLI flags and daemon request envelopes.
8. System-level commands do not get `--from` unless they operate on profile-local state.

## Actor Selection Semantics

The selected actor controls:

- the `METABOT_HOME` / profile home used by direct CLI runtime commands;
- the signer and mnemonic used by chain writes;
- the private chat identity used by encrypted simplemsg;
- default chain configuration for that profile;
- profile-local runtime state, private chat history, auto-reply config, and LLM bindings.

If `--from` cannot be resolved, commands should fail with a clear profile resolution error before building chain payloads or reading private state.

If `--from` is omitted, commands use the same active identity behavior as today.

## In Scope

### Chain-Write Commands

These commands must support optional `--from`:

```bash
metabot buzz post [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
metabot chain write [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
metabot file upload [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|opcat>]
metabot chat private [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]
metabot wallet transfer [--from <bot-slug>] --to <address> --amount <amount><UNIT> [--confirm]
```

### Profile-Local Read/Mutation Commands

These commands should support optional `--from` because they read or modify one profile's local state:

```bash
metabot wallet balance [--from <bot-slug>] [--chain <all|mvc|btc|doge|opcat>]

metabot chat conversations [--from <bot-slug>]
metabot chat messages [--from <bot-slug>] --conversation-id <id> [--limit <n>]
metabot chat auto-reply status [--from <bot-slug>]
metabot chat auto-reply enable [--from <bot-slug>] [--strategy <id>]
metabot chat auto-reply disable [--from <bot-slug>]

metabot config get [--from <bot-slug>] <key>
metabot config set [--from <bot-slug>] <key> <value>

metabot llm bindings [--from <bot-slug>]
metabot llm bind [--from <bot-slug>] --runtime-id <id> --role <role>
metabot llm unbind [--from <bot-slug>] --binding-id <id>
metabot llm set-preferred [--from <bot-slug>] --provider <provider>
metabot llm get-preferred [--from <bot-slug>]
```

### Commands That Stay System-Level

These commands should not gain `--from` in V2:

- `identity create`
- `identity who`
- `identity list`
- `identity assign`
- `daemon start`
- `daemon stop`
- `doctor`
- `system update`
- `system uninstall`
- `host bind-skills`
- `network services`
- `network bots`
- `network sources`
- `skills resolve`
- `ui open` already gained `--from` in V1 as a UI bridge selector.

## Architecture

V2 should add a shared CLI actor helper instead of duplicating profile resolution in every command. The helper should be small and explicit:

```text
CLI parser
  -> read --from
  -> include { from } in dependency input
  -> runtime dependency
    -> resolve profile home when direct local work is needed
    -> or send { from } to daemon route
      -> daemon default handler resolves scoped actor before signer/store use
```

For daemon-backed commands, routes should pass `from` to handlers through JSON bodies or query strings. Default handlers should use a scoped profile helper before touching signer, config, runtime state, private chat state, or evolution stores.

For direct CLI runtime commands, the runtime should resolve the requested actor home and then reuse existing local logic with that home. This applies to wallet and evolution runtime code that currently calls `normalizeHomeDir(context.env, context.cwd)` directly.

## Compatibility

- Existing command payload shapes remain valid.
- Existing no-`--from` behavior remains valid and continues to use the active identity.
- Existing `--slug` options for LLM and service skill compatibility remain accepted, but help should prefer `--from`.
- Result envelopes remain machine-first JSON.
- Error codes should remain stable where possible; new actor conflicts should use existing profile resolution errors or `invalid_flag`.

## Testing Requirements

### CLI Parser Tests

Add dispatch tests proving `--from` reaches dependencies for:

- `buzz post`
- `chain write`
- `file upload`
- `chat private`
- `chat conversations/messages/auto-reply`
- `master publish`
- `master ask`
- `wallet balance`
- `wallet transfer`
- `evolution publish`
- `config get/set`
- `llm bindings/bind/unbind/set-preferred/get-preferred`

### Runtime And Handler Tests

Add focused tests proving:

- direct CLI wallet commands use the selected profile home;
- direct CLI evolution publish uses the selected profile home and signer;
- daemon-backed buzz, chain write, file upload, chat private, and master publish resolve `from` before signing;
- no-`--from` behavior still uses active identity;
- missing `--from` profile fails before any chain write.

### Help Tests

Update help tests so every actor-scoped V2 command documents `--from <bot-slug>` and examples show canonical usage.

### Smoke Tests

After implementation, run read-only or fake-chain smoke commands:

```bash
metabot buzz post --help --json
metabot chain write --help --json
metabot file upload --help --json
metabot chat private --help --json
metabot wallet balance --help --json
```

If a local test environment has multiple real profiles, run at least one safe read command with `--from` for each profile.

## Acceptance Criteria

1. Every V2 chain-write command supports optional `--from <bot-slug>`.
2. `--from` changes the signer/profile used for the action, not only the returned metadata.
3. Omitting `--from` preserves active identity behavior.
4. Help output documents `--from` for every actor-scoped command.
5. Existing skills can call the canonical CLI instead of relying on hidden active identity assumptions.
6. Targeted build and CLI/daemon tests pass.
7. A code-review subagent and a CLI-smoke subagent are run after implementation, following the user's V1 acceptance workflow.
