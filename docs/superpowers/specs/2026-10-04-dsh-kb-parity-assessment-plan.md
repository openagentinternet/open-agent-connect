# DSH Knowledge Base — IDBots Parity Assessment Plan

Date: 2026-10-04
Branch: `feat/dsh-kb-parity-2026-10-04`
Reference implementation: IDBots (`/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots`)

> **Decisions resolved (2026-10-04, owner).** (1) Study budget default aligns
> to IDBots: 50. (2) The manual study-run trigger ships as
> `metabot knowledge-base study run [--wait]` + the `metaweb_study_run` chat
> tool + a `/ui/kb` Run-now button, executing in the daemon with the window
> ignored. (3) The content gate stays as OAC has it (tools always mounted;
> honest empty results). (4) `kb/import` caps at 100 MB per file and
> same-name imports get IDBots-style `-2`/`-3` suffixes.
>
> **Phase 1 + 2 landed on this branch** (same day): P1-1 local-date stamp,
> P1-2 crash recovery before the window gate (plus the in-flight registry so
> sweeps never touch runs executing in-process), P1-3 real PDF/DOCX fixture
> tests, `learnSummary.failed` end-to-end (core → CLI → tools → Knowledge
> tab → /ui/kb), import suffixing + imported/skipped reporting, the 100 MB
> import cap, budget default 50, and the dead budget-counter removal.

## Goal

Step 1 of the knowledge-base (KB) roadmap: bring OAC's KB feature to the same
completeness as IDBots' 知识库, and make every KB feature verifiably work as
designed — including the flows that were never exercised end-to-end (nightly
topic study, the 19 import formats, learn/import/edit flows, surf→KB saves).

CLI-first rule applies: every fix lands in the OAC core (`src/`) first so the
`metabot` CLI, the daemon, codex/claude-code hosts, and the DSH plugin all
benefit; the DSH plugin half only consumes the core.

## Architecture snapshot (as verified in code)

The OAC KB is a faithful file-storage port of IDBots' SQLite/FTS5 design:

| Concern | IDBots | OAC |
|---|---|---|
| Registry | `knowledge_bases` SQLite table (`src/main/knowledgeBaseStore.ts`) | `memory/knowledge-bases.json` per profile (`src/core/knowledgebase/store.ts`) |
| Index | per-KB `kb.sqlite` FTS5 (`knowledgeBaseIndexStore.ts`) | per-KB `index.json` inverted index + own BM25 (`indexStore.ts`) |
| Tokenizer | latin words + CJK unigrams+bigrams | same, bigrams-only precision queries (`text.ts`) |
| Chunking | 1200 chars / 180 overlap, paragraph-preferring | identical |
| Scoring | `0.85·BM25 + 0.15·phrase`, minScore 0.18, topK 8 | same formula and defaults (`indexStore.ts`) |
| Formats | 19 extensions, pure-JS converters (`knowledgeBaseConverters.ts`) | same 19, same converter libs (`converters.ts`) |
| Study jobs | `metaweb_study_jobs` table, window [0,6) local, 30-min tick, budget cap 50, run cap 10, 3-strikes, crash recovery | `study-jobs.json`, same window/tick/caps, **budget default 20** (`studyJobs.ts`) |
| Tools | `knowledge_base_list/query/add_document/learn`, `metaweb_study_enqueue/status` | same names + `metaweb_study_retry`, plus surf allowlist integration |
| Prompt | `<knowledge_bases>` volatile block, top 5 | same (`promptBlocks.ts`, injected via `memoryService.ts`) |
| UI | `KnowledgeBasePanel.tsx` bot-editor tab | DSH Bots-page `KnowledgeTab.tsx` + OAC `/ui/kb` page |
| Learn status events | `knowledgeBase:learnStatus` running/done/error + `summary.failed` surfaced in UI | none — learn result is `{added,updated,removed}` only |

OAC-only additions worth keeping: CLI verbs (`metabot knowledge-base *`),
daemon HTTP `/api/kb/*`, the `/ui/kb` human page with a query tester, surf
integration (`SURF_KB_ADD_BUDGET = 40` with executor-side enforcement), and
memory-layer triage (`knowledge_recall`/`knowledge_upsert` knowledge points vs
document KB — deliberately two systems, mirroring IDBots).

## Parity checklist (IDBots capability → OAC status)

Legend: ✅ = present and equivalent; 🟡 = present with a delta (listed in
Defects); ❌ = missing.

| # | IDBots capability | OAC status |
|---|---|---|
| 1 | Per-bot auto-created default KB, non-deletable | ✅ |
| 2 | Create KB (name+description required, optional external raw dir + picker) | ✅ (`kb/browse-dir`, `--raw-dir`) |
| 3 | Edit name/description inline | ✅ |
| 4 | Delete KB with confirm, managed dirs only | ✅ |
| 5 | Import files, 19 extensions, collision suffixing `-2/-3`, imported/skipped counts | 🟡 same-name import **silently overwrites** (`service.ts` `importFiles`); DSH `kb/import` has no size cap, no content sniff; import result is a bare count |
| 6 | Learn now (incremental) | ✅ (CLI `learn`, DSH tab, `/ui/kb`; DSH route 300 s timeout) |
| 7 | Full rebuild (advanced, confirm) | ✅ |
| 8 | Auto-learn toggle, nightly [0,6) local, once/day | 🟡 works but **stamps UTC date vs local-date compare** → in UTC+ zones re-learns up to 12×/night and `lastAutoLearnDate` is always stale |
| 9 | Stats display (docs/chunks/last-learned) | ✅ |
| 10 | Open raw directory in OS file manager | ✅ (`kb/open-dir`) |
| 11 | Learn notices incl. **failed-file list** (first file + reason, error styling) | ❌ `learnSummary = {added,updated,removed}` only — per-file failures invisible to UI and tools |
| 12 | `<knowledge_bases>` per-turn prompt block (top 5) | ✅ (+ lazy default-KB ensure) |
| 13 | `knowledge_base_list` | ✅ |
| 14 | `knowledge_base_query` (scope, topK 1–50, minScore, citations, honest miss) | ✅ |
| 15 | `knowledge_base_add_document` (SimpleNote JSON, provenance, ledger back-fill, instant index) | ✅ |
| 16 | `knowledge_base_learn` (incremental/full, counts) | 🟡 works; no failed-file reporting (see #11) |
| 17 | Content gate: query/list mount only once content exists | ❌ (OAC always mounts; harmless, decide keep-or-align) |
| 18 | Study enqueue via chat, topic dedupe, budget | 🟡 present; **default budget 20 vs IDBots 50** |
| 19 | Nightly study runs (search→read→save→learn→JSON report, multi-night, run cap 10, 3-strikes) | ✅ structurally; two lifecycle bugs below |
| 20 | `metaweb_study_status` ("what have you been learning") | ✅ (failed-first grouping) |
| 21 | Read-only study job panel with stats | ✅ (DSH Knowledge tab; `/ui/kb` adds enqueue+retry) |
| 22 | Memory-policy gating for KB/study tools and study runs | 🟡 availability toggle skips profiles; no memory-policy gate on study eligibility (decide) |
| 23 | Study session tool allowlist | ✅ (`STUDY_TOOL_ALLOWLIST`, `post_simplequestion` deliberately absent) |
| 24 | Index self-heal on corruption + explicit error when unrecoverable | 🟡 corrupt JSON → silent empty index → silent full rebuild next learn; never surfaced |
| 25 | Surf KB saves share hard budget | ✅ (40/run, executor-enforced, tested) |

## Confirmed defects (verified in code this round)

### P1 — correctness

1. **Auto-learn date stamp mismatch (UTC vs local).**
   `src/cli/runtime.ts:7552` stamps `new Date().toISOString().slice(0,10)`
   (UTC) while `store.listDueForAutoLearn` (`store.ts:238-247`) compares the
   **local** date. In any UTC+ timezone the whole 00:00–06:00 window precedes
   the UTC rollover, so the stamp never equals "today": every 30-min tick
   re-learns (≤12 wasted incremental learns/KB/night) and `lastAutoLearnDate`
   always shows yesterday. Fix: stamp the local date (same formatter as
   `listDueForAutoLearn`); add a timezone-matrix regression test.

2. **Study crash recovery blocked outside the window.**
   `runStudyTick` (`studyJobs.ts:566-567`) returns before
   `resetRunningToPending` when `!inStudyWindow`. A run killed by a daemon
   restart mid-night shows `running` until the next night's first tick (~18 h
   of wrong status). Fix: run crash recovery before the window gate; test both
   orderings.

3. **PDF extraction has zero happy-path test coverage.**
   `tests/knowledgebase/converters.test.mjs` asserts the 19-extension list and
   a broken-`.pdf` rejection, but never extracts a real PDF — the highest-risk
   converter (`pdfjs-dist/legacy`, fonts, scanned-image failure path). IDBots
   ships real per-format fixtures (`tests/knowledgeBaseText.test.mjs`). Fix:
   port small committed fixtures (pdf/docx/pptx/xlsx/epub) and assert
   extracted text for each; assert the typed scanned-PDF error.

### P2 — parity gaps

4. **No failed-file reporting in learn results** (checklist #11). Add
   `learnSummary.failed: {file, reason}[]` in the core learn path, surface it
   in: CLI `learn` output, `knowledge_base_learn` tool output, DSH Knowledge
   tab notice, `/ui/kb` learn summary. This is IDBots'
   `knowledgeBasePresentation` behavior and the single biggest observability
   gap: today a corpus of unreadable PDFs learns "successfully" with 0 docs.

5. **Import filename collisions overwrite silently.**
   `importFiles` (`service.ts:214-229`) copies to `path.basename(filePath)`;
   a second import of `notes.md` replaces the first corpus file. IDBots
   suffixes `-2/-3` and reports imported/skipped counts. Align: suffix dedupe
   + return `{imported, skipped}` and surface it in the DSH tab notice.

6. **`kb/import` route hardening** (`dsh-plugin/src/kb-routes.ts:279-309`): add
   a per-file size cap (suggest 100 MB, matching a stated constant, clear
   error), reject before buffering; decide same-name policy per #5. (No cap is
   also IDBots behavior, so parity strictly doesn't require it — recommended
   anyway because the DSH host is a long-lived process.)

7. **Study budget default 20 vs IDBots 50** (`DEFAULT_STUDY_PIN_BUDGET_PER_NIGHT`,
   `studyJobs.ts:14`). Decide: align to 50 or keep 20 (cheaper nights). Also
   remove the dead `budget.savedDocs` counter in `runStudyTurnWithTools`
   (`studyJobs.ts:739,758`) — enforcement lives in the runtime closure
   (`runtime.ts:7628-7641`), the field is written and never read.

8. **Content gate + memory gating (checklist #17/#22)** — decide: (a) keep
   OAC's always-mounted tools (simpler; empty-corpus queries already return an
   honest empty) or (b) align with IDBots' gates. Recommendation: keep
   always-mounted (OAC's honest-empty behavior covers the intent), but gate
   study eligibility on the bot's memory policy like IDBots (loud job failure
   instead of a silently useless night).

### P3 — robustness / hygiene

9. **Cross-process learn serialization.** Daemon builds a fresh KB service per
   call (`kbHandlers.ts`), DSH plugin memoizes per profile, CLI is a third
   instance; the learn queue is per-instance and the registry is an unlocked
   read-modify-write JSON file. Atomic renames make corruption unlikely but
   interleaved incremental rebuilds can lose an add that lands mid-rebuild.
   Fix: per-KB lock file (or single daemon-owned service per bot profile).
10. **`addDocument` → full incremental walk per save.** The study/surf loops
    call addDocument then `learnKnowledgeBase` after every pin
    (`runtime.ts:7643`): O(saves × files) each night. Fix: short-circuit the
    rebuild to just the new inbox file (the only change), or debounce learn to
    end-of-run.
11. **Stale chunks on re-extraction failure** (`indexStore.ts:255-258`): a file
    that turns unreadable keeps its old chunks silently. With #4 in place,
    record it in `learnSummary.failed` and decide keep-vs-drop policy
    (IDBots keeps going and reports; recommend the same).
12. **Slug duality in daemon KB handlers** (`kbHandlers.ts`): study verbs use
    `bot.slug` while KB verbs use `basename(profileRoot)`; with no Twin and no
    `--from`, `effectiveSlug='default'` and the two can disagree. Single
    resolver.
13. **Serial per-profile study drain** can let one bot's 12×30-min turns
    consume the whole window and starve later profiles. Document the limit;
    consider a per-run wall-clock budget or round-robin across profiles
    (design note, not necessarily this round).

## Verification plan (how we prove "works as designed")

**Layer A — deterministic engine tests** (`tests/knowledgebase/`, fast tier):
- A1 real-fixture converter tests for pdf/docx/pptx/xlsx/epub (P1-3).
- A2 auto-learn due/stamp timezone matrix incl. UTC+8 (P1-1).
- A3 study-tick crash-recovery ordering (P1-2).
- A4 import collision suffixing + skipped reporting (P2-5).
- A5 `learnSummary.failed` propagation through service → CLI → tool (P2-4).
- A6 corrupt index/registry self-heal behavior surfaced, not silent (P3-11).

**Layer B — CLI end-to-end on a temp profile** (`tests/cli/knowledge-base.test.mjs`
extension; `mkdtempTempRoot`):
- B1 full verb roundtrip: create → add-document → learn → query (CJK + latin
  queries, empty-corpus honest miss) → update → list → remove --confirm.
- B2 one file per supported format imported via `--raw-dir`+learn, then a
  targeted query per file asserting hit + snippet (this is the executable form
  of the "19 formats" claim).

**Layer C — daemon + DSH plugin tests** (extend existing
`tests/daemon/kbRoutes.test.mjs`, plugin kb tests):
- C1 `/api/kb/*` verb matrix incl. study status/retry.
- C2 plugin `knowledge_base_*` tools: add→instantly queryable, learn full,
  `indexed:false` hint, study enqueue via fallback (Twin) resolution.

**Layer D — nightly study, without waiting for midnight** (the never-tested
flow, made testable):
- D1 unit/integration drain with an injected clock inside the window: enqueue
  topic → fake search/read tools → assert KB documents with metaweb
  provenance, budget enforcement, JSON report parsing, multi-night
  continuation, 3-strikes failure, retry. (Much of the loop already has tests;
  add the end-to-end drain against a temp profile with a stubbed LLM.)
- D2 live observation checklist (user-driven, respects the restart etiquette):
  say 「有空学学 <topic>」 in a DSH chat → confirm the tool result; after the
  next nightly window check `study status` + the Knowledge tab panel + KB docs
  landed. Optionally: a CLI `study run --job-id` manual-trigger verb (new,
  CLI-first; makes the whole nightly path exercisable in daylight — flag for
  user decision).

**Layer E — surf→KB live check**: `metabot surf run --wait` on a bot with the
KB budget; assert `savedToKb` stats and that saved pins appear as KB docs
already covered by unit tests; live run once during verification.

## Execution phases (each = scoped verify + closeout on this branch; merge
--no-ff to main when the fix rounds complete, keep branch/worktree alive after)

- **Phase 1 (P1 correctness):** fixes 1–3 + A1–A3 tests.
- **Phase 2 (parity gaps):** fixes 4–8 + A4–A5 + UI surfaces (Knowledge tab,
  /ui/kb, tool outputs, locale strings en/zh).
- **Phase 3 (robustness):** fixes 9–12 as scoped; #13 as a design note only.
- **Phase 4 (live verification):** Layer D2/E checklist run with the user
  against the live `dsh web` (user restarts DSH/daemon per etiquette), then a
  closing defect report.

## Open decisions for the owner

1. Study budget default: align to IDBots' 50 or keep 20? (recommend keep 20,
   it is surfaced and adjustable per job; parity here is nominal)
2. Manual `metabot knowledge-base study run` verb for daylight testing?
   (recommend yes — small, CLI-first, unlocks Layer D2)
3. Content gate (#17): keep always-mounted tools (recommended) or mirror
   IDBots?
4. `kb/import` size cap value (recommend 100 MB) and same-name policy
   (recommend IDBots-style suffix dedupe).
