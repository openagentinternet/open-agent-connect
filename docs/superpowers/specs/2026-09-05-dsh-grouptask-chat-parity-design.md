# DSH Group-Task Chat Parity — Comparison & Implementation Plan

Date: 2026-09-05 · Branch: `dsh-group-task` (worktree `.worktrees/dsh-group-task`) · Status: proposed, awaiting go

## Problem statement

The 2026-08-24 port (`2026-08-24-dsh-grouptask-port-design.md`) brought the
full group-task **backend** to OAC: on-chain group chat per task, 5 s engine
tick, statuses, deliverables, acceptance, OpenTeam, CLI verbs, and the DSH
Group Tasks panel. But the **chat-session surface was never ported**: a DSH
Meta bot (the Twin) has zero group-task tools and zero SOP knowledge. Asked to
"开一个群任务" it falls back to local worker delegation
(`local_worker_delegate`), which spawns private sub-sessions and never creates
the on-chain task group. In IDBots the same request flows through the
`metabot-group-task` skill: wish → staffing slate → owner confirm → on-chain
group → chaired execution → review → acceptance.

Verified today: `grep` over every SKILL.md, skillpack, and dsh-plugin prompt
section finds **zero** occurrences of group-task content; the daemon-side
verbs are reachable only via CLI/HTTP.

## Side-by-side inventory

| Area | IDBots | OAC today | Gap |
|---|---|---|---|
| Agent-facing skill/SOP | `SKILLs/metabot-group-task/SKILL.md` (367-line SOP: wish→task, seats, staffing gate, phases, tags) + chat-skill routing | none | **P0** |
| Model-facing verbs | 16 skill actions (`propose/create/list/show/member_status/send/invite/kick/search_candidates/search_remote/invite_remote/supervise/deliverable-delete/close/bots`) over RPC | same verbs exist as `metabot grouptask *` CLI/HTTP, but **no tool bridges them into any chat session** | **P0** |
| Engine (5 s tick, driver mutex, planning turn, responder gating, ACK watch, member monitors) | `groupTaskDaemon.ts` | `src/core/grouptask/engine.ts` — ported | — |
| Status machine | planning/executing/review/done/cancelled + legal transitions + rework hatch | same (`types.ts`) | — |
| Staffing (search→propose→owner gate→create) | `groupTaskStaffing.ts`, LLM intent confirm, auto-start waiver | `staffingStore` + CLI `grouptask staffing propose/list/decide/create/search` + DSH panel card; HTTP `staffing/propose` has **no caller** | **P0** (needs agent surface) |
| Worker execution | workers run **skill turns in real cowork sessions** with tool access (30-min budget); plain LLM turn is only the degraded fallback | `runSeatTurn` = bare `options.runLlmTurn` completion — workers can only produce text, never real artifacts | **P1 (biggest functional gap)** |
| Supervise (nudge/flag/pause/resume) + dispatch pause | yes | missing | **P1** |
| Source-session relay ("哪里发起哪里结束": created/dispatch/checkpoint/review/acceptance back to the originating chat) | yes (`source_session_id` + notify) | missing (staffing stores `--session`, nothing relays) | **P1** |
| Chair-identity send gating (`CHAIR_IDENTITY_CONFIRM_REQUIRED` + driver mutex 409) | yes | `grouptask post --as <chair>` bypasses the engine mutex unguarded | **P1** |
| Checkpoints (HITL `[CHECKPOINT:*]`) | yes | ported (store + UI banner) | — |
| Deliverables (parse `[DELIVERABLE]`, verify on-chain, 10-min re-verify, local-file upgrade) | yes | ported | — |
| Deliverable delete | yes | missing | P2 |
| Review ceremony + acceptance summary + owner report | deterministic summary (criteria verdicts, observations, guidance) + private A2A report + group summary | ported (summary + 【结论】 report + group notice); no per-criterion verdicts/observations/guidance | P2 |
| Acceptance rating + rework | 1–5 stars + comment, close/reopen | ported (UI + CLI) | — |
| Remote candidate search (`search_remote`) for OpenTeam seats | yes (online bot search) | invite is GMID-only | P2 |
| Tags | `[DELIVERABLE] [WORKING] [NO_REPLY] [STANDBY] [STATUS:*] [CHECKPOINT:*] [DEPENDS_ON:*] [PLAN_CHANGE:*] [FREEZE:*] [DEADLINE:*] [GROUP_TASK_NOTICE:*]` | core set ported; `[FREEZE]`/`[DEADLINE]` unverified | P2 (verify) |
| UI panel | detail view, member rail, deliverable rail, acceptance card, rating, badge, toasts | `GroupTaskView.tsx` covers most; no turn-activity badge/toasts | P2 |
| Cross-host skillpack | n/a (Electron app) | no group-task skill in `SKILLs/`/skillpacks | P2 |

## Design decisions

1. **Mount on the Twin only.** Group tasks are always chaired by the Twin
   (IDBots invariant; OAC `twinRole.ts` already enforces one Twin per
   machine). Register the group-task toolset inside the existing
   `botType === 'twin'` gate in `dsh-plugin/src/index.ts` (`installTwinOnAgent`
   pattern), with execution-time revalidation (`ensureTwinAuthorized`-style).
   Non-twin `oac-*` agents get nothing — matches IDBots.
2. **One tool, action-union shape.** A single native Cordis tool `group_task`
   with an `action` parameter mirrors IDBots' 16-action skill script: the SOP
   section ports near-verbatim, and the Twin's function list stays lean
   (it already carries 7 twin tools + memory + browser tools). The host half
   executes actions by spawning `metabot grouptask …` through the same runner
   the `/oac/api/grouptask/*` routes use (local-read fast path for reads).
3. **SOP as a system-prompt section.** New `oac:group-task` section (ported
   from IDBots `SKILL.md` + `chairPlaybookRules`, adapted to OAC verb names
   and the DSH staffing card) injected with the toolset. English copy; no UI
   strings involved.
4. **Chat-driven owner gate.** The agent presents the staffing slate in chat;
   the owner confirms semantically in chat (agent calls `staffing decide
   confirm|revise|skip`), or uses the existing panel card. Auto-start waiver
   (all-local slate ≤4 seats, or the wish said "just start") encoded in the
   SOP, judged by the agent — same policy as IDBots.
5. **CLI-first.** New state-control capabilities (supervise, chair-send gate,
   deliverable-delete, relay rows) land in OAC core + `metabot grouptask *`
   first; the DSH tool is a thin wrapper. A cross-host `SKILLs/metabot-group-task`
   follows in Phase 4 per the skillpack SOP convention.

## Phases

Each phase = one round on `dsh-group-task`: scoped verification → commit +
eric buzz → `git merge --no-ff` to `main` → `dsh-plugin npm run build` (+ repo
`npm run build` when core changed) → daemon restart and/or `dsh web` restart
per README so the user sees it on the live 3080 env. The branch is kept after
each merge.

### Phase 1 — Chat entry (the user-visible fix)

- `dsh-plugin/src/group-task-tools.ts`: `group_task` tool with actions
  `list / detail / messages / post / create / kick / member_status / invite /
  invites / close / reopen` and staffing actions `search_candidates / propose
  / decide / create` (create-from-proposal returns pending remote seats and
  chains `invite` per seat, as the SOP prescribes).
- `oac:group-task` prompt section: wish→task enrichment (goal + measurable
  acceptance criteria), seat model (`content/design/engineering/promotion/domain`),
  search→propose→confirm→create→invite_remote, phase/tag playbook summary,
  when NOT to open a task (single-bot jobs, casual chat), status vocabulary.
- Host captures the current DSH session id and passes it to `staffing propose
  --session` for the Phase-2 relay.
- Verify: unit tests for the tool dispatcher; live round-trip — ask the Meta
  bot in DSH chat to open a task; expect slate → confirm → on-chain group →
  kickoff → engine planning turn → panel shows the task.

### Phase 2 — State control & relay

- Core: `grouptask supervise` (nudge/flag/pause/resume; dispatch-pause state,
  supervisor signals store, engine honors pause) ; `grouptask deliverable-delete`;
  chair-send gate (`post --as <chair>` on a non-terminal task requires
  `--confirm-chair`, else refuses with a `CHAIR_IDENTITY_CONFIRM_REQUIRED`
  error).
- Relay: on create/dispatch/checkpoint/review/acceptance the daemon records a
  relay row tagged with the source session; the plugin host drains it and
  pushes the notice into the originating DSH session (reuse the existing
  twin-session insert path used by ORCH-NOTIFY). "哪里发起哪里结束" parity.
- Tool: add `supervise` + `deliverable_delete` actions.
- Verify: pause/resume round trip through chat; review/acceptance notice
  lands back in the originating conversation; ungated chair post fails loudly.

### Phase 3 — Worker real-work sessions (the deep one)

- Engine worker wakes spawn (or reuse) a real DSH sub-session per (task,
  worker), reusing the delegation machinery from `local_worker_delegate`
  (`agents.create` + worker preset mount + group-task context snapshot);
  handoff text becomes the on-chain reply; `[DELIVERABLE]` lines extracted
  from the handoff; empty handoff → failed attempt with the turn's own error
  (`WORKER_EMPTY_HANDOFF` parity).
- `[WORKING]` ACK posted immediately on wake; per-turn timeout/budget
  analogous to `twin.stepTimeoutMs`; graceful fallback to the existing bare
  `runLlmTurn` when session spawn fails (IDBots degrade path).
- Chair turns stay engine LLM turns (chair work is orchestration text).
  Keep this scope boundary explicit.
- Verify: live task where a worker actually produces an artifact (simplenote
  note or metafile) that verifies on-chain and shows in the panel.

### Phase 4 — Cross-host skill + polish

- `SKILLs/metabot-group-task/` (SKILL.md + `scripts/index.js` shelling
  `metabot grouptask …`) + `build:skillpacks` for the other hosts.
- Remote candidate search for OpenTeam seats (reuse the daemon chain-profile
  index; if no search endpoint exists, keep GMID-only invite and document it).
- Acceptance-summary enrichment (per-criterion verdicts, observations,
  guidance); verify/complete `[FREEZE]`/`[DEADLINE]` tag handling; DSH UI
  turn-activity badge + owner-report toasts.
- README (Group Tasks section) + `docs/hosts/dsh.md` updates.

## Out of scope

IDBots' casual group-chat autonomous tasks (`assignGroupChatTask`),
`teamCultureDistillation`, and Electron-only renderer features with no DSH
equivalent.

## Risks / notes

- Phase 3 touches the engine's turn path — keep the bare-LLM fallback
  default-off feature-flagged per profile until a live round-trip passes.
- The daemon must be restarted for core changes; the DSH host for host
  changes (README "Live DSH binding" section governs which).
- Every phase keeps worker/chair playbook text in English, chain-visible
  messages unchanged in protocol, and no new temp-root patterns in tests.
