# DSH Group Task — Live-Run Findings and Fix Plan (task 145, 2026-09-12)

Observation subject: live group task `a40576b643efe3fbf14a4d571fed20a0a107bae2ae51556723cdd3272ffe7141i0`
("GitHub spec-kit 介绍 MetaApp（本机四人组）", chair `bob`, workers `agent-internet` / `ken` / `fable-1`),
watched end-to-end on the live `dsh web` (127.0.0.1:3080) from creation to the first review entry.

## What went well

- Single-commander mechanics held: every group message was chair/worker-authored; host notes
  (`long_turn`) were recorded and consumed; no host posts in the group.
- Phase-3 worker sub-sessions worked end-to-end: work requests claimed by the DSH host within
  seconds (#152/#155/#156/#157/#170), mid-turn `group_chat` posts landed on-chain, handoffs posted
  as worker messages, deliverables recorded + on-chain verified (`confirmation: confirmed`).
- Worker quality was high and the seats earned their keep: `ken` caught that the shipped SVGs are
  unreadable at Bot Browser sidebar width (4–6 px effective text) and produced narrow variants;
  `fable-1` caught that ken's patch was based on the v1.0 snapshot and would have deleted the
  chair-mandated alias section, and did a true merge onto v1.1.0 before publishing v1.2.0.
- The panel (list, thread, task drawer, member badges, deliverable ledger) rendered correctly and
  stayed in sync with the store.

## Findings (root causes verified against state.json / engine log / dist build)

### F1. Planning-turn roster race: the chair plans with a partial roster (HIGH)

`createGroupTask` (`src/core/grouptask/service.ts:360-411`) creates the task row, then adds member
rows **interleaved with one slow on-chain join each** (~13 s per member). Evidence: task row and
chair/agent-internet member rows share `createdAt 1789206625060-066`; `ken` was added 13.6 s later,
`fable-1` 26 s later.

The daemon engine tick (5 s) picked up the task in `planning` at ~17:50:26 and ran the one-shot
planning turn with only 2 of 4 members in `promptSeats`; the chair's LLM turn took ~85 s and posted
the plan at 17:51:52 saying "本组实际仅一名 Worker（Agent-Internet）". `rosterSettledForPlanning`
(`engine.ts:1495`) only waits for OpenTeam invites, not for in-flight local seating.

Corollary: the `plan_coverage` safety net (`notePlanningCoverage`, `engine.ts:1383`) was disarmed by
the same race — it checks the plan against the SAME stale `promptSeats`, so it found nothing
uncovered (no host note, log line absent). The chair self-corrected 10 min later (msg 5) only
because its system-prompt roster was complete by then.

### F2. Backlog tag replay: status flapped review→executing in 15 s; owner-facing flap (HIGH)

Worker-turn work requests serialize the message cursor: while msg 5's three worker turns ran
(18:01→18:17), `lastProcessedIndex` sat at 4 and chair messages 6 and 11 piled up unprocessed.

- msg 6 (18:02) carried `[STATUS:REVIEW]` — correct at post time (v1.1.0 accepted).
- msg 11 (18:14) carried `[STATUS:EXECUTING]` — correct at post time (re-dispatch for v1.2.0).

When the backlog drained at 18:17, the engine applied both within the same pass:
executing→review at 18:17:02 (transition id 160; review ceremony fired: acceptanceSummary row,
`review` source-session relay, private owner report) then review→executing at 18:17:17
(transition id 169, rework). The task was in 待验收 for 15 seconds.

Owner-facing surfaces never learned about the revert: the relay stream to the source session is
created→dispatch→review with no rework relay (emitGroupTaskRelay has no review→executing branch,
`engine.ts:586-590`), so the source chat still believes "待验收". The orphaned acceptanceSummary row
also survives the rework (only kv guards are cleared).

### F3. Review-tag loss has no recovery path: task wedged in executing, fully delivered (HIGH)

The chair's final acceptance message (msg 13, 18:18) was **truncated at 708 chars mid-table** (raw
on-chain content verified — not a CLI display cap; worker messages up to 2590 chars posted fine).
The `[STATUS:REVIEW]` tag never existed in the posted text, no parse note could fire, and no further
trigger exists (all members delivered → deadline clocks settled; no pending host notes; no new
messages). The task sat in `executing` with everything delivered and accepted — a silent wedge until
the owner nudges or closes by hand. Truncation root cause is on the generation path (chair turns run
`runLlmTurn` → host-executor bridge with no explicit `maxTokens`, `runtime.ts:6319-6328`); no
finish-reason is logged anywhere.

### F4. Engine log spam: "completed by the host; advancing the cursor" every tick (LOW)

`handleWorkerSessionTurn` (`engine.ts:1268-1271`) logs the same completed work request on every tick
while a LATER responder decision for the same message still defers (14 repetitions for #155 within
5 min). The cursor does not actually advance; the line is misleading noise in a failures-only log.

### F5. Roster profiles always empty; seat roles never reach the chair (MEDIUM)

`GroupTaskPromptSeat.roleText/bio/goal` exists and `## Roster profiles` renders them
(`prompts.ts:149-160`), but `buildSeats` (`engine.ts:362-387`) never populates them. The staffing
proposal's seat roles (内容/设计/工程 — visible in the source session's slate) are only recoverable
via `seatRoleBySlug` at close time for impressions (`impressions.ts:16-34`). The chair planned
seat-blind, which contributed to F1's "one worker does everything" plan.

### F6. Minor observations

- Owner-confirm friction: "现在开始" still required an owner decision on the staffing proposal; the
  Twin recorded the user's instruction as the confirmation itself (proposalId 4). Works, but the
  confirm gate can't tell an explicit go-ahead from a fresh wish.
- Member seat status stays `working` after delivery until the chair explicitly sets done/standby;
  drawer badges show stale 工作中 alongside delivered work.
- The source-session relay stream lacks a `dispatch`-revert sibling for review→executing (see F2).

## Fix plan

### P1. Seat the full roster before the first chain write (F1)

In `createGroupTask`: write ALL member rows up-front (chair + every worker, `joinedPinId: null`),
then run the on-chain joins and patch `joinedPinId` per member. Join failures keep the current
tolerant behavior. The roster is complete within milliseconds of `createTask`, so any engine tick
sees every seat. Additionally re-run `notePlanningCoverage` against the FRESH member list when the
planning message is processed as a pending message (tag-side-effect time), so a stale-turn plan can
no longer slip past the net.

### P2. Defer owner-facing review effects to end-of-pass + supersede stale chair tags (F2)

Two surgical changes in the engine:

1. In `applyChairStatusTag`, split state transition from owner-facing effects: apply the status
   change immediately, but queue `runReviewCeremony` + the `review` relay; execute them after the
   pending-message loop only if the task is STILL in `review`. Transient flaps then never reach the
   owner, and the acceptanceSummary row is only written for settled review entries.
2. When processing a chair status tag, scan the current pending batch for a NEWER chair message
   carrying an honored status tag; if one exists, skip the older tag and record a `parse` host note
   ("superseded by your [STATUS:X] in #N"). Latest chair intent wins without mid-pass flapping.
3. Add the missing `review → executing` relay emit so the source session learns about reworks.

### P3. Truncation resilience for chair turns (F3)

1. Pass an explicit generous `maxTokens` for chair turns through `createHostFirstCompletion`
   (engine → `runLlmTurn` already threads per-role options).
2. Detect a chair reply that ends without an honored lifecycle tag AND mid-structure (inside a
   markdown table/list, or no terminal punctuation): retry the turn once with a "continue/complete
   concisely" instruction; log the finish truncation to the engine log either way.
3. Safety net for the wedge: when a chair message posted while `executing` contains an acceptance
   verdict but no honored tag, the next engine pass with no pending triggers records a
   `review_stalled` host note reminding the chair to re-issue `[STATUS:REVIEW]` (deduped; the chair
   gets exactly one wake instead of silence). — Alternatively surface it as a `nudge`-style
   supervisor signal; keep single-commander (host never posts).

### P4. Log once per completed work request (F4)

Memoize the "completed → done" log per request id (kv or in-memory set per engine run); subsequent
ticks return `'done'` silently.

### P5. Feed seat roles into the roster (F5)

Persist the staffing proposal's seat role onto the member row at `create_from_proposal`/create time
(new nullable `seatRole` field, backward-compatible JSON), and map it in `buildSeats` to
`promptSeats.roleText`. Direct-created tasks (no proposal) keep the empty-profiles behavior.

### P6. Nice-to-have

- Set member seat status back to `assigned` (or `done`) automatically on a recorded delivery.
- Source-session relay: use the settled-review event from P2.1 as the single `review` relay point.

## Verification approach

- New fast-tier tests under `tests/grouptask/`: members-first create ordering (roster complete at
  first tick), coverage re-check on fresh members, ceremony deferral (flap produces no relay /
  acceptanceSummary), superseded-tag skip, truncation retry helper, log-once memo.
- Re-run this exact live scenario (4 local seats, MetaApp publish) on `dsh web` after the merge and
  confirm: plan names all seats, review entry is single and stable, owner relay stream is
  created→dispatch→review with no flap.

## Implementation record (branch `dsh-grouptask-fix`)

- **P1** `service.ts:createGroupTask` seats every member row before the first on-chain join;
  `engine.ts:applyChairStatusTag` re-runs `notePlanningCoverage` with the current tick's roster on
  the planning→executing transition. (Note: superseding within-batch chair tags was considered and
  deliberately dropped — the deferral in P2 already makes flaps owner-invisible, and skipping
  intermediate tags could break a legit planning→executing→review batch.)
- **P2** `engine.ts`: `DeferredReviewEffects` defers the review relay + `runReviewCeremony` to the
  end of the message pass (fires only when the task is still in `review`); a review→executing
  rework emits the new `rework` relay kind only when the review had actually been delivered
  (REVIEW_SUMMARY kv present); owner `reopenGroupTask` relays `rework` as well.
- **P3** `runtime.ts` passes `maxTokens: 8192` for chair turns;
  `engine.ts:looksLikeTruncatedReply` detects cut-off chair replies and retries the turn once;
  a chair message that still lands truncated earns a deduped `parse` host note
  (`truncated:<task>:<index>`) so the chair re-issues the lost lifecycle move.
- **P4** completed work requests log once per request id (`loggedCompletedWorkRequests`).
- **P5** `GroupTaskMember.seatRole` persisted via `addMember`; `staffingService` maps the slate's
  seat roles (`domain:<label>` for domain seats) into `createGroupTask`; `buildSeats` maps them to
  `promptSeats.roleText`, rendering the `## Roster profiles` prompt section for the first time.
- Tests: `tests/grouptask/liveRunFixes.test.mjs` (7 tests) + full suite green.
