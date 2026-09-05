---
name: metabot-schedule
description: Use when a human or agent asks to create, list, update, delete, enable, disable, run, or inspect scheduled tasks for a local Bot — recurring prompts the Bot executes on a timer, such as "每天上午9点总结昨天的梦境" or "run this every hour" (定时任务). Also use for host/daemon-facing due/claim/complete bookkeeping. Do not use this skill for one-off chat, memory operations, or on-chain publishing.
---

# Bot Scheduled Tasks

Create and manage scheduled tasks — prompts a MetaBot runs by itself on a
timer, through the same LLM runtime the Bot uses for everything else. Treat
Bot, bot, and MetaBot as equivalent user wording for the selected local
profile.

## Host Adapter

Generated for WorkBuddy.

- Default skill root: `$HOME/.workbuddy/skills`
- Host pack id: `workbuddy`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Schedule commands accept optional `--from <bot-slug>`.
Use it whenever the human names a specific local Bot, or a previous workflow
step already selected a Bot. If `--from` is omitted, the CLI uses the Twin
Bot.

## Trigger Guidance

Should trigger when:

- The user wants a Bot to do something automatically at a time, on a repeat
  interval, or on a cron schedule (定时任务、定时、循环执行).
- The user asks to see, change, pause, or run one of the Bot's scheduled
  tasks, or to inspect past scheduled runs.
- A host or daemon workflow needs the due/claim/complete task ledger.

Should not trigger when:

- The user wants a one-off conversation with a Bot.
- The user asks about memory, dream, knowledge bases, or on-chain publishing.

## Core Rule — Prompts Describe Runtime Behavior

A scheduled task's `--prompt` is **executed by the Bot when the task fires**,
it is not a pre-computed result. Never write a prompt that embeds the answer;
write the instruction the Bot should carry out at run time. For example,
`--prompt "Summarize yesterday's dream diary"` is correct — the Bot reads the
diary when the task fires. `--prompt "The diary said X"` is wrong: it is
already stale by the time the task runs.

## Verb Cheat-Sheet

| Verb | Purpose | Key flags |
|---|---|---|
| `schedule create` | create a task | `--name`, `--prompt`, one of `--at` / `--every` / `--cron` |
| `schedule list` | list tasks | `[--from]` |
| `schedule show` | one task + state | `--id` |
| `schedule update` | partial update | `--id`, `--payload-file` |
| `schedule delete` | delete task + runs | `--id`, `--confirm` |
| `schedule enable` / `disable` | toggle | `--id` |
| `schedule run` | run now, manually | `--id` |
| `schedule runs` | run history | `[--id] [--limit]` |
| `schedule due` | due tasks | `[--from]` or `--all` |
| `schedule claim` | claim for a host | `--id`, `[--executor]` |
| `schedule complete` | settle a claimed run | `--run-id`, `[--error]` |

## Schedule Selectors

Exactly one of these defines when a task fires:

- `--at <iso>` — **one-shot, local wall-clock time**. Example:
  `--at 2026-09-06T14:30:00` fires once at 14:30 local time on 2026-09-06 and
  then disables itself. The datetime is interpreted in the machine's local
  timezone — do not append `Z` or an offset unless the user means UTC.
- `--every <ms>` — repeat interval, minimum 60000 (1 minute).
- `--cron <expr>` — 5-field cron
  (`minute hour day-of-month month day-of-week`), machine-local timezone.
  Supported subset: `*`, `*/n`, `a`, `a-b`, `a,b,c`. Day-of-month and
  day-of-week use standard cron OR-semantics when both are restricted.

Example — one-shot task:

```bash
$HOME/.metabot/bin/metabot schedule create --from <bot-slug> --name "morning digest" \
  --prompt "Summarize yesterday's dream diary." --at 2026-09-06T08:00:00
```

Example — repeating interval:

```bash
$HOME/.metabot/bin/metabot schedule create --name "kb sweep" \
  --prompt "Scan MetaWeb for new guides and save them to the knowledge base." \
  --every 3600000
```

Example — cron (every Monday 09:00 local):

```bash
$HOME/.metabot/bin/metabot schedule create --name "weekly review" \
  --prompt "Write a weekly review of this week's work." --cron "0 9 * * 1"
```

## Useful Behaviors

- **Where runs live:** `schedule runs` shows the run ledger (trigger,
  executor, status, duration, error). A manual `schedule run` records
  `trigger: manual`, `executor: cli`; daemon fires record `daemon`; host
  claims record `host`.
- **Auto-disable:** a task disables itself after 5 consecutive errors, and a
  one-shot `--at` task disables after any execution. Success resets the error
  counter.
- **Expiry:** `--expires-at YYYY-MM-DD` stops a task from firing at or after
  that date. Enabling an expired task returns a `TASK_EXPIRED` warning;
  enabling a one-shot `--at` task whose datetime is in the past returns a
  `TASK_AT_PAST` warning.
- **Catch-up:** a task missed while everything was down fires once, then its
  next occurrence is recomputed from the settle time — no burst of missed
  runs.
- **No overlap:** a task never runs twice at the same time; the daemon and
  hosts coordinate through an atomic claim.

## Error Handling

- `invalid_argument` — the name, prompt, schedule selector, channel, or
  expires-at value is malformed; show the message and ask the user to fix it.
- `task_not_found` / `task_run_not_found` — the id does not exist in the
  selected Bot's store.
- `already_running` — the task already has a live run; wait for it to settle.
- `task_expired` — the task is past its expiry and cannot fire.
- `schedule_run_failed` — the manual run's LLM execution failed; the run was
  settled as an error, inspect `schedule runs` for the message.

## In Scope

- Create/list/show/update/delete/enable/disable scheduled tasks.
- Manual execution via `schedule run` and run-ledger inspection via
  `schedule runs`.
- Host/daemon bookkeeping: `schedule due`, `schedule claim`,
  `schedule complete`.

## Out of Scope

- One-off chats or memory/dream operations.
- On-chain publishing, service orders, or network management.

## Handoff To

- `metabot-help` for capability questions.
- `metabot-memory-*` skills when a task's work is about memory.
- `metabot-metaweb` / `metabot-browser` when a task prompt needs web reads.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
