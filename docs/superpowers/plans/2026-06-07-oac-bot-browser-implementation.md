# OAC Bot Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the local Agent Internet Browser product surface at `/browser` and `/ui/browser`, with `metaid://` Bot Pages, `metaapp://` resource renderers, on-demand Inspector/drawer panels, and Browser-owned trusted actions.

**Architecture:** Keep the Browser split into portable core modules under `src/core/browser/`, a small daemon route adapter under `src/daemon/routes/browser.ts`, and a local UI page under `src/ui/pages/browser/`. The UI must not call chain/indexer services directly; it should call `/api/browser/context` for local identity context and `/api/browser/resolve` for URI resolution, then render the returned view model.

**Tech Stack:** TypeScript strict CommonJS build, Node.js `node:test`, existing OAC local UI page builder framework, native browser DOM APIs, sandboxed iframe/PDF/image/video renderers.

---

## Inputs

- PRD: `/Users/tusm/Documents/MetaID_Projects/pitch_metaid/docs/product/2026-06-07-oac-bot-browser-prd.md`
- Design spec: `docs/superpowers/specs/2026-06-07-agent-internet-browser-design.md`
- Bot homepage API PRD: `/Users/tusm/Documents/MetaID_Projects/pitch_metaid/docs/product/2026-06-07-metaso-p2p-bot-homepage-api-prd.md`
- Project instructions: `AGENTS.md`

## Decisions

- Use `Agent Internet Browser` for product/page title and `Bot Browser` for compact chrome labels. Do not use `MetaWeb Browser` as the main product name.
- Add `/browser` as a product-facing alias to the same built page served by `/ui/browser`.
- Add `/api/browser/context` even though the PRD only requires `/api/browser/resolve`. The context endpoint is the smallest reliable way for the first screen to find the active/default local Bot and using identity without making the UI infer active profile state from unrelated endpoints.
- Keep `/api/browser/resolve` URI-focused. It must require a `uri` query parameter and return `commandFailed('missing_uri', 'uri query parameter is required.')` when the URI is absent.
- Use profile config storage for Browser config by adding an optional `browser` section to `MetabotConfig`. The resolver consumes an explicit `BotBrowserConfig` object; it does not import hard-coded service URLs.
- Resolve `metaid://idq1fixturebot`-style URIs through the metaso-p2p Bot homepage API. The stored Browser config should default `metasoP2PBaseUrl` to `https://so.metaid.io` so an installed runtime works out of the box. The core resolver must still fail closed with `browser_config_missing` when it is given an explicit empty `BotBrowserConfig`, so broken adapters and focused tests produce a user-readable error instead of a hidden network failure.
- Resolve `metaapp://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0`-style URIs from the existing MetaApp indexer/cache path and map the record into a generic renderer descriptor. Do not turn `/ui/browser` into a MetaApp gallery.
- Trusted side effects reuse existing Browser-owned OAC endpoints: `/api/chat/private` and `/api/services/call`. Rendered iframe/PDF/image/video content must not call those endpoints directly.

## File Structure

- Create `src/core/browser/types.ts`: shared Browser config, URI, resolver result, renderer, owner, proof, source, action, and context types.
- Create `src/core/browser/uri.ts`: scheme parser/normalizer for `metaid://` and `metaapp://`.
- Create `src/core/browser/config.ts`: Browser config normalization from `MetabotConfig.browser` plus env overrides.
- Create `src/core/browser/botHomepageClient.ts`: metaso-p2p homepage client and envelope normalization.
- Create `src/core/browser/botPageResolver.ts`: map `botHomepage.v1` JSON into `BrowserResolveResult`.
- Create `src/core/browser/metaAppResolver.ts`: map `MetaAppGalleryRecord` into `BrowserResolveResult` renderer descriptors.
- Create `src/core/browser/browserResolver.ts`: orchestration layer that parses URI and dispatches to Bot Page or MetaApp resolver.
- Create `src/daemon/routes/browser.ts`: `GET /api/browser/context` and `GET /api/browser/resolve`.
- Modify `src/daemon/routes/types.ts`: add `browser` handler and add `'browser'` to `MetabotUiPageName`.
- Modify `src/daemon/httpServer.ts`: register `handleBrowserRoutes` before `handleUiRoutes`.
- Modify `src/daemon/routes/ui.ts`: register `buildBrowserPageDefinition`; serve `/browser` as an alias to the browser page.
- Modify `src/daemon/defaultHandlers.ts`: wire default Browser context/resolve handlers.
- Modify `src/core/config/configTypes.ts` and `src/core/config/configStore.ts`: persist normalized Browser config.
- Create `src/ui/pages/browser/app.ts` and `src/ui/pages/browser/index.html`: browser shell, renderers, drawer, Inspector, trusted action modals.
- Create tests under `tests/browser/`, `tests/daemon/browserRoutes.test.mjs`, `tests/daemon/defaultBrowserHandlers.test.mjs`, and focused `tests/ui/browserPage*.test.mjs` files.
- Add fixtures under `tests/fixtures/browser/`.

## Task 1: Core Browser Types, Config, And URI Parser

**Files:**
- Create: `src/core/browser/types.ts`
- Create: `src/core/browser/uri.ts`
- Create: `src/core/browser/config.ts`
- Modify: `src/core/config/configTypes.ts`
- Modify: `src/core/config/configStore.ts`
- Test: `tests/browser/uri.test.mjs`
- Test: `tests/config/browserConfig.test.mjs`

- [ ] **Step 1: Write parser and config tests**

Add `tests/browser/uri.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parseBrowserUri } = require('../../dist/core/browser/uri.js');

test('parseBrowserUri normalizes metaid and metaapp schemes', () => {
  assert.deepEqual(parseBrowserUri('  METAID://idqABC  '), {
    originalUri: 'METAID://idqABC',
    normalizedUri: 'metaid://idqABC',
    scheme: 'metaid',
    id: 'idqABC',
  });
  assert.deepEqual(parseBrowserUri('metaapp://abcdef123i0'), {
    originalUri: 'metaapp://abcdef123i0',
    normalizedUri: 'metaapp://abcdef123i0',
    scheme: 'metaapp',
    id: 'abcdef123i0',
  });
});

test('parseBrowserUri rejects missing, empty, and unsupported schemes', () => {
  assert.throws(() => parseBrowserUri('idqABC'), /complete Agent Internet URI/i);
  assert.throws(() => parseBrowserUri('metaid://'), /empty resource id/i);
  assert.throws(() => parseBrowserUri('https://example.com'), /unsupported URI scheme/i);
});
```

Add `tests/config/browserConfig.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { resolveBrowserConfig } = require('../../dist/core/browser/config.js');

test('config store normalizes Browser config with safe defaults', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-browser-config-'));
  const store = createConfigStore(homeDir);
  const config = await store.read();

  assert.equal(config.browser.localMode, true);
  assert.equal(config.browser.defaultChainName, 'mvc');
  assert.equal(resolveBrowserConfig(config, {}).localMode, true);
});

test('Browser config accepts env override over stored base URL', async () => {
  const resolved = resolveBrowserConfig({
    chain: { defaultWriteNetwork: 'mvc' },
    a2a: { simplemsgListenerEnabled: true },
    browser: {
      metasoP2PBaseUrl: '',
      localMode: true,
      defaultChainName: 'mvc',
    },
  }, {
    METABOT_BROWSER_METASO_P2P_BASE_URL: 'https://so.example.test/',
  });

  assert.equal(resolved.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(resolved.defaultChainName, 'mvc');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/uri.test.mjs tests/config/browserConfig.test.mjs
```

Expected: build fails because `src/core/browser/*` does not exist or tests fail because parser/config functions are missing.

- [ ] **Step 3: Add Browser types**

Implement `src/core/browser/types.ts` with these exported types:

```ts
import type { DefaultWriteNetwork } from '../config/configTypes';

export type BrowserUriScheme = 'metaid' | 'metaapp';
export type BrowserResourceType = 'bot' | 'metaapp' | 'unsupported';
export type BrowserRendererType = 'bot-page' | 'html-iframe' | 'pdf' | 'image' | 'video' | 'unsupported';
export type BrowserResolutionState = 'resolved' | 'loading' | 'not_found' | 'error';
export type BrowserVerificationState = 'verified' | 'partial' | 'unverified';

export interface BotBrowserConfig {
  metasoP2PBaseUrl: string;
  metafileContentBaseUrl?: string;
  blockExplorerBaseUrl?: string;
  walletApiBaseUrl?: string;
  defaultChainName: DefaultWriteNetwork;
  localMode: boolean;
}

export interface ParsedBrowserUri {
  originalUri: string;
  normalizedUri: string;
  scheme: BrowserUriScheme;
  id: string;
}

export interface BrowserResourceOwner {
  kind: 'bot' | 'metaapp-publisher' | 'unknown';
  globalMetaId: string;
  metaid?: string;
  address?: string;
  name: string;
  avatar?: string;
  online?: boolean | null;
  verificationState: BrowserVerificationState;
}

export interface BrowserRendererDescriptor {
  type: BrowserRendererType;
  contentType: string;
  url?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface BrowserResolutionStatus {
  state: BrowserResolutionState;
  verificationState: BrowserVerificationState;
  message: string;
}

export interface BrowserProofSummary {
  txid?: string;
  pinId?: string;
  protocolPath?: string;
  contentHash?: string;
  publisherGlobalMetaId?: string;
  explorerUrl?: string;
  verificationState: BrowserVerificationState;
  details?: Record<string, unknown>;
}

export interface BrowserSourceSummary {
  resolver: string;
  url?: string;
  fetchedAt?: number;
  indexedAt?: number;
  stale?: boolean;
  schemaVersion?: string;
  raw?: Record<string, unknown>;
}

export interface BrowserTrustedAction {
  id: string;
  label: string;
  kind: 'private-chat' | 'service-list' | 'service-call' | 'copy' | 'proof' | 'creator';
  enabled?: boolean;
  requiresUsingIdentity?: boolean;
  uri?: string;
  serviceId?: string;
  payload?: Record<string, unknown>;
}

export interface BrowserResolveResult {
  uri: string;
  normalizedUri: string;
  resourceType: BrowserResourceType;
  title: string;
  owner: BrowserResourceOwner;
  renderer: BrowserRendererDescriptor;
  status: BrowserResolutionStatus;
  proof?: BrowserProofSummary;
  source: BrowserSourceSummary;
  actions: BrowserTrustedAction[];
}

export interface BrowserUsingIdentity {
  slug: string;
  name: string;
  globalMetaId: string;
  avatar?: string;
  isDefault: boolean;
}

export interface BrowserContextResult {
  usingIdentities: BrowserUsingIdentity[];
  defaultUsingIdentity: BrowserUsingIdentity | null;
  defaultUri: string | null;
}
```

- [ ] **Step 4: Add URI parser**

Implement `src/core/browser/uri.ts`:

```ts
import type { BrowserUriScheme, ParsedBrowserUri } from './types';

const SUPPORTED_SCHEMES = new Set<BrowserUriScheme>(['metaid', 'metaapp']);

export function parseBrowserUri(input: string): ParsedBrowserUri {
  const originalUri = String(input ?? '').trim();
  const schemeMatch = originalUri.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  if (!schemeMatch) {
    throw new Error('Enter a complete Agent Internet URI such as metaid://idq1example or metaapp://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0.');
  }

  const scheme = schemeMatch[1].toLowerCase() as BrowserUriScheme;
  if (!SUPPORTED_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported URI scheme: ${schemeMatch[1]}.`);
  }

  const id = schemeMatch[2].trim();
  if (!id) {
    throw new Error('Agent Internet URI has an empty resource id.');
  }

  return {
    originalUri,
    normalizedUri: `${scheme}://${id}`,
    scheme,
    id,
  };
}
```

- [ ] **Step 5: Add Browser config normalization**

Update `src/core/config/configTypes.ts` by adding `BrowserConfig` to `MetabotConfig` and `createDefaultConfig()`:

```ts
export interface BrowserConfig {
  metasoP2PBaseUrl: string;
  metafileContentBaseUrl?: string;
  blockExplorerBaseUrl?: string;
  walletApiBaseUrl?: string;
  defaultChainName: DefaultWriteNetwork;
  localMode: boolean;
}

export interface MetabotConfig {
  chain: ChainConfig;
  a2a: A2AConfig;
  browser: BrowserConfig;
}
```

Create `src/core/browser/config.ts`:

```ts
import type { BrowserConfig, MetabotConfig } from '../config/configTypes';

const DEFAULT_METASO_P2P_BASE_URL = 'https://so.metaid.io';
const DEFAULT_METAFILE_CONTENT_BASE_URL = 'https://so.metaid.io/content';
const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://www.mvcscan.com/tx';

function normalizeUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.replace(/\/+$/, '');
}

export function resolveBrowserConfig(config: MetabotConfig, env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const browser = config.browser;
  return {
    metasoP2PBaseUrl: normalizeUrl(env.METABOT_BROWSER_METASO_P2P_BASE_URL) || normalizeUrl(browser.metasoP2PBaseUrl),
    metafileContentBaseUrl: normalizeUrl(env.METABOT_BROWSER_METAFILE_CONTENT_BASE_URL) || normalizeUrl(browser.metafileContentBaseUrl),
    blockExplorerBaseUrl: normalizeUrl(env.METABOT_BROWSER_BLOCK_EXPLORER_BASE_URL) || normalizeUrl(browser.blockExplorerBaseUrl),
    walletApiBaseUrl: normalizeUrl(env.METABOT_BROWSER_WALLET_API_BASE_URL) || normalizeUrl(browser.walletApiBaseUrl),
    defaultChainName: browser.defaultChainName || config.chain.defaultWriteNetwork,
    localMode: browser.localMode !== false,
  };
}

export function createDefaultBrowserConfig(defaultChainName: BrowserConfig['defaultChainName']): BrowserConfig {
  return {
    metasoP2PBaseUrl: DEFAULT_METASO_P2P_BASE_URL,
    metafileContentBaseUrl: DEFAULT_METAFILE_CONTENT_BASE_URL,
    blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
    defaultChainName,
    localMode: true,
  };
}
```

Update `src/core/config/configStore.ts` `normalizeConfig()` so it normalizes `browser` from stored config and preserves existing defaults:

```ts
const maybeBrowser = root['browser'];
const browserSource = maybeBrowser && typeof maybeBrowser === 'object'
  ? maybeBrowser as Record<string, unknown>
  : {};
```

Return the full browser object below. For `defaultChainName`, accept only `DEFAULT_WRITE_NETWORKS`; otherwise use `defaults.chain.defaultWriteNetwork`.

```ts
browser: {
  metasoP2PBaseUrl: normalizeString(browserSource.metasoP2PBaseUrl) || defaults.browser.metasoP2PBaseUrl,
  metafileContentBaseUrl: normalizeString(browserSource.metafileContentBaseUrl) || defaults.browser.metafileContentBaseUrl,
  blockExplorerBaseUrl: normalizeString(browserSource.blockExplorerBaseUrl) || defaults.browser.blockExplorerBaseUrl,
  walletApiBaseUrl: normalizeString(browserSource.walletApiBaseUrl) || defaults.browser.walletApiBaseUrl,
  defaultChainName: isDefaultWriteNetwork(normalizeString(browserSource.defaultChainName).toLowerCase())
    ? normalizeString(browserSource.defaultChainName).toLowerCase() as DefaultWriteNetwork
    : defaults.chain.defaultWriteNetwork,
  localMode: normalizeBoolean(browserSource.localMode, defaults.browser.localMode),
}
```

Do not preserve an empty stored `browser.metasoP2PBaseUrl`; an empty stored value means "use the default." The `browser_config_missing` branch is tested at the core resolver boundary by passing an explicit empty `BotBrowserConfig`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/uri.test.mjs tests/config/browserConfig.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/browser/types.ts src/core/browser/uri.ts src/core/browser/config.ts src/core/config/configTypes.ts src/core/config/configStore.ts tests/browser/uri.test.mjs tests/config/browserConfig.test.mjs
git commit -m "feat: add browser URI and config contracts"
```

## Task 2: Bot Homepage Client And Bot Page Resolver

**Files:**
- Create: `src/core/browser/botHomepageClient.ts`
- Create: `src/core/browser/botPageResolver.ts`
- Create: `tests/fixtures/browser/botHomepage.v1.json`
- Test: `tests/browser/botHomepageResolver.test.mjs`

- [ ] **Step 1: Add fixture JSON**

Create `tests/fixtures/browser/botHomepage.v1.json` using the `botHomepage.v1` shape from the metaso-p2p PRD. Keep values deterministic:

```json
{
  "schemaVersion": "botHomepage.v1",
  "resolvedAt": 1780760000000,
  "globalMetaId": "idq1fixturebot",
  "canonical": {
    "globalMetaId": "idq1fixturebot",
    "metaid": "metaid-fixture",
    "address": "18FixtureAddress",
    "chainName": "mvc"
  },
  "profile": {
    "name": "Fixture Bot",
    "avatar": "https://so.example.test/content/avatar-pin",
    "avatarPinId": "avatar-pin",
    "background": "",
    "backgroundPinId": "",
    "bio": "Builds OAC browser fixtures.",
    "bioPinId": "bio-pin",
    "chatPubkey": "04fixture",
    "chatPubkeyPinId": "chat-pin",
    "nftAvatar": "",
    "displayGlobalMetaId": "idq1fixture...bot"
  },
  "homepage": {
    "mode": "default",
    "title": "Fixture Bot",
    "summary": "Builds OAC browser fixtures.",
    "custom": null
  },
  "presence": {
    "state": "online",
    "updatedAt": 1780760000000,
    "source": "fixture-presence"
  },
  "services": [
    {
      "id": "service-current-pin",
      "currentPinId": "service-current-pin",
      "sourceServicePinId": "service-source-pin",
      "displayName": "Fixture Review",
      "serviceName": "fixture-review",
      "description": "Review a fixture payload.",
      "providerSkill": "fixture-review",
      "price": "0",
      "currency": "SPACE",
      "paymentChain": "mvc",
      "paymentAddress": "18FixtureAddress",
      "proof": {
        "txid": "service-txid",
        "pinId": "service-current-pin",
        "sourceServicePinId": "service-source-pin",
        "protocolPath": "/protocols/skill-service",
        "publisherGlobalMetaId": "idq1fixturebot"
      }
    }
  ],
  "actions": [
    { "id": "message", "label": "Message", "kind": "private-chat", "enabled": true, "requiresUsingIdentity": true },
    { "id": "services", "label": "Services", "kind": "service-list", "enabled": true, "requiresUsingIdentity": true },
    { "id": "copy-uri", "label": "Copy URI", "kind": "copy", "enabled": true, "uri": "metaid://idq1fixturebot" }
  ],
  "proofs": {
    "verificationState": "partial",
    "identity": {
      "txid": "identity-txid",
      "pinId": "identity-pin",
      "protocolPath": "/",
      "publisherGlobalMetaId": "idq1fixturebot",
      "contentHash": "sha256:identity"
    },
    "profile": [
      {
        "field": "bio",
        "txid": "bio-txid",
        "pinId": "bio-pin",
        "protocolPath": "/info/bio",
        "contentHash": "sha256:bio",
        "publisherGlobalMetaId": "idq1fixturebot"
      }
    ],
    "homepage": null,
    "services": []
  },
  "source": {
    "resolver": "metaso-p2p",
    "node": "https://so.example.test",
    "contentBaseUrl": "https://so.example.test/content/",
    "fetchedAt": 1780760000000,
    "stale": false
  },
  "warnings": []
}
```

- [ ] **Step 2: Write resolver tests**

Add `tests/browser/botHomepageResolver.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createBotHomepageClient } = require('../../dist/core/browser/botHomepageClient.js');
const { buildBotPageResolveResult } = require('../../dist/core/browser/botPageResolver.js');

test('Bot homepage client fetches metaso-p2p botHomepage.v1 envelope', async () => {
  const calls = [];
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const client = createBotHomepageClient({
    baseUrl: 'https://so.example.test',
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, message: '', data: fixture }),
      };
    },
  });

  const result = await client.getByGlobalMetaId('idq1fixturebot');

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, 'Fixture Bot');
  assert.deepEqual(calls, ['https://so.example.test/api/bot-homepage/globalmetaid/idq1fixturebot?includeServices=true&includeProofs=true&includePresence=true']);
});

test('buildBotPageResolveResult maps homepage JSON into BrowserResolveResult', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const result = buildBotPageResolveResult({
    uri: 'metaid://idq1fixturebot',
    normalizedUri: 'metaid://idq1fixturebot',
    homepage: fixture,
    resolverUrl: 'https://so.example.test/api/bot-homepage/globalmetaid/idq1fixturebot',
  });

  assert.equal(result.resourceType, 'bot');
  assert.equal(result.title, 'Fixture Bot');
  assert.equal(result.owner.kind, 'bot');
  assert.equal(result.owner.globalMetaId, 'idq1fixturebot');
  assert.equal(result.owner.online, true);
  assert.equal(result.renderer.type, 'bot-page');
  assert.equal(result.renderer.contentType, 'application/vnd.oac.bot-homepage+json');
  assert.equal(result.status.state, 'resolved');
  assert.equal(result.status.verificationState, 'partial');
  assert.equal(result.proof.txid, 'identity-txid');
  assert.equal(result.proof.pinId, 'identity-pin');
  assert.equal(result.actions.some((action) => action.kind === 'private-chat'), true);
  assert.equal(result.actions.some((action) => action.kind === 'service-list'), true);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/botHomepageResolver.test.mjs
```

Expected: build fails because `botHomepageClient` and `botPageResolver` are missing.

- [ ] **Step 4: Implement homepage client**

Implement `src/core/browser/botHomepageClient.ts`:

```ts
export interface BotHomepageClientInput {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface BotHomepageClient {
  getByGlobalMetaId(globalMetaId: string): Promise<{
    ok: true;
    data: Record<string, unknown>;
    fetchedAt: number;
    url: string;
  } | {
    ok: false;
    code: string;
    message: string;
    status?: number;
    fetchedAt: number;
    url: string;
  }>;
}
```

The implementation must:

- Trim trailing slashes from `baseUrl`.
- Request `/api/bot-homepage/globalmetaid/:globalMetaId` with `includeServices=true`, `includeProofs=true`, and `includePresence=true`.
- Accept only success envelopes with `code === 0` and object `data`.
- Map metaso code `40400` to `bot_homepage_not_found`.
- Map fetch/network failures to `bot_homepage_fetch_failed`.

- [ ] **Step 5: Implement Bot Page result mapper**

Implement `src/core/browser/botPageResolver.ts` with this exported signature:

```ts
import type { BrowserResolveResult } from './types';

export function buildBotPageResolveResult(input: {
  uri: string;
  normalizedUri: string;
  homepage: Record<string, unknown>;
  resolverUrl: string;
}): BrowserResolveResult;
```

Mapping rules:

- `owner.name` comes from `profile.name` or `homepage.title` or shortened GlobalMetaId.
- `owner.avatar` comes from `profile.avatar`.
- `owner.online` is `true` for `presence.state === 'online'`, `false` for `offline`, and `null` for `unknown` or missing.
- `renderer.type` is `bot-page`.
- `renderer.data` contains the raw homepage JSON so the UI Bot Page renderer can render services and proof details without another call.
- `status.verificationState` comes from `proofs.verificationState`, default `unverified`.
- `proof` prefers `proofs.identity`, then first `proofs.profile`, then first service proof.
- `source.raw` contains the raw homepage JSON.
- `actions` merge homepage action hints with guaranteed Browser-owned `message`, `services`, and `copy-uri` actions, deduped by `id`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/botHomepageResolver.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/browser/botHomepageClient.ts src/core/browser/botPageResolver.ts tests/fixtures/browser/botHomepage.v1.json tests/browser/botHomepageResolver.test.mjs
git commit -m "feat: map bot homepage resources"
```

## Task 3: MetaApp Renderer Resolver

**Files:**
- Create: `src/core/browser/metaAppResolver.ts`
- Test: `tests/browser/metaAppResolver.test.mjs`

- [ ] **Step 1: Write MetaApp resolver tests**

Add `tests/browser/metaAppResolver.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildMetaAppResolveResult } = require('../../dist/core/browser/metaAppResolver.js');

function record(overrides = {}) {
  return {
    pinId: 'a'.repeat(64) + 'i0',
    firstPinId: 'b'.repeat(64) + 'i0',
    operation: 'create',
    title: 'Fixture MetaApp',
    appName: 'fixture-metaapp',
    version: '1.0.0',
    runtime: 'browser',
    indexFile: 'index.html',
    code: '',
    content: '',
    contentType: 'text/html',
    codeType: 'html',
    tags: [],
    ownerGlobalMetaId: 'idq1publisher',
    ownerAddress: '18Publisher',
    network: 'mvc',
    metawebUrl: 'https://metaweb.example/app',
    localUiUrl: '/api/metaapp/preview-assets/preview/index.html',
    updatedAt: 1780760000000,
    source: 'indexer',
    ...overrides,
  };
}

test('buildMetaAppResolveResult selects sandboxed html iframe renderer', () => {
  const result = buildMetaAppResolveResult({
    uri: 'metaapp://' + 'a'.repeat(64) + 'i0',
    normalizedUri: 'metaapp://' + 'a'.repeat(64) + 'i0',
    record: record(),
    fetchedAt: 1780760000001,
  });

  assert.equal(result.resourceType, 'metaapp');
  assert.equal(result.owner.kind, 'metaapp-publisher');
  assert.equal(result.owner.globalMetaId, 'idq1publisher');
  assert.equal(result.renderer.type, 'html-iframe');
  assert.equal(result.renderer.url, 'https://metaweb.example/app');
  assert.equal(result.actions.some((action) => action.kind === 'copy'), true);
  assert.equal(result.actions.some((action) => action.kind === 'proof'), true);
});

test('buildMetaAppResolveResult selects content-specific renderers', () => {
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'application/pdf', downloadUrl: 'https://files.example/a.pdf' }) }).renderer.type, 'pdf');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'image/png', downloadUrl: 'https://files.example/a.png' }) }).renderer.type, 'image');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'video/mp4', downloadUrl: 'https://files.example/a.mp4' }) }).renderer.type, 'video');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'application/octet-stream', downloadUrl: 'https://files.example/a.bin' }) }).renderer.type, 'unsupported');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/metaAppResolver.test.mjs
```

Expected: build fails because `metaAppResolver` is missing.

- [ ] **Step 3: Implement MetaApp resolver**

Implement `src/core/browser/metaAppResolver.ts` with this exported signature:

```ts
import type { MetaAppGalleryRecord } from '../metaapp/types';
import type { BrowserResolveResult, BrowserRendererType } from './types';

export function buildMetaAppResolveResult(input: {
  uri: string;
  normalizedUri: string;
  record: MetaAppGalleryRecord;
  fetchedAt?: number;
}): BrowserResolveResult;
```

Renderer rules:

- `text/html`, `application/xhtml+xml`, `codeType === 'html'`, `runUrl`, or non-gallery `metawebUrl` select `html-iframe`.
- `application/pdf` or `.pdf` URL selects `pdf`.
- `image/*` or image file extension selects `image`.
- `video/*` or video file extension selects `video`.
- Anything else selects `unsupported` with `renderer.error = 'Unsupported MetaApp content type.'`.
- For URL selection, prefer `record.runUrl`, then `record.metawebUrl`, then `record.downloadUrl`, then non-gallery `record.localUiUrl`.
- Reject unsafe renderer URLs by leaving `url` undefined unless the value is `http:`, `https:`, or a same-origin absolute path beginning with one `/`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/metaAppResolver.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/browser/metaAppResolver.ts tests/browser/metaAppResolver.test.mjs
git commit -m "feat: map metaapp browser renderers"
```

## Task 4: Browser Resolver Service And Daemon API Routes

**Files:**
- Create: `src/core/browser/browserResolver.ts`
- Create: `src/daemon/routes/browser.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/httpServer.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/browser/browserResolver.test.mjs`
- Test: `tests/daemon/browserRoutes.test.mjs`
- Test: `tests/daemon/defaultBrowserHandlers.test.mjs`

- [ ] **Step 1: Write resolver orchestration tests**

Add `tests/browser/browserResolver.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveBrowserResource } = require('../../dist/core/browser/browserResolver.js');

test('resolveBrowserResource fails closed when metaso-p2p URL is missing for metaid URI', async () => {
  const result = await resolveBrowserResource({
    uri: 'metaid://idq1missingconfig',
    config: {
      metasoP2PBaseUrl: '',
      defaultChainName: 'mvc',
      localMode: true,
    },
    metaAppLookup: async () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_config_missing');
});

test('resolveBrowserResource resolves metaid URI through homepage client', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const result = await resolveBrowserResource({
    uri: 'metaid://idq1fixturebot',
    config: {
      metasoP2PBaseUrl: 'https://so.example.test',
      defaultChainName: 'mvc',
      localMode: true,
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
    metaAppLookup: async () => null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.renderer.type, 'bot-page');
});
```

- [ ] **Step 2: Write daemon route tests**

Add `tests/daemon/browserRoutes.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = { context: [], resolve: [] };
  const server = createHttpServer({
    browser: {
      getContext: async (input) => {
        calls.context.push(input);
        return commandSuccess({
          usingIdentities: [{ slug: 'alice', name: 'Alice Bot', globalMetaId: 'idq1alice', isDefault: true }],
          defaultUsingIdentity: { slug: 'alice', name: 'Alice Bot', globalMetaId: 'idq1alice', isDefault: true },
          defaultUri: 'metaid://idq1alice',
        });
      },
      resolve: async (input) => {
        calls.resolve.push(input);
        if (input.uri === 'metaid://missing') return commandFailed('browser_resource_not_found', 'Resource not found.');
        return commandSuccess({
          uri: input.uri,
          normalizedUri: input.uri.toLowerCase(),
          resourceType: 'bot',
          title: 'Alice Bot',
          owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
          renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
          status: { state: 'resolved', verificationState: 'verified', message: '' },
          source: { resolver: 'test' },
          actions: [],
        });
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, calls, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('GET /api/browser/context forwards optional from slug', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/context?from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.defaultUri, 'metaid://idq1alice');
  assert.deepEqual(calls.context, [{ from: 'alice' }]);
});

test('GET /api/browser/resolve forwards URI and from slug', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/resolve?uri=${encodeURIComponent('METAID://idq1alice')}&from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.resourceType, 'bot');
  assert.deepEqual(calls.resolve, [{ uri: 'METAID://idq1alice', from: 'alice' }]);
});

test('GET /api/browser/resolve validates missing uri and maps not found status', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const missingUri = await fetch(`${baseUrl}/api/browser/resolve`);
  const missingPayload = await missingUri.json();
  assert.equal(missingUri.status, 400);
  assert.equal(missingPayload.code, 'missing_uri');

  const notFound = await fetch(`${baseUrl}/api/browser/resolve?uri=${encodeURIComponent('metaid://missing')}`);
  const notFoundPayload = await notFound.json();
  assert.equal(notFound.status, 404);
  assert.equal(notFoundPayload.code, 'browser_resource_not_found');
});
```

- [ ] **Step 3: Write default handler context tests**

Add `tests/daemon/defaultBrowserHandlers.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');

test('Browser context defaults to the active local Bot and can switch using identity by slug', async (t) => {
  const profileHome = await createProfileHome('browser-default-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfile(systemHomeDir, { name: 'Active Browser Bot' });
  const other = await createMetabotProfile(systemHomeDir, { name: 'Other Browser Bot' });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const defaultContext = await handlers.browser.getContext({});
  assert.equal(defaultContext.ok, true);
  assert.equal(defaultContext.data.defaultUsingIdentity.slug, active.slug);
  assert.equal(defaultContext.data.defaultUri, `metaid://${active.globalMetaId}`);

  const selectedContext = await handlers.browser.getContext({ from: other.slug });
  assert.equal(selectedContext.ok, true);
  assert.equal(selectedContext.data.defaultUsingIdentity.slug, other.slug);
  assert.equal(selectedContext.data.defaultUri, `metaid://${other.globalMetaId}`);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/browserResolver.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs
```

Expected: build fails because resolver, browser route, and default handler browser support are missing.

- [ ] **Step 5: Implement `resolveBrowserResource`**

Create `src/core/browser/browserResolver.ts` with this exported signature and imports:

```ts
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppGalleryRecord } from '../metaapp/types';
import { createBotHomepageClient } from './botHomepageClient';
import { buildBotPageResolveResult } from './botPageResolver';
import { buildMetaAppResolveResult } from './metaAppResolver';
import { parseBrowserUri } from './uri';
import type { BotBrowserConfig, BrowserResolveResult } from './types';

export interface ResolveBrowserResourceInput {
  uri: string;
  config: BotBrowserConfig;
  fetch?: typeof fetch;
  metaAppLookup: (pinId: string) => Promise<MetaAppGalleryRecord | null>;
}

export async function resolveBrowserResource(input: ResolveBrowserResourceInput): Promise<MetabotCommandResult<BrowserResolveResult>>;
```

Failure codes:

- `invalid_browser_uri` for parser errors.
- `browser_config_missing` when `metaid://` is requested and `config.metasoP2PBaseUrl` is empty.
- `browser_resource_not_found` when homepage client returns not found or MetaApp lookup returns null.
- `browser_resolve_failed` for network/malformed responses.

- [ ] **Step 6: Implement daemon browser route**

Create `src/daemon/routes/browser.ts`:

```ts
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function statusForBrowserResult(result: MetabotCommandResult<unknown>): number {
  if (result.ok) return 200;
  if (result.code === 'missing_uri' || result.code === 'invalid_browser_uri') return 400;
  if (result.code === 'browser_resource_not_found') return 404;
  if (result.code === 'browser_config_missing') return 500;
  return 400;
}

export const handleBrowserRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (url.pathname === '/api/browser/context') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const from = normalizeText(url.searchParams.get('from'));
    const result = handlers.browser?.getContext
      ? await handlers.browser.getContext(from ? { from } : {})
      : commandFailed('not_implemented', 'Browser context handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/resolve') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const uri = normalizeText(url.searchParams.get('uri'));
    if (!uri) {
      context.sendJson(400, commandFailed('missing_uri', 'uri query parameter is required.'));
      return true;
    }
    const from = normalizeText(url.searchParams.get('from'));
    const result = handlers.browser?.resolve
      ? await handlers.browser.resolve({ uri, ...(from ? { from } : {}) })
      : commandFailed('not_implemented', 'Browser resolve handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  return false;
};
```

Modify `src/daemon/routes/types.ts`:

```ts
import type { BrowserContextResult, BrowserResolveResult } from '../../core/browser/types';

export type MetabotUiPageName = 'hub' | 'publish' | 'my-services' | 'trace' | 'refund' | 'bot' | 'loom' | 'metaapps' | 'browser';

browser?: {
  getContext?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<BrowserContextResult>>;
  resolve?: (input: { uri: string; from?: string }) => Awaitable<MetabotCommandResult<BrowserResolveResult>>;
};
```

Modify `src/daemon/httpServer.ts` to import and add `handleBrowserRoutes` before `handleUiRoutes`.

- [ ] **Step 7: Wire default handlers**

In `src/daemon/defaultHandlers.ts`:

- Import `resolveBrowserConfig`, `resolveBrowserResource`, and Browser types.
- Add helper `buildBrowserContextResult(rawFrom?: unknown)`.
- Use `listMetabotProfiles(normalizedSystemHomeDir)` and mark the default identity by matching `path.resolve(profile.homeDir) === path.resolve(input.homeDir)`; when `from` is supplied, default to that profile.
- Resolve MetaApps by reusing `readMetaAppRecordForUpdate(actor.homeDir, pinId)` when a selected profile is available, and otherwise by checking active actor first.
- Add `browser` to the returned handler object:

```ts
browser: {
  getContext: async (request = {}) => buildBrowserContextResult(request.from),
  resolve: async (request) => {
    const actor = await resolveActorWriteContext(request.from);
    if ('failure' in actor) return actor.failure;
    const config = await createConfigStore(actor.homeDir).read();
    const browserConfig = resolveBrowserConfig(config, process.env);
    return resolveBrowserResource({
      uri: request.uri,
      config: browserConfig,
      fetch: globalThis.fetch,
      metaAppLookup: (pinId) => readMetaAppRecordForUpdate(actor.homeDir, pinId),
    });
  },
},
```

`resolveActorWriteContext` already resolves the selected profile home and existing signer context. The Browser resolver only needs its `homeDir` and `runtimeStateStore`; do not add a new broad actor abstraction for this task.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/browserResolver.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/browser/browserResolver.ts src/daemon/routes/browser.ts src/daemon/routes/types.ts src/daemon/httpServer.ts src/daemon/defaultHandlers.ts tests/browser/browserResolver.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs
git commit -m "feat: add browser resolve API"
```

## Task 5: Browser UI Route, Page Shell, And Product Alias

**Files:**
- Create: `src/ui/pages/browser/app.ts`
- Create: `src/ui/pages/browser/index.html`
- Modify: `src/daemon/routes/ui.ts`
- Test: `tests/daemon/browserUiRoutes.test.mjs`

- [ ] **Step 1: Write route/page shell tests**

Add `tests/daemon/browserUiRoutes.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

async function startServer() {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('GET /browser and /ui/browser serve the same Agent Internet Browser shell', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const product = await fetch(`${baseUrl}/browser?uri=${encodeURIComponent('metaid://idq1alice')}`);
  const framework = await fetch(`${baseUrl}/ui/browser?uri=${encodeURIComponent('metaid://idq1alice')}`);
  const productHtml = await product.text();
  const frameworkHtml = await framework.text();

  assert.equal(product.status, 200);
  assert.equal(framework.status, 200);
  assert.match(productHtml, /Agent Internet Browser/);
  assert.match(productHtml, /data-browser-shell/);
  assert.match(productHtml, /data-browser-uri-input/);
  assert.match(productHtml, /data-browser-viewport/);
  assert.match(productHtml, /data-browser-status-strip/);
  assert.match(productHtml, /\/api\/browser\/resolve/);
  assert.equal(productHtml, frameworkHtml);
});

test('Browser default shell hides drawer and inspector by default and avoids rejected labels', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/ui/browser`);
  const html = await response.text();

  assert.match(html, /data-browser-drawer hidden/);
  assert.match(html, /data-browser-inspector hidden/);
  assert.doesNotMatch(html, />Rendered</);
  assert.doesNotMatch(html, />Chain Proof</);
  assert.doesNotMatch(html, />Source</);
  assert.doesNotMatch(html, /TSID/);
  assert.match(html, /TXID/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/daemon/browserUiRoutes.test.mjs
```

Expected: build fails or route returns 404 because `browser` page is not registered.

- [ ] **Step 3: Implement page definition**

Create `src/ui/pages/browser/app.ts`:

```ts
import type { LocalUiPageDefinition } from '../types';

export function buildBrowserPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'browser',
    title: 'Agent Internet Browser',
    eyebrow: 'Bot Browser',
    heading: 'Agent Internet Browser',
    description: 'Visit Agent Internet resources by URI.',
    panels: [],
    contentHtml: `
      <section class="browser-shell" data-browser-shell>
        <header class="browser-topbar" data-browser-topbar>
          <div class="browser-nav">
            <button type="button" data-browser-back aria-label="Back">Back</button>
            <button type="button" data-browser-forward aria-label="Forward">Forward</button>
            <button type="button" data-browser-reload aria-label="Reload">Reload</button>
            <button type="button" data-browser-drawer-toggle aria-label="Bookmarks and history">Bookmarks</button>
          </div>
          <form class="browser-address-form" data-browser-address-form>
            <input data-browser-uri-input aria-label="Agent Internet URI" placeholder="metaid://idq1example" />
            <button type="submit">Open</button>
          </form>
          <button type="button" class="browser-resource-chip" data-browser-resource-chip>Resource</button>
          <button type="button" class="browser-using-chip" data-browser-using-selector>Using: My Bot</button>
        </header>
        <aside class="browser-drawer hidden" data-browser-drawer></aside>
        <main class="browser-viewport" data-browser-viewport></main>
        <footer class="browser-status-strip" data-browser-status-strip>
          <button type="button" data-browser-status-state>loading</button>
          <button type="button" data-browser-status-proof>unverified</button>
          <span data-browser-status-renderer>renderer: unsupported</span>
          <button type="button" data-browser-status-txid>TXID: -</button>
        </footer>
        <aside class="browser-inspector hidden" data-browser-inspector></aside>
        <div class="browser-modal hidden" data-browser-modal-root></div>
      </section>
    `,
    script: buildBrowserPageScript(),
  };
}
```

The shell must include:

- Top bar with Back, Forward, Reload, drawer button, full URI input, Open button, current resource chip, and compact `Using: My Bot` selector.
- Main viewport with `data-browser-viewport`.
- Minimal status strip with `data-browser-status-strip`.
- Hidden drawer with `data-browser-drawer hidden`.
- Hidden Inspector with `data-browser-inspector hidden`.
- Modal root for Browser-owned trusted actions.

- [ ] **Step 4: Implement page template**

Create `src/ui/pages/browser/index.html` using the existing template replacement style. It must link `/ui/shared.css`, contain `__PAGE_CONTENT__`, and inject `__PAGE_SCRIPT__` in a script tag.

- [ ] **Step 5: Register routes**

Modify `src/daemon/routes/ui.ts`:

- Import `buildBrowserPageDefinition`.
- Add `'browser': buildBrowserPageDefinition` to `PAGE_BUILDERS`.
- Add Browser to `NAV_ITEMS` near Hub/Bot.
- Add alias handling before the `/ui/` prefix return:

```ts
if (url.pathname === '/browser') {
  if (req.method !== 'GET') {
    context.sendMethodNotAllowed(['GET']);
    return true;
  }
  const html = handlers.ui?.renderPage
    ? await handlers.ui.renderPage('browser')
    : await renderBuiltInPage('browser');
  context.sendHtml(200, html);
  return true;
}
```

The alias must render the same HTML string as `/ui/browser`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/daemon/browserUiRoutes.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/pages/browser/app.ts src/ui/pages/browser/index.html src/daemon/routes/ui.ts tests/daemon/browserUiRoutes.test.mjs
git commit -m "feat: add browser UI shell"
```

## Task 6: Browser UI State, Context Loading, And Navigation

**Files:**
- Modify: `src/ui/pages/browser/app.ts`
- Test: `tests/ui/browserPageState.test.mjs`

- [ ] **Step 1: Write UI state tests**

Add `tests/ui/browserPageState.test.mjs` with VM-based tests in the style of `tests/ui/botPageScript.test.mjs`. The tests must verify:

- Query param `?uri=metaid%3A%2F%2Fidq1alice` is decoded into the Browser address bar.
- With no query URI, the script calls `/api/browser/context`, picks `defaultUri`, and then calls `/api/browser/resolve`.
- Current resource identity and using identity render into different elements.
- Back, Forward, Reload, and address-form navigation update local Browser history without replacing the Browser chrome.
- With no local Bot, the viewport renders a no-local-Bot empty state with a primary link/button to `/ui/bot`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageState.test.mjs
```

Expected: tests fail because the initial page shell does not implement runtime state.

- [ ] **Step 3: Implement Browser page state and API calls**

In `buildBrowserPageScript()` implement state:

```js
var state = {
  history: [],
  historyIndex: -1,
  current: null,
  context: null,
  usingSlug: '',
  drawerOpen: false,
  inspectorOpen: false,
  status: 'loading',
  error: ''
};
```

Implement `api(url, options)`, `loadContext()`, `resolveUri(uri, options)`, `navigateTo(uri)`, `reloadCurrent()`, `goBack()`, `goForward()`, and `initialize()`:

- `initialize()` reads `new URLSearchParams(window.location.search).get('uri')`.
- If query URI exists, set the input to decoded URI and resolve it.
- If no query URI exists, call `/api/browser/context`, set using identity, and resolve `defaultUri` if present.
- If no local Bot exists, render the no-local-Bot empty state with a primary link/button to `/ui/bot`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageState.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/browser/app.ts tests/ui/browserPageState.test.mjs
git commit -m "feat: wire browser navigation state"
```

## Task 7: Browser Resource Renderers

**Files:**
- Modify: `src/ui/pages/browser/app.ts`
- Test: `tests/ui/browserPageRenderers.test.mjs`

- [ ] **Step 1: Write renderer tests**

Add `tests/ui/browserPageRenderers.test.mjs` with VM-based tests. The tests must verify:

- `bot-page` renders avatar, Bot name, GlobalMetaId, profile/summary, services, and trusted buttons from fixture JSON.
- `html-iframe` emits an iframe with `sandbox` and without `allow-same-origin`, `allow-top-navigation`, wallet, payment, or signing permissions.
- `pdf`, `image`, and `video` render with `<iframe>`, `<img>`, and `<video controls>` respectively.
- Unsupported renderer types render a readable unsupported state and keep raw source details available for the Inspector.
- All renderer URLs pass through a `safeUrl()` helper and unsafe schemes are rejected.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageRenderers.test.mjs
```

Expected: tests fail because the shell does not implement renderer dispatch yet.

- [ ] **Step 3: Implement renderers**

Implement renderer dispatch:

- `bot-page`: native HTML renderer with avatar, Bot name, GlobalMetaId, summary/profile, services, and trusted buttons.
- `html-iframe`: `<iframe class="browser-html-frame" sandbox src="https://metaweb.example/app"></iframe>`; do not include `allow-same-origin`, `allow-top-navigation`, or wallet/payment/signing permissions.
- `pdf`: `<iframe class="browser-pdf" src="https://files.example/a.pdf"></iframe>` plus fallback open link.
- `image`: `<img class="browser-image" src="https://files.example/a.png" alt="">`.
- `video`: `<video class="browser-video" src="https://files.example/a.mp4" controls></video>`.
- `unsupported`: readable unsupported renderer state and Inspector Source details.

All renderer URLs must pass a local `safeUrl()` helper before use.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageRenderers.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/browser/app.ts tests/ui/browserPageRenderers.test.mjs
git commit -m "feat: render browser resource types"
```

## Task 8: Browser Drawer And Inspector

**Files:**
- Modify: `src/ui/pages/browser/app.ts`
- Test: `tests/ui/browserPageInspector.test.mjs`

- [ ] **Step 1: Write drawer and Inspector tests**

Add `tests/ui/browserPageInspector.test.mjs` with VM-based tests. The tests must verify:

- Drawer and Inspector stay hidden by default.
- Drawer opens only when the drawer button is clicked and shows bookmarks placeholder, recent Bots, recent MetaApps, and visit history from local state.
- Inspector opens from current resource chip, verification state control, and TXID status control.
- Inspector sections are `Identity`, `Proof`, and `Source`; these labels appear only inside Inspector.
- Status strip and proof fields use `TXID`, never `TSID`.
- Proof details include pin id, protocol path, content hash, publisher GlobalMetaId, and block explorer URL when present.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageInspector.test.mjs
```

Expected: tests fail because drawer/Inspector behavior is not implemented.

- [ ] **Step 3: Implement Drawer and Inspector**

Implement:

- Drawer button toggles `data-browser-drawer` hidden state.
- Drawer shows an empty bookmarks section, recent Bots, recent MetaApps, and visit history from local state. It is hidden by default.
- Inspector opens from current resource chip, verification state, and TXID status controls.
- Inspector sections are `Identity`, `Proof`, and `Source`. These labels are allowed only inside Inspector.
- Proof labels use `TXID`, `pin id`, `protocol path`, `content hash`, `publisher GlobalMetaId`, and block explorer URL.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageInspector.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/browser/app.ts tests/ui/browserPageInspector.test.mjs
git commit -m "feat: add browser inspector panels"
```

## Task 9: Browser Trusted Actions

**Files:**
- Modify: `src/ui/pages/browser/app.ts`
- Test: `tests/ui/browserPageActions.test.mjs`

- [ ] **Step 1: Write trusted action tests**

Add `tests/ui/browserPageActions.test.mjs` with VM-based tests. The tests must verify:

- `copy-uri` copies the normalized URI with `navigator.clipboard.writeText()` when available and falls back to status text.
- `private-chat` opens a Browser-owned modal; only modal confirmation sends `/api/chat/private`.
- The private chat request body uses the existing daemon contract: top-level `from`, `to`, and `content`; it must not use `peer` or `message`.
- `service-call` opens a Browser-owned confirmation modal; only modal confirmation sends `/api/services/call`.
- The service call request body uses the existing daemon contract: `request.servicePinId`, `request.providerGlobalMetaId`, and `request.userTask`; it must not use `request.input`.
- Sandboxed iframe content cannot reach these side-effect helpers.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageActions.test.mjs
```

Expected: tests fail because trusted actions are not implemented.

- [ ] **Step 3: Implement trusted actions**

Implement Browser-owned action handlers:

- `copy-uri`: copies the normalized URI through `navigator.clipboard.writeText()` when available and falls back to status text.
- `private-chat`: opens a modal with using identity, target Bot, and message text. Confirm sends:

```js
api('/api/chat/private', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    from: state.usingSlug || undefined,
    to: state.current.owner.globalMetaId,
    content: messageText
  })
})
```

- `service-list`: opens the services section or service modal using services from `renderer.data.services`.
- `service-call`: opens a confirmation modal that previews using identity, target service, service pin id, price/payment terms, and request payload. Confirm sends:

```js
api('/api/services/call', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    from: state.usingSlug || undefined,
    request: {
      servicePinId: service.currentPinId || service.servicePinId || service.pinId || service.id,
      providerGlobalMetaId: service.providerGlobalMetaId || state.current.owner.globalMetaId,
      userTask: userTaskText,
      taskContext: 'Requested from Agent Internet Browser',
      rawRequest: userTaskText,
      confirmed: true
    }
  })
})
```

Do not expose these side-effect calls to iframe content. The Browser modal is the product-level confirmation boundary; the daemon may still return `awaiting_confirmation` for payment-policy cases, and the UI must render that command result rather than assuming the call completed.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/ui/browserPageActions.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/browser/app.ts tests/ui/browserPageActions.test.mjs
git commit -m "feat: add browser trusted actions"
```

## Task 10: Integration Tests And Browser Smoke Verification

**Files:**
- Modify: `tests/daemon/httpServer.test.mjs` only if a small existing aggregate assertion is needed
- Create or modify: `tests/playwright/browser-product-ui.spec.mjs` if Playwright harness is already usable for this repo

- [ ] **Step 1: Run targeted non-browser verification**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/browser/uri.test.mjs tests/config/browserConfig.test.mjs tests/browser/botHomepageResolver.test.mjs tests/browser/metaAppResolver.test.mjs tests/browser/browserResolver.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs tests/daemon/browserUiRoutes.test.mjs tests/ui/browserPageState.test.mjs tests/ui/browserPageRenderers.test.mjs tests/ui/browserPageInspector.test.mjs tests/ui/browserPageActions.test.mjs
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run existing nearby daemon/UI tests**

Run:

```bash
node --test --test-concurrency=1 tests/daemon/metaappRoutes.test.mjs tests/daemon/defaultBotHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
```

Expected: all tests pass. If `tests/daemon/httpServer.test.mjs` becomes too slow for this local check, run the new Browser tests plus `tests/daemon/metaappRoutes.test.mjs` and note the skipped aggregate route file in the final acceptance report.

- [ ] **Step 3: Browser smoke**

Start the local daemon in dev mode only after the targeted tests pass:

```bash
npm run dev:mode -- --restart-daemon
```

Then verify with real HTTP requests:

```bash
curl -sS http://127.0.0.1:24885/browser | head
curl -sS "http://127.0.0.1:24885/api/browser/context" | jq .
DEFAULT_URI=$(curl -sS "http://127.0.0.1:24885/api/browser/context" | jq -r '.data.defaultUri')
curl -sS "http://127.0.0.1:24885/api/browser/resolve?uri=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DEFAULT_URI")" | jq .
```

If the daemon port differs, use the `baseUrl` reported by dev mode or `metabot doctor --host codex`.

Open `/browser` or `/ui/browser` in the in-app Browser and verify:

- Default view shows top bar, content viewport, and minimal status strip only.
- Address bar shows an Agent Internet URI such as `metaid://idq1fixturebot`, not local `/browser`.
- Drawer is hidden until the drawer button is clicked.
- Inspector is hidden until identity/proof/TXID is clicked.
- Current resource owner chip and `Using: My Bot` are visually distinct.
- Bot Page renders from homepage JSON or shows a precise resolver/config error.
- HTML renderer iframe is sandboxed.

- [ ] **Step 4: Commit verification-only test additions**

If Task 10 adds or modifies tests, commit them:

```bash
git add tests/playwright/browser-product-ui.spec.mjs tests/daemon/httpServer.test.mjs
git commit -m "test: cover browser product surface"
```

If Task 10 only runs verification and changes no files, do not create an empty commit.

## Final Acceptance Checklist

- [ ] `/browser` returns the same Agent Internet Browser page as `/ui/browser`.
- [ ] Deep links display decoded Agent Internet URIs in the Browser address bar.
- [ ] A `metaid://idq1fixturebot`-style URI calls `/api/browser/resolve` and renders a Bot Page from `botHomepage.v1` JSON.
- [ ] A `metaapp://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0`-style URI resolves to one of `html-iframe`, `pdf`, `image`, `video`, or `unsupported`.
- [ ] Default UI has no always-visible bookmarks/sidebar.
- [ ] Default UI has no always-visible proof/source panel.
- [ ] Default UI has no tabs named `Rendered`, `Identity`, `Chain Proof`, or `Source`; `Identity`, `Proof`, and `Source` appear only inside Inspector.
- [ ] Current resource identity and using identity are visually distinct.
- [ ] Proof fields use `TXID`, not `TSID`.
- [ ] Inspector opens on demand and shows Identity, Proof, and Source.
- [ ] HTML renderer uses sandboxed iframe or shows a clear renderer error.
- [ ] PDF, image, and video use content-specific renderers.
- [ ] Private chat, service call, copy URI, and proof/source inspection are Browser-owned controls.
- [ ] Browser config is injected/resolved and not hard-coded inside resolver logic.
- [ ] Targeted tests and `npm run build` pass.
