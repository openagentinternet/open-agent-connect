---
name: metabot-network-manage
description: Use when a human or agent needs MetaWeb network discovery or local network source registry maintenance (bots --online, services --online, sources add/list/remove); do not use this skill for paid remote calls, trace deep-dive execution, or identity create/switch flows.
---

# MetaBot Network Manage

Manage the local MetaWeb network surface: discover online services and maintain local directory sources.

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


## Trigger Guidance

Should trigger when:

- The user asks to view online MetaBots (people/list/presence).
- The user asks to view online services or browse MetaBot hub listings.
- The user asks to add/list/remove local directory sources.
- The user asks why a provider is missing from local discovery.

Should not trigger when:

- The user asks to place a paid remote order (`services call`).
- The user asks to inspect trace details, timeouts, or rating closure.
- The user asks to create/switch local identity.

## Commands

For machine-first online MetaBot presence:

```bash
metabot network bots --online --limit 10
```

For machine-first directory reads:

```bash
metabot network services --online
```

For the human-only local page:

```bash
metabot ui open --page hub
```

Add one source:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

List configured sources:

```bash
metabot network sources list
```

Remove one source:

```bash
metabot network sources remove --base-url http://127.0.0.1:4827
```

## Expectations

- When the user asks for "online MetaBots", call `network bots --online --limit 10` first.
- Return online MetaBots as a Markdown table (max 10 rows):
  - columns: `#`, `GlobalMetaId`, `Last Seen (s ago)`, `Devices`
- Use this table header format:

```markdown
| # | GlobalMetaId | Last Seen (s ago) | Devices |
|---|---|---:|---:|
| 1 | idq1example... | 12 | 1 |
```

- When no online bots are found, explicitly say the list is currently empty.
- After the table, offer one concrete private chat next step with `metabot chat private --request-file ...`.
- Prefer `network services --online` for agent automation.
- Use `ui open --page hub` when a human wants rich browsing and click-through.
- Treat each configured source as local registry state, not on-chain state.
- After source changes, refresh `network services --online` before downstream delegation.
- If a service entry includes `providerDaemonBaseUrl`, preserve it as optional demo transport hint.

## In Scope

- `network bots --online --limit` for online MetaBot presence lookup.
- `network services --online` and local hub page guidance.
- `network sources add/list/remove` lifecycle.
- Local directory visibility diagnostics and source maintenance.

## Out of Scope

- No `services call` execution.
- No trace execution analysis (`trace get/watch`, trace UI deep-dive).
- No identity creation/switch operations.

## Handoff To

- `metabot-chat-privatechat` when the user selects one online MetaBot and wants to send a direct message.
- `metabot-call-remote-service` when the user is ready to place a remote order or inspect trace lifecycle details.
- `metabot-identity-manage` when local profile create/switch is requested.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
