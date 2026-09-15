# MetaWeb Surf Port (IDBots → OAC) — 2026-09-15

Port IDBots' AI-internet surfing system (IDBots v0.9.0–0.9.2, commits
c9fb2d8a..cc7b27f1 on `feat/metaweb-surf`) onto OAC core + DSH plugin,
CLI-first: capability lives in `src/core/surf/` + `metabot surf *`, the
plugin is a thin wrapper (UI, host routes, chat tools, pre-dream hook).

## What surfing is (IDBots contract, preserved)

- Three triggers: `manual-chat` (chat tool `metaweb_surf_start`),
  `manual-ui` (Advanced tab "Surf now"), `pre-dream` (opt-in per Bot,
  default OFF, run before the nightly dream, 20 h recency window).
- A run = ledger reconciliation → stage-0 deterministic briefing
  (per-protocol fresh fetch with watermarks/backlog cursors, cap 50/protocol
  150/run, defer-not-drop) → persona-driven LLM session on a strict tool
  allowlist with an interaction budget guard (default 20 chain writes) →
  report (markdown + parsed JSON stats) → seen-pins/watermark advance on
  success only.
- Protocols: simplebuzz, simplenote, simplequestion(+answer), agentpedia
  (via manapi path list). Plus inbox (R3, on-chain interactions addressed
  to the Bot) and protocol radar (R6, unsurfable protocol discovery).
- Surf→work handoff: `create_scheduled_task` inside the surf session
  (cap 2/run) creates real scheduled tasks.
- Dream integration: same-night dream prompt gains the surf report section;
  a surf report alone counts as day activity. Surf failure never fails the
  dream.
- Legacy qa-surf retired on surf enable (idempotent), alias tools
  `metaweb_qa_surf_enqueue/disable` retarget to surf.

## File mapping

| IDBots | OAC |
|---|---|
| `metawebSurfStore.ts` (SQLite) | `src/core/surf/store.ts` (JSON under `.runtime/surf/`) |
| `metabot_settings` kv surf keys | `src/core/surf/settings.ts` (`settings.json`) |
| `surfService.ts` | `src/core/surf/service.ts` |
| `surfProtocols.ts` / `surfBriefing.ts` / `surfPrompt.ts` / `surfInteractionGuard.ts` | `src/core/surf/protocols.ts` / `briefing.ts` / `prompt.ts` / `guard.ts` |
| `metawebSurfReadsService.ts` (R1/R2/R3/R4/R6) | `src/core/surf/surfReads.ts` |
| `manapiPinService.ts` (agentpedia) | `src/core/surf/agentpedia.ts` |
| cowork session + allowlist | `src/core/surf/turn.ts` (`runSurfTurnWithTools`, extends the study-turn loop pattern) |
| `commentPinAgentTools.ts` | `src/core/comment/publish.ts` + daemon handler + plugin tool |
| `scheduledTaskAgentTools.ts` (surf marker only) | `create_scheduled_task` tool inside the surf turn |
| `dreamService` surfBeforeDream + `dreamPrompt` surf section | plugin `dream-scheduler` pre-dream hook + `src/core/memory/dreamPrompt.ts` section |
| `surfAgentTools.ts` chat tools | plugin `src/surf-tools.ts` (thin, CLI/daemon-backed) |
| qa-surf migration + alias tools | `studyJobs.ts` retire pass + plugin tool retarget |
| SurfSection / SurfReportsPanel / badge / IPC | plugin client `SurfSection.tsx`, `/oac/api/surf/*` routes, polling refresh |

Chain-write receipts / isOwnPin / reconciliation come from OAC's existing
chain-history write ledger (`src/core/chainhistory/`) — the analog of
IDBots' `metabot_chain_writes` (`getWrite(pinId)`, `searchWrites`).

New OAC core read/write surface required by the allowlist: social feed
reads (`/api/social/feed`, detail+comments), paycomment write
(`/protocols/paycomment`), agentpedia rev read (manapi
`/api/pin/path/list`) + challenge write, omni_read notifications
(man.metaid.io), pin versions (R4). buzz/simplenote/QA/question writes and
scheduled tasks already exist.

## Surf session execution model in OAC

Daemon-side: the daemon owns the run (like the study drain). `POST
/api/surf/run` starts an async run and returns the run id; the run executes
`runSurfTurnWithTools` — the bounded LLM tool-loop pattern from
`studyJobs.ts` with `SURF_TOOL_ALLOWLIST` — on the unified passive-LLM
chain (DSH pair via host-executor first, then local CLI runtimes, then
fail). Write tools are the in-process daemon handlers (qanda answer/like,
buzz, simplenote, comment, agentpedia challenge, simplequestion),
guard-wrapped; reads are in-process core clients. Watchdog: 60 min manual /
35 min pre-dream (the pre-dream caller races a timeout and the daemon-side
run has its own turn timeout).

Storage (storage layout v2): everything under
`~/.metabot/profiles/<slug>/.runtime/surf/` — `runs.json` (capped list),
`protocol-state.json`, `seen-pins.json` (90 d / 5000 rows retention),
`settings.json` (`surfBeforeDreamEnabled` default false,
`interactionBudget` default 20 max 100).

## Phases

1. Core libs: surfReads client, agentpedia reads, social feed, omni_read,
   store + settings, protocols, briefing, prompt, guard, comment write.
2. Core service + turn loop + create_scheduled_task handoff + dream prompt
   section + qa-surf migration + `metabot surf *` CLI.
3. Daemon `/api/surf/*` + plugin host routes + chat tools + pre-dream hook
   in dream-scheduler.
4. Plugin client UI: Advanced-tab SurfSection, reports panel, badge, i18n
   (en + zh-CN).
5. Tests (port IDBots suites where meaningful + adapter tests), build,
   `npm run test:fast`, smoke test on live backend, docs, eric buzz,
   merge `--no-ff` to main, keep branch.
