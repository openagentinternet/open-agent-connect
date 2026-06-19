# OAC Browser Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove OAC's local Browser core mirror and standalone host so OAC consumes ABC Browser packages through one host adapter only.

**Architecture:** Keep OAC Browser code only where OAC is truly host-specific: Bot/profile selection, local route wrappers, MetaApp preview glue, and OAC-owned trusted actions. Move the runtime path to one adapter that returns the published Browser host-contract result shape directly, delete the extra OAC core bridge, and delete local Browser core/standalone source trees once the boundary tests prove ABC is the only shared Browser core.

**Tech Stack:** Node.js `>=20 <25`, TypeScript strict CommonJS build, `@openagentinternet/agent-browser-core@0.3.1`, `@openagentinternet/agent-browser-host-contract@0.3.1`, Node test runner, npm pack dry-run checks.

---

## Preconditions

- All commands run from `/Users/tusm/Documents/MetaID_Projects/open-agent-connect`.
- If the worktree does not have `node_modules/`, run `npm install` once before Task 1 so `npm run build` and the focused tests can run locally.
- Do not touch `/Users/tusm/Documents/MetaID_Projects/agent-browser-core`. This cleanup is OAC-only.

## File Map

### Keep and modify

- `src/daemon/browser/oacBrowserHostAdapter.ts` - the single surviving OAC Browser adapter, returning ABC host-contract results directly.
- `src/daemon/defaultHandlers.ts` - remove the bridge wiring and inline OAC Browser context mapping.
- `src/browser/http.ts` - keep the OAC Browser HTTP shell, but import Browser context types from ABC instead of local core files.
- `src/browser/index.ts` - keep only Browser shell exports and package types; remove standalone exports.
- `package.json` - remove the `browser-standalone` bin.
- `AGENTS.md` - update the runtime entrypoint and `src/browser/` description so they match the new boundary.
- `tests/browser/browserModuleBoundary.test.mjs` - invert the architecture assertions so the old mixed shape fails.
- `tests/browser/browserPublishedPackages.test.mjs` - keep the package smoke and exact-version checks for consumed ABC packages.
- `tests/npm/packageFiles.test.mjs` - guard against publishing standalone or local Browser core artifacts.
- `tests/daemon/oacBrowserHostAdapter.test.mjs` - move host-contract conformance coverage onto the only remaining adapter.
- `tests/daemon/browserRoutes.test.mjs` - keep route-wrapper coverage after the adapter collapse.

### Delete

- `src/daemon/browser/oacBrowserCoreBridge.ts`
- `src/core/browser/botHomepageClient.ts`
- `src/core/browser/botHomepageTemplates.ts`
- `src/core/browser/botPageResolver.ts`
- `src/core/browser/browserResolver.ts`
- `src/core/browser/config.ts`
- `src/core/browser/hostTypes.ts`
- `src/core/browser/metaAppPinResolver.ts`
- `src/core/browser/metaAppResolver.ts`
- `src/core/browser/runtimeContext.ts`
- `src/core/browser/settings.ts`
- `src/core/browser/types.ts`
- `src/core/browser/uri.ts`
- `src/browser/standalone/adapter.ts`
- `src/browser/standalone/main.ts`
- `src/browser/standalone/server.ts`
- `tests/daemon/oacBrowserCoreBridge.test.mjs`
- `tests/browser/browserRuntimeContext.test.mjs`
- `tests/browser/browserStandaloneAdapter.test.mjs`
- `tests/browser/browserStandaloneServer.test.mjs`
- `tests/browser/browserResolver.test.mjs`
- `tests/browser/metaAppPinResolver.test.mjs`
- `tests/browser/botHomepageResolver.test.mjs`
- `tests/browser/metaAppResolver.test.mjs`
- `tests/browser/uri.test.mjs`
- `tests/config/browserConfig.test.mjs`

## Task 1: Guard the new boundary in tests and pack checks

**Files:**
- Modify: `tests/browser/browserModuleBoundary.test.mjs`
- Modify: `tests/npm/packageFiles.test.mjs`
- Test: `tests/browser/browserModuleBoundary.test.mjs`
- Test: `tests/npm/packageFiles.test.mjs`

- [ ] **Step 1: Write failing boundary assertions for "one adapter, no standalone, no local Browser core"**

Update `tests/browser/browserModuleBoundary.test.mjs` so it asserts the post-cleanup shape instead of the current mixed shape:

```js
test('Browser module output no longer exports standalone host helpers', () => {
  assert.equal(browserModule.createStandaloneBrowserHostAdapter, undefined);
  assert.equal(browserModule.createStandaloneBrowserServer, undefined);

  const contents = readFileSync(new URL('../../dist/browser/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(contents, /standalone\/adapter/);
  assert.doesNotMatch(contents, /standalone\/server/);
});

test('OAC default Browser handlers use exactly one Browser adapter', () => {
  const contents = readFileSync(new URL('../../dist/daemon/defaultHandlers.js', import.meta.url), 'utf8');

  assert.match(contents, /createOacBrowserHostAdapter/);
  assert.doesNotMatch(contents, /oacBrowserCoreBridge/);
  assert.doesNotMatch(contents, /createOacBrowserCoreHostAdapter/);
  assert.doesNotMatch(contents, /browserRuntimeToContextResult/);
});

test('OAC Browser adapter consumes published ABC packages directly', () => {
  const contents = readFileSync(new URL('../../dist/daemon/browser/oacBrowserHostAdapter.js', import.meta.url), 'utf8');

  assert.match(contents, /@openagentinternet\/agent-browser-host-contract/);
  assert.match(contents, /@openagentinternet\/agent-browser-core/);
  assert.doesNotMatch(contents, /\.\.\/\.\.\/core\/browser\//);
  assert.doesNotMatch(contents, /browser\/standalone/);
});
```

Update `tests/npm/packageFiles.test.mjs` so the packed npm artifact rejects the old Browser surfaces:

```js
  assertExcludesPrefix(paths, 'dist/browser/standalone/');
  assertExcludesPrefix(paths, 'dist/core/browser/');
  assertExcludesPrefix(paths, 'src/core/browser/');
  assertExcludesPrefix(paths, 'dist/daemon/browser/oacBrowserCoreBridge');
```

- [ ] **Step 2: Run the focused tests and confirm they fail on the current code**

Run:

```bash
npm run build && node --test \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/npm/packageFiles.test.mjs
```

Expected: FAIL because `dist/browser/index.js` still exports standalone helpers, `dist/daemon/defaultHandlers.js` still imports `oacBrowserCoreBridge`, and the packed artifact still contains `dist/browser/standalone/*`.

- [ ] **Step 3: Leave the failing guards in the working tree for the next tasks**

Do not commit these guard edits yet. OAC repo policy requires the verification that belongs to a commit to pass before that commit is created. That means:

- the bridge-collapse commit in Task 2 should stage only Task 2 files
- the core-mirror removal commit in Task 3 should stage only Task 3 files
- the pending Task 1 guard edits should stay out of those earlier commits until Task 4 makes them pass

## Task 2: Collapse OAC Browser runtime wiring to one adapter

**Files:**
- Modify: `src/daemon/browser/oacBrowserHostAdapter.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/oacBrowserHostAdapter.test.mjs`
- Delete: `src/daemon/browser/oacBrowserCoreBridge.ts`
- Delete: `tests/daemon/oacBrowserCoreBridge.test.mjs`
- Test: `tests/daemon/oacBrowserHostAdapter.test.mjs`
- Test: `tests/daemon/browserRoutes.test.mjs`

- [ ] **Step 1: Move the published host-contract conformance test onto the surviving adapter**

Extend `tests/daemon/oacBrowserHostAdapter.test.mjs` with the bridge conformance case, but require the real adapter directly:

```js
const { assertBrowserHostConformance } = require('@openagentinternet/agent-browser-test-harness');

test('OAC browser host adapter satisfies the published Browser host contract directly', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-contract');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Adapter Contract Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1adaptercontract',
    mvcAddress: '18AdapterContract',
  });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
  });

  await assertBrowserHostConformance({
    adapter,
    expectedHostKind: 'oac',
    sampleUri: 'metaid://idq1fixturebot',
  });
});
```

Delete `tests/daemon/oacBrowserCoreBridge.test.mjs` after the replacement test exists.

- [ ] **Step 2: Run the adapter tests and verify the new conformance case fails before the refactor**

Run:

```bash
npm run build && node --test \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs
```

Expected: FAIL because `createOacBrowserHostAdapter()` still returns OAC-local `MetabotCommandResult` envelopes and the published harness currently targets `createOacBrowserCoreHostAdapter()`.

- [ ] **Step 3: Refactor `src/daemon/browser/oacBrowserHostAdapter.ts` to return the published Browser host-contract shape directly**

Replace the local Browser-core imports at the top of `src/daemon/browser/oacBrowserHostAdapter.ts` with package imports:

```ts
import {
  applyBrowserSettingsUpdate,
  createBrowserSettingsSnapshot,
  resolveBrowserConfig,
  resolveBrowserResource,
  resolveMetaAppPinToRecord,
} from '@openagentinternet/agent-browser-core';
import {
  browserFailure,
  browserManualActionRequired,
  browserSuccess,
  browserWaiting,
  type BrowserActor,
  type BrowserActorCapability,
  type BrowserActorInput,
  type BrowserCacheClearInput,
  type BrowserCacheClearResult,
  type BrowserCacheInput,
  type BrowserCacheSnapshot,
  type BrowserCommandFailureOptions,
  type BrowserCommandResult,
  type BrowserFollowUpAction,
  type BrowserHostAdapter,
  type BrowserResolveInput,
  type BrowserResolveResult,
  type BrowserRuntimeInput,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsInput,
  type BrowserSettingsSnapshot,
  type BrowserSettingsUpdateInput,
  type BrowserOpenConversationPayload,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
```

Inline the bridge's envelope-conversion helpers into the adapter so the adapter itself owns the published result shape:

```ts
function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  if (result.ok) return browserSuccess(result.data);

  const action = followUpActionFromOac(result);
  const data = dataRecord(result.data);
  const options: BrowserCommandFailureOptions = {
    ...(action ? { action } : {}),
    ...(data ? { data } : {}),
  };

  if (result.state === 'waiting') {
    return browserWaiting(
      failureCode(result),
      failureMessage(result),
      {
        ...options,
        ...(typeof (result as { pollAfterMs?: unknown }).pollAfterMs === 'number'
          ? { pollAfterMs: (result as { pollAfterMs: number }).pollAfterMs }
          : {}),
      },
    );
  }

  if (result.state === 'manual_action_required') {
    return browserManualActionRequired(failureCode(result), failureMessage(result), options);
  }

  return browserFailure(failureCode(result), failureMessage(result), options);
}
```

Then change every adapter method to return `BrowserCommandResult<...>` directly:

```ts
async function getRuntime(runtimeInput: BrowserRuntimeInput = {}): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>> {
  const requestedActor = actorSelector(runtimeInput);
  const activeHomeDir = path.resolve(input.homeDir);
  const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
  const selectedProfile = requestedActor
    ? profiles.find((profile) => profile.slug === requestedActor) ?? null
    : profiles.find((profile) => path.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;

  if (requestedActor && !selectedProfile) {
    return browserFailure('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
  }

  const selectedHomeDir = selectedProfile ? path.resolve(selectedProfile.homeDir) : '';
  const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
  const defaultActor = selectedProfile
    ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
    : null;

  return browserSuccess({
    host: { kind: 'oac', name: 'Open Agent Connect', localMode: true },
    actors,
    defaultActor,
    defaultUri: defaultActor?.globalMetaId ? `metaid://${defaultActor.globalMetaId}` : null,
    features: { privateChat: true, serviceCall: true, cacheManagement: true, templateSettings: true, walletLogin: false },
    labels: {
      actorChip: 'Using',
      noActorTitle: 'Create your first Bot',
      noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
      noActorAction: { label: 'Create Bot', href: createBotHref(env) },
    },
  });
}

async function runTrustedAction(
  actionInput: BrowserTrustedActionInput,
): Promise<BrowserCommandResult<BrowserTrustedActionResult>> {
  const actor = await resolveActor(actionInput);
  if ('failure' in actor) return toBrowserResult(actor.failure);

  const from = actorSelector(actionInput);
  const payload = readActionPayload(actionInput);

  if (actionInput.kind === 'private-chat') {
    return toBrowserResult(await input.privateChat!({
      ...(from ? { from } : {}),
      to: normalizeText(payload.to) || normalizeText(payload.targetGlobalMetaId),
      content: normalizeText(payload.content) || normalizeText(payload.message),
    }));
  }

  if (actionInput.kind === 'service-call') {
    return toBrowserResult(await input.serviceCall!({
      ...(from ? { from } : {}),
      request: {
        servicePinId: normalizeText(payload.servicePinId),
        providerGlobalMetaId: normalizeText(payload.providerGlobalMetaId),
        userTask: normalizeText(payload.userTask) || normalizeText(payload.rawRequest),
        taskContext: normalizeText(payload.taskContext) || 'Requested from Agent Internet Browser',
        rawRequest: normalizeText(payload.rawRequest) || normalizeText(payload.userTask),
        confirmed: payload.confirmed === false ? false : true,
      },
    }));
  }

  if (actionInput.kind === 'open-conversation') {
    const openPayload = payload as Partial<BrowserOpenConversationPayload>;
    const profiles = await listMetabotProfiles(input.systemHomeDir);
    const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
    const localGlobalMetaId = normalizeText(selectedProfile?.globalMetaId);
    if (!localGlobalMetaId) {
      return browserManualActionRequired(
        'browser_identity_required',
        'Open conversation requires a selected local Bot with a Global MetaID.',
      );
    }
    return browserSuccess({
      kind: 'open-conversation',
      handled: true,
      data: {
        href: conversationHref(localGlobalMetaId, normalizeText(openPayload.peerGlobalMetaId)),
      },
    });
  }

  return browserFailure(
    'browser_action_not_supported',
    `Browser trusted action is not supported by OAC: ${actionInput.kind}`,
  );
}
```

In `src/daemon/defaultHandlers.ts`, remove the bridge wiring and keep one adapter only:

```ts
const browserHostAdapter = createOacBrowserHostAdapter(browserHostAdapterInput);

function browserContextFromRuntime(snapshot: BrowserRuntimeSnapshot): BrowserContextResult {
  const usingIdentities = snapshot.actors
    .filter((actor) => actor.kind === 'oac-bot')
    .map((actor) => ({
      slug: actor.id,
      name: actor.label,
      globalMetaId: actor.globalMetaId ?? '',
      ...(actor.avatar ? { avatar: actor.avatar } : {}),
      isDefault: actor.isDefault,
    }));

  const defaultUsingIdentity = snapshot.defaultActor && snapshot.defaultActor.kind === 'oac-bot' && snapshot.defaultActor.globalMetaId
    ? {
        slug: snapshot.defaultActor.id,
        name: snapshot.defaultActor.label,
        globalMetaId: snapshot.defaultActor.globalMetaId,
        ...(snapshot.defaultActor.avatar ? { avatar: snapshot.defaultActor.avatar } : {}),
        isDefault: snapshot.defaultActor.isDefault,
      }
    : null;

  return { usingIdentities, defaultUsingIdentity, defaultUri: snapshot.defaultUri };
}

browser: {
  getRuntime: async (request = {}) => browserHostAdapter.getRuntime({ actorId: browserActorId(request) }),
  getContext: async (request = {}) => {
    const runtime = await browserHostAdapter.getRuntime({ actorId: browserActorId(request) });
    if (!runtime.ok) return runtime;
    return browserSuccess(browserContextFromRuntime(runtime.data));
  },
  getSettings: async (request = {}) => browserHostAdapter.getSettings({ actorId: browserActorId(request) }),
  updateSettings: async (request) => browserHostAdapter.updateSettings({ actorId: browserActorId(request), browser: request.browser }),
  getCache: async (request = {}) => browserHostAdapter.getCache({ actorId: browserActorId(request) }),
  clearCache: async (request) => browserHostAdapter.clearCache({
    actorId: browserActorId(request),
    scope: request.scope,
    pinId: request.pinId,
    cacheKey: request.cacheKey,
  }),
  resolve: async (request) => browserHostAdapter.resolveResource({
    actorId: browserActorId(request),
    uri: request.uri,
  }),
  runTrustedAction: async (request) => browserHostAdapter.runTrustedAction({
    actorId: browserActorId(request),
    resourceUri: request.resourceUri,
    kind: request.kind,
    ...(request.payload ? { payload: request.payload } : {}),
  }),
},
```

Delete `src/daemon/browser/oacBrowserCoreBridge.ts`.

- [ ] **Step 4: Run the focused adapter and route tests again**

Run:

```bash
npm run build && node --test \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs
```

Expected: PASS. `tests/daemon/oacBrowserHostAdapter.test.mjs` should now satisfy the published host-contract harness directly, and the browser route wrapper should still forward the expected actor/context/action inputs.

- [ ] **Step 5: Commit the single-adapter refactor**

Run:

```bash
git add src/daemon/browser/oacBrowserHostAdapter.ts src/daemon/defaultHandlers.ts tests/daemon/oacBrowserHostAdapter.test.mjs tests/daemon/browserRoutes.test.mjs
git rm src/daemon/browser/oacBrowserCoreBridge.ts tests/daemon/oacBrowserCoreBridge.test.mjs
git commit -m "refactor: collapse browser adapter bridge"
```

Then use `metabot-post-buzz` with `--from eric` to publish a development journal for this commit.

## Task 3: Remove the local Browser core mirror and re-point shell typings to ABC

**Files:**
- Modify: `src/browser/http.ts`
- Modify: `src/browser/index.ts`
- Modify: `src/daemon/browser/oacBrowserHostAdapter.ts`
- Modify: `tests/browser/browserPublishedPackages.test.mjs`
- Delete: `src/core/browser/*`
- Delete: `tests/browser/browserRuntimeContext.test.mjs`
- Delete: `tests/browser/browserResolver.test.mjs`
- Delete: `tests/browser/metaAppPinResolver.test.mjs`
- Delete: `tests/browser/botHomepageResolver.test.mjs`
- Delete: `tests/browser/metaAppResolver.test.mjs`
- Delete: `tests/browser/uri.test.mjs`
- Delete: `tests/config/browserConfig.test.mjs`
- Test: `tests/browser/browserPublishedPackages.test.mjs`
- Test: `tests/daemon/oacBrowserHostAdapter.test.mjs`

- [ ] **Step 1: Add a failing build-output assertion for the local Browser core mirror, then re-point shell imports**

Extend `tests/browser/browserPublishedPackages.test.mjs` with a build-output guard:

```js
import { existsSync } from 'node:fs';

test('OAC build does not emit a local Browser core mirror', () => {
  assert.equal(
    existsSync(new URL('../../dist/core/browser', import.meta.url)),
    false,
    'dist/core/browser should disappear once OAC stops shipping its local Browser core',
  );
});
```

Update `src/browser/http.ts` so `BrowserContextResult` comes from the published ABC package:

```ts
import {
  browserFailure,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandResult,
  type BrowserResolveResult,
  BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  BrowserTrustedActionInput,
  BrowserTrustedActionKind,
  BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import type { BrowserContextResult } from '@openagentinternet/agent-browser-core';
```

Update `src/browser/index.ts` so it exports only the Browser shell and published package types:

```ts
export {
  handleBrowserApiRoutes,
  statusForBrowserResult,
  type BrowserHttpHandlers,
  type BrowserHttpRouteContext,
} from './http';
export { renderBrowserPageHtml } from './page';

export type {
  BrowserActor,
  BrowserActorCapability,
  BrowserActorInput,
  BrowserActorKind,
  BrowserCacheClearInput,
  BrowserCacheClearResult,
  BrowserCacheInput,
  BrowserCacheSnapshot,
  BrowserHostAdapter,
  BrowserHostKind,
  BrowserResolveInput,
  BrowserResolveResult,
  BrowserRuntimeInput,
  BrowserRuntimeSnapshot,
  BrowserSettingsInput,
  BrowserSettingsSnapshot,
  BrowserSettingsUpdateInput,
  BrowserTrustedActionInput,
  BrowserTrustedActionKind,
  BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
export type { BrowserContextResult } from '@openagentinternet/agent-browser-core';
```

Keep `src/daemon/browser/oacBrowserHostAdapter.ts` importing only ABC package APIs plus OAC host-glue modules such as `../../core/config/configStore`, `../../core/metaapp/artifactCache`, `../../core/metaapp/previewSessions`, and `../../core/bot/metabotProfileManager`.

- [ ] **Step 2: Run the focused tests and confirm they fail until the local Browser core files are removed**

Run:

```bash
npm run build && node --test \
  tests/browser/browserPublishedPackages.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs
```

Expected: FAIL while `src/browser/index.ts` still re-exports local `../core/browser/*` types and while the old local Browser core files still compile into `dist/core/browser/*`.

- [ ] **Step 3: Delete the local Browser core mirror and the unit tests that only exist to validate it**

Run:

```bash
git rm \
  src/core/browser/botHomepageClient.ts \
  src/core/browser/botHomepageTemplates.ts \
  src/core/browser/botPageResolver.ts \
  src/core/browser/browserResolver.ts \
  src/core/browser/config.ts \
  src/core/browser/hostTypes.ts \
  src/core/browser/metaAppPinResolver.ts \
  src/core/browser/metaAppResolver.ts \
  src/core/browser/runtimeContext.ts \
  src/core/browser/settings.ts \
  src/core/browser/types.ts \
  src/core/browser/uri.ts \
  tests/browser/browserRuntimeContext.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/browser/metaAppPinResolver.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/metaAppResolver.test.mjs \
  tests/browser/uri.test.mjs \
  tests/config/browserConfig.test.mjs
```

Do not replace these with new OAC-local unit tests. Their responsibilities now belong to the consumed ABC packages, and OAC's coverage should stay at the adapter/route/package-boundary level.

- [ ] **Step 4: Run the focused tests again**

Run:

```bash
npm run build && node --test \
  tests/browser/browserPublishedPackages.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs
```

Expected: PASS. The build should no longer emit `dist/core/browser/*`, and the surviving Browser shell code should type-check against the published ABC packages only.

- [ ] **Step 5: Commit the Browser core mirror removal**

Run:

```bash
git add src/browser/http.ts src/browser/index.ts src/daemon/browser/oacBrowserHostAdapter.ts tests/browser/browserPublishedPackages.test.mjs tests/daemon/oacBrowserHostAdapter.test.mjs tests/daemon/browserRoutes.test.mjs
git commit -m "refactor: remove local browser core mirror"
```

Then use `metabot-post-buzz` with `--from eric` to publish a development journal for this commit.

## Task 4: Remove the standalone host surface from OAC packaging and docs

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`
- Delete: `src/browser/standalone/adapter.ts`
- Delete: `src/browser/standalone/main.ts`
- Delete: `src/browser/standalone/server.ts`
- Delete: `tests/browser/browserStandaloneAdapter.test.mjs`
- Delete: `tests/browser/browserStandaloneServer.test.mjs`
- Test: `tests/browser/browserModuleBoundary.test.mjs`
- Test: `tests/npm/packageFiles.test.mjs`
- Test: `tests/daemon/browserUiRoutes.test.mjs`

- [ ] **Step 1: Update package and doc surfaces to stop advertising `browser-standalone`**

Change the `bin` section in `package.json` to:

```json
"bin": {
  "metabot": "dist/cli/main.js",
  "oac": "dist/oac/main.js"
},
```

Update `AGENTS.md` so the runtime list and `src/browser/` description no longer mention standalone hosting:

```md
Open Agent Connect (OAC) — an open-source connector that gives local AI agents a blockchain-backed network layer (identity, discovery, encrypted messaging, remote service calls, traces, payments). Two runtime entrypoints:

- `metabot` (CLI + daemon) — the full Bot runtime: `dist/cli/main.js`
- `oac` — the installer CLI: `dist/oac/main.js`
```

```md
| `src/browser/` | Agent Internet Browser app — HTTP handlers, menu model, and shell assets for the OAC Browser wrapper |
```

- [ ] **Step 2: Remove the standalone source files and their tests**

Run:

```bash
git rm \
  src/browser/standalone/adapter.ts \
  src/browser/standalone/main.ts \
  src/browser/standalone/server.ts \
  tests/browser/browserStandaloneAdapter.test.mjs \
  tests/browser/browserStandaloneServer.test.mjs
```

`src/browser/index.ts` should already be clean from Task 3. If it still exports standalone helpers at this point, stop and fix Task 3 before running this task. Do not leave dead export stubs behind.

- [ ] **Step 3: Run the focused packaging, browser-shell, and route tests**

Run:

```bash
npm run build && node --test \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/daemon/browserUiRoutes.test.mjs \
  tests/npm/packageFiles.test.mjs
```

Expected: PASS. `npm pack --dry-run` inside `tests/npm/packageFiles.test.mjs` should no longer see `dist/browser/standalone/*`, and the Browser shell tests should still render the OAC wrapper correctly.

- [ ] **Step 4: Commit the standalone surface removal**

Run:

```bash
git add package.json AGENTS.md tests/browser/browserModuleBoundary.test.mjs tests/npm/packageFiles.test.mjs tests/daemon/browserUiRoutes.test.mjs
git commit -m "chore: drop browser standalone surface"
```

Then use `metabot-post-buzz` with `--from eric` to publish a development journal for this commit.

## Task 5: Final verification on the cleaned boundary

**Files:**
- No new file edits. This task is verification only.

- [ ] **Step 1: Run the final focused verification set**

Run:

```bash
npm run build && node --test \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/browser/browserPublishedPackages.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/daemon/browserUiRoutes.test.mjs \
  tests/npm/packageFiles.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Confirm there is no surviving local Browser core or standalone host surface**

Run:

```bash
rg -n "core/browser/|browser/standalone|oacBrowserCoreBridge" src package.json AGENTS.md
find dist -type f | rg "dist/(core/browser|browser/standalone)|oacBrowserCoreBridge"
```

Expected:

- no matches under `src/`, `package.json`, or `AGENTS.md`
- no built files under `dist/core/browser/`
- no built files under `dist/browser/standalone/`
- no built `oacBrowserCoreBridge` artifact
- historical dated docs may still contain those strings; they are intentionally excluded from this command

- [ ] **Step 3: Confirm the npm artifact surface**

Run:

```bash
npm pack --dry-run --json
```

Expected: the listed files include `dist/cli/main.js`, `dist/oac/main.js`, `src/browser/index.html`, and `src/ui/...`, but do not include `dist/browser/standalone/` or `dist/core/browser/`.
