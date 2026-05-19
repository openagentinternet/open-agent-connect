# MetaBot Loom Product UI Design

Date: 2026-05-17
Status: Phase 4 SDD for productization planning

## Context For The Implementer

This document defines Phase 4 of MetaBot Loom. Phase 3 intentionally produced a read-first aggregation board with copy-only handoffs. Phase 4 turns that board into an operable local product surface.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, SKILL documents, and code comments must be written in English.
- New storage must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce code or documentation that depends on the legacy `.metabot/hot` layout.

Authoritative Loom sources:

- Protocol source: `docs/metaid_protocols/05-loom.md`
- Phase 2 workflow CLI design: `docs/superpowers/specs/2026-05-16-metabot-loom-workflow-cli-design.md`
- Phase 2 workflow CLI plan: `docs/superpowers/plans/2026-05-16-metabot-loom-workflow-cli-implementation.md`
- Phase 3 dashboard design: `docs/superpowers/specs/2026-05-16-metabot-loom-dashboard-design.md`
- Phase 3 dashboard plan: `docs/superpowers/plans/2026-05-16-metabot-loom-dashboard-implementation.md`

Historical note:

- `docs/superpowers/plans/2026-05-15-metabot-loom-cli-prd.md` is historical background only.
- Do not use that PRD as an implementation source.
- This Phase 4 document supersedes Phase 3 UI behavior where the two disagree.

User intent note:

- The requested productization work belongs in Phase 4. Do not split this scope into a later productization phase.

## Current Baseline

Phase 2 produced a working CLI workflow:

1. `metabot loom post-task`
2. `metabot loom claim-and-start`
3. `metabot loom run-dev-round`
4. `metabot loom deliver`
5. `metabot loom accept-and-pay`
6. `metabot loom review-delivery`
7. `metabot loom state`

Phase 3 produced:

- deterministic task-centric aggregation over the six Loom protocols;
- visible invalid-record warnings instead of silently consuming bad data;
- a daemon JSON dashboard API;
- `metabot loom dashboard`;
- `/ui/loom`, currently mostly read-only with copy-only CLI handoffs;
- task cards that expose requester and developer Bot identities;
- detail evidence for PRs, payment txids, local workflow logs, process logs, timelines, and raw records.

The current Phase 3 UI is not yet a product-grade task operation surface. Known gaps include:

- detail is fixed on the right and consumes board width;
- the board is constrained by the shared `.content` max-width;
- task cards are too tall for scanning;
- top controls are too prominent for the default global view;
- `/ui/loom?from=eric` makes the default feel actor-scoped instead of global;
- `needs my action` may appear without corresponding browser actions;
- review/payment/revision decisions still require copy-only CLI handoff;
- humans cannot publish a new Loom task directly from the UI.

## Goal

Build a product-grade local Loom operations UI that lets a human see the global Loom task flow, inspect compact task cards, open rich task details in a centered modal, publish new tasks, and perform confirmed high-value workflow actions from the browser while preserving CLI-safe fallbacks.

Phase 4 should make `/ui/loom` feel like the first usable product version:

- global by default, showing all cached/refreshable Loom tasks without `?from=<bot>`;
- task-centric, with flow states more important than raw protocol buckets;
- Bot-centric, with requester and developer Bot avatars/names visible on cards and details;
- board-first, with short scannable cards and full-width columns;
- operable, with confirmed actions for review, payment, revision, claim/start, and new task publishing;
- safe, with explicit confirmations before any chain write, payment, GitHub mutation, or local development operation;
- trustworthy, with invalid data and recovery paths visible instead of hidden.

## Non-Goals

Phase 4 should not become a hosted multi-user SaaS portal.

Out of scope:

- hosted public deployment;
- automatic infinite "claim to PR" loops;
- complex reputation scoring;
- drag-and-drop task state mutation in the board;
- merging GitHub PRs from the Loom UI;
- rewriting the Phase 2 CLI workflows;
- replacing raw-chain aggregation with a third-party aggregator;
- solving deep business analytics beyond the existing task projection;
- full mobile-first redesign beyond responsive usability;
- changing the six Loom protocol schemas unless a separate protocol SDD is approved.

## Product Thesis

Visual thesis:

- A compact engineering control board: dark OAC surfaces, full-width columns, low cards, visible Bot presence, and a centered high-density modal for evidence and decisions.

Content plan:

- Default surface: full-width board, slim title/action bar, state columns.
- Card surface: title, short summary, requester/developer avatars, state, warnings, latest activity.
- Detail surface: task requirement, criteria, Bot identities, state-specific action area, PR/payment/log evidence, timeline, raw warnings.
- Create surface: new task form based on `loom-task`, with preview, validation, and confirmed publish.

Interaction thesis:

- The board never loses context: details and create flow open as centered overlays above the board.
- Dangerous operations use a two-step confirmation with exact actor, payload/payment/git target, and fallback CLI.
- State changes should feel like task flow: after a successful action, the board refreshes and the card moves or updates in place.

## UI References

Use the existing OAC UI as the design system:

- `src/ui/shared.css`
- `/ui/trace` implementation in `src/ui/pages/trace/index.html`
- existing `/ui/loom` implementation in `src/ui/pages/loom/index.html` and `src/ui/pages/loom/app.ts`

Use the Multica board as an interaction/layout reference, not as a dependency:

- `/Users/tusm/Documents/MetaID_Projects/multica/packages/views/issues/components/board-view.tsx`
- `/Users/tusm/Documents/MetaID_Projects/multica/packages/views/issues/components/board-column.tsx`
- `/Users/tusm/Documents/MetaID_Projects/multica/packages/views/issues/components/board-card.tsx`
- `/Users/tusm/Documents/MetaID_Projects/multica/packages/views/issues/components/issue-detail.tsx`

Key patterns to borrow conceptually:

- columns are fixed-width, horizontally scrollable when needed;
- each column is a flex child with `min-height: 0`;
- each column's card list scrolls internally;
- cards are compact and prioritize title, short description, actor avatars, and only essential status;
- details are dense and evidence-rich, but should be modal-centered for Loom.

## Layout Design

### Page Shell

`/ui/loom` should use a full-width, full-height workspace like `/ui/trace`.

Requirements:

- no shared 1280px content cap for Loom's workspace;
- topbar remains shared OAC navigation;
- Loom content height is `calc(100vh - <topbar-height>)` or equivalent;
- the outer page must not scroll during normal board use;
- board columns own vertical scrolling;
- horizontal board overflow is allowed when the viewport is narrow;
- desktop and tablet should show as many columns as possible;
- mobile should remain usable with horizontal column scroll and centered modals.

### Top Bar Inside Loom

The Loom page's internal top area should be slim.

Show:

- title: `Loom`
- short scope label such as `Global task board`
- refresh button;
- `New task` button;
- optional small warning indicator when the cache is stale or invalid records exist.

Hide by default:

- state filter;
- role filter;
- query filter;
- actor context block;
- last-refresh block.

Filters can remain in code behind a collapsed advanced drawer if implementation cost is low, but they should not occupy the default screen. If the drawer is not implemented in Phase 4, remove the controls from the default UI and keep API-level filter support.

### Board

Keep the Phase 3 columns:

| Column | States |
| --- | --- |
| Open | `open` |
| Claimed | `claimed` |
| Working | `in_progress` |
| Review | `delivered` |
| Revision | `revision_needed` |
| Closed | `accepted_paid`, `rejected`, `failed` |

Column requirements:

- each column has a compact header with title and count;
- each column has a stable width, around 280px to 320px;
- each column is a flex column with internal list scroll;
- each list has `overflow-y: auto` and `min-height: 0`;
- empty columns show one understated empty row;
- external board container should have no vertical scroll.

### Task Cards

Cards must be shorter than Phase 3 cards.

Show only:

- state label or tone strip;
- task title, clamped to 2 lines;
- one-line summary from latest status, delivery summary, or requirement preview;
- requester Bot avatar/name;
- active developer Bot avatar/name when present;
- warning indicator when relevant;
- small latest activity timestamp.

Move these into detail:

- task PIN;
- bounty;
- repo/base branch;
- tags;
- claim counts;
- PR URL;
- payment txid;
- local workflow paths;
- CLI handoff commands;
- raw records.

Card click opens a centered detail modal. Cards should not perform mutation on click.

### Detail Modal

The default page should have no persistent detail panel. Clicking a task opens a centered overlay.

Modal requirements:

- desktop width should be generous, approximately `min(1040px, calc(100vw - 48px))`;
- max height should be `calc(100vh - 64px)`;
- modal body scrolls internally;
- board remains visible behind a subtle overlay;
- close button and Escape close;
- clicking outside closes only when no confirmation is active;
- focus returns to the clicked card after close;
- detail content is dense and organized.

Suggested detail sections:

1. Task header: title, state, next action, task PIN copy.
2. Action panel: state-aware primary/secondary actions.
3. Participants: requester Bot and active developer Bot with avatars, globalMetaId, address, payout address.
4. Requirement and criteria.
5. Delivery: PR link, branch, self-check checklist.
6. Payment: bounty, payout address, payment txid, acceptance score/comment.
7. Process evidence: statuses, commits, local logs, uploaded process logs, artifact URIs.
8. Timeline.
9. Warnings and invalid records.
10. Raw record appendix with copy affordances.

## State-Aware Next Actions

The UI must make each state understandable to a human.

| State | Human explanation | Primary action candidates |
| --- | --- | --- |
| `open` | Waiting for a developer Bot to claim the task. | `Claim and start` when a developer actor is selected; copy CLI fallback otherwise. |
| `claimed` | A developer Bot claimed the task and should begin work. | `Run dev round` or `Open local workspace` when local workflow exists. |
| `in_progress` | Development is underway. | `Run dev round`, `Deliver`, view logs and commits. |
| `delivered` | A PR or deliverable is ready for requester review. | `Accept and pay`, `Request revision`, `Reject`, `Open PR`. |
| `revision_needed` | Requester asked for changes. | developer: `Run revision round`; requester: view requested changes. |
| `accepted_paid` | Task was accepted and payment proof exists. | view payment proof and final evidence. |
| `rejected` | Delivery was rejected and task may be available again. | view rejection reason; possible future claim path. |
| `failed` | Developer abandoned or could not continue. | view failure reason; possible future claim path. |

Actor-sensitive labels:

- Global view without actor context should say `Review required`, `Developer needed`, or `Work in progress`, not `Needs my action`.
- Actor-specific `needs my action` should appear only when the UI knows the active actor.
- Mutating actions must require a selected actor. If no actor is active, the modal should prompt the human to choose or supply `from` before confirming.

## Action Model

Phase 4 upgrades copy-only handoff into confirmed UI actions. It should reuse existing Phase 2 workflows rather than duplicating business logic.

### Action Types

Add daemon/API action endpoints for:

- `postTask`: publish a new `loom-task` from the New task form;
- `claimAndStart`: run `metabot loom claim-and-start` behavior for a selected task;
- `runDevRound`: run one development round for an existing claim;
- `deliver`: create a GitHub PR and publish `loom-delivery`;
- `acceptAndPay`: preview and confirm payment plus `loom-acceptance`;
- `requestRevision`: publish a `revision_needed` acceptance through the existing Phase 2 `reviewDelivery` workflow;
- `reject`: publish a `rejected` acceptance through the existing Phase 2 `reviewDelivery` workflow;
- optional `previewAction`: return exact CLI fallback and confirmation envelope without mutating state.

The implementation can expose these as separate REST endpoints or one typed action endpoint. The recommended API is one typed endpoint:

```text
POST /api/loom/actions
```

with:

```json5
{
  "action": "acceptAndPay",
  "from": "requester-bot",
  "taskPinId": "task...i0",
  "deliveryPinId": "delivery...i0",
  "score": 5,
  "comment": "Accepted.",
  "chain": "mvc",
  "confirm": false
}
```

The response should be a normal `MetabotCommandResult` envelope.

Action naming contract:

- The UI endpoint uses product-facing action names: `requestRevision` and `reject`.
- The Phase 2 workflow dependency remains `reviewDelivery`.
- The daemon action service must map `requestRevision` to `reviewDelivery` with `verdict: "revision_needed"` and `reject` to `reviewDelivery` with `verdict: "rejected"`.
- Browser clients should not send raw `reviewDelivery` unless a later API revision explicitly adds it.

### Preview And Confirmation

All mutating actions must support preview before confirmed execution.

General rule:

- `confirm: false` returns an awaiting-confirmation result or preview payload.
- `confirm: true` performs the mutation.
- When an existing workflow has a dry-run or preview mode, the action service should use it.
- When an existing workflow has no preview mode, the action service must synthesize a preview envelope from validated inputs, current dashboard/task context, and CLI fallback without calling the mutating workflow.
- A `confirm: false` request must not write chain data, transfer payment, create a GitHub PR, modify local repositories, run an LLM development round, or update workflow state.

Payment rule:

- `acceptAndPay` must preview the exact payment amount, currency, payout address, task PIN, delivery PIN, active actor, and chain.
- The UI must require a deliberate confirmation before `confirm: true`.
- If payment succeeds but acceptance write fails, existing Phase 2 recovery data and "do not pay again" guidance must be surfaced clearly.

GitHub/local development rule:

- `claimAndStart`, `runDevRound`, and `deliver` may mutate local directories, Git branches, and GitHub PRs.
- The UI must explain the local workspace or repo target before confirmation.
- The UI must show missing dependency guidance when `git`, `gh`, wallet, or LLM runtime is unavailable.

Chain write rule:

- No browser action should silently write chain data.
- The confirmation modal must describe the protocol record that will be published.

### CLI Fallbacks

Keep CLI fallbacks visible in detail for every mutating action.

Fallbacks are required because:

- the browser UI is local and may not have enough actor context;
- payment or GitHub credentials can fail;
- advanced operators need exact reproducibility.

CLI fallback strings must be shell-quoted, following the Phase 3 safety work.

## New Task Form

Add a `New task` button to the Loom top bar.

The form should publish a `loom-task` payload based on `docs/metaid_protocols/05-loom.md`.

Fields:

- requester actor (`from`);
- title;
- requirement content type, default `text/markdown`;
- requirement markdown;
- criteria content type, default `text/markdown`;
- criteria markdown;
- project base, default `github`;
- repository URI;
- base branch, default `main`;
- bounty amount;
- bounty currency;
- optional deadline;
- tags;
- optional attachment URIs.

Behavior:

- form opens in a centered modal, not a separate page;
- validation errors show inline before preview;
- first submit performs dry-run/preview;
- confirmation publishes the task;
- success closes the modal, refreshes the board, and highlights or opens the new task;
- failure leaves entered data intact and shows the error;
- no LLM draft behavior is required in Phase 4 UI, though existing CLI `--wish` remains available.

## Global Default And Actor Selection

Default `/ui/loom` must load the global board:

```text
/ui/loom
```

It must not redirect to or auto-append:

```text
/ui/loom?from=eric
```

Actor context remains important for actions. Recommended behavior:

- global board loads without `from`;
- read model shows global tasks;
- `needs my action` is hidden or replaced with neutral labels in global mode;
- mutating actions require `from`;
- if the URL has `?from=<slug>`, actions can preselect that actor and actor-specific badges may appear;
- the New task form requires a requester actor before publish.

## Data Model Extensions

Phase 4 should extend the dashboard view model, not break Phase 3 aggregation.

Recommended additions:

```ts
interface LoomDashboardTaskCard {
  summaryPreview?: string;
  nextAction?: LoomTaskNextAction;
}

interface LoomDashboardTaskDetail {
  nextActions: LoomTaskNextAction[];
  actionEligibility: LoomTaskActionEligibility[];
}

interface LoomTaskNextAction {
  id: string;
  label: string;
  tone: 'primary' | 'neutral' | 'warning' | 'danger';
  actorRole: 'requester' | 'developer' | 'any';
  requiresActor: boolean;
  requiresConfirmation: boolean;
  disabledReason?: string;
  cliFallback?: string;
}
```

These fields should be derivable from existing records plus actor context. They must not become a second source of truth for task state.

## API Design

Keep existing read endpoints:

- `GET /api/loom/dashboard`
- `GET /api/loom/tasks/:taskPinId`
- `POST /api/loom/refresh`

Add:

- `POST /api/loom/actions`

Recommended action names:

- `postTask`
- `claimAndStart`
- `runDevRound`
- `deliver`
- `acceptAndPay`
- `requestRevision`
- `reject`

Response requirements:

- always return `MetabotCommandResult`;
- include `action`, `confirmed`, `requiresConfirmation`, and `dashboardRefreshRecommended` in action results;
- include `cliFallback` on preview and many failures;
- for successful mutation, include relevant PINs, txids, PR URL, local workflow path, or recovery artifacts.

HTTP status mapping:

- `200` for successful action or awaiting confirmation;
- `400` for validation errors;
- `403` for permission/actor mismatch;
- `409` for already-finalized or stale-state conflicts;
- `500` only for unexpected server failures.

## Product Copy

Use product-operational copy, not marketing copy.

Good examples:

- `Global task board`
- `Review required`
- `Accept and pay`
- `Request revision`
- `Payment proof`
- `Process logs`
- `Invalid records`
- `Publish task`

Avoid:

- aspirational hero text;
- explanations of the UI design itself;
- verbose tutorial copy in the default surface.

## Safety And Trust Boundaries

Hard requirements:

- board reads are safe by default;
- any mutation requires explicit user intent;
- any payment requires preview plus confirm;
- no action should infer payment from payload alone;
- no action should hide invalid records;
- no action should swallow recovery artifacts;
- a browser refresh must not repeat a mutation;
- repeated confirmation after success must be protected against duplicate payment or duplicate final acceptance;
- PR links and external URLs must be sanitized before rendering as clickable links;
- CLI fallback arguments must be shell-quoted.

Negative examples that must be rejected:

- accepting and paying a delivery when the active actor is not the requester;
- `acceptAndPay` without a valid payout address;
- `acceptAndPay` without a valid positive bounty;
- `acceptAndPay` after an accepted-paid state already exists;
- mapped review-delivery verdict other than `revision_needed` or `rejected`;
- `postTask` with missing title, requirement, criteria, repo URI, bounty amount, or currency;
- `claimAndStart` without payout address unless a configured payout address is available and shown;
- `runDevRound` when local workflow state cannot identify the claim workspace;
- clickable `javascript:` or `data:` URLs from chain records;
- form submission that writes chain data from a mere Enter keypress without preview;
- showing `needs my action` in global mode without actor context.

## Testing Strategy

Use the smallest verification set that proves each unit.

Required automated coverage:

- action model unit tests for next-action eligibility and disabled reasons;
- daemon route tests for `/api/loom/actions`;
- runtime dependency tests that ensure action routes call existing Phase 2 workflows;
- UI view model tests for compact cards, modal details, state explanations, and global-mode labels;
- UI script tests for New task preview/confirm, review actions, payment preview/confirm, modal close/focus behavior, and URL sanitization;
- CSS/HTML shell tests where existing test style supports them;
- Playwright acceptance against a local daemon after implementation.

Manual/Playwright product acceptance:

1. Open `/ui/loom` without `?from`.
2. Confirm the board fills available width and height.
3. Confirm the outer page does not scroll in normal board use.
4. Confirm each column scrolls internally when loaded with many cards.
5. Confirm cards are compact and show only title, summary, Bot avatars/names, warning, and activity.
6. Click a card and confirm a centered modal opens.
7. Confirm Review state actions show `Accept and pay`, `Request revision`, and `Reject`.
8. Run an action preview and confirm no mutation happens before confirmation.
9. Confirm a confirmed mutation refreshes the board and shows the result.
10. Publish a New task through the UI preview/confirm flow.
11. Confirm unsafe URLs render as text and not links.
12. Confirm global mode does not show actor-specific `Needs my action`.

## Acceptance Criteria

Phase 4 is acceptable when:

- `/ui/loom` opens globally by default and does not append `?from=eric`;
- the board layout is full-width/full-height with no outer vertical board scroll;
- every column owns its own scroll;
- task cards are compact and no longer expose detail-heavy metadata;
- details open in a centered modal, not a fixed right panel;
- detail modal exposes all relevant task evidence from Phase 3;
- state-aware next actions are visible and understandable;
- Review tasks can preview and confirm accept/pay, revision, and reject flows from the UI;
- humans can publish a new `loom-task` from the UI with preview/confirm;
- copy-only CLI fallbacks still exist for every risky action;
- payments, chain writes, GitHub mutations, and local development actions all require explicit confirmation;
- invalid records remain visible;
- tests cover positive and negative paths;
- Playwright verifies the main UI flow.

## Implementation Guidance

Prefer incremental commits:

1. action model and API contract;
2. daemon action routing;
3. compact full-height board shell;
4. centered detail modal;
5. New task modal;
6. review/payment action UI;
7. developer workflow action UI;
8. Playwright acceptance and final polish.

The implementation plan should assign these units to subagents only after this SDD is approved.
