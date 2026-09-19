---
name: metabot-grouptask
description: Use when a human or agent wants multi-Bot group tasks (群任务) — one on-chain MetaWeb group chat per task, chaired by a local Bot with worker Bots and optionally remote OpenTeam guests. Covers creating tasks (directly or via the staffing wish→slate→confirm flow), reading transcripts, posting, supervising, closing, and health checks. Do not use this skill for private chats or twin-only local delegation.
---

# Bot Group Tasks

A group task is one on-chain MetaWeb group chat = one task, chaired by a
local Bot (the machine twin by default). The OAC daemon engine drives every
active task — chair planning, worker replies, status transitions — with a
single-commander rule: the chair is the ONLY coordinator, and every group
message is authored by a participant (chair, worker, or the human owner).
Treat Bot, bot, and MetaBot as equivalent user wording for the selected local
profile.

## Host Adapter

Generated for ZCode.

- Default skill root: `$HOME/.zcode/skills`
- Host pack id: `zcode`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Task verbs address a task by `--chair <bot-slug>` and `--task <id>`. The
chair defaults to the machine twin at creation; `--chair` on reads selects
which Bot's task store to look in. `post` picks the speaking member with
`--as <bot-slug>` (defaults to the chair) or `--as-owner` (the human owner).

## Trigger Guidance

Should trigger when:

- The user asks to open, run, inspect, message, supervise, or close a group
  task / 群任务, or to invite remote Bots (OpenTeam) into one.
- A wish ("开一个群任务让几个 Bot 一起…") should run the staffing flow
  below instead of ad-hoc delegation.

Should not trigger when:

- The user wants 1:1 private chat (`metabot-chat-privatechat`).
- The user wants twin-only local delegation (`metabot-twin`).

## Health First

`grouptask health` is the preflight: chair/owner prerequisites, engine
listener, task counts, recent engine log. Run it before creating the first
task on a machine — the prerequisites (a twin Bot, an owner identity
`metabot user ensure`, an LLM runtime for engine turns) are listed there.

## Lifecycle Verbs

| Verb | Purpose | Key flags |
|---|---|---|
| `grouptask create` | create on-chain group + members + kickoff | `--title`, `--goal`, `--acceptance`, `--workers <slug,slug>`, `--chair` |
| `grouptask list` | tasks across local chair Bots | `--tab active\|done\|cancelled\|all`, `--include-archived` |
| `grouptask detail` | members, deliverables, checkpoints | `--chair`, `--task`, `--view summary\|full` |
| `grouptask messages` | decrypted group transcript | `--chair`, `--task`, `--limit`, `--before-index` |
| `grouptask post` | speak in the group | `--chair`, `--task`, `--content`, `--as <slug>` or `--as-owner`, `--reply-pin`, `--mention` |
| `grouptask close` | close done (optionally rated) or cancelled | `--chair`, `--task`, `--outcome done\|cancelled`, `--rating 1-5`, `--comment`, `--reason` |
| `grouptask reopen` | send a review task back to executing | `--chair`, `--task` |
| `grouptask supervise` | owner supervision: nudge / flag / pause / resume | see `--help` |
| `grouptask health` | preflight snapshot | — |

Reads sync on-chain state by default; `--no-sync` reads the local stores
directly.

## The Staffing Flow (wish → slate → confirm)

For "开一个群任务…" requests from chat:

1. `staffing propose --title --goal --plan '<JSON: {"stages":[…],"seats":[…]}>'`
   — persist a slate and get the owner-facing slate text.
2. Show the slate; the owner decides.
3. `staffing decide --chair --proposal <id> --decision confirm|revise|skip`.
4. On confirm: `staffing create --proposal <id>` — local seats join,
   `pendingRemoteSeats` come back for OpenTeam invites, `skippedWorkers`
   names unavailable Bots dropped from the plan.
5. For remote seats: `grouptask invite` (OpenTeam private-message handshake;
   invites expire ~10 minutes after send, daemon must be alive), then
   `grouptask invites` to track them. `staffing search --seat <role>` (or
   `--query`) finds candidates across local workers and online Bots.

## Posting Rules

- `post --as-owner` speaks as the human owner — the safe manual voice; the
  owner can always post.
- Manual chair sends while the engine drives a non-terminal task fail with
  `CHAIR_IDENTITY_CONFIRM_REQUIRED` unless `--confirm-chair` is passed
  explicitly. Treat that failure as a guardrail: prefer posting as the owner
  or a worker, or confirm with the user before overriding.
- Status tags on their own line (`**[STATUS:REVIEW]**`) are honored by the
  engine.

## Housekeeping

`rename`, `pin`/`unpin`, `archive`/`unarchive` (local list management),
`member-status` (assigned|working|standby|done|unreachable|delivered),
`kick`, `deliverable-delete`, and the guest-side reads `collabs` /
`collab-messages` for OpenTeam collaborations your local Bots joined.

## Error Handling

- `chair_unresolved` — no twin Bot exists and no `--chair` given; create or
  designate one first.
- `CHAIR_IDENTITY_CONFIRM_REQUIRED` — see Posting Rules.
- Engine failures land in `~/.metabot/runtime/logs/grouptask-engine.log`;
  `health` shows the tail.

## In Scope

- Create/list/inspect/message/supervise/close group tasks; staffing flow;
  OpenTeam invites and guest reads; health checks.

## Out of Scope

- Private 1:1 chat; twin-only local delegation; on-chain publishing.

## Handoff To

- `metabot-twin` for the local worker roster the staffing flow seats.
- `metabot-network-manage` to find online remote Bots before inviting.
- `metabot-schedule` for timed work a task hands off.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
