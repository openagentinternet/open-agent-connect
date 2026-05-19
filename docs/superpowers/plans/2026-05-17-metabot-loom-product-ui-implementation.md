# MetaBot Loom Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 3 read-first Loom dashboard into a product-grade local task operations UI with compact full-width board layout, centered task details, confirmed workflow actions, and a manual New task publish flow.

**Architecture:** Keep the Phase 3 raw aggregation model as the read source of truth. Add a small action-planning layer that derives state-aware next actions, expose one confirmed daemon action endpoint that delegates to existing Phase 2 workflows, and rebuild `/ui/loom` as a full-height board with modals for detail, task creation, and confirmation.

**Tech Stack:** TypeScript CommonJS, Node.js built-in test runner, existing `MetabotCommandResult` envelopes, existing Loom workflow modules, existing daemon route pattern, built-in HTML/CSS/vanilla TypeScript UI pages, Playwright for final local UI acceptance.

---

## Source Documents

- SDD: `docs/superpowers/specs/2026-05-17-metabot-loom-product-ui-design.md`
- Protocols: `docs/metaid_protocols/05-loom.md`
- Phase 2 workflow design: `docs/superpowers/specs/2026-05-16-metabot-loom-workflow-cli-design.md`
- Phase 3 dashboard design: `docs/superpowers/specs/2026-05-16-metabot-loom-dashboard-design.md`
- Storage layout: `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`
- Project instructions: `AGENTS.md`

## Execution Rules

- Work in branch/worktree `codex/metabot-loom-cli` unless the user explicitly asks for a new branch.
- Use `superpowers:subagent-driven-development` for implementation.
- Spawn review/test subagents with model `gpt-5.5`.
- Use `frontend-skill` for UI tasks. This is an operational app surface, not a landing page.
- All documentation, SKILL documents, and code comments must be English.
- Do not introduce legacy `.metabot/hot` references.
- Prefer small, frequent commits. Each task below should produce one independent commit.
- Before each commit, run the focused tests listed for that task plus `npm run build`.
- After every commit, post a detailed development diary with the `metabot-post-buzz` skill.
- Do not duplicate Phase 2 workflow business logic. UI action endpoints must delegate to existing workflow dependencies.
- Mutating browser actions must support preview/confirmation and must not run on page refresh.

## File Structure

Create:

- `src/core/loom/dashboardActions.ts`: pure next-action and action-eligibility projection for cards/details.
- `src/core/loom/uiActionService.ts`: typed service for previewing and executing Loom UI actions by delegating to existing workflow dependencies.
- `tests/loom/dashboardActions.test.mjs`
- `tests/loom/uiActionService.test.mjs`
- `tests/daemon/loomActionHandlers.test.mjs`
- `tests/playwright/loom-product-ui.spec.mjs` or the nearest existing Playwright test location if the repo already has a convention.

Modify:

- `src/core/loom/dashboardTypes.ts`: add next-action and UI action types.
- `src/core/loom/dashboardAggregation.ts`: attach summary previews and next actions to task cards/details.
- `src/core/loom/dashboardService.ts`: pass action context into aggregation and detail responses.
- `src/core/loom/index.ts`: export new modules.
- `src/daemon/routes/types.ts`: add `loom.actions`.
- `src/daemon/routes/loom.ts`: add `POST /api/loom/actions`.
- `src/daemon/defaultHandlers.ts`: wire action service to Phase 2 workflow dependencies.
- `src/cli/runtime.ts`: reuse existing Loom workflow dependency builders where possible for daemon action service.
- `src/ui/pages/loom/viewModel.ts`: project compact cards, global-mode labels, modal detail, action buttons, and form state.
- `src/ui/pages/loom/app.ts`: implement page markup/script for board, detail modal, New task modal, and confirmations.
- `src/ui/pages/loom/index.html`: rebuild Loom CSS for full-height board, short cards, centered modals, and internal column scroll.
- `tests/daemon/httpServer.test.mjs`: route coverage for `/api/loom/actions`.
- `tests/daemon/loomActionHandlers.test.mjs`: default handler/runtime wiring coverage that proves UI actions reuse Phase 2 Loom workflow dependencies.
- `tests/ui/loomViewModel.test.mjs`: compact card/detail/action projection coverage.
- `tests/ui/loomPageScript.test.mjs`: browser-script behavior coverage.
- Existing CLI tests only if shared types/help need adjustment. Do not add new CLI commands for Phase 4 unless a test demonstrates a necessary shared dependency.

## Shared Test Fixtures

Use deterministic IDs:

```js
const TASK_PIN = `${'a'.repeat(64)}i0`;
const CLAIM_PIN = `${'b'.repeat(64)}i0`;
const DELIVERY_PIN = `${'c'.repeat(64)}i0`;
const ACCEPTANCE_PIN = `${'d'.repeat(64)}i0`;
const PAYMENT_TXID = `${'e'.repeat(64)}`;
```

Use fake workflow dependencies. Unit tests must not call real chain, wallet, GitHub, LLM runtime, daemon, or browser.

---

### Task 1: Action Projection And Compact Dashboard Model

**Files:**

- Create: `src/core/loom/dashboardActions.ts`
- Modify: `src/core/loom/dashboardTypes.ts`
- Modify: `src/core/loom/dashboardAggregation.ts`
- Modify: `src/core/loom/dashboardService.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/dashboardActions.test.mjs`
- Test: `tests/loom/dashboardAggregation.test.mjs`
- Test: `tests/loom/dashboardService.test.mjs`

- [ ] **Step 1: Write failing action projection tests**

Cover:

- global mode does not label tasks as `needsMyAction`;
- actor mode labels requester/developer next actions only when actor matches;
- `delivered` requester tasks expose `acceptAndPay`, `requestRevision`, `reject`, and `openPr`;
- `open` tasks expose `claimAndStart` for developer actors but require actor selection in global mode;
- `failed`, `revision_needed`, and `in_progress` produce human-readable next-step labels;
- disabled reasons exist for missing payout address, missing bounty, missing delivery, already accepted paid, and missing local workflow;
- every mutating action includes `requiresConfirmation: true` and a CLI fallback.

Run:

```bash
npm run build && node --test tests/loom/dashboardActions.test.mjs
```

Expected: FAIL because `dashboardActions` does not exist.

- [ ] **Step 2: Add serializable action types**

In `src/core/loom/dashboardTypes.ts`, add types equivalent to:

```ts
export type LoomDashboardActionId =
  | 'postTask'
  | 'claimAndStart'
  | 'runDevRound'
  | 'deliver'
  | 'acceptAndPay'
  | 'requestRevision'
  | 'reject'
  | 'openPr'
  | 'copyCli';

export interface LoomDashboardNextAction {
  id: LoomDashboardActionId;
  label: string;
  tone: 'primary' | 'neutral' | 'warning' | 'danger';
  actorRole: 'requester' | 'developer' | 'any';
  requiresActor: boolean;
  requiresConfirmation: boolean;
  disabledReason?: string;
  cliFallback?: string;
}
```

Add `summaryPreview?: string`, `nextAction?: LoomDashboardNextAction`, and `nextActions?: LoomDashboardNextAction[]` to the relevant card/detail models.

- [ ] **Step 3: Implement pure action projection**

Create `src/core/loom/dashboardActions.ts`.

Implementation rules:

- no file, network, chain, wallet, or GitHub access;
- derive from current task detail, card state, active actor context, and local workflow evidence;
- keep action labels product-facing and short;
- shell-quote CLI fallback arguments using the existing Phase 3 quoting pattern or a shared helper;
- return disabled actions with reasons instead of hiding critical next steps.

- [ ] **Step 4: Attach compact summaries and actions during aggregation**

Modify `dashboardAggregation` so:

- cards get a one-line `summaryPreview`;
- detail gets `nextActions`;
- card `nextAction` chooses the most useful state-aware action for display;
- state is still derived from raw records and local workflow only.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/loom/dashboardActions.test.mjs tests/loom/dashboardAggregation.test.mjs tests/loom/dashboardService.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/core/loom/dashboardActions.ts src/core/loom/dashboardTypes.ts src/core/loom/dashboardAggregation.ts src/core/loom/dashboardService.ts src/core/loom/index.ts tests/loom/dashboardActions.test.mjs tests/loom/dashboardAggregation.test.mjs tests/loom/dashboardService.test.mjs
git commit -m "feat: add loom dashboard action projection"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 2: UI Action Service

**Files:**

- Create: `src/core/loom/uiActionService.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/uiActionService.test.mjs`

- [ ] **Step 1: Write failing service tests**

Test:

- `postTask` with `confirm: false` returns a dry-run preview;
- `postTask` with `confirm: true` delegates to post-task workflow with `dryRun: false`;
- `acceptAndPay` with `confirm: false` previews payment and does not write acceptance;
- `acceptAndPay` with `confirm: true` delegates with `confirmPayment: true`;
- `requestRevision` with `confirm: false` returns a preview envelope and does not call `reviewDelivery`;
- `requestRevision` with `confirm: true` maps to `reviewDelivery` with `verdict: 'revision_needed'`;
- `reject` with `confirm: false` returns a preview envelope and does not call `reviewDelivery`;
- `reject` with `confirm: true` maps to `reviewDelivery` with `verdict: 'rejected'`;
- `claimAndStart` with `confirm: false` returns a preview or dry-run result and does not write a claim/status;
- `claimAndStart` with `confirm: true` delegates to the claim/start workflow;
- `runDevRound` with `confirm: false` returns a preview envelope and does not call the development-round workflow;
- `runDevRound` with `confirm: true` delegates to the development-round workflow;
- `deliver` with `confirm: false` returns a preview or dry-run result and does not create a PR or write delivery;
- `deliver` with `confirm: true` delegates to the delivery workflow;
- `claimAndStart`, `runDevRound`, and `deliver` reject when required IDs are missing;
- unsupported action returns `loom_action_invalid`;
- duplicate/finalized payment failures propagate with original data;
- every preview and every failure includes a CLI fallback when possible.

Run:

```bash
npm run build && node --test tests/loom/uiActionService.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement typed action service**

Create `src/core/loom/uiActionService.ts` with:

```ts
export interface LoomUiActionRequest {
  action: string;
  from?: string;
  confirm?: boolean;
  [key: string]: unknown;
}

export interface LoomUiActionService {
  run(input: LoomUiActionRequest): Promise<MetabotCommandResult<unknown>>;
}
```

Dependencies should be injectable and mirror existing CLI dependency shapes:

- `postTask`;
- `claimAndStart`;
- `runDevRound`;
- `deliver`;
- `acceptAndPay`;
- `reviewDelivery`;
- optional `dashboardAfterAction` for refresh hints.

Action alias contract:

- Browser/API action names are product-facing: `requestRevision` and `reject`.
- `reviewDelivery` remains an internal Phase 2 workflow dependency.
- Do not expose raw `reviewDelivery` as a browser action in Phase 4.

Implementation rules:

- validate required fields before calling dependencies;
- normalize UI action names `requestRevision` and `reject` into Phase 2 `reviewDelivery`;
- `confirm: false` must never call a mutating dependency;
- use existing dry-run/preview workflow support for `postTask`, `claimAndStart`, `deliver`, and `acceptAndPay` where available;
- synthesize preview envelopes for `requestRevision`, `reject`, and `runDevRound` from validated inputs, current context, and CLI fallback;
- preview envelopes must include `action`, `confirmed: false`, `requiresConfirmation: true`, `cliFallback`, and enough target data for the UI confirmation summary;
- never call payment with confirmation unless `confirm === true`;
- do not perform direct chain writes in this service.

- [ ] **Step 3: Verify**

Run:

```bash
npm run build && node --test tests/loom/uiActionService.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/loom/uiActionService.ts src/core/loom/index.ts tests/loom/uiActionService.test.mjs
git commit -m "feat: add loom ui action service"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 3: Daemon Action Route

**Files:**

- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/loom.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts` if runtime helper reuse is required
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/daemon/loomActionHandlers.test.mjs`
- Test: `tests/loom/uiActionService.test.mjs`

- [ ] **Step 1: Write failing daemon route tests**

Add coverage for:

- `POST /api/loom/actions` calls `handlers.loom.actions`;
- method other than POST returns method-not-allowed;
- invalid JSON returns existing bad-request behavior;
- success and awaiting-confirmation return HTTP 200;
- validation errors return HTTP 400;
- permission errors return HTTP 403;
- stale/finalized conflicts return HTTP 409.

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: FAIL because route is missing.

- [ ] **Step 2: Extend daemon handler types**

Add:

```ts
actions?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
```

under `MetabotDaemonHttpHandlers['loom']`.

- [ ] **Step 3: Implement route**

In `src/daemon/routes/loom.ts`, add `POST /api/loom/actions` before the fallback return.

Map HTTP status:

- `200`: `result.ok === true` or awaiting-confirmation state;
- `403`: `result.code === 'permission_denied'`;
- `409`: `already_accepted_paid`, `already_delivered`, stale/finalized action conflicts;
- `400`: known validation/action errors;
- `500`: unexpected thrown route errors should still use the server's normal error path.

- [ ] **Step 4: Wire default handler**

In `src/daemon/defaultHandlers.ts`, construct `createLoomUiActionService` from the same dependencies used by CLI Loom commands.

Important:

- reuse existing actor/profile resolution;
- reuse existing workflow store and raw sync helpers;
- do not duplicate acceptance/payment logic;
- preserve existing recovery behavior from `reviewWorkflow.ts`.

- [ ] **Step 5: Write default-handler wiring tests**

Create `tests/daemon/loomActionHandlers.test.mjs`.

Cover:

- `handlers.loom.actions({ action: 'postTask', confirm: true, ... })` reaches the same post-task workflow dependency used by CLI `metabot loom post-task`;
- `handlers.loom.actions({ action: 'claimAndStart', confirm: true, ... })` reaches the claim/start workflow dependency and does not construct a parallel chain write;
- `handlers.loom.actions({ action: 'runDevRound', confirm: true, ... })` reaches the development-round workflow dependency;
- `handlers.loom.actions({ action: 'deliver', confirm: true, ... })` reaches the delivery workflow dependency;
- `handlers.loom.actions({ action: 'acceptAndPay', confirm: true, ... })` reaches the accept/pay workflow dependency and preserves payment recovery output;
- `handlers.loom.actions({ action: 'requestRevision', confirm: true, ... })` and `reject` reach the Phase 2 `reviewDelivery` workflow with the expected verdict;
- `confirm: false` for `requestRevision`, `reject`, and `runDevRound` does not call those mutating dependencies;
- missing `git`, `gh`, wallet, or LLM dependency errors are propagated from the existing workflow layer rather than rewritten by the UI action route.

If the existing default handler is too large to instantiate directly, extract a minimal factory seam that accepts the existing Loom workflow dependencies and test that seam. Do not duplicate workflow behavior in the test seam.

- [ ] **Step 6: Verify**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/daemon/loomActionHandlers.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post diary**

```bash
git add src/daemon/routes/types.ts src/daemon/routes/loom.ts src/daemon/defaultHandlers.ts src/cli/runtime.ts tests/daemon/httpServer.test.mjs tests/daemon/loomActionHandlers.test.mjs tests/loom/uiActionService.test.mjs
git commit -m "feat: expose loom ui action endpoint"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 4: Full-Width Board Shell And Compact Cards

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts`
- Test: `tests/ui/loomViewModel.test.mjs`
- Test: `tests/ui/loomPageScript.test.mjs`

- [ ] **Step 1: Write failing UI tests**

Test:

- initial dashboard fetch is `/api/loom/dashboard` when URL has no `from`;
- no actor/last-refresh blocks render in the default top area;
- metrics are hidden or reduced so they do not dominate the first viewport;
- cards include title, summary preview, requester/developer names or avatars, warning/activity, and not full bounty/repo/payment metadata;
- global mode does not render `Needs my action`;
- columns are present with compact count headers.

Run:

```bash
npm run build && node --test tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs
```

Expected: FAIL because the current UI still renders Phase 3 layout.

- [ ] **Step 2: Rebuild Loom CSS shell**

In `src/ui/pages/loom/index.html`:

- override shared content width for Loom only, for example through a `.loom-page` class on the content root;
- use full-height layout similar to `/ui/trace`;
- make `.loom-board-shell` flex column with `height: calc(100vh - 52px)`;
- make `.loom-board` horizontally scrollable and vertically contained;
- make `.loom-column` fixed width and `min-height: 0`;
- make `.loom-column-list` `flex: 1`, `overflow-y: auto`, `min-height: 0`;
- reduce `.loom-task-card` height and remove detail-heavy sections.

- [ ] **Step 3: Simplify top content**

In `src/ui/pages/loom/app.ts`:

- render title, global scope label, refresh button, New task button;
- remove default actor/last-refresh/filter blocks;
- keep stale/invalid warning as one compact indicator;
- fetch global dashboard unless `window.location.search` explicitly includes `from`.

- [ ] **Step 4: Update view model**

In `viewModel.ts`:

- add compact card fields;
- add global-mode action labels;
- keep detail-heavy fields for modal only;
- preserve existing sanitization and copy labels.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs
git commit -m "feat: compact loom board layout"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 5: Centered Detail Modal

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts`
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/ui/loomViewModel.test.mjs`

- [ ] **Step 1: Write failing modal tests**

Test:

- no persistent right-side detail panel is rendered on initial load;
- clicking a card opens a modal containing requirement, criteria, identities, PR, payment, process logs, timeline, warnings, raw evidence, and CLI fallback;
- Escape closes the modal;
- close button closes the modal;
- focus returns to the selected card;
- outside click does not close while a confirmation dialog is active;
- unsafe URLs remain non-clickable.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/ui/loomViewModel.test.mjs
```

Expected: FAIL because current detail is a fixed aside.

- [ ] **Step 2: Add modal structure**

In `app.ts`, replace the fixed aside with:

- hidden overlay root;
- centered detail dialog;
- close button;
- body container;
- action panel container.

Use accessible attributes:

- `role="dialog"`;
- `aria-modal="true"`;
- modal title id;
- keyboard Escape handler.

- [ ] **Step 3: Move detail rendering into modal**

Reuse existing detail rendering where possible but reorganize into dense sections:

- header;
- state explanation and action panel;
- participants;
- requirement/criteria;
- delivery;
- payment;
- process evidence;
- timeline;
- warnings;
- raw records.

- [ ] **Step 4: Add focus and close behavior**

Keep the clicked card element or task pin id so focus can return after closing. Ensure modal close does not mutate board state.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/ui/loomViewModel.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/ui/loomPageScript.test.mjs tests/ui/loomViewModel.test.mjs
git commit -m "feat: add loom task detail modal"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 6: New Task Publish Modal

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts` if form helpers are shared there
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/loom/uiActionService.test.mjs`

- [ ] **Step 1: Write failing New task tests**

Test:

- New task button opens a centered form modal;
- required fields are title, requirement, criteria, repo URI, base branch, bounty amount, currency, and actor;
- `bounty.amount` remains a string in the generated payload and must match a positive decimal format;
- `deadline`, when supplied, is converted to a millisecond timestamp;
- attachment input accepts only non-empty `metafile://` URIs;
- tags are trimmed, deduplicated, and serialized as strings;
- inline validation prevents preview when required fields are missing;
- preview posts `POST /api/loom/actions` with `action: 'postTask'` and `confirm: false`;
- confirm posts the same action with `confirm: true`;
- success refreshes the dashboard and closes the modal;
- failure preserves form input;
- Enter in a text field does not bypass preview confirmation.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: FAIL because UI form is missing.

- [ ] **Step 2: Add New task form markup**

Fields:

- `from`;
- `title`;
- `requirementContentType` default `text/markdown`;
- `requirement`;
- `criteriaContentType` default `text/markdown`;
- `criteria`;
- `projectBase` default `github`;
- `repoUri`;
- `baseBranch` default `main`;
- `bounty.amount`;
- `bounty.currency`;
- `deadline`;
- `tags`;
- `attachments`.

Keep the form dense and product-like. Do not add hero copy.

Schema mapping checklist:

- `payload.requirementContentType` defaults to `text/markdown`;
- `payload.criteriaContentType` defaults to `text/markdown`;
- `payload.projectBase` defaults to `github`;
- `payload.project.repoUri` is copied from `repoUri`;
- `payload.project.baseBranch` defaults to `main`;
- `payload.bounty.amount` is serialized as a string, not a number;
- `payload.bounty.currency` is one of the protocol-supported currency values;
- `payload.deadline` is omitted when empty and otherwise serialized as a millisecond timestamp;
- `payload.tags` is omitted when empty and otherwise serialized as a string array;
- `payload.attachments` is omitted when empty and otherwise serialized as a `metafile://` URI array.

- [ ] **Step 3: Build payload and preview**

Client script should build a `loom-task` payload matching `docs/metaid_protocols/05-loom.md`, then call:

```json
{
  "action": "postTask",
  "from": "<actor>",
  "confirm": false,
  "payload": { "...": "..." }
}
```

- [ ] **Step 4: Add confirmation and success behavior**

The confirmation view should show:

- actor;
- chain;
- title;
- repo;
- bounty;
- validation/preview result;
- CLI fallback if present.

On successful confirm:

- call refresh;
- close modal;
- show success status;
- highlight/open the new task if returned PIN exists and appears after refresh.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: publish loom tasks from ui"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 7: Review And Payment Actions In UI

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts`
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/loom/uiActionService.test.mjs`

- [ ] **Step 1: Write failing review action tests**

Test:

- delivered task detail renders `Accept and pay`, `Request revision`, `Reject`, and `Open PR`;
- each mutating action opens a confirmation modal before `confirm: true`;
- accept/pay preview shows amount, currency, payout address, actor, task PIN, delivery PIN, and chain;
- accept/pay confirm sends `action: 'acceptAndPay'`, `confirm: true`;
- request revision preview sends `action: 'requestRevision'`, `confirm: false` and does not mutate;
- request revision confirm sends `action: 'requestRevision'`, `confirm: true`;
- reject preview sends `action: 'reject'`, `confirm: false` and does not mutate;
- reject confirm sends `action: 'reject'`, `confirm: true`;
- success refreshes board and keeps result visible;
- payment-write failure after successful payment surfaces "do not pay again" recovery guidance;
- actor mismatch/permission failure is shown and does not close detail.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: FAIL because actions are still copy-only.

- [ ] **Step 2: Render action buttons**

In detail modal action panel:

- render primary action from `detail.nextActions`;
- render secondary actions;
- render disabled reason inline for ineligible actions;
- keep CLI fallback copy button.

- [ ] **Step 3: Implement confirmation modal**

The confirmation modal should:

- show action-specific summary;
- call preview endpoint before showing final confirm when needed;
- disable confirm during network call;
- never retry automatically;
- keep result/error visible.

- [ ] **Step 4: Implement review action calls**

POST `/api/loom/actions` with normalized payloads:

```json
{ "action": "acceptAndPay", "from": "...", "taskPinId": "...", "deliveryPinId": "...", "score": 5, "comment": "...", "confirm": false }
```

```json
{ "action": "requestRevision", "from": "...", "taskPinId": "...", "deliveryPinId": "...", "score": 3, "comment": "...", "confirm": false }
```

```json
{ "action": "requestRevision", "from": "...", "taskPinId": "...", "deliveryPinId": "...", "score": 3, "comment": "...", "confirm": true }
```

```json
{ "action": "reject", "from": "...", "taskPinId": "...", "deliveryPinId": "...", "score": 1, "comment": "...", "confirm": false }
```

```json
{ "action": "reject", "from": "...", "taskPinId": "...", "deliveryPinId": "...", "score": 1, "comment": "...", "confirm": true }
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
git commit -m "feat: review loom deliveries from ui"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 8: Developer Workflow Actions In UI

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts`
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/loom/uiActionService.test.mjs`

- [ ] **Step 1: Write failing developer action tests**

Test:

- open tasks show `Claim and start` when actor can be a developer;
- claimed/in-progress/revision tasks show `Run dev round` when local workflow exists;
- in-progress/completed local workflow can show `Deliver`;
- missing local workflow shows a human-readable disabled reason and CLI fallback;
- confirmations show local repo/workspace target, GitHub PR target, and LLM/runtime dependency hints;
- `Claim and start`, `Run dev round`, and `Deliver` all send `confirm: false` preview requests before any `confirm: true` request;
- canceling a developer-action confirmation never calls `confirm: true`;
- success refreshes the dashboard;
- failures for missing `git`, `gh`, wallet, or LLM runtime are rendered clearly.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: FAIL because developer actions are not wired.

- [ ] **Step 2: Render developer actions**

Use the same action panel and confirmation modal as Task 7. Do not create a second interaction system.

- [ ] **Step 3: Implement calls**

Call `/api/loom/actions` with:

- `action: 'claimAndStart'`;
- `action: 'runDevRound'`;
- `action: 'deliver'`.

Each action must use this sequence:

1. Send `confirm: false`.
2. Render the returned preview, local target, and CLI fallback.
3. Send `confirm: true` only after the human confirms.
4. Refresh the dashboard after a successful confirmed result.

For Phase 4, keep advanced fields minimal:

- claim/start: actor, taskPinId, payoutAddress, optional message;
- run dev round: actor, taskPinId, claimPinId, optional round note;
- deliver: actor, taskPinId, claimPinId, optional PR title and delivery summary.

- [ ] **Step 4: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/ui/loomPageScript.test.mjs tests/loom/uiActionService.test.mjs
git commit -m "feat: run loom developer actions from ui"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 9: Product Polish, Negative Cases, And Playwright Acceptance

**Files:**

- Modify: `src/ui/pages/loom/index.html`
- Modify: `src/ui/pages/loom/app.ts`
- Modify: `src/ui/pages/loom/viewModel.ts`
- Create or modify: `tests/playwright/loom-product-ui.spec.mjs`
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/playwright/loom-product-ui.spec.mjs`

- [ ] **Step 1: Add focused regression tests**

Add tests for negative examples from the SDD:

- global mode does not show `Needs my action`;
- unsafe PR/process URLs are not clickable;
- duplicate accept/pay is blocked;
- missing payout address disables payment;
- post-task validation blocks missing title/criteria/repo/bounty;
- browser refresh does not resubmit pending action;
- confirmation close/cancel does not mutate anything.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/loom/dashboardActions.test.mjs tests/loom/uiActionService.test.mjs
```

Expected: PASS after fixes.

- [ ] **Step 2: Add Playwright acceptance**

Create a Playwright acceptance test that starts or uses the local daemon test harness and verifies:

- `/ui/loom` opens without `?from`;
- board fills the viewport width;
- outer page does not vertically scroll in normal board mode;
- columns have internal scroll when seeded with many cards;
- compact cards do not exceed the planned density budget;
- detail opens centered;
- New task form preview/confirm calls are observable with mocked endpoint data;
- review action preview/confirm calls are observable with mocked endpoint data;
- developer action preview/confirm calls are observable with mocked endpoint data.

If the repo has no Playwright harness, document the exact manual Playwright command in the test file header and keep the test isolated from real chain/wallet/GitHub.

- [ ] **Step 3: Visual/browser smoke**

Run the local UI and inspect with Playwright or the in-app browser:

```bash
npm run build
metabot daemon start
metabot ui open --page loom
```

Then verify at:

```text
http://127.0.0.1:24885/ui/loom
```

Check desktop and narrow viewport screenshots for:

- no clipped text in buttons/cards;
- no overlapping columns or modal header;
- no outer board scroll;
- readable card density.

- [ ] **Step 4: Final targeted verification**

Run:

```bash
npm run build
node --test tests/loom/dashboardActions.test.mjs tests/loom/uiActionService.test.mjs tests/daemon/httpServer.test.mjs tests/daemon/loomActionHandlers.test.mjs tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs
```

Run Playwright acceptance if available:

```bash
node --test tests/playwright/loom-product-ui.spec.mjs
```

Expected: all targeted tests pass.

- [ ] **Step 5: Commit and post diary**

```bash
git add src/ui/pages/loom/index.html src/ui/pages/loom/app.ts src/ui/pages/loom/viewModel.ts tests/playwright/loom-product-ui.spec.mjs tests/ui/loomPageScript.test.mjs tests/loom/dashboardActions.test.mjs tests/loom/uiActionService.test.mjs tests/daemon/loomActionHandlers.test.mjs
git commit -m "test: verify loom product ui flow"
```

Post a development diary with `metabot-post-buzz`.

---

## Final Review Gate

After all implementation tasks pass:

1. Dispatch a final `gpt-5.5` review/test subagent.
2. Ask it to run the targeted automated tests and one Playwright UI pass.
3. Require an explicit `PASS` or specific modification requests.
4. Fix any issues and re-run the relevant review.
5. Only then report Phase 4 as ready for human testing.

## Human Acceptance Script

After implementation, a human can test:

```bash
npm run build
metabot daemon start
metabot ui open --page loom
```

Then:

1. Open `/ui/loom` without `?from`.
2. Confirm global board layout and compact cards.
3. Click a task and inspect centered detail modal.
4. Try New task preview, then confirm on a small test task.
5. On a delivered task, preview accept/pay and cancel once.
6. Preview accept/pay again, confirm only if the test bounty and payout address are correct.
7. Try request revision or reject on a separate test delivery.
8. Confirm board refreshes and evidence/timeline remain readable.

## Definition Of Done

- SDD acceptance criteria are satisfied.
- All targeted tests pass.
- Playwright acceptance passes or documents the exact blocker.
- UI does not regress `/ui/trace` or other shared pages.
- Every task commit has an on-chain development diary buzz.
- Final review/test subagent gives explicit approval.
