# Agent Internet Browser Host Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Phase 1 host-adapter boundary for Agent Internet Browser inside OAC while preserving current `/ui/browser` and `/api/browser/*` behavior.

**Architecture:** Add host-neutral Browser contracts under `src/core/browser/`, then add an OAC adapter under `src/daemon/browser/`. `src/daemon/defaultHandlers.ts` should stop owning Browser profile/settings/cache/resolve details and should only wire existing daemon routes to the adapter.

**Tech Stack:** TypeScript strict mode, CommonJS build output, Node.js test runner with ESM tests, existing OAC daemon route and config stores.

---

## Source Spec

Implement Phase 1 from:

- `docs/superpowers/specs/2026-06-08-agent-internet-browser-independent-module-design.md`

Do not implement standalone hosting, Metalet login, uploaded templates, or a new public Browser runtime endpoint in this plan.

## Current Coupling Points

- `src/daemon/defaultHandlers.ts`
  - `buildBrowserContextResult` reads OAC MetaBot profiles directly.
  - `getBrowserSettings`, `updateBrowserSettings`, `getBrowserCache`, and `clearBrowserCache` resolve OAC profile homes directly.
  - `browser.resolve` builds OAC-specific config, MetaApp artifact cache, and preview sessions inline.
- `src/daemon/routes/browser.ts`
  - Existing public route contract. Keep it stable.
- `src/daemon/routes/types.ts`
  - Existing `handlers.browser` contract. Keep request/response compatibility.
- `src/core/browser/types.ts`
  - Existing Browser resource and legacy using-identity types.

## Files

Create:

- `src/core/browser/hostTypes.ts` - host-neutral Browser runtime, actor, adapter, cache, and action contracts.
- `src/core/browser/runtimeContext.ts` - maps host-neutral runtime snapshots to the existing `/api/browser/context` response shape.
- `src/daemon/browser/oacBrowserHostAdapter.ts` - OAC implementation of `BrowserHostAdapter`.
- `tests/browser/browserRuntimeContext.test.mjs` - contract tests for runtime-to-context compatibility.
- `tests/daemon/oacBrowserHostAdapter.test.mjs` - direct adapter tests for OAC actors, settings, cache, and resolver wiring.

Modify:

- `src/daemon/defaultHandlers.ts` - instantiate the OAC adapter and route existing Browser handlers through it.
- `tests/daemon/defaultBrowserHandlers.test.mjs` - keep existing assertions and add one unknown-profile regression if it is not already covered after the adapter move.

Do not modify:

- `src/daemon/routes/browser.ts`
- `src/ui/pages/browser/app.ts`
- `src/ui/pages/browser/index.html`

Phase 1 is a backend boundary refactor. UI runtime config and actor-id naming happen in Phase 2.

## Task 1: Host-Neutral Contracts And Legacy Context Mapping

**Files:**

- Create: `src/core/browser/hostTypes.ts`
- Create: `src/core/browser/runtimeContext.ts`
- Create: `tests/browser/browserRuntimeContext.test.mjs`

- [ ] **Step 1: Write the failing compatibility test**

Create `tests/browser/browserRuntimeContext.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { browserRuntimeToContextResult } = require('../../dist/core/browser/runtimeContext.js');

test('browserRuntimeToContextResult preserves the legacy using identity shape', () => {
  const context = browserRuntimeToContextResult({
    host: {
      kind: 'oac',
      name: 'Open Agent Connect',
      localMode: true,
    },
    actors: [
      {
        id: 'alice',
        label: 'Alice Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1alice',
        avatar: 'data:image/png;base64,alice',
        isDefault: true,
        capabilities: ['private-chat', 'service-call', 'template-settings'],
      },
      {
        id: 'bob',
        label: 'Bob Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1bob',
        isDefault: false,
        capabilities: ['private-chat'],
      },
    ],
    defaultActor: {
      id: 'alice',
      label: 'Alice Bot',
      kind: 'oac-bot',
      globalMetaId: 'idq1alice',
      avatar: 'data:image/png;base64,alice',
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'template-settings'],
    },
    defaultUri: 'metaid://idq1alice',
    features: {
      privateChat: true,
      serviceCall: true,
      cacheManagement: true,
      templateSettings: true,
      walletLogin: false,
    },
    labels: {
      actorChip: 'Using',
      noActorTitle: 'No Bot',
      noActorBody: 'Create a local Bot before using Browser actions.',
      noActorAction: {
        label: 'Create Bot',
        href: '/ui/bot',
      },
    },
  });

  assert.deepEqual(context, {
    usingIdentities: [
      {
        slug: 'alice',
        name: 'Alice Bot',
        globalMetaId: 'idq1alice',
        avatar: 'data:image/png;base64,alice',
        isDefault: true,
      },
      {
        slug: 'bob',
        name: 'Bob Bot',
        globalMetaId: 'idq1bob',
        isDefault: false,
      },
    ],
    defaultUsingIdentity: {
      slug: 'alice',
      name: 'Alice Bot',
      globalMetaId: 'idq1alice',
      avatar: 'data:image/png;base64,alice',
      isDefault: true,
    },
    defaultUri: 'metaid://idq1alice',
  });
});

test('browserRuntimeToContextResult returns no default identity when the default actor has no globalMetaId', () => {
  const context = browserRuntimeToContextResult({
    host: {
      kind: 'standalone',
      name: 'Agent Internet Browser',
      localMode: false,
    },
    actors: [
      {
        id: 'wallet-1',
        label: 'Wallet User',
        kind: 'wallet',
        address: '18WalletUser',
        isDefault: true,
        capabilities: ['wallet-sign'],
      },
    ],
    defaultActor: {
      id: 'wallet-1',
      label: 'Wallet User',
      kind: 'wallet',
      address: '18WalletUser',
      isDefault: true,
      capabilities: ['wallet-sign'],
    },
    defaultUri: null,
    features: {
      privateChat: false,
      serviceCall: false,
      cacheManagement: false,
      templateSettings: false,
      walletLogin: true,
    },
    labels: {
      actorChip: 'Wallet',
      noActorTitle: 'Sign in',
      noActorBody: 'Sign in with a wallet to use Browser actions.',
    },
  });

  assert.deepEqual(context, {
    usingIdentities: [],
    defaultUsingIdentity: null,
    defaultUri: null,
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails before implementation**

Run:

```bash
npm run build && node --test tests/browser/browserRuntimeContext.test.mjs
```

Expected result:

```text
Cannot find module '../../dist/core/browser/runtimeContext.js'
```

- [ ] **Step 3: Add host-neutral Browser contracts**

Create `src/core/browser/hostTypes.ts`:

```ts
import type { MetabotCommandResult } from '../contracts/commandResult';
import type { BrowserSettingsSnapshot } from './settings';
import type { BrowserResolveResult } from './types';

export type BrowserHostKind = 'standalone' | 'oac' | 'idbots';
export type BrowserActorKind = 'oac-bot' | 'idbots-agent' | 'wallet';

export type BrowserActorCapability =
  | 'private-chat'
  | 'service-call'
  | 'wallet-sign'
  | 'payment'
  | 'template-settings';

export interface BrowserActor {
  id: string;
  label: string;
  kind: BrowserActorKind;
  globalMetaId?: string;
  address?: string;
  avatar?: string;
  isDefault: boolean;
  capabilities: BrowserActorCapability[];
}

export interface BrowserRuntimeSnapshot {
  host: {
    kind: BrowserHostKind;
    name: string;
    localMode: boolean;
    publicBaseUrl?: string;
  };
  actors: BrowserActor[];
  defaultActor: BrowserActor | null;
  defaultUri: string | null;
  features: {
    privateChat: boolean;
    serviceCall: boolean;
    cacheManagement: boolean;
    templateSettings: boolean;
    walletLogin: boolean;
  };
  labels: {
    actorChip: string;
    noActorTitle: string;
    noActorBody: string;
    noActorAction?: {
      label: string;
      href: string;
    };
  };
}

export interface BrowserActorInput {
  actorId?: string;
  from?: string;
}

export type BrowserRuntimeInput = BrowserActorInput;

export interface BrowserResolveInput extends BrowserActorInput {
  uri: string;
}

export type BrowserSettingsInput = BrowserActorInput;

export interface BrowserSettingsUpdateInput extends BrowserActorInput {
  browser?: Record<string, unknown>;
}

export type BrowserCacheInput = BrowserActorInput;

export interface BrowserCacheClearInput extends BrowserActorInput {
  scope?: string;
  pinId?: string;
  cacheKey?: string;
}

export type BrowserCacheSnapshot = Record<string, unknown>;
export type BrowserCacheClearResult = Record<string, unknown>;

export type BrowserTrustedActionKind =
  | 'private-chat'
  | 'service-call'
  | 'copy-uri'
  | 'open-settings'
  | 'login';

export interface BrowserTrustedActionInput extends BrowserActorInput {
  resourceUri: string;
  kind: BrowserTrustedActionKind;
  payload?: Record<string, unknown>;
}

export interface BrowserTrustedActionResult {
  kind: BrowserTrustedActionKind;
  handled: boolean;
  data?: unknown;
}

export interface BrowserHostAdapter {
  getRuntime(input?: BrowserRuntimeInput): Promise<MetabotCommandResult<BrowserRuntimeSnapshot>>;
  resolveResource(input: BrowserResolveInput): Promise<MetabotCommandResult<BrowserResolveResult>>;
  getSettings(input?: BrowserSettingsInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>>;
  updateSettings(input: BrowserSettingsUpdateInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>>;
  getCache(input?: BrowserCacheInput): Promise<MetabotCommandResult<BrowserCacheSnapshot>>;
  clearCache(input: BrowserCacheClearInput): Promise<MetabotCommandResult<BrowserCacheClearResult>>;
  runTrustedAction(input: BrowserTrustedActionInput): Promise<MetabotCommandResult<BrowserTrustedActionResult>>;
}
```

- [ ] **Step 4: Add the legacy context mapper**

Create `src/core/browser/runtimeContext.ts`:

```ts
import type { BrowserContextResult, BrowserUsingIdentity } from './types';
import type { BrowserActor, BrowserRuntimeSnapshot } from './hostTypes';

function actorToUsingIdentity(actor: BrowserActor): BrowserUsingIdentity | null {
  if (!actor.globalMetaId) {
    return null;
  }
  return {
    slug: actor.id,
    name: actor.label,
    globalMetaId: actor.globalMetaId,
    ...(actor.avatar ? { avatar: actor.avatar } : {}),
    isDefault: actor.isDefault,
  };
}

export function browserRuntimeToContextResult(snapshot: BrowserRuntimeSnapshot): BrowserContextResult {
  const usingIdentities = snapshot.actors
    .map(actorToUsingIdentity)
    .filter((identity): identity is BrowserUsingIdentity => Boolean(identity));
  const defaultUsingIdentity = snapshot.defaultActor
    ? actorToUsingIdentity(snapshot.defaultActor)
    : null;

  return {
    usingIdentities,
    defaultUsingIdentity,
    defaultUri: snapshot.defaultUri,
  };
}
```

- [ ] **Step 5: Verify Task 1**

Run:

```bash
npm run build && node --test tests/browser/browserRuntimeContext.test.mjs
```

Expected result:

```text
2 tests passing
```

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/core/browser/hostTypes.ts src/core/browser/runtimeContext.ts tests/browser/browserRuntimeContext.test.mjs
git commit -m "Add browser host adapter contracts"
```

Post a development diary buzz for this commit before starting Task 2.

## Task 2: OAC Browser Host Adapter

**Files:**

- Create: `src/daemon/browser/oacBrowserHostAdapter.ts`
- Create: `tests/daemon/oacBrowserHostAdapter.test.mjs`

- [ ] **Step 1: Write the failing adapter tests**

Create `tests/daemon/oacBrowserHostAdapter.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createOacBrowserHostAdapter } = require('../../dist/daemon/browser/oacBrowserHostAdapter.js');
const { createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');

async function createAdapter(input) {
  return createOacBrowserHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: input.systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: {},
    fetch: input.fetch,
    resolveActorWriteContext: async (rawActor) => {
      const slug = typeof rawActor === 'string' ? rawActor.trim() : '';
      if (!slug) {
        return { homeDir: input.homeDir };
      }
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

test('OAC browser host adapter exposes MetaBot profiles as Browser actors', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Active Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1activebrowser',
    mvcAddress: '18ActiveBrowser',
  });
  const other = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Other Browser Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'other-browser-bot'),
    globalMetaId: 'idq1otherbrowser',
    mvcAddress: '18OtherBrowser',
  });

  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const runtime = await adapter.getRuntime({ actorId: other.slug });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data.host.kind, 'oac');
  assert.equal(runtime.data.host.name, 'Open Agent Connect');
  assert.equal(runtime.data.defaultActor.id, other.slug);
  assert.equal(runtime.data.defaultUri, `metaid://${other.globalMetaId}`);
  assert.deepEqual(runtime.data.features, {
    privateChat: true,
    serviceCall: true,
    cacheManagement: true,
    templateSettings: true,
    walletLogin: false,
  });
  assert.deepEqual(
    runtime.data.actors.map((actor) => ({
      id: actor.id,
      label: actor.label,
      kind: actor.kind,
      globalMetaId: actor.globalMetaId,
      isDefault: actor.isDefault,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: active.slug,
        label: 'Active Browser Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1activebrowser',
        isDefault: false,
      },
      {
        id: other.slug,
        label: 'Other Browser Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1otherbrowser',
        isDefault: true,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('OAC browser host adapter persists Browser settings for the selected profile', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-settings');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Settings Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1settingsbrowser',
    mvcAddress: '18SettingsBrowser',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const updated = await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test/',
      manApiBaseUrl: 'https://manapi.example.test/',
      botHomepageTemplateId: 'compact-list',
    },
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.data.browser.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(updated.data.browser.manApiBaseUrl, 'https://manapi.example.test');
  assert.equal(updated.data.browser.botHomepageTemplateId, 'compact-list');

  const configOnDisk = await createConfigStore(active.homeDir).read();
  assert.equal(configOnDisk.browser.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(configOnDisk.browser.manApiBaseUrl, 'https://manapi.example.test');
  assert.equal(configOnDisk.browser.botHomepageTemplateId, 'compact-list');
});

test('OAC browser host adapter resolves metaid URIs with the selected profile Browser config', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-resolve');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Resolve Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1resolvebrowser',
    mvcAddress: '18ResolveBrowser',
  });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
  });

  await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      botHomepageTemplateId: 'compact-list',
    },
  });
  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: 'metaid://idq1fixturebot',
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.renderer.type, 'bot-page');
  assert.equal(resolved.data.renderer.templateId, 'compact-list');
});

test('OAC browser host adapter reads and clears the selected profile MetaApp cache', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-cache');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Cache Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1cachebrowser',
    mvcAddress: '18CacheBrowser',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const stats = await adapter.getCache({ actorId: active.slug });
  assert.equal(stats.ok, true);
  assert.match(stats.data.cacheRoot, /cache\/metaapps$/);

  const invalidClear = await adapter.clearCache({
    actorId: active.slug,
    scope: 'unknown',
  });
  assert.equal(invalidClear.ok, false);
  assert.equal(invalidClear.code, 'invalid_argument');
});
```

- [ ] **Step 2: Run the new adapter tests and verify they fail before implementation**

Run:

```bash
npm run build && node --test tests/daemon/oacBrowserHostAdapter.test.mjs
```

Expected result:

```text
Cannot find module '../../dist/daemon/browser/oacBrowserHostAdapter.js'
```

- [ ] **Step 3: Implement the OAC adapter**

Create `src/daemon/browser/oacBrowserHostAdapter.ts` with these responsibilities:

- list OAC MetaBot profiles and map them to `BrowserActor`;
- resolve `actorId` or legacy `from` into an OAC profile home;
- read/update OAC Browser settings through `createConfigStore`;
- read/clear MetaApp artifact cache through `createMetaAppArtifactCacheStore`;
- resolve resources through `resolveBrowserResource`;
- keep `runTrustedAction` present but unsupported until Phase 2 adds an action route.

Use this implementation shape:

```ts
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { listMetabotProfiles, type MetabotProfileFull } from '../../core/bot/metabotProfileManager';
import { createConfigStore } from '../../core/config/configStore';
import { resolveBrowserConfig } from '../../core/browser/config';
import { resolveBrowserResource } from '../../core/browser/browserResolver';
import { resolveMetaAppPinToRecord } from '../../core/browser/metaAppPinResolver';
import {
  applyBrowserSettingsUpdate,
  createBrowserSettingsSnapshot,
  type BrowserSettingsSnapshot,
} from '../../core/browser/settings';
import { createMetaAppArtifactCacheStore } from '../../core/metaapp/artifactCache';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';
import type {
  BrowserActor,
  BrowserActorInput,
  BrowserCacheClearInput,
  BrowserCacheClearResult,
  BrowserCacheInput,
  BrowserCacheSnapshot,
  BrowserHostAdapter,
  BrowserResolveInput,
  BrowserRuntimeInput,
  BrowserRuntimeSnapshot,
  BrowserSettingsInput,
  BrowserSettingsUpdateInput,
  BrowserTrustedActionInput,
  BrowserTrustedActionResult,
} from '../../core/browser/hostTypes';
import type { BrowserResolveResult } from '../../core/browser/types';

type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;

export interface OacBrowserActorContext {
  homeDir: string;
}

export interface CreateOacBrowserHostAdapterInput {
  homeDir: string;
  systemHomeDir: string;
  resolveActorWriteContext: (
    rawActor: unknown,
  ) => Promise<OacBrowserActorContext | { failure: MetabotCommandResult<never> }>;
  metaAppPreviewSessions: MetaAppPreviewSessions;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actorSelector(input?: BrowserActorInput): string {
  return normalizeText(input?.actorId) || normalizeText(input?.from);
}

function buildMetaAppPreviewAssetUrl(previewId: string, assetPath: string): string {
  const previewSegments = encodeURIComponent(previewId);
  const normalizedAssetPath = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/metaapp/preview-assets/${previewSegments}/${normalizedAssetPath}`;
}

function profileToBrowserActor(profile: MetabotProfileFull, selectedHomeDir: string): BrowserActor {
  const isDefault = Boolean(selectedHomeDir && path.resolve(profile.homeDir) === selectedHomeDir);
  return {
    id: profile.slug,
    label: profile.name,
    kind: 'oac-bot',
    globalMetaId: profile.globalMetaId,
    ...(profile.avatarDataUrl ? { avatar: profile.avatarDataUrl } : {}),
    isDefault,
    capabilities: ['private-chat', 'service-call', 'template-settings'],
  };
}

export function createOacBrowserHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;

  async function resolveActor(inputValue?: BrowserActorInput): Promise<
    | OacBrowserActorContext
    | { failure: MetabotCommandResult<never> }
  > {
    return input.resolveActorWriteContext(actorSelector(inputValue));
  }

  async function getRuntime(runtimeInput: BrowserRuntimeInput = {}): Promise<MetabotCommandResult<BrowserRuntimeSnapshot>> {
    const requestedActor = actorSelector(runtimeInput);
    const activeHomeDir = path.resolve(input.homeDir);
    const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
    const selectedProfile = requestedActor
      ? profiles.find((profile) => profile.slug === requestedActor) ?? null
      : profiles.find((profile) => path.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;

    if (requestedActor && !selectedProfile) {
      return commandFailed('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
    }

    const selectedHomeDir = selectedProfile ? path.resolve(selectedProfile.homeDir) : '';
    const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
    const defaultActor = selectedProfile && selectedProfile.globalMetaId
      ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
      : null;

    return commandSuccess({
      host: {
        kind: 'oac',
        name: 'Open Agent Connect',
        localMode: true,
      },
      actors,
      defaultActor,
      defaultUri: defaultActor?.globalMetaId ? `metaid://${defaultActor.globalMetaId}` : null,
      features: {
        privateChat: true,
        serviceCall: true,
        cacheManagement: true,
        templateSettings: true,
        walletLogin: false,
      },
      labels: {
        actorChip: 'Using',
        noActorTitle: 'No Bot',
        noActorBody: 'Create a local Bot to message, call services, and sign Browser actions.',
        noActorAction: {
          label: 'Create Bot',
          href: '/ui/bot',
        },
      },
    });
  }

  async function getSettings(settingsInput: BrowserSettingsInput = {}): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return actor.failure;
    const targetConfigStore = createConfigStore(actor.homeDir);
    const config = await targetConfigStore.read();
    return commandSuccess(createBrowserSettingsSnapshot({
      config,
      configPath: targetConfigStore.paths.configPath,
      env,
    }));
  }

  async function updateSettings(settingsInput: BrowserSettingsUpdateInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return actor.failure;
    const targetConfigStore = createConfigStore(actor.homeDir);
    const current = await targetConfigStore.read();
    try {
      const next = applyBrowserSettingsUpdate(current, settingsInput.browser);
      await targetConfigStore.set(next);
      const saved = await targetConfigStore.read();
      return commandSuccess(createBrowserSettingsSnapshot({
        config: saved,
        configPath: targetConfigStore.paths.configPath,
        env,
      }));
    } catch (error) {
      return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function getCache(cacheInput: BrowserCacheInput = {}): Promise<MetabotCommandResult<BrowserCacheSnapshot>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return actor.failure;
    return commandSuccess(await createMetaAppArtifactCacheStore(actor.homeDir).getStats());
  }

  async function clearCache(cacheInput: BrowserCacheClearInput): Promise<MetabotCommandResult<BrowserCacheClearResult>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return actor.failure;
    try {
      const scope = normalizeText(cacheInput.scope) || 'all';
      if (scope === 'pin') {
        return commandSuccess(await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          pinId: normalizeText(cacheInput.pinId),
        }));
      }
      if (scope === 'artifact') {
        return commandSuccess(await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          cacheKey: normalizeText(cacheInput.cacheKey),
        }));
      }
      if (scope === 'all') {
        return commandSuccess(await createMetaAppArtifactCacheStore(actor.homeDir).clear({ scope }));
      }
      return commandFailed('invalid_argument', 'Unsupported Browser cache clear scope.');
    } catch (error) {
      return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function resolveResource(resolveInput: BrowserResolveInput): Promise<MetabotCommandResult<BrowserResolveResult>> {
    const actor = await resolveActor(resolveInput);
    if ('failure' in actor) return actor.failure;
    const config = await createConfigStore(actor.homeDir).read();
    const browserConfig = resolveBrowserConfig(config, env);
    return resolveBrowserResource({
      uri: resolveInput.uri,
      config: browserConfig,
      fetch: fetchImpl,
      metaAppResolve: (pinId) => resolveMetaAppPinToRecord({
        pinId,
        fetch: fetchImpl,
        manApiBaseUrl: browserConfig.manApiBaseUrl,
        artifactCache: createMetaAppArtifactCacheStore(actor.homeDir),
        createPreviewSession: ({ artifactDir, indexFile }) => {
          const session = input.metaAppPreviewSessions.create({ artifactDir, indexFile });
          return {
            previewId: session.previewId,
            localPreviewUrl: buildMetaAppPreviewAssetUrl(session.previewId, indexFile),
          };
        },
      }),
    });
  }

  async function runTrustedAction(actionInput: BrowserTrustedActionInput): Promise<MetabotCommandResult<BrowserTrustedActionResult>> {
    return commandFailed(
      'browser_action_not_supported',
      `Browser trusted action is not supported by the OAC adapter yet: ${actionInput.kind}`,
    );
  }

  return {
    getRuntime,
    resolveResource,
    getSettings,
    updateSettings,
    getCache,
    clearCache,
    runTrustedAction,
  };
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm run build && node --test tests/daemon/oacBrowserHostAdapter.test.mjs
```

Expected result:

```text
4 tests passing
```

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/daemon/browser/oacBrowserHostAdapter.ts tests/daemon/oacBrowserHostAdapter.test.mjs
git commit -m "Add OAC browser host adapter"
```

Post a development diary buzz for this commit before starting Task 3.

## Task 3: Wire Default Browser Handlers Through The Adapter

**Files:**

- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/defaultBrowserHandlers.test.mjs`

- [ ] **Step 1: Add or confirm the unknown-profile regression**

In `tests/daemon/defaultBrowserHandlers.test.mjs`, add this test if no equivalent exists:

```js
test('Browser handlers return profile_not_found for an unknown using identity', async (t) => {
  const profileHome = await createProfileHome('browser-unknown-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Known Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1knownbrowser',
    mvcAddress: '18KnownBrowser',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const context = await handlers.browser.getContext({ from: 'missing-browser-bot' });
  assert.equal(context.ok, false);
  assert.equal(context.code, 'profile_not_found');

  const settings = await handlers.browser.getSettings({ from: 'missing-browser-bot' });
  assert.equal(settings.ok, false);
  assert.equal(settings.code, 'profile_not_found');
});
```

- [ ] **Step 2: Run the default Browser handler tests before refactor**

Run:

```bash
npm run build && node --test tests/daemon/defaultBrowserHandlers.test.mjs
```

Expected result:

```text
3 tests passing
```

If the new unknown-profile test already passes before the refactor, keep it as regression coverage. This task is a behavior-preserving refactor, so existing behavior passing before and after is acceptable.

- [ ] **Step 3: Import the new adapter and context mapper**

In `src/daemon/defaultHandlers.ts`, add:

```ts
import { browserRuntimeToContextResult } from '../core/browser/runtimeContext';
import { createOacBrowserHostAdapter } from './browser/oacBrowserHostAdapter';
```

Remove Browser-only imports that become unused after the refactor:

```ts
import { resolveBrowserConfig } from '../core/browser/config';
import {
  applyBrowserSettingsUpdate,
  createBrowserSettingsSnapshot,
} from '../core/browser/settings';
import { resolveBrowserResource } from '../core/browser/browserResolver';
import { resolveMetaAppPinToRecord } from '../core/browser/metaAppPinResolver';
import { createMetaAppArtifactCacheStore } from '../core/metaapp/artifactCache';
import type { BrowserContextResult, BrowserUsingIdentity } from '../core/browser/types';
```

Keep `listMetabotProfiles` if other sections still use it.

- [ ] **Step 4: Remove defaultHandlers Browser helper implementations**

Remove these local functions from `src/daemon/defaultHandlers.ts`:

```ts
getBrowserSettings
updateBrowserSettings
getBrowserCache
clearBrowserCache
buildBrowserContextResult
```

Do not remove `buildMetaAppPreviewAssetUrl`; it is still used by MetaApp publish/update/share flows in the same file.

- [ ] **Step 5: Instantiate the adapter near the Browser handler return block**

After `const metaAppPreviewSessions = createMetaAppPreviewSessionRegistry();`, add:

```ts
  const browserHostAdapter = createOacBrowserHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: normalizedSystemHomeDir,
    resolveActorWriteContext,
    metaAppPreviewSessions,
    fetch: globalThis.fetch,
    env: process.env,
  });
```

- [ ] **Step 6: Replace the Browser handler body**

Replace the current `browser` handler block in the `return` object with:

```ts
    browser: {
      getContext: async (request = {}) => {
        const runtime = await browserHostAdapter.getRuntime({ actorId: request.from, from: request.from });
        if (!runtime.ok) return runtime;
        return commandSuccess(browserRuntimeToContextResult(runtime.data));
      },
      getSettings: async (request = {}) => browserHostAdapter.getSettings({ actorId: request.from, from: request.from }),
      updateSettings: async (request) => browserHostAdapter.updateSettings({
        actorId: request.from,
        from: request.from,
        browser: request.browser,
      }),
      getCache: async (request = {}) => browserHostAdapter.getCache({ actorId: request.from, from: request.from }),
      clearCache: async (request) => browserHostAdapter.clearCache({
        actorId: request.from,
        from: request.from,
        scope: request.scope,
        pinId: request.pinId,
        cacheKey: request.cacheKey,
      }),
      resolve: async (request) => browserHostAdapter.resolveResource({
        actorId: request.from,
        from: request.from,
        uri: request.uri,
      }),
    },
```

This keeps the daemon route contract stable while making the handler implementation adapter-backed.

- [ ] **Step 7: Verify Task 3**

Run:

```bash
npm run build && node --test tests/daemon/defaultBrowserHandlers.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/oacBrowserHostAdapter.test.mjs tests/browser/browserRuntimeContext.test.mjs
```

Expected result:

```text
all listed tests passing
```

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBrowserHandlers.test.mjs
git commit -m "Route browser handlers through host adapter"
```

Post a development diary buzz for this commit before starting Task 4.

## Task 4: Focused Browser Regression Verification

**Files:**

- No source files should be changed in this task unless verification finds a regression caused by Tasks 1-3.

- [ ] **Step 1: Run the focused Browser verification set**

Run:

```bash
npm run build && node --test \
  tests/browser/browserRuntimeContext.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/browser/metaAppPinResolver.test.mjs \
  tests/browser/metaAppResolver.test.mjs \
  tests/config/browserConfig.test.mjs \
  tests/config/configStore.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/defaultBrowserHandlers.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageInspector.test.mjs \
  tests/ui/browserPageLayout.test.mjs \
  tests/ui/browserPageRenderers.test.mjs \
  tests/ui/browserPageState.test.mjs
```

Expected result:

```text
all listed tests passing
```

- [ ] **Step 2: Check the final diff**

Run:

```bash
git status --short
git diff --check
```

Expected result:

```text
git diff --check exits 0
```

Only files from this plan should be modified or added.

- [ ] **Step 3: Commit verification-only cleanup only if needed**

If Task 4 required any source or test cleanup, commit it:

```bash
git add src/core/browser/hostTypes.ts src/core/browser/runtimeContext.ts src/daemon/browser/oacBrowserHostAdapter.ts src/daemon/defaultHandlers.ts tests/browser/browserRuntimeContext.test.mjs tests/daemon/oacBrowserHostAdapter.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs
git commit -m "Stabilize browser host adapter tests"
```

Post a development diary buzz for the cleanup commit.

If Task 4 required no changes, do not create an empty commit.

## Completion Criteria

- `src/core/browser/hostTypes.ts` defines the host-neutral Browser adapter contract.
- `src/core/browser/runtimeContext.ts` maps host-neutral runtime snapshots to the existing context response.
- `src/daemon/browser/oacBrowserHostAdapter.ts` owns OAC Browser profile/settings/cache/resource wiring.
- `src/daemon/defaultHandlers.ts` no longer contains Browser-specific profile/settings/cache/resource implementation details.
- Existing Browser API routes still return the same user-visible data shape.
- Focused Browser regression verification passes.
- Each implementation commit has a development diary buzz.

## Deferred To Later Phases

- Public `/api/browser/runtime` route.
- Browser frontend runtime config injection.
- Internal UI rename from `usingSlug` to `actorId`.
- Browser trusted-action endpoint.
- Standalone hosted adapter.
- IDBots adapter.
- Uploaded or shared template packages.
