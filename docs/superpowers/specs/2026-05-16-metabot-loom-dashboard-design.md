# MetaBot Loom Dashboard And Aggregation Design

Date: 2026-05-16
Status: SDD for Phase 3 implementation planning

## Context For The Implementer

This document defines Phase 3 of the MetaBot Loom work. It is written for a future AI development session that does not have the conversation history that produced it.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, SKILL documents, and code comments must be written in English.
- New storage must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce code or documentation that depends on the legacy `.metabot/hot` layout.

Protocol source of truth:

- `docs/metaid_protocols/05-loom.md`

Previous Loom phases:

- Phase 1 design: `docs/superpowers/specs/2026-05-15-metabot-loom-cli-design.md`
- Phase 1 implementation plan: `docs/superpowers/plans/2026-05-15-metabot-loom-cli-implementation.md`
- Phase 2 design: `docs/superpowers/specs/2026-05-16-metabot-loom-workflow-cli-design.md`
- Phase 2 implementation plan: `docs/superpowers/plans/2026-05-16-metabot-loom-workflow-cli-implementation.md`

Historical note:

- `docs/superpowers/plans/2026-05-15-metabot-loom-cli-prd.md` is historical background only.
- Do not use that PRD as an implementation source.
- For Phase 3, this design, the Phase 2 design, the Phase 2 implementation, and `docs/metaid_protocols/05-loom.md` are authoritative.

## Phase 2 Baseline

Phase 2 produced a working CLI vertical slice:

1. `metabot loom post-task` writes a `loom-task`.
2. `metabot loom claim-and-start` writes `loom-claim`, prepares the GitHub workspace, and writes a started `loom-status`.
3. `metabot loom run-dev-round` runs one explicit development round, commits work, uploads process logs, and writes `loom-status`.
4. `metabot loom deliver` creates a GitHub pull request and writes `loom-delivery`.
5. `metabot loom accept-and-pay` previews acceptance without payment by default, confirms payment only with `--confirm-payment`, and writes `loom-acceptance`.
6. `metabot loom state --refresh` can derive one task state from raw Loom records.

Phase 2 is intentionally CLI-first. It has enough local state and raw chain data to prove the workflow, but not enough aggregation or UI for a human to monitor many tasks.

## Goal

Build a local Loom dashboard that lets a human or MetaBot operator inspect Loom work across tasks, claims, development statuses, deliveries, reviews, and payments.

The Phase 3 goal is not another chain-write workflow. The goal is a read-first aggregation and board UI:

- aggregate the six Loom protocols into task-centric workflow records;
- preserve invalid and disputed records as visible evidence instead of silently dropping them;
- combine global raw chain records with local workflow state when available;
- expose a daemon JSON API for the dashboard and future agents;
- add a `metabot loom dashboard` read command for testability and terminal use;
- add a `metabot ui open --page loom` handoff and a built-in `/ui/loom` board;
- show enough context for requesters and developers to decide the next action without reading raw JSON.

## Non-Goals

Phase 3 must not become a full product portal.

Out of scope:

- fully automatic task discovery, claim selection, or multi-round scheduling;
- in-browser wallet payment execution;
- in-browser GitHub PR creation or merge;
- third-party hosted aggregation APIs;
- public multi-user web hosting;
- reputation scoring that affects claim eligibility;
- notification delivery outside the local dashboard;
- protocol changes to the six Loom protocols.

The dashboard may show action handoffs, such as copyable CLI commands, PR links, process log links, and state explanations. The first dashboard version should not perform high-risk write actions from the browser.

## Key Decisions

1. Raw Loom records remain the durable input. The dashboard does not invent state that cannot be traced back to raw `loom-*` records or local workflow state.
2. The canonical raw cache remains the existing `~/.metabot/loom/records.json` cache created by `metabot loom sync`.
3. The derived dashboard index is profile-scoped under the active profile runtime root, because it contains actor-context flags and may include local workflow paths.
4. The aggregation layer must work even when local workflow state is absent. A task created on another machine must still appear from chain data.
5. Local workflow state can enrich the view with workspace paths, local branch names, LLM session ids, and uploaded process log URIs, but it cannot override chain-derived truth.
6. Invalid records are first-class dashboard data. A malformed status or unauthorized acceptance should be visible in a warnings area and must not mutate the canonical derived task state.
7. The board groups tasks by derived state, not by protocol type.
8. The task detail view shows a timeline that combines every valid and invalid related record.
9. UI refresh uses the same raw sync pipeline as CLI refresh. If chain refresh fails, the dashboard may render stale cached data with an explicit warning.
10. The UI is local and operator-focused: dense, scannable, predictable, and built for repeated inspection.

## Layer Model

Phase 3 adds four layers on top of Phase 2.

1. **Raw record layer**
   - Existing `src/core/loom/rawCache.ts`
   - Existing `src/core/loom/rawChainReader.ts`
   - Existing `metabot loom sync`
   - Owns storage of raw, protocol-bucketed chain records.

2. **Task aggregation layer**
   - New `src/core/loom/dashboardAggregation.ts`
   - Converts raw records plus optional local workflow states into task cards, claim summaries, state columns, timelines, warnings, and metrics.
   - Must be deterministic and side-effect-free.

3. **Dashboard service layer**
   - New `src/core/loom/dashboardStore.ts`
   - New `src/core/loom/dashboardService.ts`
   - Reads raw cache, optionally refreshes chain data, reads workflow state enrichments, writes a profile-scoped derived index, and returns dashboard payloads.

4. **Daemon and CLI presentation layer**
   - CLI command: `metabot loom dashboard`
   - Daemon API:
     - `GET /api/loom/dashboard`
     - `GET /api/loom/tasks/:taskPinId`
     - `POST /api/loom/refresh`
   - UI page:
     - `/ui/loom`
     - `metabot ui open --page loom`

## Storage Design

### Raw Cache

Keep the existing raw cache location:

```text
~/.metabot/loom/records.json
```

This is global, non-secret chain cache data. Phase 3 must not move it unless a separate migration design is written.

### Derived Dashboard Index

Add a profile-scoped derived index:

```text
~/.metabot/profiles/<slug>/.runtime/loom/dashboard/index.json
```

Shape:

```json5
{
  "version": 1,
  "updatedAt": 1778896800000,
  "rawCacheUpdatedAt": 1778896790000,
  "profile": {
    "slug": "eric",
    "globalMetaId": "idq..."
  },
  "summary": {
    "totalTasks": 12,
    "open": 2,
    "claimed": 1,
    "inProgress": 4,
    "delivered": 2,
    "revisionNeeded": 1,
    "rejected": 1,
    "acceptedPaid": 1,
    "invalidRecords": 3,
    "needsMyAction": 2
  },
  "tasks": [
    {
      "taskPinId": "...i0",
      "state": "delivered",
      "title": "Add Loom dashboard",
      "updatedAt": 1778896790000
    }
  ]
}
```

The stored index is a fast local read model, not the source of truth. It can be rebuilt at any time from raw cache plus local workflow state.

### Local Workflow Enrichment

Use the existing profile-scoped Phase 2 workflow files:

```text
~/.metabot/profiles/<slug>/.runtime/loom/workflows/<taskPinId>/<claimPinId>.json
~/.metabot/profiles/<slug>/.runtime/loom/logs/<taskPinId>/
~/.metabot/profiles/<slug>/.runtime/loom/workspaces/<taskPinId>/<claimPinId>/repo
```

The dashboard may display:

- local workspace path;
- local branch name;
- LLM session ids;
- local process log path;
- uploaded `metafile://` process log URI;
- check summaries and commit records already captured by Phase 2.

The dashboard must label local-only fields as local evidence. They must not be confused with on-chain records.

## Aggregation Model

### Dashboard Summary

The dashboard top-level model should include:

- refresh status and last successful refresh time;
- active profile identity;
- task counts by state;
- count of invalid records;
- count of tasks needing the active profile's action;
- newest activity timestamp;
- filters applied.

### Board Columns

Use these board columns:

| Column | Included states |
| --- | --- |
| Open | `open` |
| Claimed | `claimed` |
| Working | `in_progress` |
| Review | `delivered` |
| Revision | `revision_needed` |
| Closed | `accepted_paid`, `rejected`, `failed` |

This keeps the board compact while still showing the important workflow transitions.

### Task Card

Each task card should show:

- task title;
- derived state label and tone;
- task PIN short form with copy affordance in UI;
- requester label;
- bounty amount and currency;
- repository owner/name and base branch when GitHub-based;
- tags;
- latest activity time;
- active claim count;
- latest status summary;
- PR URL when delivered;
- payment txid when accepted and paid;
- warning count for invalid related records;
- "needs my action" marker when the active profile is the requester or developer and the next action is theirs.

### Task Detail

The detail view should show:

- task requirement and acceptance criteria;
- GitHub repository link;
- all claims;
- claim reject records;
- all status records with commits and process logs;
- deliveries with PR links and review checklists;
- acceptances with verdict, score, payment flag, payment txid, and attachments;
- invalid records with reason codes;
- local workflow enrichment when available;
- copyable CLI handoff commands for the next likely action.

### Timeline Events

Create a normalized timeline event type:

```ts
type LoomDashboardTimelineEventKind =
  | 'task'
  | 'claim'
  | 'status'
  | 'delivery'
  | 'acceptance'
  | 'claim_reject'
  | 'local_workflow'
  | 'invalid_record';
```

Timeline sorting:

1. sort by timestamp ascending;
2. tie-break by protocol priority: task, claim, status, delivery, acceptance, claim-reject, local workflow, invalid record;
3. final tie-break by `pinId` or stable local id.

### Actor Context

The dashboard should derive the active profile context when available:

- `isRequester`: active profile globalMetaId equals task author globalMetaId.
- `isDeveloper`: active profile globalMetaId equals at least one valid claim author globalMetaId.
- `needsMyAction`:
  - requester: task is `delivered`, `revision_needed` after a new delivery, or has suspicious invalid acceptance/payment records;
  - developer: task is `open` and not claimed by them, `claimed`/`in_progress` by them, or `revision_needed` for their latest delivery;
  - both: show a neutral mixed-role marker, never silently choose one side.

Actor context must be advisory. It must not change the protocol-derived task state.

## State Derivation Rules

Phase 3 should build on `buildLoomWorkflowTaskState`, but it needs a richer multi-task projection. The richer aggregator should keep the same core safety rules:

- invalid payloads do not affect state;
- `loom-status` author must match the referenced claim author;
- `loom-delivery` author must match the referenced claim author;
- `loom-acceptance` author must match the task author;
- `loom-claim-reject` author must match the task author;
- `loom-claim` without `payoutAddress` is invalid for workflow use;
- `accepted_paid` requires `verdict: "passed"`, `releasePayment: true`, and a non-empty `paymentTxId`;
- a delivery after an acceptance reopens the task into review state;
- a status after an acceptance can show renewed work, but the timeline must make the ordering explicit.

Additional Phase 3 rules:

- Multiple active claims are allowed. The task card summarizes the latest active claim and shows a claim count. The detail view lists every claim.
- Rejected claims are not active, but remain visible.
- A task with only invalid claims remains `open` with warnings.
- A task with an acceptance that references an unknown delivery remains in the previous valid state with warnings.
- A task with payment evidence but invalid acceptance remains in the previous valid state with warnings.
- A task with a stale local workflow file but no matching chain claim may show local evidence only in the warnings/detail area, not as an active claim.

## API Design

### `GET /api/loom/dashboard`

Query params:

- `from`: optional profile slug for actor context.
- `refresh`: `true` or `false`.
- `limit`: optional task limit.
- `state`: optional derived state or board column.
- `role`: optional `all`, `requester`, `developer`, or `needs_action`.
- `query`: optional text search over title, repo, tags, task PIN, claim PIN, delivery PIN, PR URL, and payment txid.

Response:

```json5
{
  "ok": true,
  "state": "success",
  "data": {
    "dashboard": {
      "summary": {},
      "columns": [],
      "filters": {},
      "refresh": {
        "requested": true,
        "succeeded": true,
        "updatedAt": 1778896800000,
        "warning": null
      }
    }
  }
}
```

If refresh fails but cached data exists, return success with `refresh.succeeded: false` and a warning. If no cached data exists, return a command failure with a stable code such as `loom_dashboard_unavailable`.

### `GET /api/loom/tasks/:taskPinId`

Query params:

- `from`: optional profile slug for actor context.
- `refresh`: `true` or `false`.

Response includes one detailed task projection. Missing task returns `task_not_found`.

### `POST /api/loom/refresh`

Body:

```json
{
  "from": "eric",
  "limit": 200
}
```

Behavior:

- run the same refresh path as `metabot loom sync`;
- rebuild the profile-scoped dashboard index;
- return summary and refresh metadata.

No chain writes, payments, GitHub writes, or local repository mutations are allowed from this endpoint.

## CLI Design

### `metabot loom dashboard`

Usage:

```bash
metabot loom dashboard [--from <bot-slug>] [--refresh] [--limit <n>] [--state <state-or-column>] [--role <all|requester|developer|needs_action>] [--query <text>]
```

Purpose:

- expose the same read model as the daemon API;
- make aggregation testable without opening a browser;
- support future skills that need a machine-readable Loom task board.

Default output can be JSON-oriented through the normal CLI result envelope. Human table formatting can be added later if needed.

### `metabot ui open --page loom`

Extend the existing UI open command:

```bash
metabot ui open --page loom
metabot ui open --page loom --from eric
```

The returned `localUiUrl` should point at `/ui/loom`, with `from` forwarded as a query param when provided.

## UI Design

The UI should be a board, not a landing page.

Primary layout:

- top toolbar with refresh, profile context, last refresh time, and compact filters;
- metrics row for total tasks, open, working, review, closed, invalid records, and needs action;
- horizontally scrollable board columns on narrow screens;
- task detail drawer or side panel for the selected task;
- timeline inside the detail panel;
- warning section for invalid or suspicious records.

Visual stance:

- operational and dense;
- no hero section;
- no marketing copy;
- no decorative gradients or cards inside cards;
- cards are only task cards and modal/detail panels;
- use stable dimensions for board columns and task cards;
- text must not overflow buttons, badges, or cards;
- use icons for refresh, copy, external link, warning, PR, payment, and process log actions when the repo already has a suitable icon strategy; otherwise use compact text buttons.

Task cards should be compact enough for repeated scanning. The detail panel can be richer.

Action affordances:

- open GitHub repo/PR in a new tab;
- copy task/claim/delivery/acceptance PINs;
- copy likely CLI commands;
- open process log URIs when they can be rendered locally;
- open local workspace path as text only; do not assume browser file access;
- show accept/pay or revision commands as copyable CLI handoffs, not browser-executed writes.

## Error Handling

Stable error codes:

- `loom_dashboard_unavailable`: no usable raw cache or derived index is available.
- `loom_dashboard_refresh_failed`: refresh failed but cached dashboard data may still be renderable.
- `loom_dashboard_task_not_found`: task detail requested for a missing task.
- `loom_dashboard_invalid_filter`: unsupported state, role, limit, or query value.
- `loom_dashboard_profile_not_found`: `--from` or `from` does not resolve to a local profile.

UI behavior:

- If refresh fails and stale data exists, render stale data with a warning.
- If a task has invalid related records, show a warning badge and detail list.
- If a task's state is ambiguous, show the latest valid state and include an ambiguity warning.
- If daemon API is unavailable, show a plain error panel with retry.

## Testing Strategy

Use targeted tests first:

- `tests/loom/dashboardAggregation.test.mjs`
- `tests/loom/dashboardStore.test.mjs`
- `tests/loom/dashboardService.test.mjs`
- `tests/cli/loom.test.mjs`
- `tests/cli/help.test.mjs`
- `tests/cli/doctor.test.mjs` for `ui open` support if needed
- `tests/daemon/httpServer.test.mjs`
- `tests/ui/loomViewModel.test.mjs`
- `tests/ui/loomPageScript.test.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs` if generated skillpack runtime artifacts or help output changes

Run full `npm test` before final acceptance because Phase 3 touches daemon routes, UI, CLI help, and Loom aggregation shared runtime behavior.

## Acceptance Criteria

Positive acceptance:

1. A real or fixture raw cache with task, claim, status, delivery, acceptance, and claim-reject records produces deterministic board columns.
2. A task that completed the Phase 2 real workflow appears as `accepted_paid`, shows the PR URL, shows the payment txid, and has a complete timeline.
3. A task with a delivery and no acceptance appears in the Review column.
4. A task with revision requested appears in the Revision column and marks developer action needed.
5. A task with local workflow state shows local branch, workspace, LLM session, process logs, and commits when available.
6. `metabot loom dashboard --refresh --json` returns the dashboard model.
7. `GET /api/loom/dashboard?refresh=true` returns the same dashboard model shape.
8. `metabot ui open --page loom` returns a local UI URL.
9. `/ui/loom` renders the board, supports refresh, filters, task selection, copy buttons, and external PR links.

Negative acceptance:

1. A malformed payload is counted and shown as invalid, but does not change task state.
2. A status written by a non-claim author is invalid and does not move the task into Working.
3. A delivery written by a non-claim author is invalid and does not move the task into Review.
4. An acceptance written by a non-task author is invalid and does not close the task.
5. A passed acceptance without `paymentTxId` does not become `accepted_paid`.
6. A claim without `payoutAddress` is invalid for workflow use.
7. Refresh failure with a previous index renders stale data with a warning.
8. Refresh failure with no previous index returns a stable failed result.
9. Unsupported filter values return `loom_dashboard_invalid_filter`.
10. Browser UI does not perform payment or chain writes.

## Manual Validation Flow

After implementation, validate against the Phase 2 E2E shape:

1. Run a small Loom task through CLI until `accepted_paid`.
2. Run `metabot loom dashboard --refresh --from eric --json`.
3. Confirm the accepted task appears in the Closed column with PR and payment txid.
4. Run `metabot ui open --page loom --from eric`.
5. Open the returned URL.
6. Refresh the board.
7. Select the E2E task.
8. Confirm timeline order: task, claim, started status, completed status, delivery, acceptance.
9. Confirm process logs and PR links are visible.
10. Confirm no browser action can accidentally pay or write chain data.
