# IDBots → OAC Parity Port Plan

Date: 2026-08-24 · Branch: `dsh-idbots-port` · Source baseline: IDBots `main` @ `012557f6` (v0.5.4)

## Goal

Port the stable IDBots feature set into Open Agent Connect so that DSH users who
install the OAC plugin get feature parity with the IDBots desktop app:

1. **Group tasks** (群任务) — including the Aug 22–24 staffing pipeline and
   **OpenTeam** remote membership, with wire-level interoperability: an OAC-side
   Bot and an IDBots-side Bot must be able to join the same group task and
   collaborate.
2. **MetaWeb search / read** (`search_metaweb`, `read_metaweb_pin`).
3. **SimpleNote publishing** (`post_simplenote`) with the chain-upload approval
   gate.
4. **Knowledge base + learning** (per-bot corpora with FTS5, procedure memory,
   autonomous study jobs).

**CLI-first rule**: every capability lands in the `metabot` CLI / daemon core
(`src/core/*`, daemon routes, CLI verbs) so it is reusable from Codex, Claude
Code, and other hosts. The DSH plugin only adds host routes, native tools,
Settings/conversation UI, and en/zh i18n.

**Out of scope**: IDBots Composer UI changes (DSH ships its own better
composer), `/goal` and `/export` session commands (DSH-native equivalents
exist), anything Electron-renderer-specific.

## Guiding rules

- **Wire compatibility with IDBots.** Group-task traffic rides the same MetaID
  protocols (`/protocols/simplegroupcreate|join|chat|removeuser`, encrypted
  simplemsg, idchat presence) and the same bracket-tag grammar
  (`[DELIVERABLE]`, `[STATUS:…]`, `[WORKING]`, `[STANDBY]`,
  `[DEPENDS_ON:<pinId>]`, `[CHECKPOINT…]`, `[PLAN_CHANGE]`, `[FREEZE]`,
  `[OPENTEAM_*]` envelopes). Nothing OAC-proprietary on the wire.
- **Storage follows layout v2** (`docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`):
  primary state as JSON in the workspace layer; derived SQLite is permitted in
  the runtime layer (`runtime.sqlite` precedent, lazily created).
- Each phase = scoped commits + scoped verification (build + targeted
  `node --test` files; fast tier when core is touched) + `--no-ff` merge to
  `main` + `eric` buzz per round. Phases 3–5 are independent of the
  group-task track and may interleave.

## Current state (audit, 2026-08-24)

**The previous group-task port is already on `main` and code-complete on every
layer** (merge `1e9c2c34`: core store/transport/engine/OpenTeam, CLI verbs,
daemon routes + handlers, engine auto-start in the daemon, dsh-plugin host
routes, dual-tab UI with full en/zh i18n, fast-tier unit tests). Later merges
did not touch it. "It doesn't run" is operational, not missing code. Top
culprits found:

| # | Culprit | Evidence |
|---|---|---|
| 1 | Stale daemon: `daemonConfigMatchesContext` hashes only env config, not the CLI build, so a pre-merge daemon keeps serving without `/api/grouptask/*` (404) and without the engine | `src/cli/runtime.ts:1202-1210` |
| 2 | `dsh-plugin/src/cli-bridge.ts:60-66` prefers an npm-installed `open-agent-connect` over the sibling repo `dist/`; an old npm install ⇒ `metabot: unknown subcommand grouptask` | `dsh-plugin/src/cli-bridge.ts` |
| 3 | Every panel read spawns a CLI subprocess (60 s timeout); memory panels got an in-process fast path (`local-read.ts`) but grouptask never did | `dsh-plugin/src/grouptask.ts:14-16` |
| 4 | Engine turns require a per-profile LLM runtime; without one the chair planning turn fails 3× and tasks stall in `planning` | `src/cli/runtime.ts:4990-5018`, `engine.ts` `PLAN_ATTEMPTS_MAX` |
| 5 | Identity prerequisites: chair resolves to the twin Bot (now the machine-wide default), owner identity needed for owner-join / as-owner posts | `service.ts:273-287, 252-266` |
| 6 | OpenTeam envelope intake silently dead when the a2a simplemsg listener is disabled (`daemonConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled`) | `src/cli/runtime.ts:4947-4950` |

**IDBots delta not yet in OAC** (Aug 22–24, all on IDBots `main`):

- Staffing pipeline: seat roles (content/design/engineering/promotion/domain,
  cap 8), staffing proposals with owner gate + 24 h TTL + CAS claim/release,
  skip-confirm detection with interrogative filter, owner-reply classification
  with last-intent-wins, candidate search merging local workers + production
  bot search (`so.metaid.io/api/bots/search`) + impression verdicts
  (boost/demote/block) with local-tie-break, `list_online_bots` presence.
- Engine additions: deliverable parse + verification retries, deterministic
  acceptance summaries (review entry / close), HITL checkpoints, plan changes,
  `[DEPENDS_ON]` bounded hold, `[WORKING]`/auto-ACK, attribution enrichment
  with SUSPECT marking, review→executing reopen, kick moderation notice.
- OpenTeam guest side: metafile deliverable upload, on-chain membership
  self-check (2-strike absence).
- Orchestration bridge onto canonical tasks/steps/attempts.
- Dream `collaborationFacts` + impression sedimentation on close/kick/deliverable
  verdict (feeds future staffing searches).

**OAC lacks entirely**: MetaWeb search/read, `post_simplenote` + upload gate,
knowledge base stack, procedure memory, study jobs.

## Phases

### Phase 0 — Make the shipped group-task port actually run ✅ (2026-08-24)

Outcome (evidence-first: live diagnosis before changes): the ported code was
code-complete and, on a current build + restarted daemon, **runs end to end
in the live DSH environment** — including full cross-client OpenTeam interop
with an IDBots-side Bot (invite → remote join with its own wallet → guest
@-mention LLM reply → review → close with rating). The original "it doesn't
run" was: (a) OpenTeam invites sent before the port existed / while no
engine was alive, silently expiring on first sight (600 s TTL), and (b) zero
diagnostic surface for silent prerequisites (missing owner identity, no twin,
listener off, missing LLM runtime). The dist-fingerprint daemon restart
already existed (since April), and the live plugin/CLI resolution was
correct (link mount, no npm copy shadowing).

Rounds landed:

- **A** plan doc (`57c75b59`).
- **B** engine + OpenTeam failures land in a size-capped rotating log
  `<system>/runtime/logs/grouptask-engine.log`; guest-invite declines log
  inviteId/reason + expiry lag (`8fb24e41`). Item 1 above was resolved by
  diagnosis (no code needed); item 4 by reading the default (`simplemsgListenerEnabled`
  already defaults true).
- **C** `metabot grouptask health` verb end to end (core/daemon/CLI/host) +
  status banner in `GroupTaskView` with en/zh copy (`c668b3f0`).
- **D** in-process grouptask reads (list/detail/messages/collabs) with CLI
  fallback; hermetic route tests (`3dd39e21`).
- **E** live verification: task #1 create/planning/close; task #5
  cross-client OpenTeam loop with IDBots 小明同学 (closed done, rating 5);
  offline-remote invite (BOT-007, another machine) correctly
  `invite_response_timeout`. Engine log stayed empty (failures only).
- **F** this documentation: README section, retroactive design spec
  (`docs/superpowers/specs/2026-08-24-dsh-grouptask-port-design.md`).
  Item 5 (daemon-level integration test) remains open — the live E2E pass
  covered the same path manually; revisit if CI coverage is needed.

### Phase 1 — Staffing pipeline (wish → slate → owner gate → staffed task)

Port into `src/core/grouptask/`:

- Staffing proposal **store** (JSON, workspace layer) with CAS
  claim/release, TTL, consumed/skip-authorized states.
- **Pure staffing module** ported near-verbatim for behavior parity:
  `normalizeStaffingPlan`, `validateStaffingPlan`, seat roles + caps,
  `detectSkipConfirmInWish` (+ interrogative filter), owner-reply
  classification patterns (keep-roster / revise / confirm / skip), last-intent
  gate, slate text builder.
- **Candidate search**: local twin workers + production bot search
  (`POST so.metaid.io/api/bots/search`) + OAC impression-store verdicts +
  online-presence source (network bots online). Match-first ranking with
  local tie-break margin; remote-search failure degrades to local-only.
- **Service**: `proposeStaffing` → owner gate → `createGroupTask` requires an
  unconsumed, unexpired, CAS-claimed proposal; `pendingRemoteSeats` returned
  for OpenTeam invites.
- CLI verbs (`propose-staffing`, `search-candidates`, gated `create`),
  daemon routes, dsh host routes.
- **DSH UI**: staffing slate card in `GroupTaskView` with explicit
  confirm / revise / skip actions and candidate match reasons. (The chat-reply
  classifier is still ported — it drives CLI-originated flows and tests; the
  DSH primary surface is the explicit card.)
- Dream prompt `collaborationFacts` + impression sedimentation on close/kick/
  deliverable verdict.

**Exit**: behavior-matrix tests mirroring the IDBots staffing suites
(skip/revise/confirm/keep-roster/last-intent/TTL/CAS).

### Phase 1 — Staffing pipeline ✅ (2026-08-24)

Rounds landed (each commit + eric buzz):

- **G** pure staffing module verbatim port (`43be2564`): seat roles/caps,
  plan validation, skip-confirm + interrogative filter, owner-reply
  classification, last-intent gate, session split, 24 h TTL, slate builder.
  Adaptation: local seats carry `candidateSlug`; remote keep GlobalMetaId.
- **H** proposal store + service (`8d0f5d71`): JSON store with CAS
  claim/release/markCreated, TTL at read time; propose / recordOwnerDecision
  / evaluateOwnerGate (explicit decision > chat-reply last-intent >
  persisted skip) / createGroupTaskFromProposal (gate → cap → claim →
  create; release on chain failure; pendingRemoteSeats for OpenTeam).
- **I** candidate search (`46c26bd5`): metaso-p2p bot-search client, CJK
  tokenization + fuzzy scoring, per-seat query seeds, impression verdicts
  (boost +4 / demote −8 / block), match-first merge with LOCAL_TIE_MARGIN=4,
  degrade-to-local on presence down.
- **J** CLI + daemon surface (`32c14b82`): `metabot grouptask staffing
  propose|list|decide|create|search`, `/api/grouptask/staffing/*` routes,
  real profile data feed (bio/role/goal/allowChatSkills, twin observer,
  per-twin impression snapshots).
- **K** DSH slate card (`1af617cd`): staffing card above the task list with
  Confirm/Revise/Skip and Create actions; host routes; en/zh copy.
- **L** impression sedimentation (this round): collaboration-facts ledger in
  the chair's impressions file, merged into snapshots (fact-only snapshots
  supported), recorded on task close (done/cancelled) and kick (kicked) with
  the staffing seat role resolved from the creating proposal; search
  verdicts read them back.

Live verification (2026-08-24, real daemon + chain): seat search ranked
local workers; propose → zh slate; decide confirm; gated create → task #15
with Paul Graham joined on-chain; close done rating 5; fact sedimented;
re-search shows **boost +4** (`prior done on "Staffing pipeline live
test"`). Dream-side collaborationFacts emission deferred to Phase 2
(dream-prompt schema addition rides the engine-parity round).

### Phase 2 — Engine behavior parity with IDBots daemon

Diff-driven port of the missing engine machinery (OAC already has: tags, review
ceremony, stall, driver mutex, cooldowns/budgets):

- Deliverables: parse + verification with retry loop.
- Acceptance summaries (deterministic, immutable snapshots) at review entry
  and close; owner private report.
- Checkpoints (HITL open/resolve/cancel) with human-gate responder silencing.
- Plan changes, `[DEPENDS_ON]` bounded hold, `[WORKING]`/`[STANDBY]` +
  host auto-ACK, attribution enrichment + SUSPECT marking, review reopen
  path, kick moderation notice.
- OpenTeam guest: metafile deliverable upload, membership self-check cadence.
- Orchestration bridge onto OAC's twin orchestration store (canonical
  tasks/steps/attempts per worker turn).
- **Worker skill turns (design note)**: IDBots runs worker turns through its
  in-process CoworkRunner + DSH runtime subprocess. The OAC daemon has no DSH
  runtime and must not grow one; v1 keeps plain LLM turns with richer prompts
  and memory injection. A tool-enabled unattended-turn substrate (needed here
  and by Phase 5 study jobs) is a separate design spike: a bounded function
  calling loop over daemon-side service calls, no host involvement.

**Exit**: engine behavior-matrix tests mirroring the IDBots daemon suites
(gating, tags, budgets, ACK ordering, dependency gate, review silence).

### Phase 2 — Engine behavior parity ✅ (2026-08-24)

Guided by a function-level diff against the IDBots daemon (13 dimensions),
rounds M–S landed the gap items in dependency order:

- **M** (`18b2ef15`) dream `collaborationFacts` schema + snapshot merge;
  `[DEPENDS_ON]` 15-min bounded hold; poison-message tag-only reprocess.
- **N** (`d8dbc1ef`) per-(msgPin,uri,kind) deliverable dedupe + correction
  supersede (reopen + verification reset).
- **O** (`8dd47a15`) deliverable verification pipeline: metaso pin check,
  ingest-time verify + 10-min re-verify, T2 accepted flip on close.
- **P** (`6f649837`) review-entry package: verification labels
  (on-chain ✓/pending sync/unverified), preview caps, checklist + omissions,
  LLM owner private report with 【结论】 capture + stamped conclusion,
  straggler closing re-assert.
- **Q** (`cc09a97a`) assignment ACK watch (P5 exemptions, ack-seen,
  expected-delivery ETA) + 3-min reminder + 30-min unreachable + 20/10-min
  timeout escalation with the L3 owner brief.
- **R** (`12a2c439`) checkpoint owner report + pause-line decision clause;
  guest membership self-check (5-min probe, 15-min grace, 2-strike);
  guest failure bound aligned to 3.
- **S** (`e78726b8`) metafile upload seam (uploadLocalFileToChain default):
  inviter-side local-path row upgrade to metafile://, guest file delivery
  ([DELIVERABLE] metafile lines, max 3/turn).

Live verification (task #27, real daemon + chain): worker pin-backed
deliverable → verified delivered+confirmed → [WORKING] ACK → review entry
with summary v1 + conclusion → close done rating 5 → deliverable accepted +
impression fact sedimented. Two bugs found and fixed during verification:
bare pin ids misread as local upload paths, and a live-debugging session
exposed orphan-daemon restart storms (multiple unrecorded `daemon serve`
processes holding driver claims with stale builds — killed; tick-duration
instrumentation added so slow/hung ticks are visible in the engine log).
Not ported by design: worker skill turns + orchestration bookkeeping
(OAC keeps plain LLM turns), twin-chair suppression window, host auto-ACK
before long turns.

### Phase 3 — MetaWeb search / read (M1)

- `src/core/metaweb/`: search service + pin-read service (HTTPS to
  `so.metaid.io`, env-overridable base URL, 10 s timeout mapped to
  model-readable retry text) + the MetaWeb URI/citation lib (`pin://`,
  `metaapp://`, `metafile://`; never Web2 viewer URLs).
- CLI `metabot metaweb search|read` + daemon routes.
- DSH: native tools `search_metaweb` / `read_metaweb_pin` on `oac-*` agents
  (in-process), the worldview prompt section (search-first, cross-language
  retry, untrusted-content guard, protocol follow-up hints), clickable
  MetaWeb URIs in chat (extend the existing `metaapp://` link handling).
- Codex/other hosts: skillpack skill wrapping the CLI verbs.

### Phase 4 — `post_simplenote` + chain-upload gate

- `src/core/` SimpleNote pin builder (protocol `1.0.1` payload, verified
  shape) over the existing chain-write + metafile upload paths; MVC/DOGE
  network selection with files uploaded on MVC regardless.
- CLI `metabot simplenote post`; DSH native tool `post_simplenote`.
- Approval gate: port `chainUploadGate` (symlink-aware workspace containment,
  `metafile://` pass-through) with DSH `ctx.approval` as the confirm surface;
  timeout/decline = not approved.

### Phase 5 — Knowledge base + learning (M2–M4)

- **Storage**: raw corpus in the workspace layer
  (`knowledge-bases/<kbId>/raw/…`), derived per-KB FTS5 index in the runtime
  layer (SQLite allowed there; `node:sqlite` with graceful LIKE fallback).
- Port the text lib (CJK bigram tokenizer, paragraph-preferring chunker,
  SimpleNote-JSON unwrap), registry store, learn/query service (incremental
  by sha256, bm25 + phrase ranking, corrupt-index self-heal), agent tools
  (`knowledge_base_list/query/add_document/learn`), volatile prompt block.
- **Procedure memory (M3)**: procedure store (JSON, title-fingerprint dedupe,
  version bump), `procedure_recall/save/archive` tools + hot prompt block,
  use-count tracking.
- **Study jobs (M4)**: job store + nightly drain window in the daemon;
  unattended study turns over the Phase-2 spike substrate (tool allowlist,
  pin-budget wrapper, last-JSON-fence report parsing, consecutive-failure
  cutoff).
- DSH UI: corpus tab in Settings → Memory, study-jobs status panel.

## Key source references

IDBots (all under `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/`):
group task core `src/main/groupTaskStore.ts`, `src/main/services/groupTask*.ts`
(service/daemon/staffing/candidateSearch/session/prompts/deliverableParser/
acceptanceSummary/orchestrationBridge), OpenTeam `src/main/services/openTeam*.ts`
+ `src/main/openTeamMembershipStore.ts`, transport
`src/main/services/groupChatTransport.ts` + backfill + mention utils, bot search
`src/main/services/botSearchService.ts`, skill `SKILLs/metabot-group-task/`;
MetaWeb `src/main/services/metaweb{Search,Pin}Service.ts`, tools
`src/main/libs/metawebLearningAgentTools.ts`, `metawebUri.ts`; SimpleNote
`src/main/libs/postSimpleNoteAgentTools.ts`, `chainUploadGate.ts`; KB
`src/main/knowledgeBaseStore.ts`, `src/main/services/knowledgeBaseService.ts`,
`src/main/knowledgeBaseIndexStore.ts`, `src/main/libs/knowledgeBaseText.ts`,
`knowledgeBaseAgentTools.ts`; learning `metawebStudyJobStore.ts`,
`services/metawebStudyService.ts`, procedures in `src/main/metaidKnowledgeStore.ts`.
Design docs: `docs/group-task-orchestration-improvements-2026-08-09.md`,
`docs/metaweb-learning-roadmap.md`, `docs/metaweb-search-backend-requirements.md`,
`docs/metaid_protocols/02-content-app.md`.

OAC (under this repo): core `src/core/grouptask/` (types/store/transport/
backfill/service/engine/openteam*), CLI `src/cli/commands/grouptask.ts`,
daemon `src/daemon/routes/grouptask.ts` + `grouptaskHandlers.ts`, engine boot
`src/cli/runtime.ts:4984-5024`, dsh-plugin `dsh-plugin/src/grouptask.ts` +
`src/client/GroupTaskView.tsx` + `A2AConversation.tsx`; memory/impression/
orchestration stores under `src/core/memory/`; local-read fast path
`dsh-plugin/src/local-read.ts`.
