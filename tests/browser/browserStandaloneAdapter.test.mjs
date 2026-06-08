import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createStandaloneBrowserHostAdapter } = require('../../dist/browser/standalone/adapter.js');

test('standalone Browser adapter reports a wallet-style runtime actor', async () => {
  const adapter = createStandaloneBrowserHostAdapter();
  const result = await adapter.getRuntime();

  assert.equal(result.ok, true);
  assert.equal(result.data.host.kind, 'standalone');
  assert.equal(result.data.host.localMode, false);
  assert.equal(result.data.defaultActor.kind, 'wallet');
  assert.equal(result.data.defaultActor.id, 'standalone-wallet');
  assert.deepEqual(result.data.defaultActor.capabilities, ['template-settings']);
  assert.equal(result.data.features.privateChat, false);
  assert.equal(result.data.features.serviceCall, false);
  assert.equal(result.data.features.cacheManagement, true);
});

test('standalone Browser adapter keeps settings in memory', async () => {
  const adapter = createStandaloneBrowserHostAdapter();

  const before = await adapter.getSettings({ actorId: 'standalone-wallet' });
  assert.equal(before.ok, true);
  assert.equal(before.data.effectiveBrowser.botHomepageTemplateId, 'document');
  assert.equal(before.data.effectiveBrowser.localMode, false);

  const updated = await adapter.updateSettings({
    actorId: 'standalone-wallet',
    browser: {
      botHomepageTemplateId: 'compact-list',
      metasoP2PBaseUrl: 'https://so.example.test/',
    },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.effectiveBrowser.botHomepageTemplateId, 'compact-list');
  assert.equal(updated.data.effectiveBrowser.metasoP2PBaseUrl, 'https://so.example.test');

  const after = await adapter.getSettings({ actorId: 'standalone-wallet' });
  assert.equal(after.data.effectiveBrowser.botHomepageTemplateId, 'compact-list');
});

test('standalone Browser adapter exposes in-memory cache stats and validates clear scope', async () => {
  const adapter = createStandaloneBrowserHostAdapter({ now: () => 1780840000000 });

  const stats = await adapter.getCache({ actorId: 'standalone-wallet' });
  assert.equal(stats.ok, true);
  assert.equal(stats.data.cacheRoot, 'standalone-memory');
  assert.equal(stats.data.artifactCount, 0);

  const invalid = await adapter.clearCache({ actorId: 'standalone-wallet', scope: 'unknown' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid_argument');

  const cleared = await adapter.clearCache({ actorId: 'standalone-wallet', scope: 'all' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.clearedArtifacts, 0);
  assert.equal(cleared.data.clearedPinRecords, 0);
  assert.equal(cleared.data.lastClearedAt, 1780840000000);
});

test('standalone Browser adapter resolves metaid resources with public Browser resolver', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const calls = [];
  const adapter = createStandaloneBrowserHostAdapter({
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, message: '', data: fixture }),
      };
    },
  });

  const result = await adapter.resolveResource({
    actorId: 'standalone-wallet',
    uri: 'metaid://idq1fixturebot',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.resourceType, 'bot');
  assert.equal(result.data.renderer.type, 'bot-page');
  assert.equal(result.data.title, 'Fixture Bot');
  assert.match(calls[0], /^https:\/\/so\.metaid\.io\/api\/bot-homepage\/globalmetaid\/idq1fixturebot/);
});

test('standalone Browser adapter fails closed for trusted host actions', async () => {
  const adapter = createStandaloneBrowserHostAdapter();

  for (const kind of ['private-chat', 'service-call', 'login']) {
    const result = await adapter.runTrustedAction({
      actorId: 'standalone-wallet',
      resourceUri: 'metaid://idq1fixturebot',
      kind,
      payload: {
        servicePinId: 'service-pin',
        providerGlobalMetaId: 'provider',
        userTask: 'Run it',
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'browser_action_not_supported');
  }
});
