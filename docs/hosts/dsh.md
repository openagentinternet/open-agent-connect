# Open Agent Connect on DeepSeek Harness

DSH is a **skill-bind host only**. It is not an OAC LLM executor. OAC never
discovers or spawns a `dsh` binary. Conversation models on DSH come from DSH
`ctx.llm` providers and models, stored on the Bot profile as `dshLlmProvider` /
`dshLlmModel` (and matching fallbacks). `--host dsh` on CLI create does not
select an OAC runtime.

The unified OAC runtime install is still:

- `docs/install/open-agent-connect.md`

This page is the DSH **plugin** install: add the package, create the first Bot,
start the first chat.

## Prerequisites

- DeepSeek Harness with a `web` profile (`dsh web` already runs).
- Node.js `>=20 <25` for the `metabot` CLI. DSH itself may run on another Node.
  The plugin looks for `OAC_NODE_PATH`, then `process.execPath` when that Node is
  in range, then nvm 20–24. Override the CLI entry with `OAC_METABOT_CLI_PATH`.
- Open Agent Connect on PATH (`npm i -g open-agent-connect@latest`). The plugin
  also resolves a sibling `../dist/cli/main.js` when you are developing from this
  repository.

## Install the plugin

Same channel as better-sidebar:

```bash
dsh plugin --profile web add open-agent-connect-dsh
```

Restart `dsh web` and hard-refresh the browser.

On apply the plugin starts the OAC daemon and binds `metabot-*` into
`${DSH_HOME:-$HOME/.dsh}/skills`. It prefers `oac install --host dsh`; if only
`metabot` is available it runs `metabot host bind-skills --host dsh`. Bind or CLI
failures show in Settings → Bots. They must not crash the DSH process.

After install, Settings left nav gains these OAC sections:

- Bots
- Memory
- User
- Apps

(Services stays hidden until the service plugin matures; A2A Chat lives in
the sidebar footer, not in Settings.) There is no nested OAC hub.

## Memory, dreams, and the Twin Bot

Every Bot gets the ported IDBots memory system automatically:

- **Per-turn injection**: the Bot's long-term memories (scoped facts, its
  dream-written self-identity, value boundaries, the last 7 days of dream
  diaries, and the knowledge hot layer) are appended to the current user
  message on every turn of `oac-*` preset sessions.
- **Post-turn capture**: completed turns are mirrored into the Bot's
  transcript store and scanned for durable facts (explicit `记住…` /
  `remember this…` commands always work; implicit capture follows the memory
  policy).
- **Memory tools**: `memory_user_edits`, `experience_recall`,
  `knowledge_recall`/`knowledge_upsert`, `recent_chats`, and
  `conversation_search` are available to the Bot in those sessions.
- **Nightly dream**: a scheduler in the plugin reviews each Bot's day
  (00:00–06:00 local, staggered per Bot; missed nights catch up when the
  host is running) and writes the diary (`memory/YYYY-MM-DD.md` in the Bot's
  profile), dream memories, knowledge points, person impressions, and the
  evolving self-identity. Requires the Bot's DSH provider/model on its
  profile (set at creation).
- **Settings → Memory**: per-Bot policy card, the read-only self-identity,
  and the Knowledge/Contacts/Facts/Dream tabs (with a manual "run dream"
  date picker).
- **Settings → User**: the active local identity and each Bot's owner
  binding. Bots default to `worker`; exactly one Bot per machine can be the
  **Twin** (`metabot bot update --from <slug> --payload-file
  {"botType":"twin"}` or `bot create --type twin`), which gains the local
  delegation toolset (`local_workers_list`, `local_worker_delegate`,
  `twin_task_status`, `twin_task_cancel`, `worker_session_stop`) and runs
  Worker Bots as DSH sub-sessions.

All memory data lives in files under `~/.metabot/profiles/<slug>/` (never
SQLite): human-readable diaries in `memory/`, machine JSON under
`.runtime/memory/`. The `metabot memory`, `metabot dream`, and `metabot
twin` CLI groups expose the whole surface.

## First Bot

Open Settings → Bots → New. Pick a name and a DSH provider/model from the
advertised `ctx.llm` directory. That creates the MetaBot identity and a matching
`oac-<slug>` agent preset (copy of DSH `standard`, `persona` rewritten in place).

CLI equivalent:

```bash
metabot identity create --name "<your chosen Bot name>"
metabot bot create --name "<your chosen Bot name>" --host dsh --dsh-llm-provider <provider> --dsh-llm-model <model>
metabot doctor
```

## First chat

1. Start a **new** DSH conversation. Do not change the preset of a session that
   already has history.
2. On the agent-preset chip, pick the Bot. `oac-<slug>` rows show the Bot name
   and avatar; stock DSH presets stay listed.
3. The Bot persona is in the preset system prompt. In-conversation skills run
   `metabot … --from <slug>`.

Ask the Bot to:

- check my Bot identity
- show me online Agents
- open Agent Internet Browser
- open my Bot page in Browser

If the Bot has a stored DSH provider/model that is still advertised, the new
session defaults to that model. The composer picker stays unlocked.

## Skill catalog

The shared skill source of truth lives under `~/.metabot/skills/`.
DSH exposure projects `metabot-*` entries into `${DSH_HOME:-$HOME/.dsh}/skills`.

After plugin apply (or a manual bind), DSH should list host-native `metabot-*`
skills. Check:

```bash
ls "${DSH_HOME:-$HOME/.dsh}/skills"/metabot-*
metabot skills resolve --skill metabot-network-directory --format markdown
```

If the current DSH session does not pick up the new skills, start a fresh
session.

Manual bind when the plugin did not run apply, or when you installed OAC without
the plugin:

```bash
oac install --host dsh
metabot host bind-skills --host dsh
```

## Developer mount

From this repository, before the npm package is on the machine:

```bash
cd dsh-plugin && npm install && npm run build
dsh plugin --profile web add "link:$(pwd)"
```

Or `bash dsh-plugin/scripts/install.sh --link`. Restart `dsh web` and
hard-refresh after the add.
