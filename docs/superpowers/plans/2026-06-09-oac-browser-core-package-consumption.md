# OAC Browser Core Package Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Open Agent Connect consume the published `agent-browser-core` `0.1.0` package contract without regressing the current OAC Browser UI or trusted-action flow.

**Architecture:** OAC remains the host: local MetaBot identity, profile storage, Browser settings, MetaApp cache, private chat, service calls, and owner actions stay inside OAC. The published Browser packages become the shared contract/core source for stable URI/template/resource-envelope semantics plus conformance tests. This phase intentionally does not replace OAC's richer local Browser shell with `@openagentinternet/agent-browser-ui@0.1.0`, because that package is a foundation preview and is not yet feature-parity with the current OAC Browser page.

**Tech Stack:** Node.js `>=20 <25`, TypeScript strict CommonJS build, npm packages pinned to `0.1.0`, Node test runner, OAC daemon Browser adapter.

---

## Current Baseline

`agent-browser-core` `v0.1.0` is published and `latest` points to `0.1.0` for:

- `@openagentinternet/agent-browser-host-contract`
- `@openagentinternet/agent-browser-core`
- `@openagentinternet/agent-browser-ui`
- `@openagentinternet/agent-browser-host-standalone`
- `@openagentinternet/agent-browser-test-harness`

OAC currently has a richer local Browser implementation under:

- `src/browser/`
- `src/core/browser/`
- `src/daemon/browser/oacBrowserHostAdapter.ts`
- `tests/browser/`
- `tests/daemon/oacBrowserHostAdapter.test.mjs`

Do not remove OAC's local Browser UI in this phase. The `0.1.0` shared UI package is useful as a published foundation, but it does not yet include OAC's full fixed chrome, settings menu, cache management UI, owner toolbar, i18n behavior, and trusted-action modals.

## Scope

In scope:

- Pin the published Browser packages that OAC actually consumes in this phase.
- Replace safe neutral local helpers with shared package exports where the APIs are already equivalent.
- Add an OAC-to-published-contract adapter bridge for conformance and future runtime migration.
- Add tests proving the OAC host can satisfy the published Browser host contract.
- Keep current OAC `/browser`, `/ui/browser`, and `/api/browser/*` behavior working.

Out of scope:

- Replacing OAC's Browser page with `@openagentinternet/agent-browser-ui@0.1.0`.
- Removing `src/browser/app.ts`, `src/browser/index.html`, or current OAC Browser client behavior.
- Removing OAC's current `browser-standalone` bin.
- Updating IDBots.
- Publishing a new ABC package version.
- Tagging or pushing from the implementation session unless explicitly requested.

## File Map

- `package.json` and `package-lock.json` - pin consumed `@openagentinternet/agent-browser-*` packages.
- `src/core/browser/uri.ts` - re-export shared URI parser from `@openagentinternet/agent-browser-core`.
- `src/core/browser/botHomepageTemplates.ts` - re-export shared template registry from `@openagentinternet/agent-browser-core`.
- `src/daemon/browser/oacBrowserCoreBridge.ts` - new OAC adapter bridge to the published `BrowserHostAdapter` contract.
- `tests/browser/browserPublishedPackages.test.mjs` - package import and version smoke.
- `tests/daemon/oacBrowserCoreBridge.test.mjs` - OAC adapter conformance against `@openagentinternet/agent-browser-test-harness`.
- `tests/browser/uri.test.mjs`, `tests/browser/botHomepageResolver.test.mjs`, `tests/daemon/oacBrowserHostAdapter.test.mjs` - existing behavior checks that must keep passing.

## Task 1: Pin Published Browser Packages

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/browser/browserPublishedPackages.test.mjs`

- [x] **Step 1: Write the failing package import smoke test**

Create `tests/browser/browserPublishedPackages.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('OAC can import published Agent Browser packages pinned for Phase 4', () => {
  const contract = require('@openagentinternet/agent-browser-host-contract');
  const core = require('@openagentinternet/agent-browser-core');
  const harness = require('@openagentinternet/agent-browser-test-harness');

  assert.equal(typeof contract.browserSuccess, 'function');
  assert.equal(typeof contract.browserFailure, 'function');
  assert.equal(typeof core.parseBrowserUri, 'function');
  assert.equal(typeof core.buildBotHomepageEnvelope, 'function');
  assert.equal(typeof core.BOT_HOMEPAGE_TEMPLATES.length, 'number');
  assert.equal(typeof harness.assertBrowserHostConformance, 'function');
});

test('OAC pins Agent Browser packages to the first published pre-1.0 version', () => {
  const rootPackage = require('../../package.json');

  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-contract'], '0.1.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-core'], '0.1.0');
  assert.equal(rootPackage.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.1.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-ui'], undefined);
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
});
```

- [x] **Step 2: Run the smoke test and verify it fails before dependencies are installed**

Run:

```bash
npm run build && node --test tests/browser/browserPublishedPackages.test.mjs
```

Expected: FAIL with `Cannot find module '@openagentinternet/agent-browser-host-contract'`.

- [x] **Step 3: Install only the packages OAC consumes in this phase**

Run:

```bash
npm install --save-exact @openagentinternet/agent-browser-host-contract@0.1.0 @openagentinternet/agent-browser-core@0.1.0
npm install --save-dev --save-exact @openagentinternet/agent-browser-test-harness@0.1.0
```

Do not install `@openagentinternet/agent-browser-ui` or `@openagentinternet/agent-browser-host-standalone` in this task. OAC's current Browser UI and standalone entrypoint remain local until the shared UI package reaches parity.

- [x] **Step 4: Run the smoke test again**

Run:

```bash
npm run build && node --test tests/browser/browserPublishedPackages.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit package pins**

Run:

```bash
git add package.json package-lock.json tests/browser/browserPublishedPackages.test.mjs
git commit -m "chore: pin published browser core packages"
```

Then use `metabot-post-buzz` with Bob (`--from bob`) to publish a development journal for this commit.

## Task 2: Replace Safe Neutral Helpers With Shared Core Exports

**Files:**
- Modify: `src/core/browser/uri.ts`
- Modify: `src/core/browser/botHomepageTemplates.ts`
- Test: `tests/browser/uri.test.mjs`
- Test: `tests/browser/botHomepageResolver.test.mjs`
- Test: `tests/daemon/oacBrowserHostAdapter.test.mjs`

- [x] **Step 1: Replace OAC URI parser with shared core export**

Change `src/core/browser/uri.ts` to:

```ts
export {
  parseBrowserUri,
  type BrowserUriScheme,
  type ParsedBrowserUri,
} from '@openagentinternet/agent-browser-core';
```

- [x] **Step 2: Replace OAC Bot homepage template registry with shared core export**

Change `src/core/browser/botHomepageTemplates.ts` to:

```ts
export {
  BOT_HOMEPAGE_TEMPLATES,
  DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
  isBotHomepageTemplateId,
  normalizeBotHomepageTemplateId,
  type BotHomepageTemplateDefinition,
  type BotHomepageTemplateId,
} from '@openagentinternet/agent-browser-core';
```

- [x] **Step 3: Run focused helper and adapter tests**

Run:

```bash
npm run build && node --test \
  tests/browser/uri.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs
```

Expected: PASS. If a failure is only an error-message wording change from the shared parser, update the assertion to preserve the behavior meaning, not the old local string.

- [x] **Step 4: Commit shared helper consumption**

Run:

```bash
git add src/core/browser/uri.ts src/core/browser/botHomepageTemplates.ts tests/browser/uri.test.mjs tests/browser/botHomepageResolver.test.mjs tests/browser/browserResolver.test.mjs tests/daemon/oacBrowserHostAdapter.test.mjs
git commit -m "refactor: consume shared browser core helpers"
```

Then use `metabot-post-buzz` with Bob (`--from bob`) to publish a development journal for this commit.

## Task 3: Add OAC Bridge To Published Browser Host Contract

**Files:**
- Create: `src/daemon/browser/oacBrowserCoreBridge.ts`
- Test: `tests/daemon/oacBrowserCoreBridge.test.mjs`

- [x] **Step 1: Write the failing OAC conformance test**

Create `tests/daemon/oacBrowserCoreBridge.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { assertBrowserHostConformance } = require('@openagentinternet/agent-browser-test-harness');
const { createOacBrowserCoreHostAdapter } = require('../../dist/daemon/browser/oacBrowserCoreBridge.js');
const { createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');

async function createAdapter(input) {
  return createOacBrowserCoreHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: input.systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: {},
    fetch: input.fetch,
    privateChat: input.privateChat,
    serviceCall: input.serviceCall,
    resolveActorWriteContext: async (rawActor) => {
      const slug = typeof rawActor === 'string' ? rawActor.trim() : '';
      if (!slug) return { homeDir: input.homeDir };
      const profile = await getMetabotProfile(input.systemHomeDir, slug);
      if (!profile) {
        return {
          failure: commandFailed('profile_not_found', `MetaBot profile not found: ${slug}`),
        };
      }
      return { homeDir: profile.homeDir };
    },
  });
}

test('OAC Browser core bridge satisfies the published host conformance harness', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-conformance');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Core Bridge Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1corebridge',
    mvcAddress: '18CoreBridge',
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

test('OAC Browser core bridge maps resolved Bot pages to BrowserResourceEnvelope sections', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-envelope');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Envelope Bridge Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1envelopebridge',
    mvcAddress: '18EnvelopeBridge',
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

  const resolved = await adapter.resolveResource({ uri: 'metaid://idq1fixturebot' });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'bot');
  assert.equal(resolved.data.renderer.type, 'bot-page');
  assert.equal(resolved.data.owner.label, 'Fixture Bot');
  assert.equal(resolved.data.sections.some((section) => section.id === 'services'), true);
  assert.equal(resolved.data.actions.some((action) => action.kind === 'private-chat'), true);
});
```

- [x] **Step 2: Run the conformance test and verify it fails**

Run:

```bash
npm run build && node --test tests/daemon/oacBrowserCoreBridge.test.mjs
```

Expected: FAIL because `dist/daemon/browser/oacBrowserCoreBridge.js` does not exist.

- [x] **Step 3: Add the bridge implementation**

Create `src/daemon/browser/oacBrowserCoreBridge.ts`:

```ts
import {
  browserFailure,
  browserSuccess,
  type BrowserActorInput,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandFailure,
  type BrowserCommandResult,
  type BrowserHostAdapter,
  type BrowserResourceEnvelope,
  type BrowserResourceOwner,
  type BrowserResourceSection,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  type BrowserTrustedActionDescriptor,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import { normalizeResourceSections } from '@openagentinternet/agent-browser-core';
import { createOacBrowserHostAdapter, type CreateOacBrowserHostAdapterInput } from './oacBrowserHostAdapter';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import type { BrowserResolveResult, BrowserTrustedAction } from '../../core/browser/types';
import type { BrowserTrustedActionInput as OacBrowserTrustedActionInput } from '../../core/browser/hostTypes';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function toBrowserFailure(result: MetabotCommandResult<unknown>): BrowserCommandFailure {
  return browserFailure(
    text((result as { code?: unknown }).code) || text((result as { state?: unknown }).state) || 'browser_oac_failure',
    text((result as { message?: unknown }).message) || 'OAC Browser command failed.',
  );
}

function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  return result.ok ? browserSuccess(result.data) : toBrowserFailure(result);
}

function trustedActionData(value: unknown): BrowserTrustedActionResult['data'] | undefined {
  const data = record(value);
  const href = text(data.href);
  const route = text(data.route);
  const copiedText = text(data.copiedText);
  const message = text(data.message);
  const normalized = {
    ...(href ? { href } : {}),
    ...(route ? { route } : {}),
    ...(copiedText ? { copiedText } : {}),
    ...(message ? { message } : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function trustedActionResultFromOac(
  actionInput: BrowserTrustedActionInput,
  result: MetabotCommandResult<unknown>,
): BrowserCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    return toBrowserFailure(result);
  }
  const outer = record(result.data);
  const nested = record(outer.data);
  const normalizedData = trustedActionData(Object.keys(nested).length ? nested : outer);
  return browserSuccess({
    kind: actionInput.kind,
    handled: true,
    ...(normalizedData ? { data: normalizedData } : {}),
  });
}

function isOacTrustedActionKind(kind: BrowserTrustedActionInput['kind']): kind is OacBrowserTrustedActionInput['kind'] {
  return [
    'private-chat',
    'service-call',
    'copy-uri',
    'open-settings',
    'login',
    'edit-profile',
    'configure-chat',
    'view-messages',
  ].includes(kind);
}

function toOacTrustedActionInput(input: BrowserTrustedActionInput): OacBrowserTrustedActionInput | null {
  if (!isOacTrustedActionKind(input.kind)) {
    return null;
  }
  return {
    ...(input.actorId ? { actorId: input.actorId } : {}),
    resourceUri: input.resourceUri,
    kind: input.kind,
    ...(input.payload ? { payload: input.payload } : {}),
  };
}

function ownerFromResult(result: BrowserResolveResult): BrowserResourceOwner {
  return {
    kind: result.owner.kind === 'metaapp-publisher' ? 'metaapp-publisher' : result.owner.kind === 'bot' ? 'bot' : 'unknown',
    globalMetaId: result.owner.globalMetaId || undefined,
    address: result.owner.address || undefined,
    label: result.owner.name || result.title,
    avatar: result.owner.avatar || undefined,
    verificationState: result.owner.verificationState,
  };
}

function actionFromOac(action: BrowserTrustedAction): BrowserTrustedActionDescriptor | null {
  if (action.kind === 'private-chat') {
    return {
      id: action.id,
      label: action.label,
      kind: 'private-chat',
      enabled: action.enabled !== false,
      payload: {
        ...(action.payload ?? {}),
        ...(action.uri ? { currentUri: action.uri } : {}),
      },
    };
  }
  if (action.kind === 'service-call') {
    return {
      id: action.id,
      label: action.label,
      kind: 'service-call',
      enabled: action.enabled !== false,
      payload: {
        ...(action.payload ?? {}),
        ...(action.serviceId ? { servicePinId: action.serviceId } : {}),
      },
    };
  }
  if (action.kind === 'copy') {
    return {
      id: action.id,
      label: action.label,
      kind: 'copy-uri',
      enabled: action.enabled !== false,
      payload: {
        ...(action.payload ?? {}),
        ...(action.uri ? { uri: action.uri } : {}),
      },
    };
  }
  return null;
}

function sectionsFromOacResult(result: BrowserResolveResult): BrowserResourceSection[] {
  const data = record(result.renderer.data);
  if (result.resourceType !== 'bot') {
    return [];
  }
  return normalizeResourceSections([
    { id: 'overview', title: 'Overview', kind: 'generic-list', items: Object.keys(record(data.homepage)).length ? [record(data.homepage)] : [] },
    { id: 'services', title: 'Services', kind: 'services', items: list(data.services) },
    { id: 'skills', title: 'Skills', kind: 'skills', items: list(data.skills) },
    { id: 'buses', title: 'Buses', kind: 'buses', items: list(data.buses) },
    { id: 'buzzes', title: 'Buzz', kind: 'buzzes', items: list(data.buzzes).length ? list(data.buzzes) : list(data.buzz) },
    { id: 'apps', title: 'Apps', kind: 'apps', items: list(data.apps) },
    { id: 'activity', title: 'Recent Activity', kind: 'activity', items: list(data.activity) },
  ]);
}

export function oacResolveResultToBrowserEnvelope(result: BrowserResolveResult): BrowserResourceEnvelope {
  return {
    uri: result.uri,
    normalizedUri: result.normalizedUri,
    resourceType: result.resourceType === 'unsupported' ? 'unknown' : result.resourceType,
    title: result.title,
    owner: ownerFromResult(result),
    ownerAffinity: null,
    renderer: {
      type: result.renderer.type,
      contentType: result.renderer.contentType,
      templateId: result.renderer.templateId,
      url: result.renderer.url,
      data: result.renderer.data,
      error: result.renderer.error,
    },
    actions: result.actions.flatMap((action) => {
      const mapped = actionFromOac(action);
      return mapped ? [mapped] : [];
    }),
    sections: sectionsFromOacResult(result),
    status: result.status,
    proof: result.proof,
    source: result.source,
    raw: result,
  };
}

export function createOacBrowserCoreHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const adapter = createOacBrowserHostAdapter(input);
  return {
    async getRuntime(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>> {
      return toBrowserResult(await adapter.getRuntime(actorInput));
    },
    async resolveResource(resolveInput): Promise<BrowserCommandResult<BrowserResourceEnvelope>> {
      const result = await adapter.resolveResource(resolveInput);
      return result.ok ? browserSuccess(oacResolveResultToBrowserEnvelope(result.data)) : toBrowserFailure(result);
    },
    async getSettings(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
      return toBrowserResult(await adapter.getSettings(actorInput));
    },
    async updateSettings(settingsInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
      return toBrowserResult(await adapter.updateSettings(settingsInput));
    },
    async getCache(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserCacheSnapshot>> {
      return toBrowserResult(await adapter.getCache(actorInput));
    },
    async clearCache(cacheInput): Promise<BrowserCommandResult<BrowserCacheClearResult>> {
      return toBrowserResult(await adapter.clearCache({ ...cacheInput, scope: cacheInput.scope ?? 'all' }));
    },
    async runTrustedAction(actionInput: BrowserTrustedActionInput): Promise<BrowserCommandResult<BrowserTrustedActionResult>> {
      const oacActionInput = toOacTrustedActionInput(actionInput);
      if (!oacActionInput) {
        return browserFailure(
          'browser_action_not_supported',
          `Browser trusted action is not supported by OAC: ${actionInput.kind}`,
        );
      }
      const result = await adapter.runTrustedAction(oacActionInput);
      return trustedActionResultFromOac(actionInput, result);
    },
  };
}
```

- [x] **Step 4: Run the conformance test**

Run:

```bash
npm run build && node --test tests/daemon/oacBrowserCoreBridge.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit the bridge**

Run:

```bash
git add src/daemon/browser/oacBrowserCoreBridge.ts tests/daemon/oacBrowserCoreBridge.test.mjs
git commit -m "feat: add oac browser core package bridge"
```

Then use `metabot-post-buzz` with Bob (`--from bob`) to publish a development journal for this commit.

## Task 4: Keep Runtime Routes On OAC's Rich Local Adapter

**Files:**
- Modify: `tests/browser/browserModuleBoundary.test.mjs`
- Modify: `tests/daemon/oacBrowserHostAdapter.test.mjs`

- [x] **Step 1: Add a boundary assertion that OAC still owns runtime routes**

Append this test to `tests/browser/browserModuleBoundary.test.mjs`:

```js
test('OAC Browser route boundary still uses OAC command-result semantics', async () => {
  const { handled, sent } = await callBrowserRoute({
    path: '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&from=alice',
    handlers: {
      resolve: async (input) => commandSuccess({
        uri: input.uri,
        normalizedUri: input.uri,
        resourceType: 'bot',
        title: 'Alice Bot',
        owner: {
          kind: 'bot',
          globalMetaId: 'idq1alice',
          name: 'Alice Bot',
          verificationState: 'partial',
        },
        renderer: {
          type: 'bot-page',
          contentType: 'application/vnd.oac.bot-homepage+json',
          templateId: 'document',
          data: {},
        },
        status: {
          state: 'resolved',
          verificationState: 'partial',
          message: 'Bot Page resolved.',
        },
        source: {
          resolver: 'test',
        },
        actions: [],
      }),
    },
  });

  assert.equal(handled, true);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.state, 'success');
  assert.equal(sent[0].payload.data.source.resolver, 'test');
});
```

This test documents the intentional Phase 4 boundary: OAC's existing `/api/browser/*` route continues to return OAC `MetabotCommandResult` payloads while the new bridge proves conformance to the published package contract.

- [x] **Step 2: Add a regression check for waiting trusted actions**

Append this test to `tests/daemon/oacBrowserHostAdapter.test.mjs`:

```js
test('OAC browser host adapter preserves waiting command states for runtime trusted actions', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-waiting-state');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Waiting Action Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1waitingaction',
    mvcAddress: '18WaitingAction',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    serviceCall: async () => ({
      ok: false,
      state: 'waiting',
      code: 'order_sent_awaiting_provider',
      message: 'Order sent to provider. Waiting for response...',
      pollAfterMs: 3000,
      data: { traceId: 'trace-waiting' },
    }),
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1target',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Run this task',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.equal(result.code, 'order_sent_awaiting_provider');
  assert.equal(result.data.traceId, 'trace-waiting');
});
```

- [x] **Step 3: Run route and adapter boundary tests**

Run:

```bash
npm run build && node --test \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/oacBrowserCoreBridge.test.mjs
```

Expected: PASS.

- [x] **Step 4: Commit route boundary documentation tests**

Run:

```bash
git add tests/browser/browserModuleBoundary.test.mjs tests/daemon/oacBrowserHostAdapter.test.mjs
git commit -m "test: document oac browser runtime boundary"
```

Then use `metabot-post-buzz` with Bob (`--from bob`) to publish a development journal for this commit.

## Task 5: Package And Verification Closeout

**Files:**
- Modify: `tests/npm/packageFiles.test.mjs`
- Modify: `docs/superpowers/plans/2026-06-09-oac-browser-core-package-consumption.md`

- [x] **Step 1: Update OAC npm package test for Browser package dependencies**

Append this test to `tests/npm/packageFiles.test.mjs`:

```js
test('npm package pins shared Agent Browser package dependencies', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-host-contract'], '0.1.0');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-core'], '0.1.0');
  assert.equal(packageJson.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.1.0');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-ui'], undefined);
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
});
```

- [x] **Step 2: Mark plan tasks complete as work finishes**

Update this plan's checkboxes from `[ ]` to `[x]` only for completed steps. Do not mark the whole plan complete until verification and reviews pass.

- [x] **Step 3: Run focused verification**

Run:

```bash
npm run build && node --test \
  tests/browser/browserPublishedPackages.test.mjs \
  tests/browser/uri.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/oacBrowserCoreBridge.test.mjs \
  tests/npm/packageFiles.test.mjs
git diff --check
```

Expected:

- all listed tests pass;
- `git diff --check` prints no errors.

- [x] **Step 4: Run broad verification only if focused checks pass**

Run:

```bash
npm run verify
```

Expected: PASS. If full verification fails in unrelated tests, capture the exact failure and run the smallest relevant test set again before deciding whether the failure belongs to this phase.

- [x] **Step 5: Commit closeout docs and package test**

Run:

```bash
git add tests/npm/packageFiles.test.mjs docs/superpowers/plans/2026-06-09-oac-browser-core-package-consumption.md
git commit -m "docs: close browser core package consumption phase"
```

Then use `metabot-post-buzz` with Bob (`--from bob`) to publish a development journal for this commit.

## Review Requirements

After each task:

1. Spawn a fresh spec-review subagent to compare the task against this plan.
2. Spawn a fresh code-quality-review subagent to look for regressions, package-boundary mistakes, and unnecessary coupling.
3. Fix all blocking or important findings before starting the next task.

After Task 5:

1. Spawn a whole-phase review subagent.
2. Confirm OAC still serves the current Browser UI locally.
3. Confirm the new package bridge passes `@openagentinternet/agent-browser-test-harness`.
4. Do not push unless the human explicitly asks.

## Expected Phase 4 Exit State

- OAC has exact `0.1.0` pins for the shared Browser contract/core packages it uses.
- OAC tests import the published packages rather than local ABC source.
- Safe neutral helpers (`parseBrowserUri`, Bot homepage template registry) come from `@openagentinternet/agent-browser-core`.
- OAC has a bridge adapter that satisfies the published `BrowserHostAdapter` conformance harness.
- OAC runtime Browser routes still use OAC's richer local command-result semantics and current UI behavior.
- No OAC-specific account, cache, wallet, or privileged-action logic moves into ABC.

## Follow-Up After Phase 4

The next Browser extraction phase should happen in `agent-browser-core`, not OAC:

- port the richer OAC Browser UI into `@openagentinternet/agent-browser-ui`;
- extend the published host contract if it needs OAC-style `waiting` or `manual_action_required` command states;
- publish `agent-browser-core` `0.2.x`;
- only then switch OAC's `/ui/browser` renderer to the shared UI package.
