import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { assertBrowserHostConformance } = require('@openagentinternet/agent-browser-test-harness');
const { createOacBrowserHostAdapter } = require('../../dist/daemon/browser/oacBrowserHostAdapter.js');
const { createMetabotProfile, createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const FORGED_LOCAL_GLOBAL_META_ID = 'idq1y3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const METAAPP_PIN_ID = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
const ZIP_PIN_ID = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

async function makeMetaAppZipBuffer(title = 'Adapter Preview App') {
  const projectDir = await mkdtempTempRoot('oac-adapter-metaapp-project-');
  await mkdir(path.join(projectDir, 'app'), { recursive: true });
  await writeFile(path.join(projectDir, 'app', 'index.html'), `<!doctype html><title>${title}</title>`, 'utf8');
  const archiveDir = await mkdtempTempRoot('oac-adapter-metaapp-archive-');
  const archivePath = path.join(archiveDir, 'metaapp.zip');
  await writeMetaAppZipArchive({ sourceDir: projectDir, outFile: archivePath });
  return readFile(archivePath);
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

function bufferResponse(buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/zip' },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

function createEnsNameAliasProviderFactory(options = {}) {
  const aliases = options.aliases ?? {};
  const calls = options.calls ?? [];
  const resolvedAt = options.resolvedAt ?? 1781000000000;

  return (config) => {
    calls.push({
      phase: 'create',
      chainId: config.chainId,
      rpcUrls: [...config.rpcUrls],
      textKey: config.textKey,
    });
    return {
      id: 'ens',
      supportsName(name) {
        return String(name ?? '').toLowerCase().endsWith('.eth');
      },
      async resolveNameAlias(request) {
        const normalizedName = String(request.name ?? '').trim().toLowerCase();
        calls.push({
          phase: 'resolve',
          inputUri: request.inputUri,
          inputScheme: request.inputScheme,
          name: normalizedName,
          rpcUrls: [...config.rpcUrls],
          textKey: config.textKey,
        });
        const canonicalUri = aliases[normalizedName];
        if (!canonicalUri) {
          return {
            ok: false,
            state: 'failed',
            code: 'name_alias_not_found',
            message: 'ENS text record was missing or empty.',
          };
        }
        return {
          ok: true,
          state: 'success',
          data: {
            provider: 'ens',
            normalizedName,
            textKey: config.textKey,
            canonicalUri,
            resolvedAt,
            verificationState: 'partial',
            raw: {
              rpcUrls: [...config.rpcUrls],
            },
          },
        };
      },
    };
  };
}

async function createAdapter(input) {
  return createOacBrowserHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: input.systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: input.env ?? {},
    fetch: input.fetch,
    now: input.now,
    confirmationTtlMs: input.confirmationTtlMs,
    privateChat: input.privateChat,
    serviceCall: input.serviceCall,
    writeMetaIdPin: input.writeMetaIdPin,
    nameAliasProviders: input.nameAliasProviders,
    ensNameAliasProviderFactory: input.ensNameAliasProviderFactory,
    onInfrastructureSettingsUpdated: input.onInfrastructureSettingsUpdated,
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
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ActiveBrowser',
  });
  const other = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Other Browser Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'other-browser-bot'),
    globalMetaId: PEER_GLOBAL_META_ID,
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
  // OAC does not preset defaultUri: /browser lands on the welcome page, not the
  // selected identity's own homepage (matches the ABC standalone host).
  assert.equal(runtime.data.defaultUri, null);
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
        globalMetaId: LOCAL_GLOBAL_META_ID,
        isDefault: false,
        capabilities: ['private-chat', 'service-call', 'message-view', 'template-settings'],
      },
      {
        id: other.slug,
        label: 'Other Browser Bot',
        kind: 'oac-bot',
        globalMetaId: PEER_GLOBAL_META_ID,
        isDefault: true,
        capabilities: ['private-chat', 'service-call', 'message-view', 'template-settings'],
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
  assert.equal(runtime.data.labels.noActorTitle, 'Create your first Bot');
  assert.equal(runtime.data.labels.noActorBody, 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.');
  assert.deepEqual(runtime.data.labels.noActorAction, {
    label: 'Create Bot',
    href: '/ui/bot?mode=create',
  });
  assert.equal(runtime.data.defaultUri, null);
});

test('OAC browser host adapter includes the host hint in first Bot creation links', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-runtime-host-hint');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const badSystemHomeFile = path.join(systemHomeDir, 'not-a-system-home-file');
  await writeFile(badSystemHomeFile, 'not a directory\n', 'utf8');

  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir: badSystemHomeFile,
    env: {
      OAC_HOST: 'codex',
    },
  });

  const runtime = await adapter.getRuntime();

  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.data.labels.noActorAction, {
    label: 'Create Bot',
    href: '/ui/bot?mode=create&host=codex',
  });
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
    capabilities: actor.capabilities,
  })), [
    {
      id: active.slug,
      kind: 'oac-bot',
      globalMetaId: '',
      isDefault: true,
      capabilities: ['template-settings'],
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
  assert.equal(runtime.data.defaultUri, null);
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
  const infrastructureUpdates = [];
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    onInfrastructureSettingsUpdated: async (homeDir) => {
      infrastructureUpdates.push(homeDir);
    },
  });

  const updated = await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test/',
      manApiBaseUrl: 'https://manapi.example.test/',
      botHomepageTemplateId: 'compact-list',
      nameResolution: {
        enabled: true,
        ens: {
          enabled: true,
          rpcUrls: ['https://rpc-one.example.test', 'https://rpc-two.example.test'],
          textKey: 'org.openagentinternet.uri',
        },
      },
    },
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.data.browser.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(updated.data.browser.manApiBaseUrl, 'https://manapi.example.test');
  assert.equal(updated.data.browser.botHomepageTemplateId, 'compact-list');
  assert.deepEqual(updated.data.browser.nameResolution, {
    enabled: true,
    ens: {
      enabled: true,
      chainId: 1,
      rpcUrls: ['https://rpc-one.example.test', 'https://rpc-two.example.test'],
      textKey: 'org.openagentinternet.uri',
    },
  });
  assert.deepEqual(updated.data.effectiveBrowser.nameResolution, {
    enabled: true,
    ens: {
      enabled: true,
      chainId: 1,
      rpcUrls: ['https://rpc-one.example.test', 'https://rpc-two.example.test'],
      textKey: 'org.openagentinternet.uri',
    },
  });

  const configOnDisk = await createConfigStore(active.homeDir).read();
  assert.equal(configOnDisk.browser.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(configOnDisk.browser.manApiBaseUrl, 'https://manapi.example.test');
  assert.equal(configOnDisk.browser.botHomepageTemplateId, 'compact-list');
  assert.deepEqual(infrastructureUpdates, [active.homeDir]);
  assert.deepEqual(configOnDisk.browser.nameResolution, {
    enabled: true,
    ens: {
      enabled: true,
      chainId: 1,
      rpcUrls: ['https://rpc-one.example.test', 'https://rpc-two.example.test'],
      textKey: 'org.openagentinternet.uri',
    },
  });
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

test('OAC browser host adapter resolves bare ENS aliases with Browser nameResolution settings', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-ens-bare-alias');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const ensCalls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'ENS Bare Alias Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1ensbarealias',
    mvcAddress: '18EnsBareAlias',
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
    ensNameAliasProviderFactory: createEnsNameAliasProviderFactory({
      aliases: {
        'sunnyfung.eth': `metaid://${LOCAL_GLOBAL_META_ID}`,
      },
      calls: ensCalls,
    }),
  });

  await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      botHomepageTemplateId: 'compact-list',
      nameResolution: {
        enabled: true,
        ens: {
          enabled: true,
          rpcUrls: ['https://rpc.example'],
          textKey: 'org.openagentinternet.uri',
        },
      },
    },
  });
  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: 'sunnyfung.eth',
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.uri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.normalizedUri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.renderer.type, 'bot-page');
  assert.equal(resolved.data.renderer.templateId, 'compact-list');
  assert.equal(resolved.data.source.raw.nameAlias.aliasUri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.source.raw.nameAlias.canonicalUri, `metaid://${LOCAL_GLOBAL_META_ID}`);
  assert.deepEqual(ensCalls, [
    {
      phase: 'create',
      chainId: 1,
      rpcUrls: ['https://rpc.example'],
      textKey: 'org.openagentinternet.uri',
    },
    {
      phase: 'resolve',
      inputUri: 'metaid://sunnyfung.eth',
      inputScheme: 'metaid',
      name: 'sunnyfung.eth',
      rpcUrls: ['https://rpc.example'],
      textKey: 'org.openagentinternet.uri',
    },
  ]);
});

test('OAC browser host adapter resolves metaid ENS aliases while preserving the alias URI', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-ens-metaid-alias');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'ENS MetaID Alias Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1ensmetaidalias',
    mvcAddress: '18EnsMetaIDAlias',
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
    ensNameAliasProviderFactory: createEnsNameAliasProviderFactory({
      aliases: {
        'sunnyfung.eth': `metaid://${LOCAL_GLOBAL_META_ID}`,
      },
    }),
  });

  await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      nameResolution: {
        enabled: true,
        ens: {
          enabled: true,
          rpcUrls: ['https://rpc.example'],
          textKey: 'org.openagentinternet.uri',
        },
      },
    },
  });
  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: 'metaid://sunnyfung.eth',
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.uri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.normalizedUri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.actions.find((action) => action.kind === 'copy')?.uri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.source.raw.nameAlias.aliasUri, 'metaid://sunnyfung.eth');
  assert.equal(resolved.data.source.raw.nameAlias.canonicalUri, `metaid://${LOCAL_GLOBAL_META_ID}`);
});

test('OAC browser host adapter returns name_resolution_unavailable when ENS resolution is disabled', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-ens-disabled');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const ensCalls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'ENS Disabled Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1ensdisabledbot',
    mvcAddress: '18EnsDisabled',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    ensNameAliasProviderFactory: createEnsNameAliasProviderFactory({
      aliases: {
        'sunnyfung.eth': `metaid://${LOCAL_GLOBAL_META_ID}`,
      },
      calls: ensCalls,
    }),
  });

  await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      nameResolution: {
        enabled: true,
        ens: {
          enabled: false,
          rpcUrls: ['https://rpc.example'],
          textKey: 'org.openagentinternet.uri',
        },
      },
    },
  });
  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: 'metaid://sunnyfung.eth',
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'name_resolution_unavailable');
  assert.deepEqual(ensCalls, []);
});

test('OAC browser host adapter returns name_resolution_unavailable when ENS rpcUrls are explicitly empty', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-ens-empty-rpc');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const ensCalls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'ENS Empty RPC Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1ensemptyrpcbot',
    mvcAddress: '18EnsEmptyRpc',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    ensNameAliasProviderFactory: createEnsNameAliasProviderFactory({
      aliases: {
        'sunnyfung.eth': `metaid://${LOCAL_GLOBAL_META_ID}`,
      },
      calls: ensCalls,
    }),
  });

  await adapter.updateSettings({
    actorId: active.slug,
    browser: {
      nameResolution: {
        enabled: true,
        ens: {
          enabled: true,
          rpcUrls: [],
          textKey: 'org.openagentinternet.uri',
        },
      },
    },
  });
  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: 'metaid://sunnyfung.eth',
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'name_resolution_unavailable');
  assert.deepEqual(ensCalls, []);
});

test('OAC browser host adapter resolves zip-backed metaapp URIs to local preview assets', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-metaapp-preview');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const zipBuffer = await makeMetaAppZipBuffer();

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'MetaApp Preview Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1metaapppreview',
    mvcAddress: '18MetaAppPreview',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    fetch: async (url) => {
      if (url === `https://manapi.metaid.io/pin/${METAAPP_PIN_ID}`) {
        return jsonResponse({
          data: {
            id: METAAPP_PIN_ID,
            path: '/protocols/metaapp',
            address: '1PublisherAddress',
            timestamp: 1780833765,
            contentSummary: JSON.stringify({
              title: 'Adapter Preview App',
              appName: 'adapter-preview-app',
              version: '1.2.3',
              runtime: 'browser',
              content: `metafile://${ZIP_PIN_ID}.zip`,
              contentType: 'application/zip',
              indexFile: 'index.html',
            }),
          },
        });
      }
      if (url === `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/${ZIP_PIN_ID}`) {
        return bufferResponse(zipBuffer);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  });

  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: `metaapp://${METAAPP_PIN_ID}`,
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'metaapp');
  assert.equal(resolved.data.renderer.type, 'html-iframe');
  assert.match(resolved.data.renderer.url, /^\/api\/metaapp\/preview-assets\/metaapp-preview-[^/]+\/index\.html$/);
});

test('OAC browser host adapter satisfies the published host conformance harness', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-conformance');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Conformance Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1conformancebot',
    mvcAddress: '18ConformanceBot',
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

test('OAC browser host adapter maps resolved Bot pages to BrowserResolveResult actions', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-envelope');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Envelope Adapter Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1envelopeadapter',
    mvcAddress: '18EnvelopeAdapter',
  });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  fixture.actions = fixture.actions.map((action) => action.id === 'message'
    ? {
        ...action,
        payload: {
          targetGlobalMetaId: 'idq1fixturebot',
        },
      }
    : action);
  fixture.actions.push({
    id: 'service-call-current',
    label: 'Request Fixture Review',
    kind: 'service-call',
    enabled: true,
    serviceId: 'service-current-pin',
    payload: {
      providerGlobalMetaId: 'idq1fixturebot',
    },
  });
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
  assert.deepEqual(resolved.data.owner, {
    kind: 'bot',
    globalMetaId: 'idq1fixturebot',
    metaid: 'metaid-fixture',
    address: '18FixtureAddress',
    name: 'Fixture Bot',
    avatar: 'https://so.example.test/content/avatar-pin',
    online: true,
    verificationState: 'partial',
  });
  const privateChat = resolved.data.actions.find((action) => action.kind === 'private-chat');
  assert.deepEqual(privateChat, {
    id: 'message',
    label: 'Message',
    kind: 'private-chat',
    enabled: true,
    requiresUsingIdentity: true,
    payload: {
      targetGlobalMetaId: 'idq1fixturebot',
    },
  });

  const serviceCall = resolved.data.actions.find((action) => action.kind === 'service-call');
  assert.deepEqual(serviceCall, {
    id: 'service-call-current',
    label: 'Request Fixture Review',
    kind: 'service-call',
    enabled: true,
    serviceId: 'service-current-pin',
    payload: {
      providerGlobalMetaId: 'idq1fixturebot',
    },
  });

  const copyUri = resolved.data.actions.find((action) => action.kind === 'copy');
  assert.deepEqual(copyUri, {
    id: 'copy-uri',
    label: 'Copy URI',
    kind: 'copy',
    enabled: true,
    uri: 'metaid://idq1fixturebot',
  });
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
  assert.equal(result.data.data, undefined);
  assert.deepEqual(calls, [{
    from: active.slug,
    to: 'idq1target',
    content: 'Hello from Browser',
  }]);
});

test('OAC browser host adapter keeps copy-uri actor-agnostic', async () => {
  const adapter = await createAdapter({
    homeDir: '/tmp/oac-browser-copy-uri',
    systemHomeDir: '/tmp/oac-browser-copy-uri-system',
  });

  const result = await adapter.runTrustedAction({
    actorId: 'missing',
    resourceUri: 'metaapp://fixture',
    kind: 'copy-uri',
    payload: {
      currentUri: 'metaapp://fixture',
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    kind: 'copy-uri',
    handled: true,
    data: {
      copiedText: 'metaapp://fixture',
    },
  });
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

test('OAC browser host adapter preserves non-terminal service-call command states', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-waiting-action');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Waiting Adapter Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1waitingadapter',
    mvcAddress: '18WaitingAdapter',
  });
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    serviceCall: async (input) => {
      const userTask = input.request?.userTask;
      if (userTask === 'Use route fallback') {
        return {
          ok: false,
          state: 'waiting',
          code: 'order_sent_awaiting_provider',
          message: 'Order sent. Waiting for response...',
          pollAfterMs: 3000,
          data: { traceId: 'trace waiting/route' },
        };
      }
      if (userTask === 'Needs manual action') {
        return {
          ok: false,
          state: 'manual_action_required',
          code: 'service_call_needs_confirmation',
          message: 'Confirm the service request in the trace view.',
          localUiUrl: '/ui/trace?traceId=trace-manual',
          data: { traceId: 'trace-manual' },
        };
      }
      return {
        ok: false,
        state: 'waiting',
        code: 'order_sent_awaiting_provider',
        message: 'Order sent. Waiting for response...',
        pollAfterMs: 3000,
        localUiUrl: '/ui/trace?traceId=trace-waiting',
        data: { traceId: 'trace-waiting' },
      };
    },
  });

  const withHref = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Use local UI URL',
    },
  });

  assert.equal(withHref.ok, false);
  assert.equal(withHref.state, 'waiting');
  assert.equal(withHref.code, 'order_sent_awaiting_provider');
  assert.match(withHref.message, /^Order sent\. Waiting for response/);
  assert.deepEqual(withHref.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-waiting',
  });
  assert.deepEqual(withHref.data, { traceId: 'trace-waiting' });

  const withRoute = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Use route fallback',
    },
  });

  assert.equal(withRoute.ok, false);
  assert.equal(withRoute.state, 'waiting');
  assert.equal(withRoute.code, 'order_sent_awaiting_provider');
  assert.match(withRoute.message, /^Order sent\. Waiting for response/);
  assert.deepEqual(withRoute.data, { traceId: 'trace waiting/route' });

  const manualAction = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Needs manual action',
    },
  });

  assert.equal(manualAction.ok, false);
  assert.equal(manualAction.state, 'manual_action_required');
  assert.equal(manualAction.code, 'service_call_needs_confirmation');
  assert.match(manualAction.message, /^Confirm the service request/);
  assert.deepEqual(manualAction.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-manual',
  });
  assert.deepEqual(manualAction.data, { traceId: 'trace-manual' });
});

test('OAC browser host adapter maps owner trusted actions to Bot management routes', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-owner-actions');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Active Owner Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1activeowner',
    mvcAddress: '18ActiveOwner',
  });
  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Alice Owner Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'alice'),
    globalMetaId: 'idq1alice',
    mvcAddress: '18AliceOwner',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const cases = [
    ['edit-profile', '/ui/bot?profile=alice&tab=info&focus=profile'],
    ['configure-chat', '/ui/bot?profile=alice&tab=info&focus=chat'],
    ['view-messages', '/ui/bot?profile=alice&tab=history&focus=messages'],
  ];

  for (const [kind, href] of cases) {
    const result = await adapter.runTrustedAction({
      actorId: active.slug,
      resourceUri: 'metaid://idq1alice',
      kind,
      payload: {
        ownerActorId: 'alice',
        ownerGlobalMetaId: 'idq1alice',
        currentUri: 'metaid://idq1alice',
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      kind,
      handled: true,
      data: { href },
    });
  }
});

test('OAC browser host adapter rejects owner trusted actions with unknown owner actors', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-owner-action-missing');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Missing Owner Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1missingowner',
    mvcAddress: '18MissingOwner',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1missing',
    kind: 'edit-profile',
    payload: {
      ownerActorId: 'missing-owner',
      ownerGlobalMetaId: 'idq1missing',
      currentUri: 'metaid://idq1missing',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'profile_not_found');
});

test('OAC browser host adapter reports owner profile list failures separately from missing owner', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-owner-action-list-failure');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const badSystemHomeFile = path.join(systemHomeDir, 'not-a-system-home-file');
  await writeFile(badSystemHomeFile, 'not a directory\n', 'utf8');

  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir: badSystemHomeFile,
  });

  const result = await adapter.runTrustedAction({
    resourceUri: 'metaid://idq1alice',
    kind: 'edit-profile',
    payload: {
      ownerActorId: 'alice',
      ownerGlobalMetaId: 'idq1alice',
      currentUri: 'metaid://idq1alice',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_profile_list_failed');
});

test('OAC browser host adapter rejects owner actions without ownerActorId even when actorId exists in payload', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-owner-action-no-owner-actor');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Active Owner Fallback Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1activefallback',
    mvcAddress: '18ActiveFallback',
  });
  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Alice Owner Fallback Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'alice'),
    globalMetaId: 'idq1alicefallback',
    mvcAddress: '18AliceFallback',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1alicefallback',
    kind: 'edit-profile',
    payload: {
      actorId: 'alice',
      ownerGlobalMetaId: 'idq1alicefallback',
      currentUri: 'metaid://idq1alicefallback',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_browser_action');
});

test('OAC browser host adapter returns safe local conversation href for open-conversation', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-open-conversation');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Conversation Action Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ConversationAction',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      href: 'https://attacker.example/steal',
      localGlobalMetaId: FORGED_LOCAL_GLOBAL_META_ID,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    kind: 'open-conversation',
    handled: true,
    data: {
      href: `/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`,
    },
  });
});

test('OAC browser host adapter rejects open-conversation without peerGlobalMetaId', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-open-conversation-no-peer');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Conversation Missing Peer Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ConversationMissingPeer',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'map://simplemsg/conversation',
    kind: 'open-conversation',
    payload: {
      conversationUri: 'map://simplemsg/conversation',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'invalid_browser_action');
});

test('OAC browser host adapter requires a selected actor with a Global MetaID for open-conversation', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-open-conversation-no-local');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfile(systemHomeDir, {
    name: 'Conversation Pending Bot',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'browser_identity_required');
});

test('OAC browser host adapter previews metaid-pin-write through manual confirmation before signing', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-preview');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Pin Preview Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18PinPreview',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'pin-preview', txid: 'tx-preview' } };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json;utf-8',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
      display: { title: 'Publish post', summary: 'hello' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'manual_action_required');
  assert.deepEqual(calls, []);
  assert.deepEqual(result.data.confirmation.actor, {
    uri: `metaid://${LOCAL_GLOBAL_META_ID}`,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    name: 'Pin Preview Bot',
  });
  assert.deepEqual(result.data.confirmation.display, {
    title: 'Publish post',
    summary: 'hello',
  });
  assert.equal(result.data.confirmation.operation, 'create');
  assert.equal(result.data.confirmation.path, '/protocols/simplebuzz');
  assert.equal(result.data.confirmation.contentType, 'application/json;utf-8');
  assert.equal(result.data.confirmation.payloadSize, Buffer.byteLength('{"content":"hello"}', 'utf8'));
  assert.equal(result.data.confirmRequest.kind, 'metaid-pin-write');
  assert.equal(result.data.confirmRequest.payload.confirmed, true);
  assert.equal(typeof result.data.confirmation.confirmationId, 'string');
  assert.equal(typeof result.data.confirmation.expiresAt, 'number');
  assert.deepEqual(
    Object.keys(result.data.confirmRequest.payload.hostConfirmation).sort(),
    ['id', 'token'],
  );
  assert.equal(result.data.confirmRequest.payload.hostConfirmation.id, result.data.confirmation.confirmationId);
});

test('OAC browser host adapter rejects invalid metaid-pin-write payloads before signer access', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-invalid');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Invalid Pin Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18InvalidPin',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'should-not-write', txid: 'tx' } };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'create',
      path: '',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_params');
  assert.deepEqual(calls, []);
});

test('OAC browser host adapter rejects forged metaid-pin-write confirmation before signer access', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-forged-confirm');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Forged Pin Confirm Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ForgedPinConfirm',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'forged-pin', txid: 'forged-tx' } };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
      confirmed: true,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'manual_action_required');
  assert.deepEqual(calls, []);
});

test('OAC browser host adapter confirms metaid-pin-write with host-owned state and sanitized result data', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-confirm');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Pin Confirm Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18PinConfirm',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: 'pin-confirm',
          txid: 'tx-confirm',
          operation: input.request.operation,
          path: input.request.path,
          actor: {
            uri: `metaid://${LOCAL_GLOBAL_META_ID}`,
            globalMetaId: LOCAL_GLOBAL_META_ID,
            name: 'Pin Confirm Bot',
          },
          explorerUrl: 'https://explorer.example/tx-confirm',
          wallet: { address: '18PinConfirm' },
          route: '/api/internal/secret',
        },
      };
    },
  });

  const preview = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json;utf-8',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
    },
  });
  assert.equal(preview.ok, false);
  assert.equal(preview.state, 'manual_action_required');
  assert.deepEqual(calls, []);

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: preview.data.confirmRequest.resourceUri,
    kind: preview.data.confirmRequest.kind,
    payload: preview.data.confirmRequest.payload,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.kind, 'metaid-pin-write');
  assert.equal(result.data.handled, true);
  assert.deepEqual(calls.map((call) => ({
    actorId: call.actorId,
    resourceUri: call.resourceUri,
    request: call.request,
  })), [{
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    request: {
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json;utf-8',
      encoding: 'utf-8',
      payload: '{"content":"hello"}',
    },
  }]);
  assert.deepEqual(result.data.data, {
    pinId: 'pin-confirm',
    txid: 'tx-confirm',
    operation: 'create',
    path: '/protocols/simplebuzz',
    actor: {
      uri: `metaid://${LOCAL_GLOBAL_META_ID}`,
      globalMetaId: LOCAL_GLOBAL_META_ID,
      name: 'Pin Confirm Bot',
    },
  });
});

test('OAC browser host adapter rejects reused mismatched and expired metaid-pin-write confirmations', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-confirm-guard');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];
  let now = 1_000;

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Pin Confirm Guard Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18PinConfirmGuard',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    now: () => now,
    confirmationTtlMs: 500,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: `pin-guard-${calls.length}`,
          txid: `tx-guard-${calls.length}`,
          operation: input.request.operation,
          path: input.request.path,
          actor: {
            uri: `metaid://${LOCAL_GLOBAL_META_ID}`,
            globalMetaId: LOCAL_GLOBAL_META_ID,
            name: 'Pin Confirm Guard Bot',
          },
        },
      };
    },
  });

  const payload = {
    operation: 'create',
    path: '/protocols/simplebuzz',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: { encoding: 'utf8', value: '{"content":"hello"}' },
  };

  const reusablePreview = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload,
  });
  const firstConfirm = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: reusablePreview.data.confirmRequest.resourceUri,
    kind: reusablePreview.data.confirmRequest.kind,
    payload: reusablePreview.data.confirmRequest.payload,
  });
  assert.equal(firstConfirm.ok, true);

  const reusedConfirm = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: reusablePreview.data.confirmRequest.resourceUri,
    kind: reusablePreview.data.confirmRequest.kind,
    payload: reusablePreview.data.confirmRequest.payload,
  });
  assert.equal(reusedConfirm.ok, false);
  assert.equal(reusedConfirm.code, 'manual_action_required');

  const mismatchPreview = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload,
  });
  const mismatchedConfirm = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: mismatchPreview.data.confirmRequest.resourceUri,
    kind: mismatchPreview.data.confirmRequest.kind,
    payload: {
      ...mismatchPreview.data.confirmRequest.payload,
      contentType: 'text/plain',
    },
  });
  assert.equal(mismatchedConfirm.ok, false);
  assert.equal(mismatchedConfirm.code, 'manual_action_required');

  const expiredPreview = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload,
  });
  now += 1_000;
  const expiredConfirm = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: expiredPreview.data.confirmRequest.resourceUri,
    kind: expiredPreview.data.confirmRequest.kind,
    payload: expiredPreview.data.confirmRequest.payload,
  });
  assert.equal(expiredConfirm.ok, false);
  assert.equal(expiredConfirm.code, 'manual_action_required');
  assert.equal(calls.length, 1);
});

test('OAC browser host adapter treats create modify and revoke as peer metaid-pin-write operations', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-operations');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const requests = [];
  const targetPinId = `${'a'.repeat(64)}i0`;

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Pin Operations Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18PinOperations',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      requests.push(input.request);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: `${input.request.operation}-pin`,
          txid: `${input.request.operation}-tx`,
          operation: input.request.operation,
          path: input.request.path,
          actor: {
            uri: `metaid://${LOCAL_GLOBAL_META_ID}`,
            globalMetaId: LOCAL_GLOBAL_META_ID,
            name: 'Pin Operations Bot',
          },
        },
      };
    },
  });

  for (const operation of ['create', 'modify', 'revoke']) {
    const pathValue = operation === 'create' ? '/protocols/simplebuzz' : `@${targetPinId}`;
    const initial = await adapter.runTrustedAction({
      actorId: active.slug,
      resourceUri: 'metaapp://bridge-app',
      kind: 'metaid-pin-write',
      payload: {
        operation,
        path: pathValue,
        encryption: '0',
        version: '1.0.0',
        contentType: 'application/json',
        payload: { encoding: 'utf8', value: '{"content":"hello"}' },
        appAction: `${operation}-from-app`,
        ...(operation === 'create' ? {} : { originalId: targetPinId }),
      },
    });
    assert.equal(initial.ok, false);
    assert.equal(initial.state, 'manual_action_required');

    const result = await adapter.runTrustedAction({
      actorId: active.slug,
      resourceUri: initial.data.confirmRequest.resourceUri,
      kind: initial.data.confirmRequest.kind,
      payload: initial.data.confirmRequest.payload,
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.data.operation, operation);
  }

  assert.deepEqual(requests.map((request) => ({
    operation: request.operation,
    path: request.path,
    originalId: request.originalId,
    appAction: request.appAction,
  })), [
    {
      operation: 'create',
      path: '/protocols/simplebuzz',
      originalId: undefined,
      appAction: 'create-from-app',
    },
    {
      operation: 'modify',
      path: `@${targetPinId}`,
      originalId: targetPinId,
      appAction: 'modify-from-app',
    },
    {
      operation: 'revoke',
      path: `@${targetPinId}`,
      originalId: targetPinId,
      appAction: 'revoke-from-app',
    },
  ]);
});

test('OAC browser host adapter validates modify and revoke target pins explicitly', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-target-validation');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Pin Target Validation Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18PinTargetValidation',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'pin-target', txid: 'tx-target' } };
    },
  });

  const wrongPath = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'modify',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
      originalId: `${'b'.repeat(64)}i0`,
    },
  });
  assert.equal(wrongPath.ok, false);
  assert.equal(wrongPath.code, 'invalid_params');

  const mismatchedOriginalId = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'revoke',
      path: `@${'c'.repeat(64)}i0`,
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json',
      payload: { encoding: 'utf8', value: '' },
      originalId: `${'d'.repeat(64)}i0`,
    },
  });
  assert.equal(mismatchedOriginalId.ok, false);
  assert.equal(mismatchedOriginalId.code, 'invalid_params');
  assert.deepEqual(calls, []);
});

test('OAC browser host adapter requires a chain-backed actor for metaid-pin-write', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-pin-no-actor');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const calls = [];

  const active = await createMetabotProfile(systemHomeDir, {
    name: 'Pending Pin Bot',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    writeMetaIdPin: async (input) => {
      calls.push(input);
      return { ok: true, state: 'success', data: { pinId: 'pin', txid: 'tx' } };
    },
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metaid-pin-write',
    payload: {
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0.0',
      contentType: 'application/json',
      payload: { encoding: 'utf8', value: '{"content":"hello"}' },
      confirmed: true,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'actor_required');
  assert.deepEqual(calls, []);
});

test('OAC browser host adapter explicitly rejects metafile-upload until a host picker exists', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-metafile-upload');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Metafile Upload Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18MetafileUpload',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaapp://bridge-app',
    kind: 'metafile-upload',
    payload: {
      source: { kind: 'host-picker', multiple: true },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_method');
  assert.doesNotMatch(result.message, /\/Users\/|\.metabot|\/api\//);
});

test('OAC browser host adapter ignores payload local identity fields for open-conversation', async (t) => {
  const profileHome = await createProfileHome('oac-browser-adapter-open-conversation-ignore-local');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Conversation Ignore Local Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ConversationIgnoreLocal',
  });
  const adapter = await createAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      localGlobalMetaId: FORGED_LOCAL_GLOBAL_META_ID,
      from: FORGED_LOCAL_GLOBAL_META_ID,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.data.href, `/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`);
  assert.ok(!result.data.data.href.includes(FORGED_LOCAL_GLOBAL_META_ID));
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
