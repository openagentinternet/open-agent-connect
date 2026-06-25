import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createMetabotProfile, createMetabotProfileFromIdentity } = require('../../dist/core/bot/metabotProfileManager.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');

test('Browser context defaults to the active local Bot and can switch using identity by slug', async (t) => {
  const profileHome = await createProfileHome('browser-default-context');
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
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const defaultContext = await handlers.browser.getContext({});
  assert.equal(defaultContext.ok, true);
  assert.equal(defaultContext.data.defaultUsingIdentity.slug, active.slug);
  // OAC does not preset defaultUri: /browser shows the welcome page, not the
  // selected identity's own homepage (matches the ABC standalone host).
  assert.equal(defaultContext.data.defaultUri, null);

  const selectedContext = await handlers.browser.getContext({ from: other.slug });
  assert.equal(selectedContext.ok, true);
  assert.equal(selectedContext.data.defaultUsingIdentity.slug, other.slug);
  assert.equal(selectedContext.data.defaultUri, null);
});

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

test('Browser context keeps local OAC Bots without a globalMetaId in legacy identities', async (t) => {
  const profileHome = await createProfileHome('browser-pending-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfile(systemHomeDir, {
    name: 'Pending Browser Bot',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const context = await handlers.browser.getContext({});
  assert.equal(context.ok, true);
  assert.deepEqual(context.data.usingIdentities, [
    {
      slug: active.slug,
      name: 'Pending Browser Bot',
      globalMetaId: '',
      isDefault: true,
    },
  ]);
  assert.equal(context.data.defaultUsingIdentity, null);
  assert.equal(context.data.defaultUri, null);
});

test('Browser runtime uses host contract data while context keeps legacy identities', async (t) => {
  const profileHome = await createProfileHome('browser-runtime-context-split');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Runtime Split Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1runtimesplit',
    mvcAddress: '18RuntimeSplit',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const runtime = await handlers.browser.getRuntime({ from: active.slug });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.state, 'success');
  assert.equal(runtime.data.defaultActor.id, active.slug);
  assert.equal(runtime.data.defaultActor.globalMetaId, 'idq1runtimesplit');
  assert.equal(runtime.data.usingIdentities, undefined);

  const context = await handlers.browser.getContext({ from: active.slug });
  assert.equal(context.ok, true);
  assert.equal(context.state, 'success');
  assert.equal(context.data.defaultUsingIdentity.slug, active.slug);
  assert.equal(context.data.usingIdentities[0].globalMetaId, 'idq1runtimesplit');
  assert.equal(context.data.defaultActor, undefined);
});

test('Browser settings expose and persist browser base URL configuration by active Bot', async (t) => {
  const profileHome = await createProfileHome('browser-settings');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Browser Settings Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1browsersettings',
    mvcAddress: '18BrowserSettings',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const defaults = await handlers.browser.getSettings({ from: active.slug });
  assert.equal(defaults.ok, true);
  assert.equal(defaults.data.browser.manApiBaseUrl, 'https://manapi.metaid.io');
  assert.equal(defaults.data.browser.botHomepageTemplateId, 'document');
  assert.equal(defaults.data.effectiveBrowser.manApiBaseUrl, 'https://manapi.metaid.io');
  assert.equal(defaults.data.effectiveBrowser.botHomepageTemplateId, 'document');

  const invalidTemplate = await handlers.browser.updateSettings({
    from: active.slug,
    browser: {
      botHomepageTemplateId: 'missing-template',
    },
  });
  assert.equal(invalidTemplate.ok, false);
  assert.equal(invalidTemplate.code, 'invalid_argument');

  const updated = await handlers.browser.updateSettings({
    from: active.slug,
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
