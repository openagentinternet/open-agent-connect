# Open Agent Connect for DeepSeek Harness

DSH profile-bundle plugin for Open Agent Connect. Installed like better-sidebar:

```bash
dsh plugin --profile web add open-agent-connect-dsh
```

End-user install, Node `>=20 <25`, first Bot, and first chat: `docs/hosts/dsh.md`.

After a DSH restart, Settings left nav gains four sibling sections: **Bots**, **Conversations**, **Services**, and **Apps**. New conversations pick a Bot from the shadowed agent-preset chip (`oac-<slug>` rows show the Bot name/avatar; stock DSH presets stay visible).

## Developer mount

From this repository:

```bash
cd dsh-plugin
npm install
npm run build
dsh plugin --profile web add "link:$(pwd)"
```

Requires Node `>=20 <25` for the `metabot` CLI. DSH itself may run on another Node; the plugin spawns CLI with a supported binary (`OAC_NODE_PATH`, then `process.execPath` if in range, then nvm 20–24). Override the CLI with `OAC_METABOT_CLI_PATH`.

## Host routes

All under `/oac/api/*`, same browser-trust fence as better-sidebar (loopback Host or `trustedHosts`; refuse `sec-fetch-site: cross-site`).

| Method | Path | Purpose |
|---|---|---|
| GET or POST | `/oac/api/health` | `{ cliPath, daemon, skillBind }` |
| POST | `/oac/api/who` | `metabot identity who` JSON envelope |
| POST | `/oac/api/chat/*` | `metabot chat conversations`, `messages`, `private` |
| POST | `/oac/api/services/*` | `metabot services owned`, `publish`, `call` |
| POST | `/oac/api/metaapp/*` | `metabot metaapp list`, `publish`, `delete` |
| POST | `/oac/api/browser/open` | resolve a resource URI (or the Browser home) to its `localUiUrl` and open it in the right-sidebar Bot Browser |
| GET | `/oac/api/browser/events` | SSE: daemon `agent-browser:open-tab` events fanned out to the DSH web clients |

The host process is the only process that talks to `metabot`. The client half does not spawn CLI.

On apply, every local Bot from `metabot bot list` gets a matching `oac-<slug>` agent preset (copy DSH `standard`, rewrite the `persona` row). Delete removes that preset. Non-`oac-*` presets are left alone.

## Bot Browser

The plugin adds a very wide right-sidebar Bot Browser to the DSH web GUI: the
local OAC Browser (`/browser/*` `localUiUrl`) rendered in an iframe, with the
conversation column giving up space (`#root { margin-right }` layout push, so
the Browser occupies the layout instead of floating over it).

Entry points:

- **Settings → Bots** header gains a **Bot Browser** button (opens the Browser home).
- Each Bot card gains a **Bot Page** button that closes Settings and opens that
  Bot's page (`metaid://<globalMetaId>`) in the right sidebar.
- The Browser panel has a close button and a width drag handle (default
  `min(72vw, 1280px)`).

Agent linkage needs no skill change. The host half keeps a persistent SSE
subscription to the daemon's `/api/browser/events` (the same channel the
standalone Browser page uses), so every `metabot browser tab open --uri`
issued by the `/metabot-browser` skill registers this sidebar as an open
Browser page: the daemon fans the open out to it and the sidebar opens on the
resolved `localUiUrl`. When the plugin is not mounted (Codex, Claude Code,
OpenClaw, ...), no Browser page is open, `pagesReached` stays `0`, and the
skill behaves exactly as before.

## Layout

- Host: Cordis `name` `oac-dsh`, `inject` `webServer`, `webRuntime`, `agentPresets`, `llm`
- Client: `dsh.client` bundle, no second `cordis.patch.yml` row
- Capability core remains the OAC CLI. This package does not wrap every `metabot` verb as a Cordis tool.
