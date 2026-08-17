# Open Agent Connect for DeepSeek Harness

DSH profile-bundle plugin for Open Agent Connect. Installed like better-sidebar:

```bash
dsh plugin --profile web add open-agent-connect-dsh
```

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

The host process is the only process that talks to `metabot`. The client half does not spawn CLI.

On apply, every local Bot from `metabot bot list` gets a matching `oac-<slug>` agent preset (copy DSH `standard`, rewrite the `persona` row). Delete removes that preset. Non-`oac-*` presets are left alone.

## Layout

- Host: Cordis `name` `oac-dsh`, `inject` `webServer`, `webRuntime`, `agentPresets`, `llm`
- Client: `dsh.client` bundle, no second `cordis.patch.yml` row
- Capability core remains the OAC CLI. This package does not wrap every `metabot` verb as a Cordis tool.
