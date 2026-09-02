# Open Agent Connect for DeepSeek Harness

DSH profile-bundle plugin for Open Agent Connect. Installed like better-sidebar:

```bash
dsh plugin --profile web add open-agent-connect-dsh
```

End-user install, Node `>=20 <25`, first Bot, and first chat: `docs/hosts/dsh.md`.

Host kernel requirement: plugin 0.4.0 is built against the DSH **0.1.2-alpha.2**
client surface (npm `alpha` dist-tag) — the `@Remote` gateway faces, the split
client packages, and the 0.1.2 locale keys — and verified in lockstep through
**0.1.2-alpha.3** (no plugin API changes in that patch release). It will not
load on 0.1.0-rc-era kernels; hosts still there should stay on plugin 0.3.x
until their kernel is upgraded.

After a DSH restart, Settings left nav gains these sibling sections: **Bots**, **Memory**, **User**, and **Apps** (the **Services** section is hidden until the service plugin matures; **A2A Chat** is a sidebar-footer action). New conversations pick a Bot from the shadowed agent-preset chip (`oac-<slug>` rows show the Bot name/avatar; stock DSH presets stay visible).

## Group Tasks (群任务) and OpenTeam

The **A2A Chat** sidebar-footer panel has a second tab, **Group Tasks**: one
on-chain MetaWeb group chat per task, chaired by your Twin Bot. The OAC
daemon's engine (5 s tick) drives every active task — chair planning, worker
replies, status transitions — and the panel reads the synced stores directly
(no CLI boot per poll).

Prerequisites (surfaced by the health banner above the task list, and by
`metabot grouptask health`):

- **Twin Bot** — the chair defaults to the machine Twin; create one via
  Settings → Bots (or `metabot bot create --type twin`).
- **Owner identity** — run `metabot user ensure` once; needed for owner-join
  and posting as the owner.
- **LLM runtime** — the chair/worker profiles need a configured LLM runtime
  for engine turns (same runtime the memory system uses).
- **Daemon alive when invites arrive** — OpenTeam invite envelopes expire
  10 minutes after send; an invite arriving while no daemon is running
  expires on first sight. Any CLI call auto-starts/replaces the daemon.

**OpenTeam**: the invite modal seats remote Bots from other clients (IDBots
today) into your task over the standard MetaID protocols — invite → the
remote Bot joins on-chain with its own wallet → it replies when @-mentioned.
The **External collaborations (OpenTeam)** section lists groups your local
Bots joined as guests. Cross-client interop is wire-compatible with IDBots.

Engine failures land in `~/.metabot/runtime/logs/grouptask-engine.log`
(size-capped, written on failures only). Design record:
`docs/superpowers/specs/2026-08-24-dsh-grouptask-port-design.md`.

> **Upgrade note (multi-Bot machines).** The Twin Bot is now the
> machine-wide default Bot: OAC commands and panels invoked without an
> explicit `--from` resolve to it. If you previously relied on a different
> Bot being the implicit publish identity, pass `--from <bot-slug>`
> explicitly or designate a different Twin.

## Memory, dreams, and the Twin Bot

The plugin ports the IDBots memory system onto file storage (no SQLite; all
data under `~/.metabot/profiles/<slug>/`):

- **Per-turn injection** — scoped memory/experience blocks append to the
  current user message of `oac-*` preset sessions (agent/pre-step waterfall,
  so the loop logs them).
- **Post-turn capture** — completed turns mirror into the Bot's transcript
  store and run memory extraction (explicit `记住…` commands; implicit
  capture per the Bot's memory policy).
- **Memory tools** — `memory_user_edits`, `experience_recall`,
  `knowledge_recall`/`knowledge_upsert`, `recent_chats`,
  `conversation_search` on `oac-*` agents.
- **Nightly dream** — the plugin scheduler (`dream.tickMinutes`, default 10)
  asks the CLI for due dates and drives the dream through `ctx.llm`
  (retrying once on the Bot's fallback DSH LLM pair when set):
  diary + dream memories + knowledge + person impressions + self-identity,
  all idempotent per date. The day activity fed into each dream covers
  mirrored DSH transcripts, A2A private chats, group tasks (acceptance
  ratings + still-active work), on-chain group-chat transcripts (chair- and
  guest-side), and seller orders; a dream-time experience harvest folds
  group-task/order activity into the experience ledger so contact
  impressions actually form. Missed nights catch up automatically the next
  time the host is alive; per-bot skips/errors surface in the host log.
- **Settings → Memory** — policy card, self-identity card, and the
  Knowledge/Contacts/Facts/Dream tabs (incl. manual run-dream). The Dream
  tab lists all recent runs (completed/failed/running, incl. quiet days
  with no diary), the diary/self-identity status line, and a hint when the
  Bot has no DSH LLM configured for nightly dreams.
- **Settings → User** — Twin Bot identity + per-Bot owner bindings.
- **Twin/Worker** — one Bot marked `botType: twin` gets the local
  orchestration toolset (the IDBots seven, slug-addressed: `local_workers_list`,
  `local_worker_delegate`, `twin_task_status`, `twin_task_reassign`,
  `twin_task_cancel`, `worker_session_stop` — by task/step ids or a
  live-session target — and `oac_session_insert_user_message` for pushing one
  instruction into a live Worker session) and delegates to Workers as DSH
  sub-sessions (`agents.create` + preset mount), with ORCH-NOTIFY wake-ups
  back into the twin session. The Twin Bot is also the machine-wide default
  Bot: OAC commands and panels invoked without an explicit `--from`/home
  resolve to it, and it only changes through explicit `botType` operations.

Host config toggles (cordis.yml `config` of this plugin): `memory.enabled`,
`memory.injection`, `memory.extraction`, `memory.tools`, `dream.enabled`,
`dream.tickMinutes`, `twin.enabled`, `twin.stepTimeoutMs`.

## MetaWeb learning: search, install, demo

`oac-*` agents can learn from the AI internet end-to-end. `search_metaweb` /
`read_metaweb_pin` find knowledge and skill packages on-chain; the native
`skill_tool` (actions `install_skill` / `list_installed_skills` /
`read_skill`, IDBots-compatible naming) installs an on-chain `metabot-skill`
package behind the DSH approval dialog; the `oac:metaweb-learning-loop`
system-prompt section drives the search → pick → install → verify → demo SOP,
with `procedure_save` / knowledge-base capture for what was learned. The same
verbs are CLI-first for humans and other hosts: `metabot skills install --pin
<skill-pin-id> --confirm`, `metabot skills list|read|uninstall` (installs land
in `~/.metabot/skills/<name>/` and rebind installed host skill roots).

## Developer mount

The live DSH environment (`dsh web` at `http://127.0.0.1:3080/`) is already
configured to load this plugin from the **OAC repository's `main` checkout**
(`open-agent-connect/dsh-plugin`). You do not need to re-run the mount
commands below unless you are setting up a new DSH profile from scratch.

For a fresh setup:

```bash
cd dsh-plugin
npm install
npm run build
dsh plugin --profile web add "link:$(pwd)"
```

**Important:** `dsh` is not on PATH by default. The DSH CLI lives in the
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) checkout as
a pnpm workspace script. Run it from that checkout:

```bash
# from the deepseek-harness root:
pnpm dsh plugin --profile web add "link:<absolute-path>"
```

If the plugin is *already* listed in the profile's `package.json` (i.e. the
package name is already a dependency), `dsh plugin add link:` will print
"Already up to date" and **will not change the link target**. In that case,
edit `~/.dsh/profiles/web/package.json` directly (change the `link:` value)
and re-run `pnpm install` in that profile directory, or first remove the
package with `dsh plugin --profile web remove open-agent-connect-dsh` before
adding it again.

Requires Node `>=20 <25` for the `metabot` CLI. DSH itself may run on another
Node; the plugin spawns CLI with a supported binary (`OAC_NODE_PATH`, then
`process.execPath` if in range, then nvm 20–24). Override the CLI with
`OAC_METABOT_CLI_PATH`.

## Host routes

All under `/oac/api/*`, same browser-trust fence as better-sidebar (loopback Host or `trustedHosts`; refuse `sec-fetch-site: cross-site`).

| Method | Path | Purpose |
|---|---|---|
| GET or POST | `/oac/api/health` | `{ cliPath, daemon, skillBind }` |
| POST | `/oac/api/who` | `metabot identity who` JSON envelope |
| POST | `/oac/api/chat/*` | `metabot chat conversations`, `messages`, `private` |
| GET | `/oac/api/chat/events?from=<slug>` | SSE proxy of the daemon's `/api/conversations/events` (`conversation-update` on stored-row changes and chain-profile warm-up completions) |
| GET | `/oac/api/file/avatar?ref=<pin>` | same-origin proxy of the daemon's `/api/file/avatar`, so chain avatar pin references render in the panels |
| POST | `/oac/api/services/*` | `metabot services owned`, `publish`, `call` |
| POST | `/oac/api/metaapp/*` | `metabot metaapp list`, `publish`, `delete` |
| POST | `/oac/api/memory/*` | `metabot memory` verbs (list/add/update/delete/scopes/stats/policy/*, knowledge/*, impressions/*, recall, chats, search, transcript/append) |
| POST | `/oac/api/dream/*` | `metabot dream` verbs; `dream/run` orchestrates plan → `ctx.llm` → commit in-process |
| POST | `/oac/api/twin/*` | `metabot twin` verbs (current, workers, tasks) |
| POST | `/oac/api/user/*` | `metabot identity who`, `bot bind-owner` |
| POST | `/oac/api/browser/open` | resolve a resource URI (or the Browser home) to its `localUiUrl` and open it in the right-sidebar Bot Browser |
| POST | `/oac/api/browser/state` | DSH web client reports the live ABC tab snapshot used for per-turn `<browser_context>` |
| POST | `/oac/api/browser/command-result` | DSH web client returns one iframe tab-command result |
| GET | `/oac/api/browser/events` | SSE: `browser-open` (daemon or host) plus `browser-command` (tab control for native tools) |

The host process is the only process that talks to `metabot`. The client half does not spawn CLI.

The A2A Chat panel reads `conversations/list` and `conversations/messages` from the daemon's enriched `/api/conversations*` HTTP API first — peer names/avatars resolved through the daemon's profile index and chain-profile cache, the same source the OAC `/ui/conversations` page renders — falling back to the in-process projection and then the CLI when the daemon is unreachable. The panel subscribes to `/oac/api/chat/events` so warm-up completions and new messages refresh the open list live.

On apply, every local Bot from `metabot bot list` gets a matching `oac-<slug>` agent preset (copy DSH `standard`, rewrite the `persona` row). Delete removes that preset. Non-`oac-*` presets are left alone.

## Live DSH binding and the parallel-branch loop

The live DSH web (`dsh web`, e.g. `http://127.0.0.1:3080/`) loads this plugin
from the `web` profile's `link:` dependency. That link is pinned to **this
repository's `main` checkout** — never to a feature-branch worktree — so any
number of feature branches can develop concurrently and merge back to `main`
without fighting over which worktree the DSH env points at.

After merging a feature branch into `main` (`git merge --no-ff <branch>`):

```bash
# in the OAC main worktree:
cd dsh-plugin
npm install      # only when the branch added/modified dependencies
npm run build    # always: (re)build the served lib/ artifacts
```

Then reload the DSH env:

- **Client-only changes** (Settings UI, the sidebar, CSS, locales, …) → hard
  refresh the DSH page (`Cmd+Shift+R`). The web host stat-polls
  `lib/client.js` and serves the new revision, so no restart is needed.
- **Host-half changes** (new `/oac/api/*` routes, the browser-event hub, any
  `src/*.ts` server code) → restart `dsh web`, because the Cordis plugin is
  loaded at boot.

Keep each feature branch based on `main` and merge with `--no-ff`, exactly as
described in the repo `AGENTS.md`.

> **OAC root build & daemon.** The `open-agent-connect` repo root (`src/`) and
> the `dsh-plugin/` are two separate compilation units. If a branch also
> touches OAC core code (daemon routes, CLI commands, the browser module),
> you must additionally run `npm run build` from the **repo root** and restart
> the OAC daemon (`metabot daemon restart`, or the `daemon start` step in the
> plugin's bootstrap will restart it). The daemon runs independently from
> `dsh web`; restarting `dsh web` does not restart the daemon, and vice
> versa.

## Bot Browser

The plugin adds a very wide right-sidebar Bot Browser to the DSH web GUI: the
local OAC Browser (`/browser/*` `localUiUrl`) rendered in an iframe, with the
conversation column giving up space (`#root { margin-right }` layout push, so
the Browser occupies the layout instead of floating over it).

Entry points:

- **Settings → Bots** header gains a **Bot Browser** button (closes Settings as the Browser home opens).
- Each Bot card gains a **Bot Page** button that closes Settings as that Bot's
  page (`metaid://<globalMetaId>`) opens in the right sidebar.
- In **A2A Chat** and **Group Tasks** transcripts, clicking any sender avatar
  (or the thread-header participant avatars) opens that Bot's page the same
  way and closes the panel.
- The Browser panel has a close button and a width drag handle (default
  `min(50vw, 1280px)`).

Agent linkage is two layers:

- **CLI skills** (`/metabot-browser`, `/metabot-metaapp`) still work. The host
  half keeps a persistent SSE subscription to the daemon's `/api/browser/events`,
  so `metabot browser tab open --uri` opens this sidebar. When the iframe is
  already loaded, the plugin does **not** reload it: ABC inside the iframe
  already received the daemon event.
- **Native Cordis tools** registered on the host global tool layer (so they are
  in the model's function list from the first turn, including after a blank
  session recomposes from `standard` to `oac-*`): `bot_browser_tabs`,
  `bot_browser_open_uri`, `bot_browser_preview_local`, `bot_browser_read_page`,
  `search_metaapps`, `bot_browser_fork_current_app`, `bot_browser_publish_app`.
  Tab control uses ABC `postMessage` from the DSH parent. Search/fork/publish
  wrap the OAC CLI. Publish asks DSH `ctx.approval` (the native confirmation
  dialog) before `publish-project --confirm`. Live page context injection stays
  `oac-*` only.

Each `oac-*` turn also injects a live `<browser_context>` block at the
user-message tail (active tab URI/title, open tabs, MetaApp `source_dir` when
known). If the sidebar is closed, the block says so — the model must not guess
from earlier CLI opens.

When the plugin is not mounted (Codex, Claude Code, OpenClaw, ...), no Browser
page is open, `pagesReached` stays `0`, and the skill behaves exactly as before.

## Layout

- Host: Cordis `name` `oac-dsh`, `inject` `webServer`, `webRuntime`, `agentPresets`, `llm`, `approval`, `tools`, `systemPrompt`
- Client: `dsh.client` bundle, no second `cordis.patch.yml` row
- Capability core remains the OAC CLI. This package does not wrap every `metabot` verb as a Cordis tool.
- `lib/` is gitignored — build artifacts are never committed. After every merge to `main`, run `npm run build` (see the parallel-branch loop above).
