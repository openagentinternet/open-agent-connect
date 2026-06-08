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
  assert.equal(result.renderer.templateId, 'document');
  assert.equal(result.status.state, 'resolved');
  assert.equal(result.status.verificationState, 'partial');
  assert.equal(result.proof.txid, 'identity-txid');
  assert.equal(result.proof.pinId, 'identity-pin');
  assert.equal(result.actions.some((action) => action.kind === 'private-chat'), true);
  assert.equal(result.actions.some((action) => action.kind === 'service-list'), true);
});

test('buildBotPageResolveResult accepts a selected Bot homepage template', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const result = buildBotPageResolveResult({
    uri: 'metaid://idq1fixturebot',
    normalizedUri: 'metaid://idq1fixturebot',
    homepage: fixture,
    resolverUrl: 'https://so.example.test/api/bot-homepage/globalmetaid/idq1fixturebot',
    templateId: 'compact-list',
  });

  assert.equal(result.renderer.type, 'bot-page');
  assert.equal(result.renderer.templateId, 'compact-list');
});
