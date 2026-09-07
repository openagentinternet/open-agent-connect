# DSH MetaWeb On-chain Q&A Port (IDBots feat/metaweb-qa → OAC)

Port design for the on-chain Q&A feature family implemented in IDBots
`feat/metaweb-qa` (merged at IDBots `dfbb07de`, 13 commits) into OAC,
following OAC conventions (CLI-first core, thin DSH host wrappers,
file-backed storage, daemon-driven nightly jobs).

Source of truth on the IDBots side: `src/main/libs/postSimpleQaAgentTools.ts`,
`qaRecallAgentTools.ts`, `likePinAgentTools.ts`, `simpleQaAnswerLedger.ts`,
`qaBehaviorPrompt.ts`, `src/main/services/{qaRecallService,metawebStudyService}.ts`,
`src/main/metawebStudyJobStore.ts`, `src/main/services/botBrowserHostService.ts`,
`METAAPPs/qanda/`. The protocol spec `docs/metaid_protocols/08-qanda.md` is
already synced in this repo.

## What is being ported (IDBots → OAC mapping)

| IDBots piece | OAC landing | Adaptation |
|---|---|---|
| `post_simplequestion` / `post_simpleanswer` tools | `dsh-plugin/src/qa-tools.ts` (native tools) over new CLI `metabot qanda question\|answer --request-file` → daemon `/api/qanda/*` → core `src/core/qanda/publish.ts` | External-file approval gate follows the `post_simplenote` pattern (`confirmExternalUpload`); already-answered check moves into the daemon handler so CLI users get it too |
| `like_pin` tool (paylike) | same path, `metabot qanda like` | no upload, no gate |
| `qaRecallService` (so.metaid.io `/api/qa/*`) | `src/core/qanda/recall.ts` | env override reuses OAC's `METABOT_METAWEB_API_BASE_URL` (not IDBots' `IDBOTS_METAWEB_API_BASE_URL`) |
| `search_qa` / `list_latest_questions` / `get_question_answers` tools | `dsh-plugin/src/qa-tools.ts`, executing core in-process (metaweb-tools pattern) | tool result texts ported verbatim |
| kv answer ledger (SQLite) | `src/core/qanda/ledger.ts`, JSON file `<workspaceRoot>/memory/qanda-answer-ledger.json` keyed `<slug>:<questionPinId>` | storage-layout-v2 file backing (study-jobs.json precedent); same caps (50/question, 8000 chars) |
| `QA_BEHAVIOR_RULE` prompt section | `src/core/qanda/behaviorPrompt.ts`; plugin section `oac:qa-behavior` order 142.5; inlined into `src/core/grouptask/prompts.ts` chair prompt; one routing sentence appended to `oac:metaweb-worldview` | cowork-composer order 43.5 maps to the plugin's 142/143 neighborhood |
| recurring `qa-surf` study job | `src/core/knowledgebase/studyJobs.ts` gains `kind: 'topic'\|'qa-surf'`, `enqueueQaSurfJob`/`disableQaSurfJob`, recurring semantics (never completes on success, 400-pin stored cap, mid-run disable guard); daemon studyTimer wires the qa executor tools | prompt rebuilt for OAC's json-fence tool loop (one tool call per step) instead of IDBots' cowork skill turn; answers post through the in-process daemon handler (`handlers.qanda.answer`) with `from: slug` |
| `metaweb_qa_surf_enqueue` / `metaweb_qa_surf_disable` tools | `dsh-plugin/src/knowledgebase-tools.ts` next to `metaweb_study_enqueue`/`status`; `metaweb_study_status` labels qa-surf jobs `[recurring Q&A surfing]` | in-process core calls (existing pattern) |
| qanda bundled MetaApp viewer | `src/ui/metaapps/qanda/app/*` served by `src/daemon/routes/uiMetaApps.ts` at `/ui/qanda/` | API base reads the injected `window.__OAC_INFRASTRUCTURE__` (metaso endpoint) with `https://so.metaid.io` fallback; `?q=<pinId>` bootstrap added for the localUiUrl form |
| bot browser `pin://<questionPinId>` routing | `src/cli/runtime.ts` browser open/tab/link path rewrite: probe `qaQuestionDetail`, on hit rewrite to `/ui/qanda/app/index.html#q/<pinId>` | negative probes cached (LRU 500), positive probes re-fetch (fresh counts); ABC-side tab rendering keeps the generic pin reader (ABC package is out of repo) — the rewrite covers `browser open` / `browser link` / `browser tab open` localUiUrl results and everything built on them (plugin sidebar, tools) |
| unified search protocol filter | `src/core/metaweb/search.ts` `MetawebSearchProtocol` gains `simplequestion`, `simpleanswer` | additive |
| QA backend docs | copy `metaweb-qa-backend-requirements{,-v2}.md`, `metaweb-qa-frontend-metaapp-guide.md` into `docs/` | already English, IDBots-authored, indexer-side specs |

## Payload contracts (docs/metaid_protocols/08-qanda.md)

- simplequestion `/protocols/simplequestion` `1.0.0`: payload `{title}` required;
  `content`/`tags`/`contentType` (only when content present, default
  `text/markdown`)/`attachments` optional; empty optionals omitted; NO
  createTime.
- simpleanswer `/protocols/simpleanswer` `1.0.0`: `{answerTo, content}` required;
  `contentType` only when the caller passes it (no default — IDBots parity);
  rest as above.
- paylike `/protocols/paylike` `1.0.0`: `{isLike: 1|-1|0, likeTo}` exactly.
- All writes `operation: 'create'`, `encryption: '0'`, `contentType:
  'application/json'`; DOGE writes upload files on MVC.

## Already-answered flow (post_simpleanswer)

Before spending sats: merge prior answers from (a) the on-chain Q&A index
(`qaQuestionAnswers` with the acting bot's globalMetaId as publisher —
authoritative across machines; `QaRecallNotFoundError` counts as
empty-but-authoritative) and (b) the local ledger (outage/fresh-pin fallback),
dedup by answerPinId. Non-empty + `allow_repeat !== true` → publish nothing,
return `formatAlreadyAnsweredNotice` (non-error). Else publish, record ledger
entry, return the success sheet with the `answer #N` note.

## qa-surf job semantics (IDBots parity)

- One ACTIVE qa-surf job per bot (`findActiveQaSurf`); re-enqueue is a no-op
  returning the existing row; disable marks done with the owner note; after
  `failed` a re-enqueue creates a fresh row.
- Defaults: budget 10 pins/night (clamp 1–50, “questions answered + pins
  saved”), tick 30 min inside local 00:00–06:00 (shared with the study drain).
- Success always returns the row to `pending` (recurring; quiet nights and the
  topic run-cap do not apply); stored handled list capped at 400 (prompt shows
  the last 80); failures follow the 3-strike rule.
- Mid-run disable guard: bookkeeping must not resurrect a row the owner
  disabled while the session was in flight.
- Executor allowlist `QA_SURF_TOOL_ALLOWLIST` = study set +
  `search_qa, list_latest_questions, get_question_answers, post_simpleanswer,
  like_pin`; `post_simplequestion` deliberately absent (surfing answers and
  learns, never asks). KB saves stay budget-capped by the executor seam.

## Phase plan

1. Core: `src/core/qanda/{publish,recall,ledger,behaviorPrompt,format}.ts` + unit tests.
2. Daemon + CLI: `qanda` handlers, `/api/qanda/*` route, `metabot qanda *`
   verbs, help entries.
3. Plugin tools: `qa-tools.ts` (`post_simplequestion`, `post_simpleanswer`,
   `like_pin`, `search_qa`, `list_latest_questions`, `get_question_answers`),
   `oac:qa-behavior` section, worldview sentence, bind call + tests.
4. qa-surf: studyJobs `kind` + store/prompt/allowlist/tick changes, daemon
   executor wiring, `metaweb_qa_surf_{enqueue,disable}` plugin tools,
   `metaweb_study_status` recurring label + tests.
5. Viewer + routing + prompts: bundled qanda app, uiMetaApps entry, browser
   question-pin rewrite, search protocol keys, group-task prompt injection.
6. Docs: copy the three IDBots QA docs, dsh-plugin README section,
   `docs/hosts/dsh.md` tool list touch-up.

## Out of scope

- R5/R6 indexer endpoints (comment threads, author answer listing) — the
  requirements docs land in `docs/` for reference; no client of them yet.
- skillservice-style qanda service publishing; ABC-package-internal question
  page rendering; owner-binding UI changes.
