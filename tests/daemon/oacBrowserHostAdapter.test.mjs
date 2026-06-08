import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createOacBrowserHostAdapter } = require('../../dist/daemon/browser/oacBrowserHostAdapter.js');
const { createMetabotProfile, createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
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
    privateChat: input.privateChat,
    serviceCall: input.serviceCall,
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
  assert.equal(runtime.data.host.localMode, true);
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
      capabilities: actor.capabilities,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: active.slug,
        label: 'Active Browser Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1activebrowser',
        isDefault: false,
        capabilities: ['private-chat', 'service-call', 'template-settings'],
      },
      {
        id: other.slug,
        label: 'Other Browser Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1otherbrowser',
        isDefault: true,
        capabilities: ['private-chat', 'service-call', 'template-settings'],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('OAC browser host adapter returns an empty runtime when profiles cannot be listed', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-runtime-empty');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const badSystemHomeFile = path.join(systemHomeDir, 'not-a-system-home-file');
  await writeFile(badSystemHomeFile, 'not a directory\n', 'utf8');

  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir: badSystemHomeFile,
  });

  const runtime = await adapter.getRuntime();
  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.data.actors, []);
  assert.equal(runtime.data.defaultActor, null);
  assert.equal(runtime.data.defaultUri, null);
});

test('OAC browser host adapter keeps local OAC actors without a globalMetaId', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pending-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfile(systemHomeDir, {
    name: 'Pending Browser Bot',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const runtime = await adapter.getRuntime();
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data.defaultActor.id, active.slug);
  assert.equal(runtime.data.defaultActor.globalMetaId, '');
  assert.equal(runtime.data.defaultUri, null);
  assert.deepEqual(runtime.data.actors.map((actor) => ({
    id: actor.id,
    kind: actor.kind,
    globalMetaId: actor.globalMetaId,
    isDefault: actor.isDefault,
  })), [
    {
      id: active.slug,
      kind: 'oac-bot',
      globalMetaId: '',
      isDefault: true,
    },
  ]);
});

test('OAC browser host adapter gives actorId precedence over legacy from', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-actor-precedence');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Active Precedence Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1activeprecedence',
    mvcAddress: '18ActivePrecedence',
  });
  const other = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Other Precedence Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'other-precedence-bot'),
    globalMetaId: 'idq1otherprecedence',
    mvcAddress: '18OtherPrecedence',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const runtime = await adapter.getRuntime({ actorId: other.slug, from: active.slug });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data.defaultActor.id, other.slug);
  assert.equal(runtime.data.defaultUri, `metaid://${other.globalMetaId}`);
});

test('OAC browser host adapter returns profile_not_found for unknown runtime actor', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-missing-actor');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Known Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1knownbrowser',
    mvcAddress: '18KnownBrowser',
  });
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
  });

  const runtime = await adapter.getRuntime({ actorId: 'missing-browser-bot' });
  assert.equal(runtime.ok, false);
  assert.equal(runtime.code, 'profile_not_found');
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

test('OAC browser host adapter maps private chat trusted actions to OAC chat input', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-private-action');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Private Action Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1privateaction',
    mvcAddress: '18PrivateAction',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    privateChat: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'chat-pin' } };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1target',
    kind: 'private-chat',
    payload: {
      to: 'idq1target',
      content: 'Hello from Browser',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.kind, 'private-chat');
  assert.equal(result.data.handled, true);
  assert.deepEqual(result.data.data, { pinId: 'chat-pin' });
  assert.deepEqual(calls, [{
    from: active.slug,
    to: 'idq1target',
    content: 'Hello from Browser',
  }]);
});

test('OAC browser host adapter maps service trusted actions to OAC service input', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-service-action');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Service Action Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1serviceaction',
    mvcAddress: '18ServiceAction',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    serviceCall: async (input) => {
      calls.push(input);
      return {
        ok: false,
        state: 'waiting',
        code: 'order_sent_awaiting_provider',
        message: 'Order sent to provider. Waiting for response...',
        pollAfterMs: 3000,
        data: { traceId: 'trace-1' },
      };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1target',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Review this payload',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.equal(result.code, 'order_sent_awaiting_provider');
  assert.deepEqual(calls, [{
    from: active.slug,
    request: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Review this payload',
      taskContext: 'Requested from Agent Internet Browser',
      rawRequest: 'Review this payload',
      confirmed: true,
    },
  }]);
});

test('OAC browser host adapter rejects incomplete trusted action payloads', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-invalid-action');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Invalid Action Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1invalidaction',
    mvcAddress: '18InvalidAction',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const missingPrivateChatContent = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1target',
    kind: 'private-chat',
    payload: {
      to: 'idq1target',
    },
  });
  assert.equal(missingPrivateChatContent.ok, false);
  assert.equal(missingPrivateChatContent.code, 'invalid_browser_action');

  const unsupported = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1target',
    kind: 'login',
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, 'browser_action_not_supported');
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

  const clearAll = await adapter.clearCache({
    actorId: active.slug,
    scope: 'all',
  });
  assert.equal(clearAll.ok, true);
  assert.equal(clearAll.data.clearedArtifacts, 0);
  assert.equal(clearAll.data.clearedPinRecords, 0);
});
