# MetaBot Loom Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 3 Loom aggregation and a local board UI so a human can inspect task state, evidence, PRs, payments, warnings, and next-action handoffs across many Loom tasks.

**Architecture:** Add a deterministic Loom dashboard aggregation layer under `src/core/loom/`, backed by the existing raw cache and enriched by Phase 2 workflow state. Wire a read-only CLI command, daemon JSON routes, and a built-in `/ui/loom` board that renders the aggregate model without performing high-risk writes from the browser.

**Tech Stack:** TypeScript CommonJS, Node.js file storage, existing `MetabotCommandResult` envelopes, existing Loom raw cache and workflow state modules, existing daemon route pattern, built-in HTML/CSS/vanilla TypeScript UI pages, Node test runner.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-16-metabot-loom-dashboard-design.md`
- Protocols: `docs/metaid_protocols/05-loom.md`
- Phase 2 spec: `docs/superpowers/specs/2026-05-16-metabot-loom-workflow-cli-design.md`
- Phase 2 plan: `docs/superpowers/plans/2026-05-16-metabot-loom-workflow-cli-implementation.md`
- Storage layout: `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`
- Project instructions: `AGENTS.md`

## Execution Rules

- Work in branch/worktree `codex/metabot-loom-cli` unless the user explicitly asks for a new branch.
- Execute tasks sequentially. The core aggregation tasks feed daemon and UI tasks.
- Every task must leave `npm run build` and targeted tests passing before commit.
- Every task must create one commit.
- After every commit, post a detailed development diary through the `metabot-post-buzz` skill.
- All documentation, code comments, and SKILL content must be English.
- Do not introduce legacy `.metabot/hot` references.
- Do not add browser-side chain writes, wallet payment, GitHub mutation, or local repository mutation in Phase 3.

## File Structure

Create:

- `src/core/loom/dashboardTypes.ts`: shared dashboard model types.
- `src/core/loom/dashboardAggregation.ts`: pure raw-cache-to-dashboard projection.
- `src/core/loom/dashboardStore.ts`: profile-scoped derived dashboard index persistence.
- `src/core/loom/dashboardService.ts`: refresh/read service that composes raw sync, workflow stores, and aggregation.
- `src/ui/pages/loom/viewModel.ts`: UI-specific projection from dashboard API payload.
- `src/ui/pages/loom/app.ts`: page definition and client-side script.
- `src/ui/pages/loom/index.html`: local board HTML/CSS template.
- `tests/loom/dashboardAggregation.test.mjs`
- `tests/loom/dashboardStore.test.mjs`
- `tests/loom/dashboardService.test.mjs`
- `tests/ui/loomViewModel.test.mjs`
- `tests/ui/loomPageScript.test.mjs`

Modify:

- `src/core/loom/index.ts`: export dashboard modules.
- `src/cli/types.ts`: add `loom.dashboard`.
- `src/cli/commands/loom.ts`: parse `metabot loom dashboard`.
- `src/cli/commandHelp.ts`: document `loom dashboard`.
- `src/cli/runtime.ts`: wire dashboard service dependency and daemon proxy.
- `src/daemon/routes/types.ts`: add Loom handlers and add `loom` to `MetabotUiPageName`.
- `src/daemon/routes/ui.ts`: register `/ui/loom` page and nav item.
- `src/daemon/httpServer.ts` or existing daemon route registration files: route `/api/loom/*` requests.
- `src/daemon/defaultHandlers.ts`: wire daemon Loom dashboard handlers.
- `src/cli/commands/ui.ts`: allow `metabot ui open --page loom`.
- `tests/cli/loom.test.mjs`: CLI parser/delegation tests.
- `tests/cli/help.test.mjs`: help coverage.
- `tests/cli/doctor.test.mjs` or `tests/cli/runtime.test.mjs`: UI open support coverage.
- `tests/daemon/httpServer.test.mjs`: daemon API and page routing tests.
- `tests/skillpacks/buildSkillpacks.test.mjs`: only if generated runtime bundles or help snapshots require updates.

## Shared Fixtures

Use these constants across tests:

```js
const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const statusPinId = `${'c'.repeat(64)}i0`;
const deliveryPinId = `${'d'.repeat(64)}i0`;
const acceptancePinId = `${'e'.repeat(64)}i0`;
const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';
```

Use fake raw cache records. Do not call real chain, GitHub, wallets, daemon, or browser in unit tests.

---

### Task 1: Dashboard Types And Pure Aggregation

**Files:**
- Create: `src/core/loom/dashboardTypes.ts`
- Create: `src/core/loom/dashboardAggregation.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/dashboardAggregation.test.mjs`

- [ ] **Step 1: Write failing aggregation tests**

Cover at least these cases:

- board columns group `open`, `claimed`, `in_progress`, `delivered`, `revision_needed`, `accepted_paid`, `rejected`, and `failed`;
- accepted paid task requires a valid passed acceptance with `releasePayment: true` and `paymentTxId`;
- invalid status author does not affect state and appears as a warning;
- multiple claims are summarized on one task card and listed in detail;
- local workflow enrichment adds local branch, workspace, LLM sessions, commits, and process logs without overriding chain state.

Run:

```bash
npm run build && node --test tests/loom/dashboardAggregation.test.mjs
```

Expected: FAIL because exports do not exist.

- [ ] **Step 2: Define dashboard model types**

Create `src/core/loom/dashboardTypes.ts` with exported interfaces for:

- `LoomDashboardState`
- `LoomDashboardStateTone`
- `LoomDashboardSummary`
- `LoomDashboardTaskCard`
- `LoomDashboardTaskDetail`
- `LoomDashboardColumn`
- `LoomDashboardTimelineEvent`
- `LoomDashboardWarning`
- `LoomDashboardActorContext`
- `LoomDashboardFilters`
- `BuildLoomDashboardOptions`

Use the state names from the spec. Keep the types serializable.

- [ ] **Step 3: Implement pure aggregation**

Create `src/core/loom/dashboardAggregation.ts`.

Implementation rules:

- accept `LoomRawCacheState`, optional workflow state records, and optional active profile context;
- never read or write files;
- reuse existing state safety checks where possible, but produce richer task cards and timelines;
- keep invalid related records visible in warnings;
- sort tasks by latest activity descending;
- sort timeline events by timestamp ascending;
- build board columns using the exact spec column mapping.

- [ ] **Step 4: Export and verify**

Modify `src/core/loom/index.ts` to export the new modules.

Run:

```bash
npm run build && node --test tests/loom/dashboardAggregation.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post diary**

```bash
git add src/core/loom/dashboardTypes.ts src/core/loom/dashboardAggregation.ts src/core/loom/index.ts tests/loom/dashboardAggregation.test.mjs
git commit -m "feat: add loom dashboard aggregation"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 2: Dashboard Index Store

**Files:**
- Create: `src/core/loom/dashboardStore.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/dashboardStore.test.mjs`

- [ ] **Step 1: Write failing store tests**

Test:

- index path resolves under `profile/.runtime/loom/dashboard/index.json`;
- missing index returns null;
- malformed index returns null;
- writes are atomic and preserve version 1;
- index normalizes missing optional arrays to empty arrays.

Run:

```bash
npm run build && node --test tests/loom/dashboardStore.test.mjs
```

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement store**

Create:

```ts
export interface LoomDashboardStore {
  indexPath: string;
  read(): Promise<LoomDashboardState | null>;
  write(state: LoomDashboardState): Promise<LoomDashboardState>;
}
```

Use the same atomic-write style as `src/core/loom/workflowStore.ts`.

- [ ] **Step 3: Export and verify**

Run:

```bash
npm run build && node --test tests/loom/dashboardStore.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/loom/dashboardStore.ts src/core/loom/index.ts tests/loom/dashboardStore.test.mjs
git commit -m "feat: persist loom dashboard index"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 3: Dashboard Service

**Files:**
- Create: `src/core/loom/dashboardService.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/dashboardService.test.mjs`

- [ ] **Step 1: Write failing service tests**

Test:

- reads raw cache and returns a dashboard without refresh;
- calls raw refresh dependency when `refresh: true`;
- writes the derived index after successful refresh;
- returns stale index with warning when refresh fails and old index exists;
- fails with `loom_dashboard_unavailable` when refresh fails and no cache/index exists;
- applies state, role, limit, and query filters;
- rejects unsupported filters with `loom_dashboard_invalid_filter`.

Run:

```bash
npm run build && node --test tests/loom/dashboardService.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement service**

Create `createLoomDashboardService(input)` with injectable dependencies:

- `rawCacheStore`;
- `dashboardStore`;
- `refreshRawCache`;
- `readWorkflowStates`;
- `resolveActorContext`.

Public methods:

- `getDashboard(input)`
- `getTaskDetail(input)`
- `refresh(input)`

Return normal `MetabotCommandResult` envelopes.

- [ ] **Step 3: Verify**

Run:

```bash
npm run build && node --test tests/loom/dashboardService.test.mjs tests/loom/dashboardAggregation.test.mjs tests/loom/dashboardStore.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/loom/dashboardService.ts src/core/loom/index.ts tests/loom/dashboardService.test.mjs
git commit -m "feat: add loom dashboard service"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 4: CLI Command

**Files:**
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commands/loom.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/cli/loom.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

Add tests for:

- `metabot loom dashboard --refresh --from eric --limit 25 --state review --role needs_action --query github`;
- invalid `--limit`;
- invalid `--role`;
- dependency missing returns `not_implemented`;
- help lists `dashboard`.

Run:

```bash
npm run build && node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement CLI parser and help**

Add `dashboard` to `metabot loom` dispatch. Keep CLI parsing thin and delegate to `context.dependencies.loom.dashboard`.

Flags:

- `--from <bot-slug>`
- `--refresh`
- `--limit <n>`
- `--state <state-or-column>`
- `--role <all|requester|developer|needs_action>`
- `--query <text>`

- [ ] **Step 3: Wire runtime dependency**

In `src/cli/runtime.ts`, wire the local implementation for direct CLI use. When running against daemon proxy mode, call `GET /api/loom/dashboard`.

- [ ] **Step 4: Verify**

Run:

```bash
npm run build && node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs tests/loom/dashboardService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post diary**

```bash
git add src/cli/types.ts src/cli/commands/loom.ts src/cli/commandHelp.ts src/cli/runtime.ts tests/cli/loom.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add loom dashboard cli"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 5: Daemon API Routes

**Files:**
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/httpServer.ts` or the current route registration file
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write failing daemon tests**

Add tests for:

- `GET /api/loom/dashboard?refresh=true&from=eric`;
- `GET /api/loom/tasks/<taskPinId>?from=eric`;
- `POST /api/loom/refresh`;
- method-not-allowed on unsupported methods;
- missing task returns a stable not-found payload.

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Add daemon handler types**

Add `loom` handlers:

```ts
loom?: {
  getDashboard?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  getTaskDetail?: (input: { taskPinId: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  refresh?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
};
```

- [ ] **Step 3: Implement routes**

Keep routes read-only except `POST /api/loom/refresh`, which only refreshes local cache/index.

- [ ] **Step 4: Wire default handlers**

Use the dashboard service from Task 3. Do not duplicate aggregation logic in route files.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/loom/dashboardService.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/daemon/routes/types.ts src/daemon/httpServer.ts src/daemon/defaultHandlers.ts tests/daemon/httpServer.test.mjs
git commit -m "feat: expose loom dashboard api"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 6: UI View Model

**Files:**
- Create: `src/ui/pages/loom/viewModel.ts`
- Test: `tests/ui/loomViewModel.test.mjs`

- [ ] **Step 1: Write failing view model tests**

Test:

- summary metrics are formatted;
- board columns preserve stable order;
- cards expose compact labels and warning tones;
- task detail timeline sorts predictably;
- long PINs and txids have short display labels plus full copy values;
- empty state is useful;
- stale refresh warning appears.

Run:

```bash
npm run build && node --test tests/ui/loomViewModel.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement view model**

Keep the view model pure. It should accept daemon API payload data and return serializable UI-friendly labels and arrays.

- [ ] **Step 3: Verify**

Run:

```bash
npm run build && node --test tests/ui/loomViewModel.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/ui/pages/loom/viewModel.ts tests/ui/loomViewModel.test.mjs
git commit -m "feat: add loom dashboard view model"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 7: Built-In Loom Board UI

**Files:**
- Create: `src/ui/pages/loom/app.ts`
- Create: `src/ui/pages/loom/index.html`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/cli/commands/ui.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/ui/loomPageScript.test.mjs`
- Test: `tests/cli/doctor.test.mjs` or `tests/cli/runtime.test.mjs`
- Test: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write failing UI route and script tests**

Test:

- `/ui/loom` renders the template;
- nav includes Loom;
- `metabot ui open --page loom --from eric` returns `/ui/loom?from=eric`;
- client script loads dashboard JSON, renders columns, selects a task, refreshes data, and displays errors.

Run:

```bash
npm run build && node --test tests/ui/loomPageScript.test.mjs tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement page definition**

Create `buildLoomPageDefinition()` in `src/ui/pages/loom/app.ts`.

The page should include:

- toolbar with refresh and filters;
- metric row;
- board columns;
- task detail panel;
- timeline;
- warning panel;
- copy buttons;
- external PR links.

- [ ] **Step 3: Implement template**

Create `src/ui/pages/loom/index.html`.

Design constraints:

- no landing hero;
- dense operational layout;
- responsive board;
- no nested cards;
- stable column and card dimensions;
- no text overflow in cards, buttons, badges, or filters.

- [ ] **Step 4: Wire UI registration**

Add `loom` to:

- `MetabotUiPageName`;
- `PAGE_BUILDERS`;
- `NAV_ITEMS`;
- supported CLI UI pages;
- local UI path resolver if it has a page switch.

- [ ] **Step 5: Verify targeted UI tests**

Run:

```bash
npm run build && node --test tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/loom src/daemon/routes/types.ts src/daemon/routes/ui.ts src/cli/commands/ui.ts src/cli/runtime.ts tests/ui/loomPageScript.test.mjs tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs
git commit -m "feat: add loom dashboard ui"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 8: Generated Artifacts, Docs, And Acceptance Runbook

**Files:**
- Create: `docs/acceptance/metabot-loom-dashboard-ui-smoke.md`
- Modify: `skillpacks/**/runtime/dist/**` if required by build output
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs` if expected bundled files change

- [ ] **Step 1: Write acceptance runbook**

Create `docs/acceptance/metabot-loom-dashboard-ui-smoke.md`.

Include:

- prerequisite identities;
- how to run or reuse a Phase 2 E2E task;
- `metabot loom dashboard --refresh --json`;
- `metabot ui open --page loom`;
- expected board state;
- negative checks for invalid records and no browser-side payment.

- [ ] **Step 2: Rebuild generated artifacts if needed**

Run:

```bash
npm run build:skillpacks
```

If no generated artifacts change, note that in the commit message or diary.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run build
node --test tests/loom/dashboardAggregation.test.mjs tests/loom/dashboardStore.test.mjs tests/loom/dashboardService.test.mjs
node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs tests/daemon/httpServer.test.mjs
node --test tests/ui/loomViewModel.test.mjs tests/ui/loomPageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and post diary**

```bash
git add docs/acceptance/metabot-loom-dashboard-ui-smoke.md skillpacks tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "docs: add loom dashboard acceptance smoke"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 9: Final Verification

**Files:**
- No source files unless verification reveals a bug.

- [ ] **Step 1: Run static diff check**

```bash
git diff --check
```

Expected: no output, exit 0.

- [ ] **Step 2: Run full test suite**

Because Phase 3 touches shared Loom runtime, daemon routes, UI, CLI help, and generated bundles, run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Manual browser verification**

Start or use the local daemon, then:

```bash
node dist/cli/main.js loom dashboard --refresh --from eric --json
node dist/cli/main.js ui open --page loom --from eric
```

Open the returned URL. Verify:

- board renders without overlap at desktop width;
- board renders without overlap at mobile width;
- refresh works;
- filters work;
- selecting a task updates details;
- copy buttons work;
- PR links point to GitHub;
- no browser path triggers chain writes or payments.

- [ ] **Step 4: Optional real E2E validation**

Reuse a real Phase 2 E2E task or run a fresh small task through `accepted_paid`, then confirm it appears in Closed with PR and payment txid.

- [ ] **Step 5: Commit only if verification changes files**

If verification requires fixes, commit them and post a development diary. If no files changed, do not create an empty commit.

## Handoff Notes

- The first dashboard is read-first by design. Do not add browser-side accept/pay until a separate payment UI design exists.
- Prefer deterministic local projection over background workers.
- Keep the task card compact and the detail panel rich.
- Treat invalid records as evidence, not noise.
- Preserve the CLI as the testable source for automation: the UI should consume daemon JSON, and the daemon JSON should consume the same core service as CLI.
