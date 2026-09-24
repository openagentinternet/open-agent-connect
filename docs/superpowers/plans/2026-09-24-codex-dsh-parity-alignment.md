# Codex ↔ DSH Feature Parity: Gap Analysis and Alignment Plan

Date: 2026-09-24
Branch: `feat/codex-dsh-parity`
Status: proposal (gap analysis done; implementation not started)

## Goal

A user who installs OAC on **Codex** (and, by extension, the other skill-bind
hosts: Claude Code, OpenClaw, ZCode, WorkBuddy) should be able to use
**functionally the same OAC feature set** as a DSH user who installs the
DSH plugin. The acceptance bar is scenario-level, not API-level: e.g. the
prompt *"去 AI 互联网冲浪一下，然后看看有没有什么新技能，并学习一下，存在自己的知识库里"*
must produce an equivalent end result on Codex and on DSH.

Non-goals for this round: pixel/UX parity with DSH's native chrome (native
approval dialogs, right-sidebar embedding, agent-preset chips), and native
function-call tool surfaces (an MCP server is a possible later phase, see §7).

## Sources and method

This plan is built from a full-repo inventory (2026-09-24) of:

- `dsh-plugin/` — the Cordis plugin (host half + React client half),
- `skillpacks/{codex,claude-code,openclaw,zcode,workbuddy,shared,common}/` and
  root `SKILLs/` (26 metabot skills),
- `src/cli/` (33 top-level `metabot` commands), `src/daemon/` (HTTP+SSE),
  `src/ui/` (13 standalone pages), `src/oac/` (installer CLI),
- prior art: `docs/superpowers/specs/2026-09-19-dsh-tools-cross-host-portability-assessment.md`
  (the load-bearing assessment; its Phase 1 already shipped as 10 new skills
  in commit `b8ed5731`).

Key architectural fact that shapes everything below: **OAC is CLI-first by
design.** Every capability lives in `src/core/` + `metabot` CLI + the daemon;
the DSH plugin is a host adapter (native tools + panels + schedulers) over that
core. So closing the gap is mostly *exposure* (daemon routes, standalone UI
pages, daemon-side schedulers, a few CLI verbs), not re-implementation.

## 1. Systematic comparison matrix

Legend: ✅ full parity · 🟡 capability exists but degraded/partial · ❌ missing.

### 1.1 Agent capabilities (what the agent can do in chat)

| Feature family | DSH plugin | Codex today | Gap |
|---|---|---|---|
| MetaWeb search/read (`search_metaweb`, `read_metaweb_pin`) | native tools | `metabot-metaweb` skill → `metabot metaweb *` | ✅ |
| Skill install/publish/list/read (`skill_tool`) | native tool + approval dialog | in `metabot-metaweb` skill → `metabot skills *`; confirm contract instead of dialog | 🟡 UX only |
| AI surf (`metaweb_surf_start/status`) | native tools + **surf UI panel** + pre-dream hook | `metabot-surf` skill → `metabot surf *`; execution already headless in daemon | 🟡 no UI, no automatic trigger |
| Knowledge base (`knowledge_base_*`) | native tools + **Knowledge tab UI** | `metabot-knowledge-base` skill → `metabot knowledge-base *` | 🟡 no UI |
| KB study jobs (`metaweb_study_*`) | native tools; daemon 30-min drain tick | **no CLI verbs** (`core/knowledgebase/studyJobs.ts` only reachable via DSH routes) | ❌ CLI verbs missing |
| Procedures (`procedure_recall/save/archive`) | native tools | **no CLI verbs** (`core/memory/procedureStore.ts` unexposed) | ❌ CLI verbs missing |
| Memory recall/edits/knowledge/impressions | native tools + **Memory panel UI** + per-turn injection/capture hooks | `metabot-memory` skill → `metabot memory *`; manual `memory blocks` / `transcript append` | 🟡 no UI, no auto hooks, LLM judge DSH-only |
| Dream (`dream *`) | native scheduler (nightly) + **Dream tab UI** | `metabot-dream` skill → `metabot dream run` (Chain B→C executor exists) | 🟡 no nightly trigger, no UI |
| Scheduled tasks | tools + daemon 30 s tick + **Scheduled tab UI** + run-as-DSH-conversation | `metabot-schedule` skill + same daemon tick | 🟡 no UI, no host-conversation executor |
| Q&A (`qanda *`), protocol registry, media describe, simplenote | native tools | skills shipped (`metabot-qanda`, `metabot-protocol`, `metabot-media`, `metabot-simplenote`) | ✅ |
| Group tasks (`group_task` 18-action union) | native tools + **GroupTaskView UI** + worker sessions via DSH sub-sessions | `metabot-grouptask` skill; engine runs in daemon 5 s tick on Chain B→C | 🟡 no UI; worker-session executor DSH-only |
| Twin read side (`twin workers/tasks`) | native tools | `metabot-twin` skill | ✅ |
| Twin delegation (`local_worker_delegate`, reassign/cancel, `oac_session_insert_user_message`) | DSH live agent sessions | **no drop-in path** (Tier C) | ❌ by design this round |
| Bot Browser (`bot_browser_*`, MetaApp search/fork/publish) | native tools + right-sidebar iframe tab | `metabot-browser` skill; standalone `/browser` SPA is the *same page* DSH iframes | 🟡 tab control inside host UI is DSH-only; capability OK |
| Chain history recall | native tool | `metabot chainhistory recall` (folded in memory skill) | ✅ |
| Wallet / traffic / file upload / buzz / identity / network | native routes + panels | skills + CLI all present | ✅ |

### 1.2 Standalone UI (what a human can open in a browser)

DSH renders React panels inside the host; other hosts get the daemon-served
`/ui/*` pages (opened via `metabot ui open --page <p>` or `localUiUrl` links
returned by CLI/skills). Today 13 pages exist: `hub, bot, conversations,
services, my-services, publish, refund, apps, metaapps(→apps), settings,
trace(→conversations), buzz, chat` (+ `/browser`, `/ui/qanda`).

| DSH plugin UI | Standalone `/ui` equivalent | Gap |
|---|---|---|
| Bots settings section (BotPanel/BotEditor: Basic, Persona, Chat Settings, Advanced) | `/ui/bot` | ✅ rough parity |
| BotEditor **Knowledge tab** (KB cards, study panel) | — | ❌ no `/ui/kb`; daemon has no `/api/kb/*` |
| BotEditor **Scheduled tab** | — | ❌ no `/ui/schedule`; daemon `/api/schedule/*` is the lease/claim protocol, lacks management endpoints |
| BotEditor Advanced → **AI Surf section** | — | ❌ no `/ui/surf` (daemon has `/api/surf/*` JSON only) |
| Memory panel (Knowledge/Facts/Contacts/**Dream** tabs, hygiene, policy) | — | ❌ no `/ui/memory`, no `/ui/dream`; daemon has **no** `/api/memory/*` or `/api/dream/*` at all |
| User panel (owner identity) | partial in `/ui/settings` | 🟡 |
| Apps panel | `/ui/apps` | ✅ |
| Services panel (hidden in DSH) | `/ui/services`, `/ui/my-services`, `/ui/publish`, `/ui/refund` | ✅ |
| Traffic panel | — | ❌ no `/ui/traffic` (daemon `/api/traffic/*` JSON only) |
| A2A chat overlay + group-task detail | `/ui/conversations` (private chat only) | 🟡 group-task UI missing |
| Bot Browser sidebar tab | `/browser` (same page, standalone) | ✅ |

i18n debt in existing standalone pages: `bot`, `hub`, `publish`, `refund` are
English-only (no `i18n.t()` coverage); repo rule requires en + zh-CN.

### 1.3 Background automation (what happens with no prompt)

| Behavior | DSH plugin | Codex today | Gap |
|---|---|---|---|
| Nightly dream + memory hygiene tail + pre-dream surf | `dsh-plugin/src/dream-scheduler.ts` | **nothing** — `metabot-dream` SKILL.md says "no automatic nightly trigger yet" | ❌ daemon dream tick missing |
| Scheduled-task execution | daemon 30 s tick (host-agnostic) + DSH heartbeat upgrade | ✅ same daemon tick | ✅ |
| KB study-job drain | daemon 30-min tick | ✅ same daemon tick (but no CLI/UI to enqueue — see 1.1) | 🟡 |
| Chain-history summary drain | `chain-history-summary.ts` via `ctx.llm` | ❌ | ❌ |
| Group-task worker turns | DSH sub-sessions (`group-task-worker.ts`) | daemon `LlmExecutor` path exists for chair turns; worker-session parity partial | 🟡 |
| A2A auto-reply | chat watcher + host executor | daemon-side orchestrator exists (`src/core/chat/privateChatAutoReply.ts`, wired in `defaultHandlers.ts`); DSH adds unread SSE watching | 🟡 mostly parity |
| Memory per-turn injection/capture | `memory-observe.ts` hooks | skill-doc-mediated (agent discipline) | 🟡 UX only |
| Memory extract LLM judge | DSH host executor | degrades to rule-only (one-call gap, `src/cli/runtime.ts:4260-4290`) | ❌ small fix |
| Host LLM executor bridge | Chain A/B | Chain C fallback works everywhere (proven by surf/schedule) | ✅ |

## 2. Gap summary (what actually needs building)

Grouped by nature, ordered by leverage:

- **G1 — Daemon API holes.** No `/api/dream/*`, `/api/memory/*`, `/api/kb/*`,
  `/api/study/*`; `/api/schedule/*` lacks management verbs (create/update/
  delete/enable/disable). Blocks all UI work. *(New code, but thin: handlers
  already exist for the CLI — expose them over HTTP.)*
- **G2 — Standalone UI pages.** Missing: `/ui/kb`, `/ui/surf`, `/ui/memory`,
  `/ui/dream`, `/ui/schedule`, `/ui/traffic`, group-task view, owner-identity
  section; plus i18n debt on `bot/hub/publish/refund`. All new pages must be
  i18n'd en + zh-CN from day one and wired into `NAV_ITEMS`,
  `metabot ui open --page`, and the CLI's `localUiUrl` returns.
- **G3 — Daemon-side dream tick.** The only missing piece of the dream
  mechanism (executor already shipped). Mirror the schedule-tick pattern;
  include hygiene tail + pre-dream surf gate; DSH plugin stands down via the
  heartbeat-lease trick already used for schedule.
- **G4 — Small core/CLI verbs.** `metabot memory procedure *`;
  `metabot knowledge-base study *`; memory-extract judge fallback to Chain C.
- **G5 — Chain-history summary drain in daemon** (B→C chain; today DSH-only).
- **G6 — Intentionally DSH-only this round** (accept, document): native
  `ctx.approval` dialogs (confirm contract is the cross-host semantic
  equivalent), per-Bot agent presets / preset chip, sidebar embedding,
  twin live-session delegation (Tier C, needs its own design), MCP server
  (native-tool UX parity — deferred until a requirement exists).

## 3. Alignment plan (phases)

Each phase is independently mergeable; order is dependency-driven.

### Phase 0 — Real-install baseline (½ day)

Nothing was runtime-verified on an actual Codex install in the 09-19
assessment. Before changing anything:

1. Install the codex skillpack into a scratch `CODEX_HOME` (fixture), run
   `metabot doctor`, walk the 26 skills' smoke commands.
2. Record a parity scorecard (works / degraded / broken per skill) as
   `docs/acceptance/codex-parity-baseline-2026-09-24.md`.
3. Verify: `pnpm run build && node --test tests/cli/…` scoped to touched
   areas only.

### Phase 1 — Daemon API completion (G1)

- Add `src/daemon/routes/dream.ts` (`/api/dream/{status,due,run,summaries,
  self-identity,capabilities}`), `memory.ts` (`/api/memory/{list,search,add,
  update,delete,recall,knowledge/*,impressions/*,policy,hygiene/*}`),
  `kb.ts` (`/api/kb/{list,create,update,remove,query,add-document,learn,
  import}`), extending `schedule.ts` with management verbs
  (`create/update/delete/enable/disable`).
- Reuse the existing CLI handler logic (handlers already take actor params);
  keep storage-v2 paths untouched.
- Register in `src/daemon/httpServer.ts` + `defaultHandlers.ts`; add route
  tests alongside existing route tests.
- Verify: `pnpm run build && node --test tests/daemon/<new>.test.mjs` +
  `pnpm run test:fast`.

### Phase 2 — Standalone UI pages (G2)

New pages under `src/ui/pages/`, following the existing page-def pattern
(`PAGE_BUILDERS` in `src/daemon/routes/ui.ts`, `topbarChrome.ts`, i18n via
`src/ui/i18n.ts` with en + zh-CN keys):

1. `/ui/kb` — KB list/create, import (file + directory), query tester, study
   job panel (enqueue/status/retry via Phase 4 verbs).
2. `/ui/surf` — status, run-now, reports list + report viewer
   (`reportMarkdown`), enable/budget settings.
3. `/ui/memory` — tabs Knowledge/Facts/Contacts/Impressions, policy card,
   hygiene run/config.
4. `/ui/dream` — diaries list/reader, self-identity, capabilities, run-now,
   next-due display.
5. `/ui/schedule` — task CRUD, enable/disable, runs history.
6. `/ui/traffic` — mode/balance/grant/redeem/usage/ledger.
7. Group-task list+detail — extend `/ui/conversations` with a group-task
   section (members, deliverables, transcript) rather than a separate page.
8. Owner identity — extend `/ui/settings` with a User section
   (who/create/import/rename/reveal-mnemonic).
9. Bot editor: add Knowledge + Scheduled entries on `/ui/bot` linking into the
   new pages (deep links with `--local`-style params).
10. i18n debt paydown on `bot/hub/publish/refund`; register all new pages in
    `NAV_ITEMS`, `SUPPORTED_UI_PAGES` in `src/cli/commands/ui.ts`, and
    `resolveLocalUiPath`.
- Verify: build + scoped UI tests; `git diff --check`; manual open of each
  page against a local daemon.

### Phase 3 — Daemon dream tick + automation parity (G3, G4c, G5)

- `src/daemon/` dream scheduler mirroring the schedule-tick pattern: per
  dream-enabled profile, `dream due` → `dream run` (Chain B→C; DSH pair wins
  when connected) → hygiene tail → pre-dream surf gate. Config under storage
  v2 profile `.runtime/`; opt-in default matching DSH semantics.
- **Multi-host conflict avoidance (DSH-first, decided 2026-09-24):** with DSH
  and Codex both installed/open against the same Bot, two ticks must never
  double-dream. Three layers: (1) *stand-down* — the daemon tick skips
  entirely while the DSH host-executor bridge is connected
  (`/api/llm/host-executor/status`; zero dsh-plugin change required, unlike a
  heartbeat lease which would touch the plugin); (2) *running-skip* — the
  core due algorithm already skips dates with a `running` run, so a dream
  started by DSH is invisible to the daemon's due check; (3) *idempotent
  commit* — dream commit is idempotent per date, so even the residual
  start-race window (both see `due` before either marks `running`, e.g. DSH
  quits mid-boundary) can cost at most one duplicate LLM run, never two
  diaries. Pre-dream surf is already guarded daemon-side by the surf run
  watchdog + `preDreamDue` recency gates.
- DSH plugin `dream-scheduler.ts` stays as-is (no plugin edits): when DSH is
  open it owns the dream; when DSH is absent the daemon owns it. Known
  accepted edge: a Bot without `dshLlmProvider/Model` configured is skipped
  by the plugin and also skipped by the standing-down daemon while DSH is
  open — it dreams only when DSH is closed (documented in the phase-3
  implementation notes).
- Memory-extract LLM judge: point the extract handler at
  `runLlmPromptWithRuntimeFallback` (Chain C) — the one-call gap at
  `src/cli/runtime.ts:4260-4290`.
- Chain-history summary drain ported into the daemon (daily cap, per-tick
  budget, B→C), plugin version stands down on lease.
- Verify: new tests in `tests/dream*` / `tests/schedule*` tiers;
  `pnpm run test:fast`; integration tier if daemon-timing tests are added
  (register in `scripts/run-test-suite.mjs` `INTEGRATION_FILES` if slow).

### Phase 4 — CLI verb gaps (G4a, G4b)

- `metabot memory procedure list/recall/save/archive` over
  `core/memory/procedureStore.ts`.
- `metabot knowledge-base study enqueue/status/retry` over
  `core/knowledgebase/studyJobs.ts` (daemon drain tick already exists).
- Full help specs in `commandHelp.ts`; JSON envelope output per CLI-first v2.
- Update `SKILLs/metabot-knowledge-base` + `metabot-memory` to teach the new
  verbs; rebuild skillpacks.
- Verify: scoped CLI tests + `pnpm run test:fast`.

### Phase 5 — Skill/UI interlinking + docs

- Skills that now have UI pages (`metabot-surf`, `metabot-knowledge-base`,
  `metabot-dream`, `metabot-memory`, `metabot-schedule`) must return/link the
  `localUiUrl` (host-adapter note already tells Codex agents to open it in the
  in-app browser).
- `pnpm run build:skillpacks`; README regen; update `metabot-help` capability
  map sources.
- Verify: `pnpm run build:skillpacks` + skillpack tests; `git diff --check`.

### Phase 6 — Acceptance run (the user's scenario, both hosts)

Scripted walkthrough on Codex and DSH of:

> "去 AI 互联网冲浪一下，然后看看有没有什么新技能，并学习一下，存在自己的知识库里"

Expected equivalent trajectory on both: surf run → report (plus `/ui/surf`
link) → MetaWeb search for skill packages → `skills install` (confirm
contract on Codex vs approval dialog on DSH) → KB `learn`/`add-document` →
visible in `/ui/kb`. Record results in `docs/acceptance/`.

## 4. What deliberately stays different

- **Approval UX:** DSH native dialogs vs the `awaiting_confirmation` +
  confirmation-contract flow. Semantically equivalent; enforcement moves to
  the skill contract (accepted trade-off, per the 09-19 assessment).
- **Host chrome:** presets, preset chip, sidebar iframe tab — DSH integration
  surfaces, not OAC capabilities. Standalone `/browser` + `/ui/*` cover the
  same ground for other hosts.
- **Twin live-session delegation** (`local_worker_delegate` family): Tier C,
  needs a daemon `LlmExecutor` session design; separate scoped plan.
- **MCP server:** only if native-function-call UX parity becomes a stated
  requirement.
- **Persona projection beyond Codex** (`~/.codex/agents/*.toml` exists;
  claude-code/openclaw projection unbuilt): separate already-scoped gap.

## 5. Constraints (repo rules this plan must honor)

- **DSH-first (hard rule, supersedes every phase below):** this alignment is
  additive-only. Every change must be a pure addition (new daemon routes, new
  UI pages, new CLI verbs, new skill docs) that leaves the DSH plugin's
  behavior, routes, tools, schedulers, and storage semantics byte-for-byte
  untouched. If closing some Codex gap would require changing behavior the
  DSH plugin depends on, or carries any risk of degrading the DSH user
  experience, that item is descoped or deferred — DSH users must be
  completely unaffected by this work. When a DSH-side change seems
  unavoidable (e.g. plugin scheduler stand-down in Phase 3), it ships as an
  opt-in/no-op-by-default path and is verified against the plugin before
  merge.
- CLI-first: every capability lands in `src/core/` + `metabot`/daemon first;
  UI and skills are thin exposures. No capability may become UI-only.
- Storage v2 layout (`docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`);
  no new code depending on the legacy `.metabot/hot` layout.
- All UI copy through `src/ui/i18n.ts`, en + zh-CN in sync; docs/comments in
  English.
- New skills → add to `METABOT_SKILLS` in `scripts/build-metabot-skillpacks.mjs`
  and regenerate packs.
- Test tiers: new slow daemon-timing tests go to `INTEGRATION_FILES` in
  `scripts/run-test-suite.mjs`; `test:fast` is the default gate; full
  `pnpm test` before merge since this touches shared runtime behavior.
- Temp dirs in tests only via `tests/helpers/tempRoots.mjs`.

## 6. Rough sizing

| Phase | Scope | Estimate |
|---|---|---|
| 0 baseline | fixtures + scorecard | ½ day |
| 1 daemon APIs | 4 route modules + tests | 1–2 days |
| 2 UI pages | 6 new pages + extensions + i18n | 3–4 days |
| 3 dream tick + drains | daemon scheduler + judge fallback + summary drain | 1–2 days |
| 4 CLI verbs | 2 verb families + help + tests | ½–1 day |
| 5 skill interlinking | SKILL.md updates + pack rebuild | ½ day |
| 6 acceptance | scripted both-host walkthrough | ½ day |

Total ≈ 1.5–2 weeks of focused work; phases 1→2 and 3→4→5 parallelize.

## 7. Open questions

1. Group-task UI: fold into `/ui/conversations` (recommended here) or a
   separate `/ui/grouptask` page? DSH uses an overlay on the chat surface.
2. Dream UI scope: full Memory-panel parity (contacts/facts live in
   `/ui/memory`) vs a lighter dream-diary reader?
3. Should the daemon dream tick be opt-in per Bot (mirroring DSH's
   dream-enabled flag) or global with per-Bot opt-out?
4. Traffic page: is it needed on self-hosted CLI installs, or is it primarily
   a hosted-billing surface (then priority drops)?
