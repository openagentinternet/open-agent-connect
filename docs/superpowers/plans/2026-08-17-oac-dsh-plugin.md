# OAC on DSH Plugin — Implementation Plan

> **For agentic workers:** implement this plan round-by-round. Product contract: `docs/superpowers/specs/2026-08-17-oac-dsh-plugin-design.md`. If this plan and the spec disagree, the spec wins. Do not revive or copy the discarded `dsh/` wrapper; it has no reference value.

**Goal:** Implement the settled v1 in the spec: a DSH profile-bundle plugin, four Settings left-nav sections, one MetaBot = one agent preset, CLI-backed UI, DSH-only LLM picker, bound `metabot-*` skills.

**Date:** 2026-08-17
**Branch / worktree:** `oac-dsh-adaptation` at `/Users/tusm/Documents/MetaID_Projects/oac-dsh-adaptation`

**Plugin-shape references (only):** `DSH-better-sidebar` and `BotScape`. OAC `/ui/*` and `metabot` CLI are the product-flow references. The current worktree `dsh/plugins`, `dsh/preset`, and `dsh/install.mjs` are not references.

---

## What was wrong before

The current commit on this branch treats **all of OAC as one DSH agent preset**: a folder of Cordis plugins that wrap every `metabot` subcommand as `metabot_*` tools, copied into `~/.dsh/.agent-presets/oac/`.

That is the wrong grain.

- A DSH **agent preset** is one agent identity: persona text, tool roster, prompt sections. That maps to **one MetaBot**, not to the OAC product.
- A single OAC preset never gives “talk to Alice vs talk to Bob”.
- Wrapping every CLI verb as a Cordis tool duplicates the skill pack we already ship.

**Round 0 deletes that tree.** Do not port code, YAML, or tests out of it.

---

## Product shape (v1)

Install (same channel as `dsh-better-sidebar`):

```bash
dsh plugin --profile web add <dsh-plugin-package>
```

After a DSH restart, Settings left nav has **four independent columns/rows** (four `settings.section` registrations). This is not one “OAC” entry with inner tabs.

1. **Bots** (`oac-bots`)
2. **Conversations** (`oac-conversations`)
3. **Services** (`oac-services`)
4. **Apps** (`oac-apps`)

Plus:

- **One MetaBot = one DSH agent preset.** New conversation: pick which Bot to talk to. Persona goes into the system prompt.
- **In conversation** the model uses bound `metabot-*` skills and `metabot … --from <slug>`. No resident `metabot_*` tool catalog.
- **Create Bot:** name + DSH LLM (`ctx.llm` only). **Edit Bot:** OAC’s four tabs, CLI-backed.

| Left-nav section | OAC pages | CLI surface |
|---|---|---|
| Bots | `/ui/bot` | `metabot bot …`, `identity …`, `wallet …`, DSH LLM fields |
| Conversations | `/ui/conversations` | `metabot chat …` |
| Services | `/ui/services`, `/ui/my-services`, `/ui/publish` | `metabot services …`, `provider …` |
| Apps | `/ui/apps`, `/ui/metaapps` | `metabot metaapp …` |

Shipping only Bots is not v1. Wallet, buzz, and the Agent Internet Browser stay inside those four sections / skills; they do not get a fifth nav row.

---

## Non-negotiable principles

1. **CLI is the capability core.** The DSH plugin does not reimplement identity, chain sync, chat, MetaApp, or skill-service logic. Host code runs `metabot` (or the same handlers the CLI already uses) and parses `MetabotCommandResult`.
2. **UI is a thin bridge**, same as OAC `/ui/*` and `metabot-*` skills. Clone OAC flows, semantics, and boundaries. Restyle with DSH primitives (`Button`, `Input`, `Modal`, design tokens). Do not iframe `/ui/bot`.
3. **Skills stay thin CLI bridges.** Adding DSH as a bind target in `platformRegistry` is a small OAC change. Do not rewrite skill bodies for DSH except `--from` / host wording where the current text assumes Codex.
4. **Do not insert a Bot scope between an agent and its preset.** DSH `agentPresets.composedPreset()` reads the agent’s direct parent (BotScape hard rule). The Bot *is* the preset.
5. **Never swap the preset of a session that has history.** Persona edits regenerate the preset file for *later* sessions. Running sessions keep the composition stamp they started with (DSH already does this).
6. **English + Simplified Chinese** for all new UI copy, through DSH `ctx.locale`.
7. **Do not fork DSH.** Composition via `dsh.bundle.patch` only.

---

## Architecture

```
dsh plugin add
        │
        ▼
┌───────────────────────────────────────────────┐
│  DSH profile bundle (host + client plugin)    │
│                                               │
│  Host                                         │
│   • resolve `metabot` CLI                     │
│   • ensure daemon                             │
│   • bind skills → ~/.dsh/skills               │
│   • CLI bridge (spawn → MetabotCommandResult) │
│   • generate/remove per-bot agent presets     │
│   • list DSH llm providers for the create UI  │
│                                               │
│  Client                                       │
│   • four settings.section rows (not one OAC)  │
│   • preset chip: Bot name/avatar              │
└─────────────┬─────────────────┬───────────────┘
              │                 │
              ▼                 ▼
     ~/.metabot (v2)     ~/.dsh/.agent-presets/oac-<slug>/
     identity, keys,     agent.cordis.yml (persona row)
     chat, services      preset.yml (display name)
              │
              ▼
     ~/.dsh/skills/metabot-*   (symlinks from ~/.metabot/skills)
```

### Host / client split

The browser cannot spawn CLI. The host half is the only process that talks to `metabot`.

- **Host:** Cordis plugin, `inject` includes `agentPresets`, `llm`, and a web/remote seam. Registers HTTP routes under a plugin prefix (better-sidebar pattern) *or* a Typert Remote namespace (BotScape pattern). v1 recommendation: **plugin HTTP routes** on the DSH webserver (`/oac/api/*`), same trust fence as other plugin routes. Each route runs one CLI command and returns the JSON envelope.
- **Client:** dual-face `dsh.client` bundle. Registers **four** `settings.section` entries (`oac-bots`, `oac-conversations`, `oac-services`, `oac-apps`). Talks only to host routes. Registers locale dictionaries. Shadows `conversation.hero.agentPreset` with Bot name/avatar the way BotScape does, without replacing the Agent-presets settings page.

### One Bot = one preset

On successful `metabot bot create` / identity bootstrap:

1. Copy DSH’s shipped `standard` preset into `~/.dsh/.agent-presets/oac-<slug>/` via `ctx.agentPresets.copy('standard', presetId, botName)` (BotScape `generatePreset`).
2. Rewrite the `persona` row `config.text` from the Bot profile (name, globalMetaId, role, soul, goal, bio, mvc address). Neutralize `{{` / `}}` so DSH prompt interpolation cannot throw (BotScape `buildPersonaPrompt`).
3. Set `preset.yml` name/description to the Bot.

On behavior/public-identity save: regenerate that preset’s persona text (same preset id). DSH running sessions keep their old stamp; new sessions see the new persona.

On `metabot bot delete --confirm`: `ctx.agentPresets.remove(presetId)`. Joined sessions keep their standing mount (DSH behavior).

Preset id format: `oac-<slug>`. Slug is already the CLI `--from` key. Directory names must match `[a-z0-9][a-z0-9-]*`.

Persona text must tell the model its `--from` slug so skill-driven CLI calls act as this Bot, not the machine’s active identity.

### How the model uses OAC

Not Cordis tools wrapping every subcommand.

1. Plugin install binds `metabot-*` into `~/.dsh/skills` (and optionally `~/.agents/skills` if we add that root). DSH `skill-filesystem` already scans those roots.
2. The session’s preset persona names the Bot.
3. The model loads a skill and runs `metabot … --from <slug>` through DSH bash, same as Codex/OpenClaw.

Optional later: a few resident Cordis tools for the most common verbs. Not v1.

### DSH LLM, not OAC host runtimes

Today `primaryProvider` is `RuntimePlatformId | 'custom'` (`codex`, `claude-code`, …). That is wrong on DSH: the conversation LLM *is* a DSH adapter (`ctx.llm.listProviders()` / `listModels`).

v1 storage (CLI-visible, so OAC `/ui/bot` and DSH stay compatible):

- Add optional Bot profile fields `dshLlmProvider` and `dshLlmModel` (and matching fallbacks).
- `metabot bot create` / `bot update` accept them.
- DSH create/edit pickers list `ctx.llm` providers and models only.
- When a blank DSH session selects an `oac-*` preset, default `session.selectModel` to that Bot’s stored provider/model if it is still advertised. The composer model picker remains available; we do not lock it.
- Do **not** add `dsh` as an OAC LLM *executor*. DSH is not a binary OAC spawns. `dsh` in `platformRegistry` is a **skill-bind host only**.

OAC `/ui/bot` on non-DSH hosts keeps the existing host-runtime picker. The DSH plugin UI never shows Codex/Claude/OpenClaw as LLM choices.

### CLI resolution

The plugin depends on the published `open-agent-connect` package (same version) and resolves the `metabot` bin from that dependency, with `OAC_METABOT_CLI_PATH` as override. On first host apply:

1. Fail loud if Node is outside OAC’s `>=20 <25` (DSH host may be on another Node; spawn the CLI with a supported binary if we can detect one, otherwise surface a settings error).
2. `metabot daemon start` if needed (CLI already auto-starts per command; an explicit start avoids first-call latency).
3. `oac install --host dsh` / `metabot host bind-skills --host dsh`.

---

## OAC core changes (small, but real)

These live in the main package, not only in the DSH plugin:

1. **`platformRegistry`:** add `dsh` with skill roots:
   - global `~/.dsh/skills` (`DSH_HOME`)
   - optional global `~/.agents/skills` (`DSH_AGENTS_HOME`) if we want the second user root DSH already scans
   - project `.dsh/skills` as `autoBind: 'manual'`
   - **no** `runtime` / `executor` (DSH is not an OAC-spawned LLM)
2. **`SystemHost` / install / `oac install --host dsh` / docs/hosts/dsh.md**
3. **Bot profile + CLI:** `dshLlmProvider` / `dshLlmModel` (+ fallbacks) on create/update/show
4. **Persona projection for DSH:** not Codex `agents/*.toml`. DSH projection is the generated agent preset, owned by the plugin host because it needs `ctx.agentPresets`. CLI may expose `metabot host persona bind --host dsh --from <slug>` later; v1 can keep generation inside the plugin as long as the only writer is that host path.
5. **Skills:** confirm `metabot-*` SKILL.md works when the host is DSH (bash + `--from`). Minimal wording fixes only.

---

## Plugin package layout

Do not fold the DSH plugin into the root `open-agent-connect` package.json. Root is CommonJS CLI; DSH plugins are ESM dual-face packages with `dsh.client` + tsdown purity gates (see better-sidebar / BotScape).

Replace the current `dsh/` tree with a real package:

```
dsh-plugin/
  package.json          # name TBD; dsh.bundle.patch; dsh.client
  cordis.patch.yml      # insert host row
  tsconfig.json
  tsdown.config.ts
  src/index.ts          # host apply, CLI bridge, preset generate, routes
  src/cli-bridge.ts
  src/preset.ts         # copy standard + rewrite persona
  src/persona.ts        # prompt builder from Bot profile
  src/client/index.ts
  src/client/BotPanel.tsx
  src/client/BotEditor.tsx
  src/client/CreateBotForm.tsx
  src/client/ConversationsPanel.tsx
  src/client/ServicesPanel.tsx
  src/client/AppsPanel.tsx
  src/client/BotPresetSeat.tsx
  src/client/locale.ts
  src/client/styles.ts
  tests/
  scripts/install.sh    # dsh plugin --profile web add …
```

Package name recommendation: `open-agent-connect-dsh` (npm), Cordis `name`: `oac-dsh`, settings section ids: `oac-bots`, `oac-conversations`, `oac-services`, `oac-apps`. Confirm before publish; do not invent a second prefix.

Peer dependencies: pin the same `@deepseek-ai/*` / `cordis` range better-sidebar and BotScape currently use (`0.1.0-rc.6` / cordis `4.0.1` as of this writing). Bump is a whole-plugin action.

`cordis.patch.yml`:

```yaml
- insert:
    - id: oac-dsh
      name: 'open-agent-connect-dsh'
```

---

## UI clone map (Bots first, then the other three sections)

Plugin-shape references (only):

- better-sidebar: install channel, host/client split, `settings.section`, trust fence
- BotScape `plugin-metabot`: one-bot-one-preset, Bot settings page, persona rewrite, preset chip

OAC `/ui/*` + CLI are product-flow references, not a plugin template. Do not copy this worktree’s `dsh/` tree.

### Bot list

Card list of local Bots from `metabot bot list`. New Bot, refresh, later recover/backup if CLI already supports them (`metabot bot backup`). Empty state matches OAC “No Bots yet”.

### Create Bot

Modal or full-page form (BotScape uses full-page; OAC uses modal). v1: **modal**, like OAC, with extra LLM fields like BotScape.

- Name (required)
- Primary DSH provider + model (required; from `ctx.llm`)
- Fallback provider + model (optional)
- Then CLI `metabot identity create` / `bot create` with `--host dsh` and the DSH LLM fields
- On success: generate preset, reload list, stay on the new Bot

Do not offer OAC host runtimes in this form.

### Edit Bot — four tabs (OAC names)

OAC i18n already calls the first tab “Basic” in English (`bot.publicIdentity`). Keep OAC tab keys:

1. **Basic (Public Identity)** — avatar, name, DSH primary/fallback LLM, public bio, homepage URI/globalMetaId copy. Save → `metabot bot update` + regenerate preset if name/bio/llm changed.
2. **Behavior** — Role / Soul / Goal, persona-preset catalog (reuse OAC catalog data). Save → `bot update` + regenerate preset persona.
3. **Chat Settings** — allowlist of chat skills. Same CLI as `/ui/bot` chatSkills tab.
4. **Advanced** — chain/wallet summary + open wallet/backup, danger zone delete (`bot delete --confirm` + remove preset). Hide OAC “LLM Runtimes / Refresh Runtimes / local host binaries” on DSH. Execution history can wait if it is host-runtime specific.

Per-tab dirty/save like OAC (and BotScape): save one tab at a time; confirm before discarding dirty fields.

---

## Conversation start

DSH already has an agent-preset picker on a blank session. The plugin:

- Ensures every local MetaBot has a matching `oac-<slug>` user preset (reconcile on host apply: create missing, skip unknown).
- Replaces the hero chip presentation with Bot avatar/name (BotScape `conversation.hero.agentPreset` at `priority: -1`).
- On select: DSH `recompose` / preset select (existing RPC). Also apply stored DSH model if advertised.
- Does **not** shadow the Settings → Agent presets page (BotScape: same-id shadow duplicates the nav entry).

The user-facing sentence: “new chat → pick which Bot to talk to → that Bot’s persona is in the system prompt → skills let it use OAC.”

---

## Implementation rounds

Each round: scoped tests + `git diff --check` + one commit. Do not run full `npm test` unless the round touches shared CLI/persistence.

### Round 0 — Clear the wrong tree

- Delete `dsh/plugins`, `dsh/preset`, `dsh/install.mjs`, `dsh/tests`, `dsh/README.md`, and the root `dsh:install` / `dsh:test` scripts.
- Do not keep any of that code as a starting point. The replacement package is scaffolded in Round 2 from better-sidebar + BotScape.
- Verify: `git diff --check`; root `npm run build` still works.

### Round 1 — OAC host `dsh` + DSH LLM fields

- Add `dsh` to `platformRegistry` (skill roots only).
- Wire `oac install --host dsh` and `metabot host bind-skills --host dsh`.
- Add Bot profile `dshLlmProvider` / `dshLlmModel` (+ fallbacks) through CLI create/update/show and daemon handlers.
- Tests: platform registry, bind-skills path resolution, bot create/update payload.
- Docs: `docs/hosts/dsh.md` (install bind + “DSH LLM is not an OAC executor”).
- Verify: `npm run build && node --test tests/cli/…` (the files this round touches).

### Round 2 — Plugin package skeleton + install channel

- Scaffold `dsh-plugin/` as a dual-face DSH plugin (host `apply`/`inject`/`name`, `dsh.client`, `cordis.patch.yml`, `scripts/install.sh`).
- Host apply: resolve CLI, bind skills, health payload (`cliPath`, `daemon`, `skillBind`).
- One ping route/command: `metabot identity who` (or `bot list`) round-trip.
- Plugin-shape test: namespace export, no stray `default` (better-sidebar `plugin-shape.spec.ts`).
- Verify: package `typecheck` + shape test. Manual: `dsh plugin --profile web add link:<abs-path>` mounts without crashing DSH.

### Round 3 — Per-bot preset generation

- `persona.ts` + `preset.ts` (copy `standard`, rewrite persona, metadata).
- Reconcile on apply: every `metabot bot list` entry ↔ `oac-<slug>` preset.
- Delete Bot removes preset.
- Tests with a fake `agentPresets` (BotScape style): copy/remove/persona rewrite, `{{` neutralization, missing `persona` row fails loud.
- Verify: unit tests only; no DSH boot required.

### Round 4 — Bots settings section (list + create + four editor tabs)

- Client `settings.section` id `oac-bots` (this is one of four left-nav rows, not the only OAC entry).
- List / create modal / editor tabs. DSH LLM directory from a host route that calls `ctx.llm.listProviders()` + `listModels`.
- All mutations go through the CLI bridge. After create/update, regenerate preset.
- Locale `en` + `zh-CN`.
- Tests: panel rendering with injected fakes; create requires name + provider; delete calls CLI `--confirm` then preset remove.
- Verify: plugin tests + a manual DSH pass (create Bot, see preset in new-session chip).

### Round 5 — Preset chip + session model default

- Shadow `conversation.hero.agentPreset` with Bot avatar/name.
- Blank session select → DSH preset recompose + optional `session.selectModel`.
- Tests: chip lists `oac-*` presets; non-OAC presets still appear as stock DSH rows (do not hide the user’s other presets).
- Verify: new conversation as Bot A vs Bot B shows different persona (inspect prompt or ask “who are you”).

### Round 6 — Conversations, Services, and Apps left-nav sections

- Register `oac-conversations`, `oac-services`, and `oac-apps` as **sibling** `settings.section` rows next to `oac-bots`. Four left-nav items total.
- Clone OAC page semantics, DSH chrome. Same CLI commands as `/ui/conversations`, services, metaapp.
- v1 can be visually simpler than OAC; do not drop confirmation gates (`--confirm`, paid service confirmations).
- v1 is not done until all four sections exist.
- Verify: scoped plugin tests + manual: send private chat, list services, list MetaApps. Settings nav shows four OAC rows.

### Round 7 — Install docs + skill smoke

- `docs/hosts/dsh.md` end-user install (plugin add, Node range, first Bot, first chat).
- Skill bind smoke: after install, DSH skill catalog contains `metabot-*`.
- Root closeout: `npm run test:fast` for OAC core changes from Round 1; plugin package tests for the rest.

---

## Out of scope (v1)

- One Settings entry named OAC / Open Agent Connect / MetaBot that nests the four products.
- Cordis tools wrapping every `metabot` subcommand (the discarded `dsh/` design).
- Iframing OAC `/ui/*`.
- Treating DSH as an OAC LLM executor / discovering a `dsh` binary.
- Moving the four sections out of Settings.
- Publishing a separate BotScape-style monorepo. The plugin lives in this repo.
- Auto-reply daemons beyond what `metabot chat auto-reply` already does.
- Changing DSH itself.
- Using this worktree’s pre-Round-0 `dsh/` tree as a template.

---

## Verification policy

- Round 1: OAC scoped CLI/registry tests + `npm run build`.
- Rounds 2–6: `dsh-plugin` unit/shape tests; manual DSH mount when the round says so.
- Round 7: `npm run test:fast` for OAC core + plugin tests. Not full `npm test` unless persistence/release packaging changed more than expected.
- UI copy: English + zh-CN in sync.
- `git diff --check` on scoped files before each commit.

---

## References

Canonical product contract: `docs/superpowers/specs/2026-08-17-oac-dsh-plugin-design.md`.

- better-sidebar: install, host/client, settings section, trust fence
- BotScape `plugin-metabot`: one-bot-one-preset, Bot page, persona, preset chip; `BotScape/AGENTS.md` identity rules
- DSH: `packages/preset/agent-presets/README.md`, `packages/preset/persona/README.md`, `packages/client/ui-settings` slots
- OAC product: `src/ui/pages/{bot,conversations,services,apps,metaapps}/`, `src/core/contracts/commandResult.ts`, `platformRegistry.ts`
