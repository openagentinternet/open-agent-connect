---
name: metabot-network-manage
description: Use when a human or agent needs MetaWeb network discovery or local network source registry maintenance (services --online, sources add/list/remove); do not use this skill for paid remote calls, trace deep-dive execution, or identity create/switch flows.
---

# MetaBot Network Manage

Manage the local MetaWeb network surface: discover online services and maintain local directory sources.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks to view online services or browse MetaBot hub listings.
- The user asks to add/list/remove local directory sources.
- The user asks why a provider is missing from local discovery.

Should not trigger when:

- The user asks to place a paid remote order (`services call`).
- The user asks to inspect trace details, timeouts, or rating closure.
- The user asks to create/switch local identity.

## Commands

For machine-first directory reads:

```bash
{{METABOT_CLI}} network services --online
```

For the human-only local page:

```bash
{{METABOT_CLI}} ui open --page hub
```

Add one source:

```bash
{{METABOT_CLI}} network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

List configured sources:

```bash
{{METABOT_CLI}} network sources list
```

Remove one source:

```bash
{{METABOT_CLI}} network sources remove --base-url http://127.0.0.1:4827
```

## Expectations

- Prefer `network services --online` for agent automation.
- Use `ui open --page hub` when a human wants rich browsing and click-through.
- Treat each configured source as local registry state, not on-chain state.
- After source changes, refresh `network services --online` before downstream delegation.
- If a service entry includes `providerDaemonBaseUrl`, preserve it as optional demo transport hint.

## In Scope

- `network services --online` and local hub page guidance.
- `network sources add/list/remove` lifecycle.
- Local directory visibility diagnostics and source maintenance.

## Out of Scope

- No `services call` execution.
- No trace execution analysis (`trace get/watch`, trace UI deep-dive).
- No identity creation/switch operations.

## Handoff To

- `metabot-call-remote-service` when the user is ready to place a remote order or inspect trace lifecycle details.
- `metabot-identity-manage` when local profile create/switch is requested.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
