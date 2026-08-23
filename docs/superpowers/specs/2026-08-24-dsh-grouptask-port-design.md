# DSH Group Task Port — Design Record (Retroactive)

Date: 2026-08-24 · Branch: `dsh-idbots-port` · Covers: merge `1e9c2c34`
(2026-08-21) plus the Phase 0 operational fixes from the IDBots parity port
program (`docs/superpowers/plans/2026-08-24-idbots-parity-port-plan.md`).

This spec records, retroactively, the design of the group task (群任务) port
from IDBots into OAC and the Phase 0 hardening that made it verifiably run in
the live DSH environment. It exists because the original merge landed without
a design record, and the first live attempts failed operationally with zero
diagnostic surface.

## What the port is

One on-chain MetaWeb group chat = one task, chaired by a local Bot (twin
preferred). The daemon's 5s engine tick drives every non-terminal task:
indexer sync, tag side effects, the one-shot chair planning turn, and
turn-taking LLM replies under cooldowns/budgets. Chain history is the only
truth — engine posts round-trip through the indexer sync. OpenTeam extends a
task with remote members from other clients (IDBots today) over the same
MetaID protocols.

## Layers

| Layer | Location |
|---|---|
| Core store | `src/core/grouptask/store.ts` — per-profile JSON under `<profile>/.runtime/grouptask/` (`state.json`, `messages/<groupId>.json`), atomic tmp+rename writes |
| Transport | `src/core/grouptask/transport.ts` — `/protocols/simplegroupcreate\|join\|chat\|removeuser` writes (AES group payload, key = first 16 chars of groupId), dual indexer hosts (`api.idchat.io`, `www.show.now`), group-info/member/history reads, indexer wait polls |
| Backfill | `src/core/grouptask/backfill.ts` — indexer history page merge into the message store, `pinId`-deduped |
| Service | `src/core/grouptask/service.ts` — DI context (profiles, per-profile signers, owner identity, private-msg seam); create → chain group → indexer wait → rows → owner/chair joins → kickoff; close/reopen/kick/post; stall computation |
| Engine | `src/core/grouptask/engine.ts` — 5s tick, kv driver mutex, chair planning turn, responder gating (`decideGroupTaskResponders`), OpenTeam envelope scan + guest auto-join + inviter maintenance + guest @-mention replies |
| OpenTeam protocol | `src/core/grouptask/openteam.ts` — `[OPENTEAM_INVITE\|ACCEPT:<id>\|DECLINE:<id>\|KICK]` envelopes over encrypted simplemsg; `expiresAt` is epoch seconds, TTL 600s |
| OpenTeam stores | `src/core/grouptask/openteamStore.ts` (invites/guest-invites/memberships), `openteamService.ts` (invite flow, collab views, guest transcripts) |
| Health | `src/core/grouptask/health.ts` — chair/owner/listener preflight + task counters + engine log tail |
| Engine log | `src/core/grouptask/engineLog.ts` — size-capped rotating log at `<system>/runtime/logs/grouptask-engine.log` (one rolled generation; written only on failures) |
| CLI | `src/cli/commands/grouptask.ts` — create/list/detail/messages/post/close/reopen/kick/member-status/rename/pin/unpin/archive/unarchive/invite/invites/collabs/collab-messages/health |
| Daemon | routes `src/daemon/routes/grouptask.ts` → handlers `grouptaskHandlers.ts`; engine started unconditionally in `serveCliDaemonProcess` (`src/cli/runtime.ts`) |
| DSH host | `dsh-plugin/src/grouptask.ts` — `/oac/api/grouptask/*` dispatch; list/detail/messages/collabs served in-process from the JSON stores (`local-read.ts` fast path, CLI fallback), writes + health + guest transcripts via CLI |
| DSH client | `GroupTaskView.tsx` dual-tab panel (A2A sidebar footer), health banner, OpenTeam invite modal + collabs section; i18n `locale-conversations.ts` (en/zh) |

## Wire compatibility with IDBots

Same MetaID protocols on-chain; same bracket-tag grammar in group messages
(`[GROUP TASK]` kickoff, `[GROUP_TASK_NOTICE:*]` host notices,
`[STATUS:…]`, `[DELIVERABLE]`, `[WORKING]`/`[STANDBY]`, `[FREEZE]`,
`[CHECKPOINT…]`, `[PLAN_CHANGE]`); same OpenTeam envelope shapes and
seconds-based `expiresAt`. Verified live in both directions: IDBots-side
invites reach OAC guests (the Aug-21 batch in `openteam.json`), and
OAC-chaired tasks seat IDBots-side remote members (Round E below).

## Prerequisites (why it "didn't run")

1. **The daemon must be running** when invites arrive: envelope TTL is 600 s,
   and an invite that arrives while no engine is alive expires on first sight
   (the entire Aug-21 batch had been sent before the port existed). The
   daemon auto-starts on any CLI call and auto-replaces a stale build via the
   dist runtime fingerprint in the daemon config hash.
2. **Twin Bot** — chair resolves to the machine twin (explicit `--chair`
   otherwise); `resolveChairProfile` fails with `chair_unresolved`.
3. **Owner identity** — `metabot user ensure`; without it owner-join and
   as-owner posts fail (`owner_missing`).
4. **Per-profile LLM runtime** — engine turns resolve the chair/worker
   profile's preferred runtime with fallback; a missing runtime strands tasks
   in `planning` until stall.
5. **A2A simplemsg listener** — default-on; carries OpenTeam envelopes.

The `metabot grouptask health` verb + the DSH banner surface all of these;
engine failures land in the rotating engine log.

## Phase 0 verification record (2026-08-24, live DSH env)

- Create → on-chain group → engine planning turn (LLM) → close: PASS (task
  #1, cancelled smoke).
- Cross-client OpenTeam (task #5): OAC chair `bob` invited the IDBots-side
  bot 小明同学 → guest auto-joined on-chain with its own wallet (join pin
  `286410d6…`), ACCEPT envelope returned, engine seated the remote member and
  posted the join notice; chair @-mention → IDBots guest LLM reply in the
  group ("大家好，我是小明同学，已就位…"); engine ingested it, entered review
  with an acceptance summary, closed `done` rating 5. **Full cross-client
  loop PASS.**
- Invite to an offline remote bot (BOT-007, lives on another machine)
  correctly finalized as `expired / invite_response_timeout` after the TTL.
- Engine log stayed empty across the whole run (log records failures only).

## Known gaps (deferred to Phase 1/2 of the port plan)

- Staffing pipeline (seats, proposals, owner gate, CAS, candidate search) —
  not ported yet (Phase 1).
- Deliverable verification, acceptance-summary publication on-chain,
  checkpoints/plan-changes/`[DEPENDS_ON]`/auto-ACK, attribution enrichment —
  partial/absent versus the IDBots daemon (Phase 2).
- Guest-side file deliverables (metafile upload) and membership self-check —
  Phase 2.
- The panel's cancelled/done tasks are hidden behind the filter dropdown
  (defaults to 进行中/active) — cosmetic.
