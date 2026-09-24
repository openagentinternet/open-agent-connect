# Codex ↔ DSH parity — unified end-to-end acceptance run (2026-09-24)

Phase 6 acceptance record for the Codex ↔ DSH parity work merged as `32f4fc90`
(`Merge branch 'feat/codex-dsh-parity': Codex↔DSH parity (daemon APIs, standalone UI, dream tick,
CLI verbs, localUiUrl, skillpacks)`).

Scenario under test (the user's acceptance prompt, verbatim intent):

> 去 AI 互联网冲浪一下，然后看看有没有什么新技能，并学习一下，存在自己的知识库里

= surf the Agent Internet, look for new skills, learn them, store them in the Bot's knowledge base.

Verdict summary: **8 of the 10 steps verified working, 2 degraded** (the surf run and the LLM
binding that gates it). Both degradations come from one environmental cause: the run was executed
in a fully isolated `HOME`, where none of the nine discovered LLM runtimes could reach
`health: "healthy"` — eight are unauthenticated inside that `HOME`, and codex is additionally
geo-blocked from this network. Every non-LLM part of the scenario (on-chain skill discovery,
install, read, knowledge-base storage and retrieval, standalone UI) ran against the real network
and passed. The surf run itself proved its chain-read phase (150 pins fetched) and then failed the
LLM gate with a precise, correct error.

## 1. Environment and scratch setup

| Item | Value |
|---|---|
| Repo / branch | `/Users/tusm/Documents/MetaID_Projects/open-agent-connect`, `main` @ `32f4fc90` |
| Node | `v22.22.2` (`/opt/homebrew/opt/node@22/bin`, prepended to `PATH` for every command) |
| CLI under test | `metabot 0.8.0`, executed from this checkout's freshly built `dist/cli/main.js` |
| Scratch root | `/tmp/oac-accept-parity-20260924` (`SCRATCH`) |
| Isolated home | `HOME=/tmp/oac-accept-parity-20260924/home`, `CODEX_HOME=$HOME/.codex` |
| Daemon port | `METABOT_DAEMON_PORT=18777` (explicit; the CLI fails rather than falling back when an explicit port is unavailable) |
| CLI entry override | `METABOT_CLI_ENTRY=/Users/tusm/Documents/MetaID_Projects/open-agent-connect/dist/cli/main.js` |
| Real daemon | `127.0.0.1:10001` (pid 28590) verified listening before and after the run — never contacted, never restarted |
| Real `~/.metabot`, `~/.codex`, `~/.claude` | never written; the only reads from outside `$SCRATCH` were the Playwright browser binaries under `~/Library/Caches/ms-playwright` (read-only, set via `PLAYWRIGHT_BROWSERS_PATH`) |

Every command in this record was executed with those overrides in force (sourced from
`$SCRATCH/env.sh`). Chain-write budget: the only authorized write was the disposable identity plus
the three bootstrap pins it inherently writes; no buzz/simplenote/qanda publish, no fund transfer,
no traffic claim, no service order, no profile edit.

## 2. Scenario table

### Step 1 — Install the Codex pack into the scratch env

| | |
|---|---|
| Exact command | `bash skillpacks/codex/install.sh` (env: `HOME`, `CODEX_HOME`, `METABOT_CLI_ENTRY`) |
| Observed | exit 0. Shim written to `$HOME/.metabot/bin/metabot` with `PREFERRED_CLI_ENTRY="/Users/tusm/Documents/MetaID_Projects/open-agent-connect/dist/cli/main.js"`; `metabot --version` → `metabot 0.8.0`; 26 shared skills in `$HOME/.metabot/skills`; 26 rendered copies in `$HOME/.metabot/host-skills/codex`; `host bind-skills --host codex` returned `state: success` binding 26 `metabot-*` names into `$CODEX_HOME/skills` (`failedRoots: []`) |
| Evidence | install stdout; `boundSkills` list in the `host bind-skills` envelope; `ls $CODEX_HOME/skills \| wc -l` = 26 |
| Bundled-runtime check | `skillpacks/codex/runtime/dist/daemon/automationTicks.js` exists and `diff -rq skillpacks/codex/runtime/dist dist` reports **0 differing files** — the bundled runtime is byte-identical to this checkout's rebuilt `dist/` for every shared file (the bundle additionally ships UI sources/assets). The bundled runtime is therefore the freshly rebuilt one, not a stale copy |
| Verdict | **works** |

### Step 2 — Disposable identity + scratch daemon

| | |
|---|---|
| Exact commands | `metabot identity create --name "ParityAcceptanceBot" --host codex --json`; `metabot identity list --json`; `metabot daemon start --json`; `lsof -nP -iTCP:18777 -sTCP:LISTEN`; `lsof -nP -iTCP:10001 -sTCP:LISTEN` |
| Observed | identity created in ~64 s, `subsidyState: "claimed"`, `syncState: "synced"`, slug `parityacceptancebot`; daemon start → `{host: "127.0.0.1", port: 18777, baseUrl: "http://127.0.0.1:18777", pid: 99603}`; `lsof` shows `node 99603 ... TCP 127.0.0.1:18777 (LISTEN)` and, separately, the user's real daemon still on `127.0.0.1:10001` (pid 28590) |
| Evidence | `identity-create.json`, `identity-list`, `daemon-start.json`, both `lsof` outputs (see §3 for the identity record) |
| Verdict | **works** |

### Step 3 — Bind an LLM runtime

| | |
|---|---|
| Exact commands | `metabot llm list-runtimes --json`; `metabot llm bindings --from parityacceptancebot --json`; `metabot llm get-preferred --from parityacceptancebot --json`; `metabot llm host-executor --json`; `codex login status` |
| Observed | 9 runtimes discovered (codex, cursor, zcode, workbuddy, claude-code, opencode, openclaw, gemini, kimi) — **none reached `health: "healthy"`**; bindings were created automatically at identity time: `llm_codex_/opt/homebrew/bin/codex` role `primary` + `llm_cursor_/Users/tusm/.local/bin/cursor-agent` role `fallback`; `get-preferred` → `runtimeId: null`; `host-executor` → `{connected: 0, lastConnectedAt: null}` |
| Probe evidence | codex: `codex error` (websocket `403 Forbidden` to `wss://api.openai.com/v1/responses`, then `Falling back … unexpected status 403 Forbidden: Country, region, or territory not supported … cf-ray …-HKG`) and `codex login status` → `Not logged in`; cursor: `Authentication required. Please run 'agent login' first`; claude-code: `Not logged in · Please run /login`; zcode/opencode/gemini/kimi: `unavailable` (version probe timeout); workbuddy: readiness probe timed out after 45000 ms; openclaw: readiness probe timed out after 30000 ms |
| Why | Auth for these CLIs is file-based inside the effective `HOME`/`CODEX_HOME` (or, for codex, is additionally geo-blocked from this network). The acceptance run deliberately uses an isolated `HOME`, and copying the user's credential files into the scratch home was explicitly out of bounds, so no runtime could become healthy. This is an environment property of the isolated run, not a defect in the binding flow — discovery, binding, and health classification all behaved correctly |
| Verdict | **degraded** (runtimes discovered and bound, but none usable in an isolated `HOME`) |

### Step 4 — Surf the Agent Internet

| | |
|---|---|
| Exact commands | `metabot surf status --from parityacceptancebot --json`; `metabot surf run --from parityacceptancebot --trigger manual-ui --json`; `metabot surf status --from parityacceptancebot --json` (~75 s later) |
| Before | `{runs: [], running: false, surfBeforeDreamEnabled: false, interactionBudget: 20, localUiUrl: "http://127.0.0.1:18777/ui/surf?from=parityacceptancebot"}` |
| Run envelope | `{runId: "caf0cf08-ffd3-4029-943a-89dbcdc97638", trigger: "manual-ui", status: "running", localUiUrl: "http://127.0.0.1:18777/ui/surf?from=parityacceptancebot"}` — fire-and-forget confirmed, `localUiUrl` present and pointing at the scratch port |
| Result after 21.2 s | `status: "failed"`, `error: "No healthy LLM runtime is available for MetaBot parityacceptancebot."`, `reportMarkdown: null`, `stats: {fetched: 150, deepRead: 0, savedToKb: 0, knowledgePoints: 0, liked: 0, commented: 0, answered: 0, posted: 0, challenged: 0, inboxHandled: 0, discoveredProtocols: 0, tasksScheduled: 0}`, `startedAt 2026-09-24T15:49:49.398Z`, `finishedAt 2026-09-24T15:50:10.588Z` |
| What the run proves | The **chain-read phase works**: 150 pins were really fetched from the aggregation node before the LLM gate was reached. The failure is exactly the documented chain: `src/cli/runtime.ts:6352` `createHostFirstCompletion({dshLlmPath})` returns `null` (no DSH pair for this bot, `host-executor connected: 0`), then `runLlmPromptWithRuntimeFallback` requires `runtime.health === 'healthy'` (`src/core/llm/llmRuntimeResolver.ts:125`) and returns the message seeded at `src/core/llm/llmRuntimeExecution.ts:48`. No chain write was attempted (`interactionBudget` untouched, no receipts) |
| Verdict | **degraded** — surf plumbing, run store, envelope, and stats are correct; the unattended LLM session could not run (see step 3) |

### Step 5 — Discover skill packages on MetaWeb

| | |
|---|---|
| Exact command | `metabot metaweb search --query skill --protocols metabot-skill --newest --size 10 --json` |
| Observed | `state: success`, 10 items, `hasMore: true`, `nextCursor: eyJvIjoxMH0`. Newest real on-chain packages: `humanizer` `09bfa810e7b7eafa26d152a1ba33f83684135d44173943d8690a892da2939bf3i0` (2026-09-21), `frontend-slides`, `gzh-design`, `pixel2motion`, `i-have-adhd`, `ffmpeg-skill`, `punk-skill`, `guizang-social-card-skill`, `caveman`, `gimi-illustration` — all published by `Builder阿码` (`idq1d5m392ahkhp79wsy9ur79e3vhak7tg729dwdr5`) |
| Evidence | `skillsearch.json`; each item carries `protocol`, `pinId`, `currentPinId`, `title`, `summary`, `publisher`, `createdAt` |
| Follow-up read | `metabot metaweb read --pin 09bfa810…i0` returned the pin metadata (protocol `metabot-skill`, path `/protocols/metabot-skill`, chain `mvc`, creator, `createdAt 1789949156`) plus a `next:` hint that names **both** surfaces: `metabot skills install --pin <pinId> --confirm` and "(DSH hosts: the skill_tool install_skill action)" |
| Verdict | **works** |

### Step 6 — Learn / install one real skill package

| | |
|---|---|
| Exact commands | `metabot skills install --pin 09bfa810…i0 --json` (preview); `metabot skills install --pin 09bfa810…i0 --confirm --json`; `metabot skills list --json`; `metabot skills read --name humanizer --json` |
| Preview | exit 1 with `code: "confirm_required"` and a real plan: skill `humanizer`, version `3.0.0`, publisher `Builder阿码`, package `metafile://fcc68c7350f808518f1fb7e7e979228350f4cf14021b6f8d6c8b8744a4457b14i0.zip`, target `$HOME/.metabot/skills/<name>/` |
| Install | `state: success`; `skill = {name: "humanizer", version: "3.0.0", skillDir: "$HOME/.metabot/skills/humanizer", skillMdPath: …/SKILL.md, replaced: false, files: ["ATTRIBUTION.md", "LICENSE", "SKILL.md"]}`; `rebind` bound `humanizer` into three host roots (`shared-agents`, `claude-code`, `codex`) → `$CODEX_HOME/skills` grew 26 → 27 with `humanizer` present. Nothing was published on-chain |
| Read | `skills read --name humanizer` returned `skillMd` (full SKILL.md), `skillDir`, and `files`; `skills list` shows provenance (`creatorMetaId`, `creatorName`, `sourcePinId`, `skillFileUri`, `installedAt`, `present: true`) |
| Defect seen | the registry entry stores `description: "|"` (see D1 in §5) |
| Verdict | **works** (with defect D1) |

### Step 7 — Store the learned material in the knowledge base, then prove retrieval

| | |
|---|---|
| Exact commands | `metabot knowledge-base create --name "MetaWeb Skills" --description "On-chain skill packages learned from MetaWeb" --autolearn on --json`; `metabot knowledge-base add-document --title "humanizer (metabot-skill 3.0.0)" --content-file <material>.md --source-type metaweb --pin-id 09bfa810…i0 --tags "skill,humanizer,metaweb" --json`; `metabot knowledge-base learn --json`; `metabot knowledge-base query --text "forced triads and dashes" --json`; `metabot knowledge-base study enqueue --from parityacceptancebot --topic "metabot-skill package authoring patterns" --budget-pins 5 --json`; `metabot knowledge-base study status --from parityacceptancebot --json` |
| Create | `knowledgeBase.id = "metaweb-skills"`, `isDefault: true`, `autoLearn: true`, raw dir under the scratch profile |
| Add document | `docCount: 1`, `chunkCount: 33`, `indexed: true`, `relPath: "metabot-inbox/humanizer-metabot-skill-3-0-0-29d61372.json"` — the 29 KB material is the installed SKILL.md plus a provenance header naming the protocol, pin id, publisher, and install path |
| Learn | `learnSummary: {added: 0, updated: 0, removed: 0}` (already indexed by auto-learn — correct incremental behaviour), `localUiUrl: "http://127.0.0.1:18777/ui/kb?from=parityacceptancebot"` |
| Query | `state: success`; hits belong to KB `MetaWeb Skills`; top score **0.9625**, and the chunk that literally contains `### 6. Forced triads` scored 0.4726 — retrieval actually found the material. Envelope carries `localUiUrl: http://127.0.0.1:18777/ui/kb?from=parityacceptancebot` |
| Study queue | `study enqueue` → `{job: {id: "study-1-41t8gp", kind: "topic", topic: "metabot-skill package authoring patterns", status: "pending", budgetPins: 5}, created: true}`; `study status` lists the same job. Local only, no chain write |
| Verdict | **works** (usage note D3: the query flag is `--text`, not `--query`) |

### Step 8 — Standalone UI evidence

| | |
|---|---|
| Exact commands | `curl -o … -w "%{http_code}" http://127.0.0.1:18777/ui/{kb,surf,memory,schedule,settings}?from=parityacceptancebot`; `curl http://127.0.0.1:18777/browser`; Playwright (chromium from the user's `ms-playwright` cache) rendering the four pages in `en` and `zh-CN` |
| HTTP | `kb` 200 (198 678 B), `surf` 200 (183 914 B), `memory` 200 (248 468 B), `schedule` 200 (201 157 B), `settings` 200 (187 694 B), `/browser` 200, `/ui/kb` without `?from=` also 200 |
| Rendered nav (en) | `Bots → /ui/bot`, `Conversations`, `Services`, `Apps`, `Knowledge → /ui/kb`, `Surf → /ui/surf`, `Memory → /ui/memory`, `Schedule → /ui/schedule`, `Open Browser → /browser` |
| Rendered nav (zh-CN) | `Bots / 对话 / 服务 / 应用 / 知识库 / 冲浪 / 记忆 / 定时任务 / 打开浏览器` (same hrefs) |
| Rendered data | KB page: `MetaWeb Skills · Default · 1 docs · 33 chunks · Just now` (the step-7 data). Surf page: run row `Failed · 3 min ago · fetched 150 · deep-read 0 · saved 0 · Error: No healthy LLM runtime is available for MetaBot parityacceptancebot.` (the step-4 data) |
| Console health | 0 console errors and 0 failed requests on all 8 page loads (4 pages × 2 languages) |
| Screenshots | `/tmp/oac-accept-shots/shot-{kb,surf,memory,schedule}-{en,zh-CN}.png` (8 files, outside the repo — no binaries added to the repo) |
| Nit | `document.title` stays English in `zh-CN` (`Knowledge — Open Agent Connect`, `Surf — …`) even though `<html lang>` switches to `zh-CN` and the `kb.title` / `surf.title` zh-CN dictionary entries exist (see D2) |
| Verdict | **works** (with nit D2) |

### Step 9 — DSH non-regression

| | |
|---|---|
| Exact command | `cd dsh-plugin && pnpm test` (= `pnpm run build && node --test tests/*.test.mjs`) |
| Build | `tsc -p tsconfig.json` clean, `tsdown` bundle OK (`lib/client.js` 863.64 kB, 2 files, 2.21 MB) |
| Tests | `# tests 488`, `# pass 488`, `# fail 0`, `# cancelled 0`, `# skipped 0`, duration 9 735 ms, exit 0 |
| Merge scope check | `git show --stat 32f4fc90 -- dsh-plugin/ \| tail -3` → **empty output**, i.e. the merge commit touched zero `dsh-plugin/` files (the 647-file merge is root-package `src/`, `tests/`, `skillpacks/` only) |
| Verdict | **works** |

### Step 10 — Cleanup

| | |
|---|---|
| Commands | `metabot daemon stop` → `lsof -nP -iTCP:18777 -sTCP:LISTEN` (empty) → `lsof -nP -iTCP:10001 -sTCP:LISTEN` (user's daemon still alive, pid 28590) → `rm -rf /tmp/oac-accept-parity-20260924` |
| Left behind | **the disposable on-chain identity** (§3) — it exists in the chain and in no local home. Screenshots preserved at `/tmp/oac-accept-shots/`. Nothing else: no repo file was modified except this document, and no git commit was made |

## 3. Disposable identity record (chain write — the only authorized one)

> **This identity exists on-chain and cannot be undone.**

| Field | Value |
|---|---|
| Name / slug | `ParityAcceptanceBot` / `parityacceptancebot` |
| `globalMetaId` | `idq1ug8p3d0nsvra25qc32qtle3zgvscluxfrsg0ve` |
| `metaId` | `c242e6c3d2c9b8c06f7440906c7f0f67a9930895ffa0cf3ce96d907e41f00911` |
| MVC address | `1McGboFnCQ8KxDvRzo7YTLAfjAJuSkE5wC` (btc/opcat same address; doge `DRkN94CRVp2cVE72jP7716LGcJ3Cj9QP1m`) |
| Public key | `03c7462219d02375cb7fa32b4021d4a1ab7c679bbfa59cdacb2d4394bc1fba1d20` |
| Chat public key | `04aa524f1a7d64a2d584ebc53f8fecec38e39a88415b128aa625909aa042324a4685ad2394e9bc5f36c87be8c78d2c34bd63b4026bab8235dd2b5fbc8db8619bfc` |
| Bootstrap subsidy | `subsidyState: "claimed"`, `syncState: "synced"` |
| Chain writes (3, all fee-sponsored) | `/info/name` pin `6660e3c9f550291f33c12bab593f08ea49ecd7d8d52c50a1039b0fa2dce0c0fdi0` (tx `6660e3c9…c0fd`, 483 bytes); `/info/chatpubkey` pin `c8827897f3dff16450b2f1dc6cfe80a811f7829818e3bc4a55953aa6ac7fa1ddi0` (601 bytes); `/info/llm` pin `889b42821881cb4526c1d6066083bab40da14adf5d862021d986f474c86a1b81i0` (524 bytes) |
| Cost | `feeAssist.mode: "mvc_sponsor_v2"`, `billedBy: "quota"` — quota 20 000 000 → 19 998 392, i.e. **1 608 sponsored bytes, zero spend from the user's wallet** |
| Local state | deleted with the scratch dir (`$SCRATCH/home/.metabot`) |

## 4. DSH-side comparison (derived from `dsh-plugin/src` + the plugin test results; the live DSH app was not driven or restarted)

`dsh-plugin@0.9.0` is a DSH profile-bundle plugin: five React settings sections
(`src/client/index.ts` — main, memory, user, apps, traffic), a sidebar conversation pane, and bot
editor tabs, backed by host routes that forward to the same `metabot` CLI verbs and read the same
OAC core stores in-process. The parity work did not touch it (`git show --stat 32f4fc90 -- dsh-plugin/`
is empty), so all plugin behaviour below is unchanged `0.9.0` behaviour.

| Scenario step | Codex path (this run) | DSH path (plugin surface) | End state matches? |
|---|---|---|---|
| Install / bind skills (step 1) | `skillpacks/codex/install.sh` → shim + shared skills + `host bind-skills --host codex` | `scripts/install.sh` + `bootstrap.ts` (per-agent binding, `per-agent-install.ts`); `skill_tool list_installed_skills` reads the same shared root | Yes — same CLI verb, same shared skills root, same host-root binding model |
| Identity (step 2) | `metabot identity create --name … --host codex` | `CreateBotForm.tsx` / `bots.ts` / `bots-api` route drive the same identity verbs; the Bot editor shows the created Bot | Yes |
| LLM binding (step 3) | local CLI runtime chain; `codex` primary, `cursor` fallback; health from real readiness probes | `llm/directory` + `llm/host-status` routes; the plugin registers as a **host LLM executor** (`host-llm-executor.ts`) so the daemon leases generations from the DSH host model | **Differs by design** — DSH can satisfy the LLM call from the host's own model; the Codex path has no host executor and needs a healthy local runtime. In this run `metabot llm host-executor` reported `connected: 0`, so the daemon fell through to local runtimes |
| Surf (step 4) | `metabot surf run --trigger manual-ui` (fire-and-forget) + `surf status`; report in the run row | `metaweb_surf_start` / `metaweb_surf_status` tools (`surf-tools.ts`) reading the run store in-process, plus `surf/*` routes (`surf/status|run|enable|disable|budget`) for the Advanced-tab section (`SurfSection.tsx`) | Yes for plumbing — identical store, identical stats/error fields, identical fire-and-forget contract. The LLM gate is the same shared code (`runtime.ts:6352` `createHostFirstCompletion` first, then the local runtime chain), and a DSH-hosted Bot with a configured DSH LLM pair and a connected plugin satisfies the first branch; this run had neither (the profile has no `dsh-llm.json`, `host-executor connected: 0`), so it fell through to the local chain and stopped there |
| Skill discovery (step 5) | `metabot metaweb search --protocols metabot-skill --newest` | `search_metaweb` / `read_metaweb_pin` tools (`metaweb-tools.ts`), same aggregation node | Yes |
| Learn / install skill (step 6) | `skills install --pin … --confirm`, `skills list`, `skills read` | `skill_tool` with `install_skill` / `list_installed_skills` / `read_skill` (`skill-tools.ts`, IDBots naming), which forward to exactly these verbs and ask the owner before installing | Yes — including the same rebind step; the `metaweb read` hint even names the DSH action |
| Knowledge base (step 7) | `knowledge-base create/add-document/learn/query/study` | `knowledge_base_list|query|add_document|learn` + `metaweb_study_enqueue|status|retry` tools, plus `kb/*` routes (`kb-routes.ts`, Bot editor Knowledge tab `KnowledgeTab.tsx`) and `memory/*` routes (`MemoryPanel.tsx`) | Yes — `kb/list` and `study/list` read in-process, writes forward to the same CLI verbs; the nightly study drain is the same store |
| Standalone UI (step 8) | `/ui/kb`, `/ui/surf`, `/ui/memory`, `/ui/schedule`, `/ui/settings`, `/browser` served by the daemon with `localUiUrl` envelopes | The plugin's React tabs mirror these pages; the plugin iframes `/browser`. The standalone pages are the new no-plugin equivalent | Yes — the pages that mirror the plugin panels exist standalone and render the same store data |
| Non-regression (step 9) | n/a | 488/488 plugin tests pass on `main` after the merge; zero plugin files in the merge | Yes |

## 5. Gaps and defects found

**D1 — installed-skill `description` is stored as the literal `"|"` for block-scalar frontmatter (real defect).**
- Repro: `metabot skills install --pin 09bfa810…i0 --confirm` (the `humanizer` package, whose
  `SKILL.md` frontmatter is `description: |` followed by an indented multi-line block), then
  `metabot skills list`. The registry entry reports `description: "|"`, and the formatted line reads
  `- **humanizer** (3.0.0) — | | by Builder阿码 …`.
- Root cause: `parseSkillFrontmatter` (`src/core/skills/skillInstall.ts:106`) parses frontmatter
  line-by-line as flat scalars; `description: |` yields the scalar `"|"`, and because
  `frontmatter.description ?? input.source?.payloadDescription` gives frontmatter precedence
  (`src/core/skills/skillInstall.ts:404`), the garbage value beats the correct description that the
  protocol pin payload already carried (the install preview displayed that correct text).
- Blast radius: any installed package whose frontmatter uses a YAML block scalar (`|` or `>`) — a
  common style, and the exact style used by this publisher. The description is what the model and
  the UI read to know what a skill does. `skillPublish` shares the same parser
  (`src/core/skills/skillPublish.ts:182`), so publishing such a skill would advertise `description: "|"`
  on-chain.
- Fix direction: unfold block scalars (`key: |` / `key: >` plus following more-indented lines) in
  `parseSkillFrontmatter`, and/or treat a value that is only a YAML indicator character as absent so
  the payload description is used instead. Add a regression test with a multi-line `description: |`
  SKILL.md.
- Evidence captured: `skills-install.json`, `skills-list.json`.

**D2 — standalone pages do not localize `document.title` (minor).**
- Repro: open `http://127.0.0.1:18777/ui/kb?from=<slug>` with the language preference set to
  `zh-CN` (localStorage `oac.localUi.languagePreference`). `<html lang>` becomes `zh-CN`, the `h1`
  and all copy become Chinese (`知识库`, `AI 冲浪`), but the tab title stays
  `Knowledge — Open Agent Connect` / `Surf — Open Agent Connect`.
- Cause: no code updates `document.title` for these pages. `src/ui/pages/kb/app.ts:8` (and the
  sibling pages) only pass `title: i18n.t('kb.title')` at definition-build time, and the only
  `document.title` write under `src/ui/` is in the unrelated `src/ui/metaapps/buzz/app/app.js:381`.
  The zh-CN dictionary entries already exist (`'kb.title': '知识库 — Open Agent Connect'`,
  `src/ui/i18n.ts:2549`), so this is a wiring gap, not missing copy.
- Impact: cosmetic (browser tab / bookmark label). Worth fixing while the KB/Surf/Memory/Schedule i18n
  coverage is still fresh; note `tests/ui/pageI18nCoverage.test.mjs` does not cover these four pages.

**D3 — `knowledge-base` subcommand help falls back to the parent help (minor).**
- Repro: `metabot knowledge-base add-document --help` (also `list`, `create`, `update`, `remove`)
  prints the parent `knowledge-base` usage instead of the subcommand's flags. `src/cli/commandHelp.ts`
  has entries only for `knowledge-base`, `knowledge-base study`, `knowledge-base query`, and
  `knowledge-base learn`; the undocumented verbs' real flags (`--content`/`--content-file`,
  `--source-type web|metaweb|manual`, `--pin-id`, `--autolearn on|off`, …) have to be read from source.
- Related usage note: the query verb's flag is `--text` (not `--query`), and `learn`/`query` carry
  `localUiUrl` while `study status` (same `/ui/kb` page) does not — a small consistency gap if the
  intent is that every KB-surface envelope can deep-link the page.
- Impact: discoverability only; no behavioural defect.

Reviewed and **not** defects: `nav.botPage` staying `"Bots"` in the zh-CN dictionary
(`src/ui/i18n.ts:1520`) matches the established terminology used everywhere else in the zh-CN copy
(`本地 Bots`, `还没有 Bot`). `metabot daemon` exposing only `start|stop|restart` (no `status`) is the
documented surface. The surf failure envelope itself is correct behaviour, not a defect.

## 6. What was NOT verified, and why

- **A completed surf run and its report.** Blocked at the LLM gate: no runtime is authenticated in an
  isolated `HOME`, and codex is additionally geo-blocked from this network. The surf step is recorded
  as degraded, with the fetch phase (150 pins) proven and the failure path proven. Faking a report via
  a stub LLM would have invalidated the acceptance.
- **Dreams / pre-dream surf.** Same LLM gate; not run at all. The pre-dream toggle and budget surfaces
  *were* exercised indirectly (initial `surf status` reports `surfBeforeDreamEnabled: false`,
  `interactionBudget: 20`).
- **The nightly study drain** (which would have LLM-read MetaWeb pins into the KB). Only
  `study enqueue`/`study status` were verified; the drain runs in the 00:00–06:00 window and needs the
  same LLM chain.
- **`knowledge-base study retry`** — not exercised (no failed job to retry).
- **The live DSH application.** Per instruction the DSH UI was not driven, modified, or restarted
  (`dsh web` untouched). DSH-side comparison is derived from `dsh-plugin/src`, the plugin's own test
  suite, and the shared CLI/daemon code paths the routes call.
- **Any second chain write.** Deliberately skipped: no buzz/simplenote/qanda/metaapp/skill publish,
  no KB `--source-type` write beyond local storage, no wallet transfer, no traffic grant claim, no
  service order, no profile edit. Consequently skill *publishing* (and therefore D1's publish-side
  effect) was not reproduced end-to-end.
- **Real wallet/chain read surfaces beyond the scenario** (wallet balances, trace, ratings, provider
  flows) — out of scope for this acceptance round.
- **Playwright against real browsers from the user's cache** — the browser binaries were read from
  `~/Library/Caches/ms-playwright`; no browser installation or cache write occurred.

## 7. Reproduction

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
SCRATCH=$(mktemp -d /tmp/oac-accept.XXXXXX); export HOME="$SCRATCH/home"; mkdir -p "$HOME"
export CODEX_HOME="$HOME/.codex" METABOT_DAEMON_PORT=18777
export METABOT_CLI_ENTRY="$PWD/dist/cli/main.js"
bash skillpacks/codex/install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot identity create --name "ParityAcceptanceBot" --host codex --json   # chain write
metabot daemon start --json && lsof -nP -iTCP:18777 -sTCP:LISTEN
metabot surf status --from parityacceptancebot --json
metabot surf run --from parityacceptancebot --trigger manual-ui --json
metabot metaweb search --query skill --protocols metabot-skill --newest --size 10 --json
metabot skills install --pin 09bfa810e7b7eafa26d152a1ba33f83684135d44173943d8690a892da2939bf3i0 --confirm --json
metabot knowledge-base create --name "MetaWeb Skills" --autolearn on --json
metabot knowledge-base add-document --title "humanizer" --content-file <material>.md --source-type metaweb --pin-id 09bfa810…i0 --json
metabot knowledge-base learn --json
metabot knowledge-base query --text "forced triads and dashes" --json
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:18777/ui/kb?from=parityacceptancebot"
cd dsh-plugin && pnpm test
```

Note: with an isolated `HOME`, steps 3–4 and dreams will degrade exactly as recorded here unless an
authenticated LLM runtime is present in that `HOME` (or a DSH host executor is connected).
