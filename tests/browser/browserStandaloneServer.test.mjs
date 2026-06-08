import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createStandaloneBrowserServer } = require('../../dist/browser/standalone/server.js');
const { createStandaloneBrowserHostAdapter } = require('../../dist/browser/standalone/adapter.js');

async function listen(server) {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(response) {
  return response.json();
}

test('standalone Browser server serves Browser pages and shared CSS', async (t) => {
  const server = createStandaloneBrowserServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  for (const pathname of ['/', '/browser', '/ui/browser', '/browser/metaid/idq1fixturebot']) {
    const response = await fetch(`${baseUrl}${pathname}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Agent Internet Browser/);
    assert.match(html, /data-browser-shell/);
    assert.match(html, /\/api\/browser\/runtime/);
  }

  const cssResponse = await fetch(`${baseUrl}/ui/shared.css`);
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get('content-type'), /text\/css/);
  assert.match(await cssResponse.text(), /MetaBot UI/);
});

test('standalone Browser server exposes runtime, settings, cache, and action routes', async (t) => {
  const server = createStandaloneBrowserServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const runtime = await readJson(await fetch(`${baseUrl}/api/browser/runtime`));
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data.host.kind, 'standalone');
  assert.equal(runtime.data.defaultActor.kind, 'wallet');

  const settings = await readJson(await fetch(`${baseUrl}/api/browser/settings?actorId=standalone-wallet`));
  assert.equal(settings.ok, true);
  assert.equal(settings.data.effectiveBrowser.localMode, false);

  const updated = await readJson(await fetch(`${baseUrl}/api/browser/settings?actorId=standalone-wallet`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ browser: { botHomepageTemplateId: 'compact-list' } }),
  }));
  assert.equal(updated.ok, true);
  assert.equal(updated.data.effectiveBrowser.botHomepageTemplateId, 'compact-list');

  const cache = await readJson(await fetch(`${baseUrl}/api/browser/cache?actorId=standalone-wallet`));
  assert.equal(cache.ok, true);
  assert.equal(cache.data.cacheRoot, 'standalone-memory');

  const cleared = await readJson(await fetch(`${baseUrl}/api/browser/cache?actorId=standalone-wallet`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'all' }),
  }));
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.clearedArtifacts, 0);

  const actionResponse = await fetch(`${baseUrl}/api/browser/actions?actorId=standalone-wallet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'private-chat',
      resourceUri: 'metaid://idq1fixturebot',
      payload: { to: 'idq1fixturebot', content: 'hello' },
    }),
  });
  const action = await readJson(actionResponse);
  assert.equal(actionResponse.status, 400);
  assert.equal(action.ok, false);
  assert.equal(action.code, 'browser_action_not_supported');
});

test('standalone Browser server resolves metaid resources through adapter fetch', async (t) => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const adapter = createStandaloneBrowserHostAdapter({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
  });
  const server = createStandaloneBrowserServer({ adapter });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/api/browser/resolve?actorId=standalone-wallet&uri=metaid%3A%2F%2Fidq1fixturebot`);
  const payload = await readJson(response);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.resourceType, 'bot');
  assert.equal(payload.data.renderer.type, 'bot-page');
});
