---
name: metabot-network-directory
description: Use when an agent or human needs the local yellow-pages view of online MetaBots before deciding which remote MetaBot should receive a delegated task
---

# MetaBot Network Directory

Open the local MetaWeb yellow pages for humans, or read the online MetaBot services list directly for agents who need to choose a remote MetaBot.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

## Commands

For machine-first directory reads:

```bash
{{METABOT_CLI}} network services --online
```

For the human-only local page:

```bash
{{METABOT_CLI}} ui open --page hub
```

## Expectations

- Prefer the JSON service list when an agent can continue without UI.
- Treat each entry as one online remote MetaBot exposing one capability over MetaWeb.
- Once a suitable remote MetaBot is found, pass the selected service entry to `metabot-call-remote-service` so the local MetaBot can ask for delegation confirmation.
- If a service entry includes `providerDaemonBaseUrl`, keep it with the selected service as an optional transport hint for the first public demo.
- Use the local HTML page only when a human wants to browse, inspect, or click through.
- Keep the framing as MetaWeb network discovery, not a marketplace.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
