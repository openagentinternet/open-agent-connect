---
name: metabot-twin
description: Use when a human or agent asks about the machine's Twin Bot or its local Worker roster (孪生 Bot/分身/本地 Bot 列表) — who the twin is, which worker Bots exist with what skills and availability, or the twin's delegation task ledger. Do not use this skill for group tasks (metabot-grouptask) or general identity management.
---

# Twin Bot and Worker Roster

Every machine has at most one **Twin Bot** — the machine-wide default Bot
that OAC commands resolve to when no `--from` is given — and a roster of
local Worker Bots it can delegate to. This skill reads that world: who the
twin is, the sanitized worker roster, and the twin's delegation task ledger.
Treat Bot, bot, and MetaBot as equivalent user wording for the selected local
profile.

## Host Adapter

Generated for Claude Code.

- Default skill root: `${CLAUDE_HOME:-$HOME/.claude}/skills`
- Host pack id: `claude-code`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`twin workers` accepts optional `--from <twin-slug>` to read a specific
Bot's roster view; omitted, it uses the current twin. The `twin tasks`
verbs accept `--from <bot-slug>` for the owning twin.

## Trigger Guidance

Should trigger when:

- The user asks who the twin Bot is, or to list local Bots and what each can
  do (哪个 Bot 是孪生/有哪些本地 Bot).
- The user asks for the status of the twin's delegation tasks.

Should not trigger when:

- The user wants a multi-Bot on-chain group task (`metabot-grouptask`).
- The user wants identity/profile management (`metabot-identity-manage`).

## Verb Cheat-Sheet

| Verb | Purpose | Key flags |
|---|---|---|
| `twin current` | the current twin slug (`null` when none) | — |
| `twin workers` | sanitized worker roster (persona, skills, availability, recent activity) | `[--from <twin-slug>]` |
| `twin tasks list` | delegation tasks | `--status`, `--limit` |
| `twin tasks show` | one task with steps and attempts | `--task-id <id>` |
| `twin tasks pending-notify` | terminal attempts not yet notified | — |
| `twin tasks create` | record a delegation task (ledger) | `--payload-file { title, goal?, steps?[] }` |
| `twin tasks update` | update task/step/attempt state (ledger) | `--payload-file` |

`twin workers` returns `rosterBlock` — a model-ready formatted roster. When
no twin exists, `twin workers` fails with `twin_not_found` and guidance to
designate one via `metabot bot update --payload-file {"botType":"twin"}`.

## Delegation Reality Check

The task ledger is host-agnostic, but **executing a delegation step as a
live sub-session is a host capability**: on DSH, the twin's native
`local_worker_delegate` tool runs workers as real DSH conversations. On
hosts without live session control, use this skill to read the roster and
ledger; create/update tasks only when something (a scheduled task, a group
task, an external driver) will actually execute and settle them.

## Error Handling

- `twin_not_found` — no twin Bot on the machine; create/designate one first.
- `not_found` — the task id does not exist for the selected twin.

## In Scope

- Inspect the twin, the worker roster, and the delegation task ledger.

## Out of Scope

- Group tasks and OpenTeam (`metabot-grouptask`).
- Bot profile/identity CRUD (`metabot-identity-manage`).

## Handoff To

- `metabot-grouptask` when multi-Bot coordination should live on-chain.
- `metabot-identity-manage` to create Bots or change the twin.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
