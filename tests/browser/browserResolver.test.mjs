import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveBrowserResource } = require('../../dist/core/browser/browserResolver.js');

const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const MAP_PIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0';

function browserConfig(overrides = {}) {
  return {
    metasoP2PBaseUrl: 'https://so.example.test',
    manApiBaseUrl: 'https://man.example.test',
    metafileContentBaseUrl: 'https://file.example.test',
    botHomepageTemplateId: 'document',
    defaultChainName: 'mvc',
    localMode: true,
    ...overrides,
  };
}

test('resolveBrowserResource fails closed when metaso-p2p URL is missing for metaid URI', async () => {
  const result = await resolveBrowserResource({
    uri: 'metaid://idq1missingconfig',
    config: browserConfig({ metasoP2PBaseUrl: '' }),
    metaAppLookup: async () => null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_config_missing');
});

test('resolveBrowserResource resolves metaid URI through homepage client', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const result = await resolveBrowserResource({
    uri: 'metaid://idq1fixturebot',
    config: browserConfig({ botHomepageTemplateId: 'compact-list' }),
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
    metaAppLookup: async () => null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.renderer.type, 'bot-page');
  assert.equal(result.data.renderer.templateId, 'compact-list');
});

test('resolves MAP conversation resources through ABC host actions', async () => {
  const result = await resolveBrowserResource({
    uri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    config: browserConfig(),
    metaAppLookup: async () => {
      throw new Error('MAP conversation should not use MetaApp lookup');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.resourceType, 'conversation');
  assert.equal(result.data.renderer.type, 'host-action');
  assert.equal(result.data.actions[0].kind, 'open-conversation');
  assert.equal(result.data.actions[0].payload.peerGlobalMetaId, PEER_GLOBAL_META_ID);
});

test('resolves MAP protocol pins through ABC without local MAP parsing', async () => {
  const calls = [];
  const result = await resolveBrowserResource({
    uri: `map://simplebuzz/pin/${MAP_PIN_ID}`,
    config: browserConfig(),
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: MAP_PIN_ID,
            path: '/protocols/simplebuzz',
            address: '1PublisherAddress',
            contentType: 'application/json',
            content: JSON.stringify({ content: 'hello from MAP' }),
          },
        }),
      };
    },
    metaAppLookup: async () => {
      throw new Error('MAP protocol pins should not use MetaApp lookup');
    },
    metaAppResolve: async () => {
      throw new Error('MAP protocol pins should not use MetaApp resolve');
    },
  });

  assert.deepEqual(calls, [`https://man.example.test/pin/${MAP_PIN_ID}`]);
  assert.equal(result.ok, true);
  assert.equal(result.data.resourceType, 'protocol');
  assert.equal(result.data.renderer.type, 'protocol-pin');
  assert.equal(result.data.source.resolver, 'map-protocol-pin');
});

test('resolves metafile pins through ABC without local MetaApp resolution', async () => {
  const calls = [];
  const result = await resolveBrowserResource({
    uri: `metafile://${MAP_PIN_ID}.png`,
    config: browserConfig(),
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: MAP_PIN_ID,
            path: '/file/avatar.png',
            address: '1PublisherAddress',
            contentTypeDetect: 'image/png',
            contentSummary: JSON.stringify({ name: 'avatar.png' }),
          },
        }),
      };
    },
    metaAppResolve: async () => {
      throw new Error('metafile pins should not use MetaApp resolve');
    },
  });

  assert.deepEqual(calls, [`https://man.example.test/pin/${MAP_PIN_ID}`]);
  assert.equal(result.ok, true);
  assert.equal(result.data.resourceType, 'image');
  assert.equal(result.data.renderer.type, 'image');
  assert.equal(result.data.renderer.url, `https://file.example.test/${MAP_PIN_ID}`);
});
