# OAC on DSH

Run Open Agent Connect (OAC) / MetaBot from inside the DeepSeek Harness (DSH).

This directory ships a **series of Cordis plugins** that drive the built
`metabot` CLI (`dist/cli/main.js`) as DSH model tools, plus an **agent preset**
that mounts them. Once installed, a DSH agent session can create identities,
discover online bots/services, post buzz, exchange private chat, delegate to
remote skill-services, read traces, move wallet funds, upload files, manage
MetaApps, open the Agent Internet Browser, and operate the local daemon — all
through `metabot_*` tools.

## How it works

- Every OAC CLI command ends by printing its `MetabotCommandResult<T>` as
  pretty-printed JSON on stdout (see `src/cli/main.ts` — `writeJsonLine`). The
  plugins spawn `node <repo>/dist/cli/main.js <command>`, capture stdout, and
  parse that JSON document, so the model sees the exact `{ ok, state, code,
  message, data }` contract.
- The CLI auto-starts the local MetaBot daemon when a command needs it, so one
  spawn is a complete unit of work; the plugin set never manages the daemon
  itself (except the explicit `metabot_daemon_start/stop` tools).
- Commands that take a JSON request body (`--request-file` / `--payload-file`)
  are wrapped: the plugin builds the request object from structured tool
  arguments, writes it to a temporary file, runs the CLI, and removes the file.
- Plugins are self-contained CommonJS files using only Node builtins plus the
  host `tools` registry — no harness package imports, so the preset loads from
  any location.

## Install

Prerequisites: a Node.js `>=20 <25` runtime, and a built checkout:

```bash
npm ci
npm run build
node dsh/install.mjs
```

`install.mjs` copies `dsh/preset/` and `dsh/plugins/` into
`${DSH_HOME:-$HOME/.dsh}/.agent-presets/oac/` and bakes the absolute path of
`<repo>/dist/cli/main.js` into the composition. It fails loudly when `dist` is
missing. Re-run it after relocating the repo or rebuilding.

Then start a new DSH session and pick the **Open Agent Connect (MetaBot)**
preset. The `metabot_*` tools appear in that session's tool catalog. (The
preset must be selected per-session; existing sessions keep their own preset.)

Uninstall:

```bash
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/oac"
```

## Tool map

| Plugin file | Tools | Backing CLI |
| --- | --- | --- |
| `oac-identity.js` | `metabot_identity_who`, `_list`, `_create`, `_assign` | `metabot identity …` |
| `oac-bot.js` | `metabot_bot_list`, `_show`, `_create`, `_config_get`, `_config_set`, `_wallet`, `_sessions`, `_runtimes_list`, `_runtimes_discover` | `metabot bot …` |
| `oac-network.js` | `metabot_network_bots`, `_services`, `_sources_list/add/remove` | `metabot network …` |
| `oac-buzz.js` | `metabot_buzz_post` | `metabot buzz post` |
| `oac-chat.js` | `metabot_chat_private`, `_conversations`, `_messages`, `_auto_reply_status/enable/disable` | `metabot chat …` |
| `oac-services.js` | `metabot_services_call`, `_rate`, `_publish`, `_owned_list`, `_owned_orders`, `_owned_revoke`, `_publish_skills`, `_refunds_list`, `_orders_inspect`, `metabot_provider_order_inspect`, `metabot_provider_refund_settle` | `metabot services …`, `metabot provider …` |
| `oac-trace.js` | `metabot_trace_get`, `_sessions` | `metabot trace get/sessions` |
| `oac-wallet.js` | `metabot_wallet_balance`, `_transfer` | `metabot wallet …` |
| `oac-files.js` | `metabot_file_upload`, `_upload_large` | `metabot file upload…` |
| `oac-metaapp.js` | `metabot_metaapp_search`, `_list`, `_view`, `_source`, `_forks`, `_publish`, `_delete` | `metabot metaapp …` |
| `oac-browser.js` | `metabot_browser_open`, `_tab`, `_link`, `metabot_ui_open` | `metabot browser …`, `metabot ui open` |
| `oac-system.js` | `metabot_daemon_start`, `_stop`, `_doctor_run`, `_system_update`, `_config_get`, `_config_set`, `_skills_resolve`, `_host_persona_status/bind/unbind`, `_host_bind_skills` | `metabot daemon/doctor/system/config/skills/host …` |

`_runner.js` is the shared helper (spawn, JSON parsing, request files, tool
registration). All result shapes follow `MetabotCommandResult` from
`src/core/contracts/commandResult.ts`:

- `ok: true, state: "success"` with `data`
- `ok: true, state: "awaiting_confirmation"` with `data`
- `ok: false, state: "waiting"` with `pollAfterMs` — poll with
  `metabot_trace_get`
- `ok: false, state: "manual_action_required"` (may carry `localUiUrl`)
- `ok: false, state: "failed"` with `code`/`message`

## Intentional exclusions

- `metabot trace watch` streams text instead of a JSON result; polling is done
  with `metabot_trace_get` instead.
- Interactive/human flows (`metabot ui`, MetaApp preview, `browser open` with no
  URI) are exposed but designed for a human at the machine; their results carry
  `localUiUrl` links.
- Destructive writes require an explicit confirmation argument (`--confirm`),
  mirroring the CLI's own guards.

## Development

- Plugin files are plain CommonJS: `module.exports = { name, inject: ['tools'],
  apply(ctx, config) }`, registering plain-object tools into `ctx.tools`.
- Tests (Node test runner, no build needed for the unit part):

  ```bash
  node --test dsh/tests/runner.test.mjs
  npm run build && node --test dsh/tests/install.test.mjs
  ```

- Validate that the installed preset actually mounts:

  ```bash
  node dsh/install.mjs
  ```

  then open a DSH session on the preset and confirm the `metabot_*` tool list.
