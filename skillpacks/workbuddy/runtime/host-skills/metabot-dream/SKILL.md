---
name: metabot-dream
description: Use when a human or agent asks about a local Bot's nightly dream — run a dream now, catch up missed nights, inspect dream status/diaries (梦境/做梦), or read the dream-written self-identity. Also covers the manual plan/synthesize/commit pipeline for hosts that execute the LLM call themselves. Do not use this skill for ordinary memory CRUD or scheduled tasks.
---

# Bot Dreams

A dream reviews one local day of a Bot's activity (mirrored transcripts, A2A
chats, group tasks, orders) and writes the diary, dream memories, knowledge
points, person impressions, and the evolving self-identity. The whole pipeline
is host-agnostic: `dream run` executes plan → LLM → commit using the Bot's
bound LLM runtime, so it works with no DSH host present. Treat Bot, bot, and
MetaBot as equivalent user wording for the selected local profile.

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

Dream commands accept optional `--from <bot-slug>`. Use it whenever the human
names a specific local Bot, or a previous workflow step already selected a
Bot. If `--from` is omitted, the CLI uses the Twin Bot.

## Trigger Guidance

Should trigger when:

- The user asks a Bot to dream now, catch up missed nights, or re-run one
  date's dream (做梦/补梦/重新做梦).
- The user asks what the Bot dreamed, for recent dream diaries, or for the
  Bot's current self-identity (自我认知).
- The user asks whether last night's dream ran, or why it failed.

Should not trigger when:

- The user only wants to recall dream content (use `metabot-memory`
  `memory recall` — it reads diaries without running anything).
- The user wants timed work (use `metabot-schedule`).

## Verb Cheat-Sheet

| Verb | Purpose | Key flags |
|---|---|---|
| `dream due` | dates due for this Bot, oldest first | `[--from]` |
| `dream status` | runs, diary count, self-identity presence | `[--from]` |
| `dream run` | full dream for one date (plan + LLM + commit) | `[--date <YYYY-MM-DD>]` (defaults to yesterday), `[--payload-file]` |
| `dream summaries` | daily diaries, newest first | `[--limit]` (default 30), `[--before <date>]` |
| `dream self-identity` | the current dream-written self-identity | `[--from]` |
| `dream fail` | mark one date's live run failed | `--payload-file { date, error? }` |

Example — run last night's dream now:

```bash
$HOME/.metabot/bin/metabot dream run --from <bot-slug>
```

Example — catch up a missed date:

```bash
$HOME/.metabot/bin/metabot dream run --from <bot-slug> --date 2026-09-18
```

Check what is owed first with `dream due`; missed nights are listed oldest
first and each can be run with an explicit `--date`.

## Surfacing the Dream Page

`dream status` and `dream run` success envelopes carry an additive
`localUiUrl` field when the CLI can resolve a local daemon base URL (it is
omitted otherwise — a missing link never fails the command). It deep-links
the standalone dream page for the resolved Bot (the `/ui/dream` route
resolves to the dream view), for example
`http://127.0.0.1:10001/ui/dream?from=<bot-slug>`. When it is present, surface
it to the user as a clickable link — opening it in the host's own browser or
preview surface per the host-adapter note above — for example "Dream diary:
<url>".

## When Dreams Fire Automatically

- On the DSH host, a plugin scheduler dreams each night while DSH is running
  (missed nights catch up automatically).
- On other hosts there is no automatic nightly trigger yet: run `dream run`
  on request, or set up a scheduled task whose prompt asks the Bot to run the
  dream (see `metabot-schedule`) for an unattended nightly cadence.

## Hosts That Execute the LLM Themselves

`dream run` is the simple path. A host that wants to run the LLM call on its
own model uses the pipeline verbs instead: `dream plan --date` returns the
prompt(s); a long day returns several fragments — run each through the LLM,
then `dream synthesize --payload-file { date, fragmentOutputs }` folds them
into the final prompt; run that through the LLM and `dream commit
--payload-file { date, outputText }` writes the results (idempotent per
date). On LLM/transport failure, `dream fail --payload-file { date, error }`
keeps the date from wedging in `running`.

## Prerequisites

- The Bot needs an LLM runtime binding (`metabot llm`), or a DSH host pair
  with the host executor connected. Without one, `dream run` fails with
  guidance to bind a runtime.
- The Bot's memory policy must have dreams enabled (`metabot memory policy
  get`); a quiet day with no activity still writes a diary entry.

## Error Handling

- `dream_run_failed` — the LLM execution failed; the message names the cause
  (often no runtime binding). The run is marked failed for that date.
- Runs stuck in `running` (for example after a host restart) are swept to
  `failed` after a stale threshold; re-run the date afterwards.

## In Scope

- Run/catch up dreams; inspect due dates, status, diaries, self-identity.
- Mark failed runs; drive the plan/synthesize/commit pipeline externally.

## Out of Scope

- Memory entry CRUD and recall (`metabot-memory`).
- Knowledge bases (`metabot-knowledge-base`), scheduled tasks
  (`metabot-schedule`), MetaWeb surf (`metabot-surf`).

## Handoff To

- `metabot-memory` to recall what dreams wrote (diaries, memories,
  impressions).
- `metabot-surf` for the optional pre-dream AI-internet surf report.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
