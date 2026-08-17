# OAC on DSH Plugin — Design (v1)

**Date:** 2026-08-17
**Status:** Settled for v1. Implementation sequencing is `docs/superpowers/plans/2026-08-17-oac-dsh-plugin.md`.
**Branch:** `oac-dsh-adaptation`

This document is the product contract. If the plan and this spec disagree, this spec wins.

---

## Goal

DSH users install one official plugin. After that, their local DSH agent can be a MetaBot with a durable OAC identity, and they can use OAC’s existing capabilities (private chat, MetaApp, skill-services, wallet, and the rest of the CLI surface) from DSH.

v1 is done when all of the following are true:

1. Install is `dsh plugin --profile web add …` (better-sidebar channel).
2. DSH Settings left nav has **four independent sections**, not one “OAC” entry.
3. Each MetaBot is one DSH agent preset. New conversation = pick which Bot to talk to. That Bot’s persona is in the system prompt.
4. Bot create/edit UI is a DSH-styled clone of OAC `/ui/bot`, with LLM choices taken from DSH providers only.
5. Conversations, Services, and Apps settings sections are DSH-styled clones of the matching OAC pages, all driven by MetaBot CLI.
6. `metabot-*` skills are bound into DSH skill roots so the in-conversation agent can call CLI as that Bot (`--from <slug>`).

---

## Settled decisions

These are not open questions.

| Decision | Settlement |
|---|---|
| Install channel | `dsh plugin --profile web add <package>`, same as better-sidebar. Bundle patch auto-mounts. |
| Settings IA | **Four `settings.section` registrations.** Four left-nav rows. Not a single OAC hub that nests the rest. |
| One Bot = one preset | Creating a Bot writes `~/.dsh/.agent-presets/oac-<slug>/`. The Bot *is* the preset. |
| Capability core | MetaBot CLI. Plugin is UI + host bind + preset generation. No reimplementation of chain, identity, chat, MetaApp, or services. |
| Model-facing OAC | Bound `metabot-*` skills + bash CLI. Not a resident catalog of `metabot_*` Cordis tools. |
| LLM on DSH | DSH `ctx.llm` providers/models only. Never Codex / Claude Code / OpenClaw / other OAC host runtimes. |
| UI | React + DSH primitives and tokens. Clone OAC semantics. Do not iframe `/ui/*`. |
| i18n | English + Simplified Chinese, via DSH `ctx.locale`. |
| Plugin shape references | **better-sidebar** and **BotScape only.** |
| Current worktree `dsh/` | **No reference value.** Delete in Round 0. Do not copy plugins, preset YAML, install.mjs, or the `metabot_*` tool wrappers. |
| v1 placement | All four product surfaces live in Settings. Moving them later is out of scope. |
| DSH itself | Do not fork or patch DSH source. |

---

## What this worktree must not be used for

The existing commit on `oac-dsh-adaptation` (`dsh/plugins`, `dsh/preset`, `dsh/install.mjs`) treats **all of OAC as one agent preset** and wraps every CLI verb as a Cordis tool.

That grain is wrong:

- A DSH agent preset is one agent identity (persona, tools, prompt). That maps to **one MetaBot**, not to the OAC product.
- A single “Open Agent Connect” preset never gives “talk to Alice vs talk to Bob”.
- Skills already are the CLI bridge. Re-wrapping CLI as tools is duplicate surface.

**Do not read those files for implementation ideas.** Plugin packaging, host/client split, settings sections, and install: copy **better-sidebar**. One-bot-one-preset, persona rewrite, settings Bot page, preset chip: copy **BotScape**. Product flows and CLI contracts: copy **OAC `/ui/*` and `metabot` CLI**.

---

## Settings left nav: four sections

After the plugin mounts, DSH Settings left nav gains **four sibling rows**. Each row is its own `settings.section` (`ctx.slots.inject('settings.section', …)`), with its own `id`, `order`, and `label`.

Forbidden:

- One left-nav item named “OAC” / “Open Agent Connect” / “MetaBot” that opens a sub-hub.
- Tabs inside a single OAC settings page that stand in for these four products.
- Hiding Conversations / Services / Apps behind the Bots editor.

Required:

| Left-nav label (en) | Left-nav label (zh) | Section id | OAC pages cloned | CLI |
|---|---|---|---|---|
| Bots | Bots | `oac-bots` | `/ui/bot` | `metabot bot …`, `identity …`, `wallet …`, DSH LLM fields |
| Conversations | 对话 | `oac-conversations` | `/ui/conversations` | `metabot chat …` |
| Services | 服务 | `oac-services` | `/ui/services`, `/ui/my-services`, `/ui/publish` | `metabot services …`, `provider …` |
| Apps | 应用 | `oac-apps` | `/ui/apps`, `/ui/metaapps` | `metabot metaapp …` |

Suggested `order` band: `20`, `21`, `22`, `23` (same region as BotScape’s Bots section at `20`). Exact numbers may shift to sit next to each other without colliding with DSH stock sections; the four must remain consecutive siblings.

Wallet, Buzz, and Agent Internet Browser do **not** get their own left-nav rows in v1. They remain reachable from Bots / skills / existing CLI.

The four sections are the v1 product. Shipping only `oac-bots` is not v1 done.

---

## User journeys

### Install

```bash
dsh plugin --profile web add open-agent-connect-dsh
```

(Package name may be confirmed at publish time; Cordis plugin name is `oac-dsh`.)

On host `apply`:

1. Resolve the `metabot` CLI (dependency on `open-agent-connect`, override `OAC_METABOT_CLI_PATH`).
2. Ensure the MetaBot daemon is up.
3. Bind `metabot-*` skills into DSH skill roots (`metabot host bind-skills --host dsh`).
4. Reconcile local Bots ↔ `oac-<slug>` presets.

Failure is loud in the Bots section (CLI missing, Node range, bind failed). It must not crash the DSH process.

### Manage Bots (Settings → Bots)

- List every local MetaBot (`metabot bot list`).
- **New:** modal with name + primary DSH LLM (required) + optional fallback DSH LLM. Then `metabot identity create` / `bot create --host dsh` plus stored DSH LLM fields. Then generate the Bot’s agent preset.
- **Edit:** four in-page tabs, same semantics as OAC `/ui/bot`:
  1. **Basic** — avatar, name, DSH primary/fallback LLM, public bio, GlobalMetaID / homepage copy.
  2. **Behavior** — Role / Soul / Goal, OAC persona-preset catalog.
  3. **Chat Settings** — chat-skill allowlist.
  4. **Advanced** — chain/wallet summary, backup, delete (`--confirm`). No OAC “local LLM runtimes / refresh host binaries” block.
- Save per tab through CLI. Name / persona / LLM changes regenerate that Bot’s preset persona text.

### Talk as a Bot

1. User starts a new DSH conversation.
2. User picks a Bot in the existing agent-preset chip (plugin shows Bot name/avatar for `oac-*` presets; other presets stay visible).
3. DSH mounts that preset. The `persona` row is the Bot identity. The model must know its `--from` slug.
4. If the Bot has a stored DSH provider/model still advertised, default `session.selectModel` to it. The composer picker stays unlocked.
5. In the conversation the model uses bound `metabot-*` skills and runs `metabot … --from <slug>`.

Do not insert a Bot scope between the agent and its preset. Do not swap the preset of a session that already has history.

### Conversations / Services / Apps

Each is a first-class Settings section. Clone OAC page behavior and confirmation gates (`--confirm`, paid-call confirmation). Restyle with DSH chrome. v1 may be visually simpler than OAC; it may not drop semantics.

---

## Architecture

```
dsh plugin add
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  One DSH profile-bundle plugin (host + client)          │
│                                                         │
│  Host                                                   │
│   • metabot CLI bridge → MetabotCommandResult           │
│   • skill bind --host dsh                               │
│   • generate / remove oac-<slug> agent presets          │
│   • expose DSH llm directory to the create/edit UI      │
│                                                         │
│  Client                                                 │
│   • four settings.section rows (bots, conversations,    │
│     services, apps)                                     │
│   • preset chip: Bot name / avatar                      │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               ▼                          ▼
     ~/.metabot (v2)            ~/.dsh/.agent-presets/oac-<slug>/
     identity, keys,            agent.cordis.yml (persona)
     chat, services             preset.yml (display name)
               │
               ▼
     ~/.dsh/skills/metabot-*    (bind from ~/.metabot/skills)
```

### Host / client

The browser does not spawn CLI. Host is the only process that talks to `metabot`.

- Host: Cordis plugin. `inject` includes `agentPresets` and `llm`, plus the webserver/trust seam used for plugin routes. HTTP routes under `/oac/api/*` (better-sidebar pattern), same trust fence as other plugin routes. Each route runs one CLI command and returns the JSON envelope.
- Client: `dsh.client` bundle. Four `settings.section` registrations. Locale dictionaries. Shadows `conversation.hero.agentPreset` at `priority: -1` (BotScape). Does **not** shadow Settings → Agent presets (same-id shadow would duplicate that nav row).

Typert Remote (BotScape) is an acceptable alternative to HTTP routes if it proves smaller. v1 default is HTTP routes.

### One Bot = one preset

Preset id: `oac-<slug>` (`[a-z0-9][a-z0-9-]*`).

On create:

1. `ctx.agentPresets.copy('standard', presetId, botName)` into the user preset root.
2. Rewrite the `persona` row `config.text` from the Bot profile (name, slug, globalMetaId, role, soul, goal, bio, mvc address). Collapse `{{` / `}}` so DSH interpolation cannot throw.
3. Write `preset.yml` name/description to the Bot.

On persona/name save: regenerate that file in place. Running sessions keep DSH’s composition stamp; later sessions see the new text.

On delete (`--confirm`): `ctx.agentPresets.remove(presetId)`.

On host apply: reconcile `metabot bot list` ↔ presets (create missing, do not delete DSH presets the CLI does not know unless they were generated by this plugin).

### Skills

`dsh` is a **skill-bind host only** in `platformRegistry`. Skill roots:

- `~/.dsh/skills` (`DSH_HOME`)
- project `.dsh/skills` (`autoBind: 'manual'`)
- optionally `~/.agents/skills` if we bind the second user root DSH already scans

No `runtime` / `executor` for `dsh`. DSH is not a binary OAC spawns.

### DSH LLM fields

OAC `primaryProvider` today is an OAC host runtime id. That stays for Codex and friends.

For DSH, persist on the Bot profile (CLI-visible):

- `dshLlmProvider` / `dshLlmModel`
- `dshLlmFallbackProvider` / `dshLlmFallbackModel`

`metabot bot create` / `bot update` / `bot show` carry them. The DSH Bots UI lists only `ctx.llm.listProviders()` + `listModels`. Non-DSH OAC UI keeps the host-runtime picker and ignores these fields.

---

## Plugin package

Do not fold this into the root `open-agent-connect` package.json (CJS CLI vs ESM dual-face DSH plugin).

Replace current `dsh/` with `dsh-plugin/`:

```
dsh-plugin/
  package.json              # open-agent-connect-dsh; dsh.bundle.patch; dsh.client
  cordis.patch.yml
  src/index.ts              # host
  src/cli-bridge.ts
  src/preset.ts
  src/persona.ts
  src/client/index.ts       # four section registrations + preset chip
  src/client/BotPanel.tsx
  src/client/BotEditor.tsx
  src/client/CreateBotForm.tsx
  src/client/ConversationsPanel.tsx
  src/client/ServicesPanel.tsx
  src/client/AppsPanel.tsx
  src/client/BotPresetSeat.tsx
  src/client/locale.ts
  tests/
  scripts/install.sh
```

`cordis.patch.yml` inserts one host row. The client half is declared through `dsh.client`, not a second patch row, matching better-sidebar.

Peer dependency pins follow better-sidebar / BotScape (`@deepseek-ai/*` `0.1.0-rc.6`, `@deepseek-ai/cordis` `4.0.1` at time of writing). A pin bump is a whole-plugin action.

---

## v1 done / not done

**Done**

- Four Settings left-nav sections working against CLI.
- Bots: list, create (name + DSH LLM), four-tab edit, delete, preset generation.
- New DSH conversation can select a Bot and speak as that identity.
- Skills bound; in-conversation CLI works with `--from`.
- Conversations / Services / Apps sections usable for the same jobs as the OAC pages.
- Install via `dsh plugin add`.
- en + zh-CN.

**Not v1**

- One OAC settings entry.
- Cordis tools wrapping every `metabot` subcommand.
- Iframing OAC HTML.
- DSH as an OAC LLM executor.
- Moving the four sections out of Settings.
- A second monorepo (BotScape-style). The plugin lives in this repo.
- Extra left-nav rows for wallet / buzz / browser.
- Forking DSH.

---

## References (use these)

Plugin packaging, install, host/client, settings section, trust fence:

- `/Users/tusm/Documents/MetaID_Projects/DSH-better-sidebar` (`scripts/install.sh`, `cordis.patch.yml`, `dsh.plugin.json`, `src/index.ts`, `src/client/index.tsx`)

One Bot = one preset, Bot settings page, persona rewrite, preset chip:

- `/Users/tusm/Documents/MetaID_Projects/BotScape/packages/plugin-metabot/` (`src/preset.ts`, `src/persona.ts`, `src/index.ts`, `src/client/BotPanel.tsx`, `src/client/index.ts`)
- `/Users/tusm/Documents/MetaID_Projects/BotScape/AGENTS.md` (no extra Bot scope)

Product flows and CLI:

- OAC `src/ui/pages/bot/`, `conversations/`, `services/`, `my-services/`, `apps/`, `metaapps/`
- OAC `src/core/contracts/commandResult.ts`
- OAC `src/cli/commands/bot.ts` and sibling command modules

DSH seams:

- `packages/preset/agent-presets/README.md`
- `packages/preset/persona/README.md`
- `packages/client/ui-settings/src/client/contract/slots.ts`
- `packages/skill/skill-filesystem/README.md`

## References (do not use)

- This worktree’s `dsh/plugins/`, `dsh/preset/`, `dsh/install.mjs`, `dsh/tests/` as they existed before Round 0
- Treating OAC as a single DSH agent preset
