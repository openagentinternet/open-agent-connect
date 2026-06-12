# OAC Agent Browser Core 0.3 Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Open Agent Connect consume the published `agent-browser-core` `0.3.0` Browser UI, core helpers, host contract, and conformance harness while preserving OAC's local Bot actor runtime.

**Architecture:** OAC remains a Browser host. ABC provides the shared Browser UI shell, neutral Browser core helpers, command-state contract, and conformance tests. OAC keeps the OAC-specific adapter for MetaBot profiles, settings, MetaApp cache, private chat, service calls, and owner management.

**Tech Stack:** Node.js `>=20 <25`, TypeScript strict CommonJS build, npm exact package pins, `@openagentinternet/agent-browser-*` `0.3.0`, Node test runner.

---

## Baseline

ABC `v0.3.0` has been published to npm and `latest` points to `0.3.0` for:

- `@openagentinternet/agent-browser-host-contract`
- `@openagentinternet/agent-browser-core`
- `@openagentinternet/agent-browser-ui`
- `@openagentinternet/agent-browser-host-standalone`
- `@openagentinternet/agent-browser-test-harness`

Current OAC `main` still pins:

- `@openagentinternet/agent-browser-host-contract@0.1.0`
- `@openagentinternet/agent-browser-core@0.1.0`
- `@openagentinternet/agent-browser-test-harness@0.1.0`

Current OAC does not install `@openagentinternet/agent-browser-ui`.

## Product Constraints

- Do not add Metalet login in this OAC phase.
- Do not install or wire `@openagentinternet/agent-browser-host-standalone` in OAC. ABC standalone owns mock standalone actor behavior.
- Do not replace OAC's local Bot actor system. The OAC Browser top-right actor selector must still be backed by OAC MetaBot profiles.
- Do not edit the `agent-browser-core` repository in this OAC implementation phase.
- Do not use local filesystem links, npm workspaces, or tarballs for ABC packages. OAC must consume the published `0.3.0` packages from npm.
- Use a separate OAC implementation worktree because other OAC work may happen in the main checkout.

## Implementation Worktree

Use this exact setup before Task 1:

```bash
cd /Users/tusm/Documents/MetaID_Projects/open-agent-connect
git fetch origin
git worktree add .worktrees/oac-abc-0.3-package-consumption -b codex/oac-abc-0.3-package-consumption origin/main
cd .worktrees/oac-abc-0.3-package-consumption
git status --short --branch
```

Expected status:

```text
## codex/oac-abc-0.3-package-consumption
```

## File Map

- `package.json` and `package-lock.json` pin the published ABC packages OAC consumes.
- `tests/browser/browserPublishedPackages.test.mjs` proves package imports, exact package pins, and Browser UI subpath exports.
- `tests/npm/packageFiles.test.mjs` keeps npm package metadata assertions aligned with the new package pins.
- `src/browser/app.ts`, `src/browser/page.ts`, and `src/browser/menuModel.ts` become compatibility re-export shims over `@openagentinternet/agent-browser-ui/browser`.
- `src/browser/http.ts` uses the published host-contract command result shape for `/api/browser/*`.
- `src/daemon/browser/oacBrowserCoreBridge.ts` adapts OAC's local Browser host adapter to the ABC `0.3.0` host contract.
- `src/daemon/defaultHandlers.ts` wires `/api/browser/runtime`, `/api/browser/resolve`, `/api/browser/settings`, `/api/browser/cache`, and `/api/browser/actions` through the ABC contract bridge while keeping `/api/browser/context` backward compatible.
- `tests/daemon/oacBrowserCoreBridge.test.mjs` verifies OAC host contract conformance and command-state correctness.
- `tests/browser/browserModuleBoundary.test.mjs` verifies OAC Browser route and module boundaries use ABC UI and host-contract packages.
- `tests/daemon/browserUiRoutes.test.mjs`, `tests/daemon/browserRoutes.test.mjs`, and `tests/ui/browserPage*.test.mjs` protect the visible Browser shell and API behavior.

## Task 1: Pin ABC 0.3 Packages In OAC

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/browser/browserPublishedPackages.test.mjs`
- Modify: `tests/npm/packageFiles.test.mjs`

- [ ] **Step 1: Update the package import smoke test first**

Replace `tests/browser/browserPublishedPackages.test.mjs` with:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('OAC can import published Agent Browser packages pinned to 0.3.0', () => {
  const contract = require('@openagentinternet/agent-browser-host-contract');
  const core = require('@openagentinternet/agent-browser-core');
  const ui = require('@openagentinternet/agent-browser-ui/browser');
  const harness = require('@openagentinternet/agent-browser-test-harness');

  assert.equal(typeof contract.browserSuccess, 'function');
  assert.equal(typeof contract.browserWaiting, 'function');
  assert.equal(typeof contract.browserManualActionRequired, 'function');
  assert.equal(typeof core.parseBrowserUri, 'function');
  assert.equal(typeof core.normalizeResourceSections, 'function');
  assert.equal(typeof ui.buildBrowserPageDefinition, 'function');
  assert.equal(typeof ui.renderBrowserPageHtml, 'function');
  assert.equal(typeof harness.assertBrowserHostConformance, 'function');
  assert.equal(typeof harness.assertBrowserCommandResultShape, 'function');
});

test('OAC pins consumed Agent Browser packages to 0.3.0', () => {
  const rootPackage = require('../../package.json');

  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-contract'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-core'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-ui'], '0.3.0');
  assert.equal(rootPackage.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
});
```

- [ ] **Step 2: Update npm package metadata assertions**

In `tests/npm/packageFiles.test.mjs`, replace the current Agent Browser package assertions with:

```js
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-host-contract'], '0.3.0');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-core'], '0.3.0');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-ui'], '0.3.0');
  assert.equal(packageJson.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.3.0');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
```

- [ ] **Step 3: Run the tests before installing packages**

Run:

```bash
npm run build && node --test tests/browser/browserPublishedPackages.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: FAIL because `package.json` still pins `0.1.0` and `@openagentinternet/agent-browser-ui/browser` is not installed.

- [ ] **Step 4: Install exact ABC 0.3 packages consumed by OAC**

Run:

```bash
npm install --save-exact @openagentinternet/agent-browser-host-contract@0.3.0 @openagentinternet/agent-browser-core@0.3.0 @openagentinternet/agent-browser-ui@0.3.0
npm install --save-dev --save-exact @openagentinternet/agent-browser-test-harness@0.3.0
```

- [ ] **Step 5: Verify package import and metadata tests pass**

Run:

```bash
npm run build && node --test tests/browser/browserPublishedPackages.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit package pins**

Run:

```bash
git add package.json package-lock.json tests/browser/browserPublishedPackages.test.mjs tests/npm/packageFiles.test.mjs
git commit -m "chore: pin agent browser core 0.3 packages"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Task 2: Switch OAC Browser UI Shims To ABC UI

**Files:**
- Modify: `src/browser/app.ts`
- Modify: `src/browser/page.ts`
- Modify: `src/browser/menuModel.ts`
- Modify: `tests/browser/browserModuleBoundary.test.mjs`
- Test: `tests/daemon/browserUiRoutes.test.mjs`
- Test: `tests/ui/browserPageActions.test.mjs`
- Test: `tests/ui/browserPageInspector.test.mjs`
- Test: `tests/ui/browserPageLayout.test.mjs`
- Test: `tests/ui/browserPageRenderers.test.mjs`
- Test: `tests/ui/browserPageState.test.mjs`

- [ ] **Step 1: Replace `src/browser/app.ts` with ABC UI re-exports**

Replace the file with:

```ts
export {
  buildBrowserPageDefinition,
  type BrowserPageDefinition,
  type BrowserPagePanelDefinition,
} from '@openagentinternet/agent-browser-ui/browser';
```

- [ ] **Step 2: Replace `src/browser/menuModel.ts` with ABC UI re-exports**

Replace the file with:

```ts
export {
  BROWSER_BASE_URL_FIELDS,
  BROWSER_BOT_HOMEPAGE_TEMPLATES,
  BROWSER_MENU_SECTIONS,
  BROWSER_SETTINGS_TABS,
  type BrowserBaseUrlFieldDefinition,
  type BrowserMenuItemDefinition,
  type BrowserMenuSectionDefinition,
  type BrowserSettingsTabDefinition,
} from '@openagentinternet/agent-browser-ui/browser';
```

- [ ] **Step 3: Replace `src/browser/page.ts` with ABC UI re-exports**

Replace the file with:

```ts
export {
  renderBrowserPageHtml,
} from '@openagentinternet/agent-browser-ui/browser';
export type {
  BrowserPageDefinition,
} from '@openagentinternet/agent-browser-ui/browser';
```

- [ ] **Step 4: Add module-boundary assertions for ABC UI package consumption**

In `tests/browser/browserModuleBoundary.test.mjs`, add this test after the existing Browser page render tests:

```js
test('Browser page modules consume the published ABC UI package', () => {
  const outputFiles = [
    '../../dist/browser/app.js',
    '../../dist/browser/page.js',
    '../../dist/browser/menuModel.js',
  ];

  for (const relativePath of outputFiles) {
    const contents = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(contents, /@openagentinternet\/agent-browser-ui\/browser/);
    assert.doesNotMatch(contents, /Browser page template not found/);
    assert.doesNotMatch(contents, /loadBrowserPageTemplate/);
  }
});
```

- [ ] **Step 5: Run focused UI and route tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/browserUiRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageInspector.test.mjs \
  tests/ui/browserPageLayout.test.mjs \
  tests/ui/browserPageRenderers.test.mjs \
  tests/ui/browserPageState.test.mjs
```

Expected: PASS. `/browser` and `/ui/browser` must still serve the same Browser shell, and the shell must still include `data-browser-shell`, `data-browser-uri-input`, `data-browser-viewport`, `data-browser-status-strip`, `/api/browser/resolve`, and `/api/browser/actions`.

- [ ] **Step 6: Commit ABC UI consumption**

Run:

```bash
git add src/browser/app.ts src/browser/page.ts src/browser/menuModel.ts tests/browser/browserModuleBoundary.test.mjs
git commit -m "refactor: consume agent browser ui package"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Task 3: Align OAC Browser HTTP Routes With ABC Host Contract Results

**Files:**
- Modify: `src/browser/http.ts`
- Modify: `tests/browser/browserModuleBoundary.test.mjs`
- Test: `tests/daemon/browserRoutes.test.mjs`

- [ ] **Step 1: Change Browser HTTP route result types to the published contract**

In `src/browser/http.ts`, replace the OAC command-result import and local host type imports with:

```ts
import {
  browserFailure,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandResult,
  type BrowserResolveResult,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionKind,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import type { BrowserContextResult } from '../core/browser/types';
```

- [ ] **Step 2: Update `BrowserHttpHandlers` to return `BrowserCommandResult`**

In `src/browser/http.ts`, replace the handler interface with:

```ts
export interface BrowserHttpHandlers {
  getRuntime?: (input?: { actorId?: string; from?: string }) => Awaitable<BrowserCommandResult<BrowserRuntimeSnapshot>>;
  getContext?: (input?: { actorId?: string; from?: string }) => Awaitable<BrowserCommandResult<BrowserContextResult>>;
  resolve?: (input: { uri: string; actorId?: string; from?: string }) => Awaitable<BrowserCommandResult<BrowserResolveResult>>;
  getSettings?: (input?: { actorId?: string; from?: string }) => Awaitable<BrowserCommandResult<BrowserSettingsSnapshot>>;
  updateSettings?: (input: { actorId?: string; from?: string; browser?: Record<string, unknown> } & Record<string, unknown>) => Awaitable<BrowserCommandResult<BrowserSettingsSnapshot>>;
  getCache?: (input?: { actorId?: string; from?: string }) => Awaitable<BrowserCommandResult<BrowserCacheSnapshot>>;
  clearCache?: (input: { actorId?: string; from?: string; scope?: string; pinId?: string; cacheKey?: string } & Record<string, unknown>) => Awaitable<BrowserCommandResult<BrowserCacheClearResult>>;
  runTrustedAction?: (input: BrowserTrustedActionInput & { from?: string }) => Awaitable<BrowserCommandResult<BrowserTrustedActionResult>>;
}
```

- [ ] **Step 3: Replace local command failures with ABC command failures**

In `src/browser/http.ts`, replace every `commandFailed(` call with `browserFailure(`. Keep the same code and message strings. For example:

```ts
browserFailure('not_implemented', 'Browser runtime handler is not configured.')
```

Also change:

```ts
export function statusForBrowserResult(result: MetabotCommandResult<unknown>): number {
```

to:

```ts
export function statusForBrowserResult(result: BrowserCommandResult<unknown>): number {
```

- [ ] **Step 4: Add module-boundary assertions for host-contract route usage**

In `tests/browser/browserModuleBoundary.test.mjs`, add this test after the ABC UI package test:

```js
test('Browser API route boundary uses the published host contract result shape', () => {
  const contents = readFileSync(new URL('../../dist/browser/http.js', import.meta.url), 'utf8');

  assert.match(contents, /@openagentinternet\/agent-browser-host-contract/);
  assert.doesNotMatch(contents, /\.\.\/core\/contracts\/commandResult/);
});
```

- [ ] **Step 5: Run focused API route tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/browserRoutes.test.mjs
```

Expected: PASS. `waiting` and `manual_action_required` Browser command results must still be serialized with HTTP `200`.

- [ ] **Step 6: Commit route contract alignment**

Run:

```bash
git add src/browser/http.ts tests/browser/browserModuleBoundary.test.mjs
git commit -m "refactor: align browser api routes with host contract"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Task 4: Update OAC Core Bridge To ABC 0.3 Contract

**Files:**
- Modify: `src/daemon/browser/oacBrowserCoreBridge.ts`
- Modify: `tests/daemon/oacBrowserCoreBridge.test.mjs`

- [ ] **Step 1: Replace envelope bridge imports with 0.3 contract imports**

In `src/daemon/browser/oacBrowserCoreBridge.ts`, replace the import block from `@openagentinternet/agent-browser-host-contract` with:

```ts
import {
  browserFailure,
  browserManualActionRequired,
  browserSuccess,
  browserWaiting,
  type BrowserActorInput,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandFailure,
  type BrowserCommandFailureOptions,
  type BrowserCommandResult,
  type BrowserCommandWaitingOptions,
  type BrowserFollowUpAction,
  type BrowserHostAdapter,
  type BrowserResolveResult,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
```

Remove the import of `normalizeResourceSections` from `@openagentinternet/agent-browser-core`.

- [ ] **Step 2: Add follow-up action mapping helpers**

In `src/daemon/browser/oacBrowserCoreBridge.ts`, add these helpers after `list()`:

```ts
function followUpActionFromOac(result: MetabotCommandResult<unknown>): BrowserFollowUpAction | undefined {
  const resultData = record(result.data);
  const href = text((result as { localUiUrl?: unknown }).localUiUrl);
  const traceId = text(resultData.traceId);
  const route = href ? '' : traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
  if (!href && !route) return undefined;
  const action: BrowserFollowUpAction = {
    label: text((result as { actionLabel?: unknown }).actionLabel) || 'Open details',
  };
  if (href) action.href = href;
  if (route) action.route = route;
  return action;
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  const next = record(value);
  return Object.keys(next).length ? next : undefined;
}
```

- [ ] **Step 3: Preserve OAC non-terminal command states**

Replace `toBrowserFailure()` and `toBrowserResult()` with:

```ts
function failureCode(result: MetabotCommandResult<unknown>): string {
  return text((result as { code?: unknown }).code) || text((result as { state?: unknown }).state) || 'browser_oac_failure';
}

function failureMessage(result: MetabotCommandResult<unknown>): string {
  return text((result as { message?: unknown }).message) || 'OAC Browser command failed.';
}

function toBrowserFailure(result: MetabotCommandResult<unknown>): BrowserCommandFailure {
  const options: BrowserCommandFailureOptions = {};
  const action = followUpActionFromOac(result);
  const data = dataRecord(result.data);
  if (action) options.action = action;
  if (data) options.data = data;
  return browserFailure(failureCode(result), failureMessage(result), options);
}

function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  if (result.ok) return browserSuccess(result.data);

  if (result.state === 'waiting') {
    const options: BrowserCommandWaitingOptions = {};
    const pollAfterMs = (result as { pollAfterMs?: unknown }).pollAfterMs;
    const action = followUpActionFromOac(result);
    const data = dataRecord(result.data);
    if (typeof pollAfterMs === 'number') options.pollAfterMs = pollAfterMs;
    if (action) options.action = action;
    if (data) options.data = data;
    return browserWaiting(failureCode(result), failureMessage(result), options);
  }

  if (result.state === 'manual_action_required') {
    const options: BrowserCommandFailureOptions = {};
    const action = followUpActionFromOac(result);
    const data = dataRecord(result.data);
    if (action) options.action = action;
    if (data) options.data = data;
    return browserManualActionRequired(failureCode(result), failureMessage(result), options);
  }

  return toBrowserFailure(result);
}
```

- [ ] **Step 4: Return `BrowserResolveResult` from `resolveResource()`**

Delete `ownerFromResult()`, `actionFromOac()`, `sectionsFromOacResult()`, and `oacResolveResultToBrowserEnvelope()` from `src/daemon/browser/oacBrowserCoreBridge.ts`.

Then replace the bridge `resolveResource()` implementation with:

```ts
    async resolveResource(resolveInput): Promise<BrowserCommandResult<BrowserResolveResult>> {
      return toBrowserResult(await adapter.resolveResource(resolveInput));
    },
```

- [ ] **Step 5: Preserve non-terminal trusted action states instead of converting them to success**

Replace `trustedActionResultFromOac()` with:

```ts
function trustedActionResultFromOac(
  actionInput: BrowserTrustedActionInput,
  result: MetabotCommandResult<unknown>,
): BrowserCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    return toBrowserResult(result as MetabotCommandResult<BrowserTrustedActionResult>);
  }

  const outer = record(result.data);
  const nested = record(outer.data);
  const normalizedData = trustedActionData(Object.keys(nested).length ? nested : outer);
  const response: BrowserTrustedActionResult = {
    kind: actionInput.kind,
    handled: true,
  };
  if (normalizedData) response.data = normalizedData;
  return browserSuccess(response);
}
```

Delete `nonTerminalTrustedActionResultFromOac()` because `browserWaiting()` and `browserManualActionRequired()` now represent those states directly.

- [ ] **Step 6: Update the bridge tests for 0.3 behavior**

In `tests/daemon/oacBrowserCoreBridge.test.mjs`:

1. Rename the envelope test to:

```js
test('OAC Browser core bridge maps resolved Bot pages to BrowserResolveResult actions', async (t) => {
```

2. Remove assertions for `resolved.data.sections`.

3. Assert the copy action remains a resolve action:

```js
  const copyUri = resolved.data.actions.find((action) => action.kind === 'copy');
  assert.deepEqual(copyUri, {
    id: 'copy-uri',
    label: 'Copy URI',
    kind: 'copy',
    enabled: true,
    uri: 'metaid://idq1fixturebot',
  });
```

4. Rename the non-terminal test to:

```js
test('OAC Browser core bridge preserves non-terminal service-call command states', async (t) => {
```

5. Replace the `withHref` assertions with:

```js
  assert.equal(withHref.ok, false);
  assert.equal(withHref.state, 'waiting');
  assert.equal(withHref.code, 'order_sent_awaiting_provider');
  assert.match(withHref.message, /^Order sent\. Waiting for response/);
  assert.deepEqual(withHref.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-waiting',
  });
  assert.deepEqual(withHref.data, { traceId: 'trace-waiting' });
```

6. Replace the `withRoute` assertions with:

```js
  assert.equal(withRoute.ok, false);
  assert.equal(withRoute.state, 'waiting');
  assert.deepEqual(withRoute.action, {
    label: 'Open details',
    route: '/ui/trace?traceId=trace%20waiting%2Froute',
  });
```

7. Replace the `manualAction` assertions with:

```js
  assert.equal(manualAction.ok, false);
  assert.equal(manualAction.state, 'manual_action_required');
  assert.equal(manualAction.code, 'service_call_needs_confirmation');
  assert.deepEqual(manualAction.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-manual',
  });
  assert.deepEqual(manualAction.data, { traceId: 'trace-manual' });
```

- [ ] **Step 7: Run focused bridge tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/daemon/oacBrowserCoreBridge.test.mjs
```

Expected: PASS. The conformance test must use `@openagentinternet/agent-browser-test-harness@0.3.0`.

- [ ] **Step 8: Commit bridge contract update**

Run:

```bash
git add src/daemon/browser/oacBrowserCoreBridge.ts tests/daemon/oacBrowserCoreBridge.test.mjs
git commit -m "refactor: update oac browser bridge for core 0.3"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Task 5: Wire OAC Browser Runtime Through The ABC Contract Bridge

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/defaultBrowserHandlers.test.mjs`
- Modify: `tests/daemon/browserRoutes.test.mjs`
- Modify: `tests/browser/browserModuleBoundary.test.mjs`

- [ ] **Step 1: Import the ABC bridge in default handlers**

In `src/daemon/defaultHandlers.ts`, replace:

```ts
import { createOacBrowserHostAdapter } from './browser/oacBrowserHostAdapter';
```

with:

```ts
import { createOacBrowserCoreHostAdapter } from './browser/oacBrowserCoreBridge';
import { createOacBrowserHostAdapter } from './browser/oacBrowserHostAdapter';
```

Keep `createOacBrowserHostAdapter` because `/api/browser/context` still returns OAC's legacy context shape.

- [ ] **Step 2: Build one shared adapter input**

Replace the current `const browserHostAdapter = createOacBrowserHostAdapter(` block with:

```ts
  const browserHostAdapterInput = {
    homeDir: input.homeDir,
    systemHomeDir: normalizedSystemHomeDir,
    resolveActorWriteContext,
    metaAppPreviewSessions,
    privateChat: async (request) => daemonHandlers?.chat?.private
      ? daemonHandlers.chat.private(request)
      : commandFailed('not_implemented', 'Private chat handler is not configured.'),
    serviceCall: async (request) => daemonHandlers?.services?.call
      ? daemonHandlers.services.call(request)
      : commandFailed('not_implemented', 'Service call handler is not configured.'),
    fetch: globalThis.fetch,
    env: process.env,
  };
  const browserHostAdapter = createOacBrowserHostAdapter(browserHostAdapterInput);
  const browserCoreHostAdapter = createOacBrowserCoreHostAdapter(browserHostAdapterInput);
```

- [ ] **Step 3: Add actor fallback helper for legacy `from` query values**

Add this helper near the Browser handler block:

```ts
  function browserActorId(request: { actorId?: string; from?: string }): string | undefined {
    return request.actorId || request.from || undefined;
  }
```

- [ ] **Step 4: Route Browser contract endpoints through `browserCoreHostAdapter`**

In the `daemonHandlers.browser` object, use `browserCoreHostAdapter` for contract endpoints:

```ts
      getRuntime: async (request = {}) => browserCoreHostAdapter.getRuntime({
        actorId: browserActorId(request),
      }),
      getSettings: async (request = {}) => browserCoreHostAdapter.getSettings({
        actorId: browserActorId(request),
      }),
      updateSettings: async (request) => browserCoreHostAdapter.updateSettings({
        actorId: browserActorId(request),
        browser: request.browser,
      }),
      getCache: async (request = {}) => browserCoreHostAdapter.getCache({
        actorId: browserActorId(request),
      }),
      clearCache: async (request) => browserCoreHostAdapter.clearCache({
        actorId: browserActorId(request),
        scope: request.scope,
        pinId: request.pinId,
        cacheKey: request.cacheKey,
      }),
      resolve: async (request) => browserCoreHostAdapter.resolveResource({
        actorId: browserActorId(request),
        uri: request.uri,
      }),
      runTrustedAction: async (request) => {
        const actionRequest = {
          actorId: browserActorId(request),
          resourceUri: request.resourceUri,
          kind: request.kind,
        };
        if (request.payload) {
          Object.assign(actionRequest, { payload: request.payload });
        }
        return browserCoreHostAdapter.runTrustedAction(actionRequest);
      },
```

Keep `getContext` backed by `browserHostAdapter.getRuntime()` and `browserRuntimeToContextResult()` so older callers still receive `usingIdentities`.

- [ ] **Step 5: Add route assertions for contract states**

In `tests/daemon/browserRoutes.test.mjs`, add or update tests so `/api/browser/actions` returns:

```js
assert.equal(payload.ok, false);
assert.equal(payload.state, 'waiting');
assert.equal(payload.action.href || payload.action.route, expectedFollowUpTarget);
```

Use the existing service-call route test setup from `tests/daemon/oacBrowserCoreBridge.test.mjs` and keep the expected HTTP status at `200`.

- [ ] **Step 6: Add module-boundary assertion for default handler bridge usage**

In `tests/browser/browserModuleBoundary.test.mjs`, add:

```js
test('OAC default Browser handlers use the ABC host contract bridge', () => {
  const contents = readFileSync(new URL('../../dist/daemon/defaultHandlers.js', import.meta.url), 'utf8');

  assert.match(contents, /oacBrowserCoreBridge/);
  assert.match(contents, /createOacBrowserCoreHostAdapter/);
});
```

- [ ] **Step 7: Run focused daemon Browser tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/defaultBrowserHandlers.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/daemon/oacBrowserCoreBridge.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs
```

Expected: PASS. `/api/browser/context` must still return the legacy OAC context result, and the other Browser endpoints must return ABC host-contract command results.

- [ ] **Step 8: Commit runtime bridge wiring**

Run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBrowserHandlers.test.mjs tests/daemon/browserRoutes.test.mjs tests/browser/browserModuleBoundary.test.mjs
git commit -m "refactor: route oac browser through core bridge"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Task 6: Final Verification And Documentation Status

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-oac-agent-browser-core-0.3-consumption.md`

- [ ] **Step 1: Run the focused Browser and package verification suite**

Run:

```bash
npm run build && node --test --test-concurrency=1 \
  tests/browser/browserPublishedPackages.test.mjs \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/browser/uri.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/browser/metaAppResolver.test.mjs \
  tests/daemon/browserUiRoutes.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/daemon/defaultBrowserHandlers.test.mjs \
  tests/daemon/oacBrowserCoreBridge.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageInspector.test.mjs \
  tests/ui/browserPageLayout.test.mjs \
  tests/ui/browserPageRenderers.test.mjs \
  tests/ui/browserPageState.test.mjs \
  tests/npm/packageFiles.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full verification because this changes package and shared Browser route plumbing**

Run:

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 3: Run whitespace verification**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Update this plan status**

In this file, add an implementation status note under this step with:

```markdown
## Implementation Status

- Branch: `codex/oac-abc-0.3-package-consumption`
- ABC package version consumed by OAC: `0.3.0`
- OAC consumes `@openagentinternet/agent-browser-ui` for Browser shell rendering.
- OAC Browser API route results use `@openagentinternet/agent-browser-host-contract`.
- OAC keeps local Bot actor/profile/cache/action adapters.
- Metalet login remains outside this OAC phase.
- Verification: `npm run verify` passed.
```

## Implementation Status

- Branch: `codex/oac-abc-0.3-package-consumption`
- ABC package version consumed by OAC: `0.3.0`
- OAC consumes `@openagentinternet/agent-browser-ui` for Browser shell rendering.
- OAC Browser API route results use `@openagentinternet/agent-browser-host-contract`.
- OAC keeps local Bot actor/profile/cache/action adapters.
- Metalet login remains outside this OAC phase.
- Verification: `npm run verify` passed.

- [ ] **Step 5: Commit final status**

Run:

```bash
git add docs/superpowers/plans/2026-06-12-oac-agent-browser-core-0.3-consumption.md
git commit -m "docs: close oac browser core 0.3 consumption plan"
```

Then use the `metabot-post-buzz` skill with Bob to publish a development diary for this commit.

## Final Review Checklist

Before asking to merge:

- `git status --short --branch` is clean on `codex/oac-abc-0.3-package-consumption`.
- OAC package pins are exact `0.3.0`.
- OAC does not install `@openagentinternet/agent-browser-host-standalone`.
- OAC Browser page rendering comes from `@openagentinternet/agent-browser-ui/browser`.
- OAC Browser API route result helpers come from `@openagentinternet/agent-browser-host-contract`.
- OAC bridge conformance uses `@openagentinternet/agent-browser-test-harness@0.3.0`.
- `waiting` and `manual_action_required` action results are preserved as contract states, not converted to success.
- OAC top-right actor state remains OAC MetaBot profile based.
- `/browser` and `/ui/browser` still serve the same Browser shell.
- `/api/browser/context` still works for legacy OAC callers.
- No ABC repository files were changed.
