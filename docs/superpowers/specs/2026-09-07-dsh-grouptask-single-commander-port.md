# DSH Group Task — Single-Commander Port (2026-09-07)

Ports the IDBots single-commander group-task refactor (IDBots `main` @
`0b468ea8`, landed 2026-09-06/07: `74340c1c` + `8787e764` + `4731828c` +
`87634b89` + `b75ff14d` + `468f7da9` + docs) into OAC's daemon engine and the
DSH plugin. This document is the OAC-side contract record; the IDBots
`docs/group-task-runbook.md` remains the upstream authority.

## The one rule

The host (daemon/engine/DSH plugin) is the **environment** — the meeting
room — never a speaker. The chair (the Twin Bot) is the **only coordinator**.
Every on-chain group message is authored by a participant: the chair, a
worker, or the human owner. The host never posts under any identity (one
exception kept from upstream: the deterministic owner-confirmed kick
moderation notice, posted as the chair).

## What changed in OAC

### Host speech → host notes (`src/core/grouptask/`)

Every former in-group `[GROUP_TASK_NOTICE:*]` post is gone; each became a
host-note record (`store.recordHostNote`, deduped per `(taskId, dedupeKey)`
while unconsumed) delivered to the chair in ONE dedicated turn per batch
(`[SYSTEM host environment notes …]` directive). The chair answers in its own
voice or consumes silently with `[NO_REPLY]`; 3 consecutive delivery failures
drop the batch with an `alert` source-session relay. Emitters converted:

| Old in-group post | Now |
|---|---|
| `[GROUP_TASK_NOTICE:ack_reminder]` | `no_ack` host note (skipped/retired silently while a worker work-request is live) |
| `[GROUP_TASK_NOTICE:member_timeout]` re-assign hint | `long_turn` host note (facts + standby roster; never auto-fails) |
| `[GROUP_TASK_NOTICE:openteam_joined]` + roster-change wake turn | `join` host note; the host-notes turn greets/re-dispatches |
| `[GROUP_TASK_NOTICE:checkpoint_open/_resolved]` pause/resume lines | dropped; the chair's own `[CHECKPOINT:]`/`[CHECKPOINT_RESOLVED:]` messages are the signals; the owner is briefed privately |
| `[GROUP_TASK_NOTICE:review_summary]` checklist post | dropped; the acceptance summary row + private owner report remain |
| `[GROUP_TASK_NOTICE:review_still_open]` straggler re-assert | dropped entirely |
| `[GROUP_TASK_NOTICE:supervisor]` pause/resume/flag posts | dropped; signals ride the chair's turn context |
| silently dropped chair `[STATUS:*]` tags (illegal transition / rework debounce) | `parse` host note explaining the verdict |
| (new) chain send failures | `chain_health` host note at 2 consecutive failures (one per 10-min bucket) + a `RECOVERED` note on the first success after |

### Single deadline clock

The chair's `[DEADLINE: Nm]` tag on a dispatch is the ONLY deadline source
(worker ETA text is planning information, never a clock). The clock arms when
the worker ACKs (`[WORKING]`), a delivery clears it, and a passed deadline
with no `[DELIVERABLE]` rings exactly one `deadline` host note. The engine's
ETA `expected_delivery` kv write and the `[DEPENDS_ON]` dispatch hold are
gone — `[DEPENDS_ON: <pinid>]` is now purely declarative (it still keeps the
ACK watch and timeout flags off a legitimately-waiting member).

### Turn contract

- Planning dedupe (EP33 P2): if the chair already dispatched in its own voice
  (any chair-authored message past the auto-kickoff that @-mentions a seated
  worker), the bootstrap runs ONE minimal directive instead of the full plan
  and never burns the 3-attempt budget; a `[NO_REPLY]` answer completes it.
  Planning replies without an honored status tag get a deterministic
  `[STATUS:EXECUTING]` footer.
- Supervisor wake (nudge/resume): new `[SYSTEM supervisor directive]` framing
  — supervision is an input, not an order; no `[STATUS:*]` in the answer —
  with the review-phase EXCEPTION (a genuine defect MAY reopen rework via
  `[STATUS:EXECUTING]`). An open checkpoint defers the wake; closing a task
  cancels a pending wake.
- Worker sub-sessions (DSH): a session-scoped `group_chat` tool
  (`send_group_message`) posts mid-turn as the worker, bound to the claimed
  task's group — malformed `group_id` rejected with the teaching error,
  mismatched id auto-routed with a note. The claim-time host-posted
  `[WORKING]` ACK is gone. An empty final reply after mid-turn sends settles
  as DELIVERED (`[NO_REPLY]` handoff completes without an on-chain post);
  `[NO_REPLY]` final replies never post.
- The engine treats an outstanding (pending/claimed, unexpired) work request
  as "engaged": no no-ACK note, no unreachable flag, no timeout escalation
  while a live DSH turn runs.

### Smaller parity items

- Markdown-wrapped status tags on their own line (`**[STATUS:REVIEW]**`,
  backticked) are honored (IDBots `4b996374`); mid-prose mentions stay inert.
- Deliverables fold by pin: the same author re-posting the same on-chain
  artifact never mints a second ledger row (IDBots R-03/`7d617f2e`).
- Sender display names resolve by GlobalMetaID (roster/profile/owner), never
  by the spoofable chain nickname (IDBots R-04).
- Source-session relay milestones carry an `(event at YYYY-MM-DD HH:MM local)`
  stamp (IDBots EP33 P3①).
- The chair's turn context now leads with the authoritative host-DB state
  line (`status`, deliverable ledger counts) that outranks model memory.

### Deliberately not ported (N/A in OAC or deferred)

- IDBots cowork-session machinery (defer queue coalescing, 30+10+45-min skill
  turn windows, corrupt session-log recovery): OAC's Phase-3 work-request
  TTL/fallback already covers the failure modes.
- Chair-response watchdog (IDBots P0-2): OAC has no chair watchdog.
- Host-fault cancellation attribution (P2-6): OAC never auto-cancels tasks.
- Per-phase time breakdown + host-alert accounting in the acceptance summary
  (R-06/P2-7): deferred; the OAC acceptance summary schema is unchanged.
- `[FREEZE:]` tag: remains unported (was never in OAC).
- The IDBots-only prompt rules referencing tools OAC bots lack
  (`describe_image`/`describe_video`).

## Wire compatibility

Unchanged. The on-chain tag set is identical; `[GROUP_TASK_NOTICE:*]`
messages already on-chain stay inert (parsed as data, excluded from
turn-taking). OpenTeam envelopes (v:1) are untouched. Cross-client interop
with IDBots at this contract is preserved: an IDBots task group sees OAC
participants as ordinary speakers, and vice versa.

## Verification

`npm run build && npm run build:skillpacks`; `node --test
--test-concurrency=1 tests/grouptask/*.test.mjs` (138 tests) and the
dsh-plugin suite (`dsh-plugin`: `npm test`, incl. group-task-worker /
group-task-tools / group-task-relay / grouptask-routes).
