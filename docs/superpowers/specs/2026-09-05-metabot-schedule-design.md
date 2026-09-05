# MetaBot Scheduled Tasks (定时任务) — Port Design

Date: 2026-09-05
Status: proposed
Source: IDBots `main` (`src/main/scheduledTaskStore.ts`, `src/main/libs/scheduler.ts`, `SKILLs/scheduled-task/`)

## Goal

Port IDBots' scheduled-task system to OAC, CLI-first:

- `metabot schedule *` owns the data model, due math, and run ledger (usable from
  Codex, Claude Code, OpenClaw, any host).
- The OAC daemon executes due tasks headlessly through the bot's bound LLM
  runtime (the same `runLlmPromptWithRuntimeFallback` path the grouptask engine
  and study scheduler use).
- The DSH plugin claims due tasks while it is alive and runs each one as a **new
  DSH conversation** (IDBots parity: a `[Scheduled] <name>` session the user can
  watch and continue).

## Data model

Per-bot store (storage layout v2): `<profile>/.runtime/schedule/schedule.json`,
`{version: 1, tasks: ScheduledTask[], runs: ScheduledTaskRun[]}`, atomic
write-then-rename with a per-store serialized write queue (same conventions as
`dream-runs.json`). Tasks belong to one bot; `--from` resolves the profile the
same way as `memory`/`dream` (Twin default).

```ts
type ScheduleSpec =
  | { type: 'at'; datetime: string }                 // local wall-clock ISO, one-shot
  | { type: 'interval'; intervalMs: number }         // min 60_000
  | { type: 'cron'; expression: string };            // 5-field cron, machine-local tz

type ScheduledTask = {
  id: string;                    // uuid
  name: string;
  description: string;           // default ''
  enabled: boolean;              // default true
  schedule: ScheduleSpec;
  prompt: string;                // sent verbatim as the user message
  workingDirectory: string;      // '' → executor default (see below)
  channel: 'auto' | 'host' | 'daemon'; // default 'auto'
  expiresAt: string | null;      // date-only YYYY-MM-DD, null = never
  state: {
    nextRunAtMs: number | null;
    lastRunAtMs: number | null;
    lastStatus: 'success' | 'error' | 'running' | null;
    lastError: string | null;
    lastDurationMs: number | null;
    runningAtMs: number | null;
    consecutiveErrors: number;   // default 0
  };
  createdAt: string;
  updatedAt: string;
};

type ScheduledTaskRun = {
  id: string;                    // uuid
  taskId: string;
  status: 'running' | 'success' | 'error';
  trigger: 'scheduled' | 'manual';
  executor: 'daemon' | 'host' | 'cli' | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
};
```

Rules carried over from IDBots:

- Auto-disable after **5 consecutive errors**; counter resets on success.
- One-shot `at` tasks auto-disable after any execution.
- Run history pruned to **100 runs per task**.
- Expired tasks (`expiresAt <=` UTC today) never fire and are not deleted;
  enabling one returns a `TASK_EXPIRED` warning, enabling a past `at` task a
  `TASK_AT_PAST` warning.
- Crash recovery: on store load, runs stuck in `running` are flipped to `error`
  ("Process stopped during execution") **without** incrementing
  `consecutiveErrors`.
- Missed fires while everything was down: fire **once** on catch-up; the next
  occurrence is recomputed from `now` (no interval storm). Same for cron.
- No overlap for the same task (guarded by `runningAtMs`); different tasks may
  run concurrently.

## Cron parsing

No new dependency. `src/core/schedule/cron.ts` implements the documented
5-field subset: `*`, `*/n`, `a`, `a-b`, `a,b,c` per field
(minute hour day-of-month month day-of-week), local timezone, next occurrence
by minute-scanning with a 4-year bound. Day-of-month and day-of-week follow
standard cron OR-semantics when both are restricted.

## CLI surface (`src/cli/commands/schedule.ts`, handlers in `runtime.ts`)

| Verb | Purpose |
|---|---|
| `create --name --prompt (--at <iso>\|--every <ms>\|--cron <expr>) [--from] [--working-directory] [--channel] [--expires-at] [--disabled]` | create task |
| `list [--from]` / `show --id [--from]` | read |
| `update --id --payload-file` | partial update (name/prompt/schedule/enabled/…) |
| `delete --id --confirm` | delete task + its runs |
| `enable --id` / `disable --id` | toggle (enable may return `TASK_AT_PAST`/`TASK_EXPIRED` warnings) |
| `run --id` | manual execution now, in-process via LLM runtime bindings (`executor: 'cli'`, `trigger: 'manual'`); bypasses expiry/enabled |
| `runs [--id] [--limit]` | run history (per task or all) |
| `due [--from] [--all]` | due tasks for one bot or every profile (host/daemon facing) |
| `claim --id [--from] --executor host` | atomically create run row + mark running; fails `already_running` if claimed |
| `complete --run-id [--from] [--error] [--duration-ms]` | settle a claimed run (success or error), apply auto-disable/prune rules |

Standard envelope (`commandSuccess`/`commandFailed`), `--payload-file` for
structured input, exit codes per `src/cli/main.ts` conventions.

## Daemon execution (headless / non-DSH hosts)

New ticker in `serveCliDaemonProcess` (template: the study scheduler at
`runtime.ts`): every **30 s**, iterate every indexed profile, load its schedule
store, and for each due task:

1. Skip if a **fresh host lease** covers that profile (see below) and the task
   channel is `auto`/`host`. Channel `daemon` tasks always run here.
2. Claim in-process (serialized, race-free), then execute the prompt with
   `runLlmPromptWithRuntimeFallback` against the bot's LLM runtime bindings,
   timeout 30 min. System prompt: task's `systemPrompt`-equivalent is v1-omitted;
   the bot persona + a short "scheduled task" framing wraps the prompt.
3. Settle the run honestly: executor throw/timeout → `error`; otherwise
   `success`.

The ticker has an in-flight guard, `unref()`d timer, and logs failures to the
size-capped engine log — a schedule failure must never take the daemon down.

## Host claiming (DSH and future hosts)

The daemon holds an in-memory **host lease** per profile:
`{host: string, expiresAtMs}`.

- `POST /api/schedule/heartbeat {slug, host}` → lease = now + 3 min.
- While a lease is fresh, the daemon tick skips `auto`/`host` tasks for that
  profile — the host owns execution. Lease expiry (host closed/crashed) hands
  execution back to the daemon with the fire-once catch-up rule.

The DSH plugin (`dsh-plugin/src/schedule-scheduler.ts`, mirrors
`dream-scheduler.ts`) ticks every 60 s:

1. Heartbeat every local bot.
2. `schedule due --all` (CLI fallback when the daemon route is unreachable —
   safe because a dead daemon cannot race a claim).
3. For each due task: claim via `POST /api/schedule/claim`, then spawn a DSH
   session exactly like `local_worker_delegate` does
   (`agentsRegistry.create` + `agentPresets.mount` of `oac-<slug>`, the bot's
   DSH LLM pair with host-default fallback, `cwd = task.workingDirectory ||
   process.cwd()` so the run appears in the DSH conversation list).
4. Send `task.prompt` as the user message; completion = `whenIdle()` racing a
   per-run timeout (plugin config `schedule.runTimeoutMs`, default 30 min).
   A turn that dies with an error settles the run as `error` — honest outcomes,
   same lesson as `WORKER_EMPTY_HANDOFF`.
5. `POST /api/schedule/complete`.

Scheduled sessions use the `oac-*` preset, so per-turn memory injection and
post-turn transcript capture apply naturally — scheduled work feeds the bot's
dream day-activity like any other session.

## Config toggles

- Plugin (`cordis.yml` config): `schedule.enabled` (default true),
  `schedule.tickSeconds` (default 60), `schedule.runTimeoutMs` (default
  1_800_000).
- Core: none global; per-task fields only.

## Agent discoverability

New bundled skill `SKILLs/metabot-schedule/` (bilingual description, verbs
cheat-sheet, local wall-clock rule for `at`, "prompts describe runtime
behavior, not pre-computed results") — wired into `skillpacks/` like the other
15 metabot skills. No native Cordis tool in v1: DSH agents reach the CLI via
Bash + bound skills, per the 2026-09-05 session decision.

## Explicitly out of scope (v1)

- IM notifications (`notifyPlatforms`) — OAC has no IM gateways yet.
- DSH settings panel for tasks/runs — sessions and `metabot schedule list/runs`
  suffice; a panel can follow.
- `systemPrompt` per task, sandbox execution modes (retired upstream too).
- Per-task workspaces (IDBots reuses the bot workspace as well).

## Tests

- `tests/schedule/store.test.mjs` — store CRUD, due math (at/interval/cron),
  claim exclusivity, auto-disable at 5 errors, one-shot disable, expiry filter,
  crash-recovery sweep, run pruning.
- `tests/schedule/cron.test.mjs` — parser subset incl. dom/dow OR-semantics.
- `tests/cli/schedule.test.mjs` — dispatcher contract (verb routing, envelope,
  malformed-input failures), modeled on `tests/cli/dream.test.mjs`.
- All fast-tier (no daemon boots, no sleeps); temp dirs via
  `tests/helpers/tempRoots.mjs`.
