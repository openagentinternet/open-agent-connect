---
name: metabot-network-directory
description: Use when an agent or human needs the local yellow-pages view of online MetaBots before deciding which remote MetaBot should receive a delegated task
---

# MetaBot Network Directory

Open the local MetaWeb yellow pages for humans, or read the online MetaBot services list directly for agents who need to choose a remote MetaBot.

## Host Adapter

Generated for OpenClaw.

- Default skill root: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`
- Host pack id: `openclaw`
- CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Commands

For machine-first directory reads:

```bash
metabot network services --online
```

For the human-only local page:

```bash
metabot ui open --page hub
```

## Expectations

- Prefer the JSON service list when an agent can continue without UI.
- Treat each entry as one online remote MetaBot exposing one capability over MetaWeb.
- Once a suitable remote MetaBot is found, pass the selected service entry to `metabot-call-remote-service` so the local MetaBot can ask for delegation confirmation.
- If a service entry includes `providerDaemonBaseUrl`, keep it with the selected service as an optional transport hint for the first public demo.
- Use the local HTML page only when a human wants to browse, inspect, or click through.
- Keep the framing as MetaWeb network discovery, not a marketplace.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
