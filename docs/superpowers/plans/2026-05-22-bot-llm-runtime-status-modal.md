# Bot LLM Runtime Status Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a human-readable LLM runtime status modal to `/ui/bot`, with per-runtime readiness testing that promotes only truly responsive runtimes to `healthy`.

**Architecture:** Extend the existing Bot page rather than adding a new page. The modal reads from the shared runtime store through `/api/bot/runtimes`, filters to `healthy` and `detected`, and uses a new per-runtime test endpoint to run the same version + readiness semantics used by discovery. Primary/Fallback provider pickers remain unchanged and continue to list only `healthy` runtimes.

**Tech Stack:** TypeScript daemon handlers and routes, existing `LlmRuntimeStore`, existing LLM discovery/readiness backend code, static built-in UI in `src/ui/pages/bot`, Node test runner.

---

## Product Scope

The Bot page currently exposes a `RUNTIMES` stat count but does not let a human inspect why a provider is or is not selectable. This change adds a small operational UI:

- Add a `View providers` link under the `RUNTIMES` number.
- Open a centered modal from that link.
- Show all current `healthy` and `detected` LLM runtimes.
- Hide `unavailable` historical rows from this human-facing list.
- Show detailed runtime fields:
  - provider display name
  - provider id
  - platform icon
  - binary path
  - version
  - configured model, if present
  - auth state
  - last seen time
  - health checked time
  - health state
  - health reason, especially for `detected`
- Show `healthy` with a green status dot.
- Provide a `Test` button per row.
- When `Test` succeeds, update that runtime to `healthy`.
- When `Test` fails after a successful version probe, update that runtime to `detected`.
- If the version probe fails or the executable cannot be used, update that runtime to `unavailable`, but keep it hidden from the modal list after refresh.

## Design Direction

Visual thesis: A restrained operator panel that makes provider readiness easy to scan without turning the Bot page into a dashboard mosaic.

Content plan:

- Runtime stat card: keep the existing number as the primary signal; add one compact link below it.
- Modal header: `LLM Providers`, a short operational note, `Refresh`, and close.
- Modal body: dense rows with icon, name, state, metadata, reason text, and a test action.
- Empty state: show a concise message when no `healthy` or `detected` runtimes exist.

Interaction thesis:

- Opening the modal should not navigate away from `/ui/bot`.
- Testing should update only the selected row first, then refresh shared runtime state.
- The row should show a local `Testing...` state while its request is in flight.

## Existing Code Map

- UI page shell and script:
  - `src/ui/pages/bot/index.html`
  - `src/ui/pages/bot/app.ts`
- Bot runtime routes:
  - `src/daemon/routes/bot.ts`
  - `src/daemon/routes/types.ts`
- Bot handlers:
  - `src/daemon/defaultHandlers.ts`
- Runtime discovery/readiness:
  - `src/core/llm/llmRuntimeDiscovery.ts`
  - `src/core/llm/llmRuntimeStore.ts`
  - `src/core/llm/executor/backends/registry.ts`
- Existing tests:
  - `tests/ui/botPageScript.test.mjs`
  - `tests/daemon/httpServer.test.mjs`
  - `tests/daemon/defaultBotHandlers.test.mjs`
  - `tests/llm/llmProviderExpansion.test.mjs`

## API Contract

Add:

```http
POST /api/bot/runtimes/:runtimeId/test
```

Response shape:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "runtime": {
      "id": "llm_codex_/Applications/Codex.app/Contents/Resources/codex",
      "provider": "codex",
      "displayName": "Codex (OpenAI)",
      "binaryPath": "/Applications/Codex.app/Contents/Resources/codex",
      "version": "0.133.0-alpha.1",
      "health": "healthy",
      "healthCheckedAt": "2026-05-22T10:00:00.000Z",
      "lastSeenAt": "2026-05-22T10:00:00.000Z"
    },
    "runtimes": []
  }
}
```

Failure response examples:

```json
{
  "ok": false,
  "state": "failed",
  "code": "runtime_not_found",
  "message": "LLM runtime was not found: llm_missing"
}
```

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "runtime": {
      "health": "detected",
      "healthReason": "Readiness probe completed without returning output."
    },
    "runtimes": []
  }
}
```

The endpoint must not mark a readiness failure as `healthy`. `healthy` means both version probe and execution readiness probe succeeded with non-empty text.

## Runtime Health Rules

- `healthy`: version probe succeeded and readiness prompt produced non-empty text.
- `detected`: version probe succeeded, but readiness prompt failed, timed out, or returned empty output.
- `unavailable`: executable path is missing, not executable, or version probe failed.

Testing a runtime should also update `healthCheckedAt`, `updatedAt`, and when applicable `healthReason`.

## Task 1: Core Runtime Test Helper

**Files:**
- Modify: `src/core/llm/llmRuntimeDiscovery.ts`
- Test: `tests/llm/llmProviderExpansion.test.mjs`

- [ ] **Step 1: Write failing tests for per-runtime testing**

Add tests that exercise a new exported helper, for example `testLlmRuntimeReadiness`.

Cases:

- version ok + readiness ok -> returns runtime with `health: "healthy"` and no `healthReason`
- version ok + readiness empty -> returns runtime with `health: "detected"` and a reason
- version failure -> returns runtime with `health: "unavailable"` and a reason

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node --test tests/llm/llmProviderExpansion.test.mjs
```

Expected: fail because `testLlmRuntimeReadiness` is not exported or not implemented.

- [ ] **Step 3: Implement the helper**

Suggested signature:

```ts
export async function testLlmRuntimeReadiness(
  runtime: LlmRuntime,
  options?: {
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
    now?: () => string;
  },
): Promise<LlmRuntime>
```

Implementation notes:

- Require `runtime.binaryPath`.
- Resolve the platform definition by `runtime.provider`.
- Run `probeExecutableVersion` with the platform version args.
- If version fails, return an `unavailable` runtime.
- Build a fresh runtime object preserving stable fields such as `id`, `provider`, `displayName`, `binaryPath`, `logoPath`, `model`, and `capabilities`.
- Run the same readiness logic used by discovery.
- If readiness succeeds with output, return `healthy`.
- If readiness fails or returns empty output, return `detected`.

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
npm run build && node --test tests/llm/llmProviderExpansion.test.mjs
```

Expected: pass.

## Task 2: Bot Runtime Test API

**Files:**
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/bot.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write route forwarding test**

In `tests/daemon/httpServer.test.mjs`, add a test for:

```http
POST /api/bot/runtimes/llm-runtime-1/test
```

Expected:

- route calls `handlers.bot.testRuntime`
- decoded runtime id is passed as `{ runtimeId: "llm-runtime-1" }`
- response returns handler payload

- [ ] **Step 2: Write default handler tests**

In `tests/daemon/defaultBotHandlers.test.mjs`, add tests for:

- missing runtime id returns `runtime_not_found`
- readiness success updates runtime to `healthy`
- readiness failure updates runtime to `detected`
- version failure updates runtime to `unavailable`

Use dependency injection if available. If not currently available, add a small optional dependency to `createDefaultHandlers` for runtime readiness testing so tests do not spawn real CLIs.

- [ ] **Step 3: Run route and handler tests to verify RED**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
```

Expected: fail because the route and handler do not exist.

- [ ] **Step 4: Implement route types and route**

In `src/daemon/routes/types.ts`, add `testRuntime` to the Bot handlers type.

In `src/daemon/routes/bot.ts`, add the route before the generic runtime routes:

```ts
const runtimeTestMatch = url.pathname.match(/^\/api\/bot\/runtimes\/([^/]+)\/test$/);
```

Decode the runtime id safely and call `handlers.bot.testRuntime`.

- [ ] **Step 5: Implement default handler**

In `src/daemon/defaultHandlers.ts`, implement `bot.testRuntime`:

- resolve actor/profile home from optional `from` when appropriate, or use current home like `listRuntimes`
- read runtime store
- find runtime by id
- call `testLlmRuntimeReadiness`
- upsert/update the returned runtime
- return `{ runtime, runtimes }`

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
```

Expected: pass.

## Task 3: Runtime Modal Markup and Styling

**Files:**
- Modify: `src/ui/pages/bot/index.html`
- Test: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write template assertions**

In `tests/daemon/httpServer.test.mjs`, extend the `/ui/bot` test to assert:

- `data-act="open-runtime-modal"` exists
- `data-runtime-modal-status` exists
- modal CSS includes a wide bounded dialog, for example:

```css
.runtime-modal-box { width: min(920px, calc(100vw - 40px)); }
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: fail because the markup and CSS do not exist.

- [ ] **Step 3: Add the runtime stat link and modal styles**

In the `Runtimes` stat card, add:

```html
<button class="stat-link" data-act="open-runtime-modal" type="button">View providers</button>
```

Add CSS in `src/ui/pages/bot/index.html`:

- `.stat-link`
- `.runtime-modal-box`
- `.runtime-modal-head`
- `.runtime-modal-summary`
- `.runtime-list`
- `.runtime-row`
- `.runtime-row-main`
- `.runtime-row-meta`
- `.runtime-health-dot`
- `.runtime-health-healthy`
- `.runtime-health-detected`
- `.runtime-path`
- `.runtime-reason`

Keep the modal centered and scrollable:

```css
.runtime-modal-box {
  width: min(920px, calc(100vw - 40px));
  max-height: calc(100vh - 96px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: pass.

## Task 4: Runtime Modal Rendering

**Files:**
- Modify: `src/ui/pages/bot/app.ts`
- Test: `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Write UI script test for filtering and rendering**

In `tests/ui/botPageScript.test.mjs`, add a test that sets:

- one `healthy` runtime
- one `detected` runtime
- one `unavailable` runtime

Open the modal by triggering `data-act="open-runtime-modal"`.

Assert:

- healthy and detected runtimes render
- unavailable runtime does not render
- binary path, version, lastSeenAt, healthReason render
- healthy row includes a green status marker class

- [ ] **Step 2: Run UI test and verify RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: fail because modal rendering functions do not exist.

- [ ] **Step 3: Implement UI state and render functions**

Add state fields:

```js
_runtimeModalOpen:false,
_runtimeTestById:{}
```

Add helpers:

- `visibleRuntimeRows()`
- `runtimeHealthMarkup(runtime)`
- `runtimeDetailMarkup(runtime)`
- `runtimeModalBodyMarkup()`
- `openRuntimeModal()`
- `renderRuntimeModal()`

Filtering:

```js
function visibleRuntimeRows(){
  return state.runtimes.filter(function(r){
    return r && (r.health === 'healthy' || r.health === 'detected');
  });
}
```

Ensure `loadRuntimes()` re-renders the modal when `state._runtimeModalOpen` is true.

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: pass.

## Task 5: Per-Row Runtime Test Interaction

**Files:**
- Modify: `src/ui/pages/bot/app.ts`
- Test: `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Write UI script test for successful Test action**

Mock `fetch` so clicking `Test` calls:

```http
POST /api/bot/runtimes/<runtimeId>/test
```

Return an updated runtime with `health: "healthy"`.

Assert:

- button becomes disabled while testing
- state runtimes are updated
- modal re-renders healthy state
- provider pickers and stats refresh through existing render functions

- [ ] **Step 2: Write UI script test for failed readiness**

Return an updated runtime with:

```json
{
  "health": "detected",
  "healthReason": "Readiness probe completed without returning output."
}
```

Assert:

- row state becomes detected
- reason is visible
- runtime is not present in provider picker if no longer healthy

- [ ] **Step 3: Run UI tests and verify RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: fail because `testRuntime` UI action does not exist.

- [ ] **Step 4: Implement test action**

Add:

```js
function testRuntime(runtimeId){
  state._runtimeTestById[runtimeId] = 'testing';
  renderRuntimeModal();
  return api('/api/bot/runtimes/'+encodeURIComponent(runtimeId)+'/test',{method:'POST'})
    .then(function(r){
      var data = r.data || {};
      if (Array.isArray(data.runtimes)) {
        state.runtimes = data.runtimes;
      } else if (data.runtime) {
        state.runtimes = state.runtimes.map(function(existing){
          return existing.id === data.runtime.id ? data.runtime : existing;
        });
      }
      renderStats();
      renderMetabotList();
      renderCurrentTab();
      renderRuntimeModal();
    })
    .catch(function(error){
      showToast(error.message || 'Runtime test failed');
      renderRuntimeModal();
    })
    .finally(function(){
      delete state._runtimeTestById[runtimeId];
      renderRuntimeModal();
    });
}
```

Wire `[data-act="test-runtime"]` in `renderRuntimeModal()`.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: pass.

## Task 6: End-to-End Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run build
node --test tests/llm/llmProviderExpansion.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Install into the local machine**

Run:

```bash
npm install -g .
$HOME/.metabot/bin/metabot daemon stop
$HOME/.metabot/bin/metabot daemon start
```

Expected: daemon starts at the normal local URL.

- [ ] **Step 3: Refresh live runtime discovery**

Run:

```bash
$HOME/.metabot/bin/metabot llm discover
```

Expected:

- truly responsive runtimes are `healthy`
- version-only or non-responsive runtimes are `detected`
- missing/broken runtimes are `unavailable`

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:24885/ui/bot
```

Verify:

- the `RUNTIMES` stat has a `View providers` link
- clicking it opens the modal
- only `healthy` and `detected` runtimes are listed
- `healthy` rows have green dots
- `Test` updates row state correctly
- Primary/Fallback pickers still show only `healthy` providers

## Commit and Diary Requirements

This repository requires one commit per modification round. Before committing:

```bash
npm run build
node --test tests/llm/llmProviderExpansion.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
git diff --check
```

Then post a development diary with `metabot-post-buzz`, and commit:

```bash
git add src/core/llm/llmRuntimeDiscovery.ts src/daemon/routes/types.ts src/daemon/routes/bot.ts src/daemon/defaultHandlers.ts src/ui/pages/bot/index.html src/ui/pages/bot/app.ts tests/llm/llmProviderExpansion.test.mjs tests/daemon/defaultBotHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
git commit -m "Add Bot LLM runtime status modal"
```

## Acceptance Checklist

- [ ] `/ui/bot` exposes a `View providers` link under the `RUNTIMES` stat.
- [ ] The modal is centered and scroll-safe on desktop and mobile.
- [ ] The modal lists `healthy` and `detected` runtimes only.
- [ ] `healthy` rows show a green dot.
- [ ] Each row shows name, provider id, icon, binary path, version, model, auth state, last seen, checked time, and reason when present.
- [ ] `Test` runs a real version + readiness probe for the selected runtime.
- [ ] Successful test updates the row to `healthy`.
- [ ] Failed readiness updates the row to `detected`.
- [ ] Failed version/executable updates the runtime to `unavailable`.
- [ ] Primary/Fallback provider pickers still list only `healthy` runtimes.
- [ ] Focused tests and `git diff --check` pass.
