# MetaBot CLI-First UI V1 Design

**Date:** 2026-05-14

## Goal

Define the first CLI-first cleanup pass for the six built-in human UI pages:

- `/ui/hub`
- `/ui/bot`
- `/ui/publish`
- `/ui/my-services`
- `/ui/trace`
- `/ui/refund`

The goal is to make each page a thin HTML interface over a documented CLI capability. Any feature a human can use from these pages should also be available through `metabot` CLI, with explicit multi-bot identity selection for actions that read private local state or create MetaID pins.

## Principles

1. CLI is the product capability boundary. HTML pages and skills are interfaces over that boundary.
2. Commands that use a local MetaBot identity should accept optional `--from <bot-slug>`.
3. If `--from` is omitted, commands use the active identity as the default/fallback bot.
4. Commands that aggregate local state across bots should accept `--all` where that is the UI's natural behavior.
5. Commands that write chain data must resolve the signing profile before building the chain write.
6. Command names should describe the user-visible function, not the internal daemon route.
7. Existing commands should remain as compatibility aliases where possible, but docs and UI should prefer the new canonical commands.

## Identity Selection Semantics

`--from <bot-slug>` means "use this local MetaBot profile as the actor for this operation."

For chain writes, this controls the signing key. Because MetaID ownership is determined by the private key that creates the pin, commands must resolve `--from` before creating the pin payload or selecting payment addresses.

When `--from` is omitted:

- read/write commands use the active profile selected by the existing active-home mechanism;
- commands return the resolved actor in the result envelope when the operation depends on an actor;
- error messages should explain how to pass `--from` if the active identity is missing or ambiguous.

`--all` means "read across all locally indexed MetaBot profiles." It is allowed only for read-only commands. It must not be accepted for chain writes.

## Canonical CLI Surface

### Network Discovery

Used by `/ui/hub`.

```bash
metabot network services [--online] [--query <text>] [--cached] [--limit <n>]
metabot network bots [--online] [--limit <n>]
metabot network sources list
metabot network sources add --base-url <url> [--label <label>]
metabot network sources remove --base-url <url>
```

No `--from` is required because these commands read public network directory data.

### Bot Management

Used by `/ui/bot` and `/ui/publish`.

```bash
metabot bot list
metabot bot show [--from <bot-slug>]
metabot bot create --name <name> [--payload-file <file>]
metabot bot update --from <bot-slug> --payload-file <file>
metabot bot delete --from <bot-slug> --confirm

metabot bot config get [--from <bot-slug>]
metabot bot config set [--from <bot-slug>] --payload-file <file>

metabot bot wallet [--from <bot-slug>]
metabot bot backup [--from <bot-slug>]

metabot bot runtimes list [--from <bot-slug>]
metabot bot runtimes discover [--from <bot-slug>]

metabot bot sessions [--from <bot-slug>] [--limit <n>]
```

`bot create` creates a new profile, so it does not take `--from`. The created bot owns its own bootstrap writes. `bot update`, `bot delete`, `bot backup`, and profile-scoped config commands should require or default an actor because they operate on one profile.

### Services

Used by `/ui/hub`, `/ui/publish`, `/ui/my-services`, and `/ui/refund`.

```bash
metabot services skills [--from <bot-slug>]
metabot services publish [--from <bot-slug>] --payload-file <file> [--chain <mvc|btc|doge|opcat>]

metabot services call [--from <bot-slug>] --request-file <file>
metabot services rate [--from <bot-slug>] --request-file <file> [--chain <mvc|btc|doge|opcat>]
```

`services skills` replaces the confusing `services publish-skills` name. It lists skills available from the actor bot's primary runtime. `services publish-skills` remains as a compatibility alias.

`services call` and `services rate` need optional `--from` because the buyer identity is the actor for payments, private messages, order-end messages, and rating pins.

#### Owned Services

Used by `/ui/my-services`.

```bash
metabot services owned list [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]
metabot services owned orders --service-id <id> [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]
metabot services owned modify [--from <bot-slug>] --payload-file <file> [--chain <mvc|btc|doge|opcat>]
metabot services owned revoke [--from <bot-slug>] --service-id <id> [--chain <mvc|btc|doge|opcat>]
```

`owned` means services published by locally managed MetaBot profiles. `/ui/my-services` should use `--all` semantics for its list view. Mutations must resolve one owner profile, either from `--from` or from the service ownership record.

#### Orders And Refunds

Used by `/ui/refund` and service detail links.

```bash
metabot services orders inspect [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)

metabot services refunds list [--from <bot-slug> | --all] [--initiated | --received | --all-kinds]
metabot services refunds settle [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)
```

`provider` remains as a compatibility command group for existing scripts:

```bash
metabot provider order inspect    -> metabot services orders inspect
metabot provider refund settle    -> metabot services refunds settle
```

The new canonical surface is under `services` because refunds and seller order inspection are service-order lifecycle operations, not a separate product area.

### Trace

Used by `/ui/trace`.

```bash
metabot trace sessions [--from <bot-slug> | --all] [--limit <n>]
metabot trace get (--trace-id <id> | --session-id <id>) [--from <bot-slug>]
metabot trace watch --trace-id <id> [--from <bot-slug>]
```

`/ui/trace` should default to `--all` semantics because it is the human trace center across all local bots. `trace get` and `trace watch` can use `--from` as an optimization or disambiguation hint, but should still find a unique trace/session if the selector is globally unique.

### UI Bridge

Used by humans and by CLI results that point to richer visual inspection.

```bash
metabot ui open --page <page> [--from <bot-slug>] [--trace-id <id>] [--session-id <id>] [--service-id <id>]
```

This is not a business capability. It is a bridge from CLI to local HTML.

## Command To UI Mapping

| UI page | Canonical CLI capability |
| --- | --- |
| `/ui/hub` | `network services`, `services call --from` for future Get Service action |
| `/ui/bot` | `bot list/show/create/update/delete/config/wallet/backup/runtimes/sessions` |
| `/ui/publish` | `bot list`, `bot runtimes list`, `services skills --from`, `services publish --from` |
| `/ui/my-services` | `services owned list/orders/modify/revoke` |
| `/ui/trace` | `trace sessions/get/watch` |
| `/ui/refund` | `services refunds list/settle`, `services orders inspect` |

## Implementation Architecture

The preferred implementation is not to spawn the CLI binary from the daemon. Instead, both CLI commands and daemon routes should call shared typed capability handlers.

```text
CLI parser
  -> command handler
    -> shared capability dependency
      -> core module / runtime store / chain writer

Daemon route
  -> route input parser
    -> same shared capability dependency
      -> core module / runtime store / chain writer

UI page
  -> fetch /api/...
    -> daemon route
```

This keeps browser behavior simple while preserving CLI-first semantics.

## Compatibility Rules

1. Keep `metabot services publish-skills` as an alias for `metabot services skills`.
2. Keep `metabot provider order inspect` as an alias for `metabot services orders inspect`.
3. Keep `metabot provider refund settle` as an alias for `metabot services refunds settle`.
4. Existing command results should keep machine-readable JSON envelopes.
5. New canonical commands should be documented first in help output.
6. Compatibility aliases should be tested so existing scripts do not break.
7. Human UI and canonical daemon routes should not keep old HTTP aliases for renamed service capabilities; missing rewiring should fail loudly with `not_found`.

## Testing Requirements

### Parser And Dispatch Tests

Add or update CLI tests to prove:

- `services skills --from alice` dispatches `{ from: 'alice' }`.
- `services publish --from alice --payload-file payload.json --chain doge` passes `from` and `network`.
- `services call --from buyer --request-file request.json` passes the buyer actor.
- `services rate --from buyer --request-file rating.json --chain opcat` passes the buyer actor and network.
- `services owned list --all --page 2 --page-size 10 --refresh` dispatches aggregate list input.
- `services owned modify --from alice --payload-file payload.json --chain btc` dispatches a chain-write mutation.
- `services owned revoke --from alice --service-id service-pin --chain doge` dispatches revoke input.
- `services refunds list --all --received` dispatches read-only refund list input.
- `services refunds settle --from seller --order-id order-1` dispatches seller settlement input.
- `services orders inspect --from seller --payment-txid txid` dispatches order inspection input.
- `trace sessions --all --limit 50` dispatches multi-bot session listing.
- `trace get --session-id s1 --from alice` keeps the selector and actor hint.
- `bot` commands dispatch to bot dependencies instead of requiring direct HTTP-only access.
- legacy aliases dispatch to the same canonical dependencies.

### Route And Contract Tests

Route tests or handler-level tests should prove:

- daemon `/api/services/skills?from=alice` maps to the same capability as `services skills --from alice`;
- daemon `/api/services/owned*` maps to the same capability as `services owned *`;
- daemon `/api/services/refunds` maps to the same capability as `services refunds list`;
- daemon `/api/services/refunds/settle` maps to the same capability as `services refunds settle`;
- daemon `/api/services/orders/inspect` maps to the same capability as `services orders inspect`;
- daemon `/api/trace/sessions?all=true` maps to the same capability as `trace sessions --all`;
- daemon `/api/bot/*` maps to the same capability group as `metabot bot *`.
- old service HTTP paths such as `/api/services/my*`, `/api/services/publish/skills`, and `/api/provider/refund*` are not mounted for these UI-backed capabilities.

### Focused Build Verification

For each implementation commit:

```bash
npm run build
node --test tests/cli/services.test.mjs tests/cli/trace.test.mjs tests/cli/help.test.mjs
```

Add more targeted files when touching bot or daemon route behavior:

```bash
node --test tests/cli/bot.test.mjs
node --test tests/daemon/*.test.mjs
```

Full `npm test` is required before final merge because this work changes CLI contracts, daemon contracts, and chain-write actor selection.

## Manual Acceptance Checklist

Use real local MetaBot private keys where available.

- `metabot bot list` returns local profiles.
- `metabot bot show --from <slug>` returns the selected profile, not only the active profile.
- `metabot services skills --from <slug>` lists skills for that bot's primary runtime.
- `metabot services publish --from <slug> --payload-file <file>` writes a service as that bot.
- The resulting service pin shows the selected bot's GlobalMetaId as provider.
- `metabot services owned list --all` shows services across local profiles.
- `metabot services owned list --from <slug>` shows only services owned by that bot.
- `metabot services refunds list --all` shows buyer-initiated and seller-received refund records.
- `metabot services refunds settle --from <seller> --order-id <id>` uses the seller bot identity.
- `metabot trace sessions --all` shows sessions across local bots.
- `metabot trace get --session-id <id>` returns the same data rendered by `/ui/trace`.
- `/ui/publish` can select a non-active bot and publish through the same actor semantics.
- `/ui/my-services` can list all local bot services and mutate the correct owner service.
- `/ui/refund` settlement maps to the new services refund capability.

## Out Of Scope For V1

The second CLI cleanup pass will apply the same `--from` policy to other chain-writing commands such as:

- `metabot buzz post`
- `metabot chain write`
- `metabot file upload`
- `metabot chat private`

V1 only changes the CLI surface needed by the six built-in UI pages.
