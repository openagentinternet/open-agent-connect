import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createStandaloneBrowserServer } = require('../../dist/browser/standalone/server.js');
const { createStandaloneBrowserHostAdapter } = require('../../dist/browser/standalone/adapter.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const METAAPP_PIN_ID = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
const ZIP_PIN_ID = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const MAP_PIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0';

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

async function makeZipBuffer(title = 'Standalone Preview') {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oac-standalone-metaapp-project-'));
  await mkdir(path.join(projectDir, 'app'), { recursive: true });
  await writeFile(path.join(projectDir, 'app', 'index.html'), `<!doctype html><title>${title}</title>`);
  await writeFile(path.join(projectDir, 'app', 'app.js'), 'window.__standalonePreviewLoaded = true;');
  const archivePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'oac-standalone-metaapp-archive-')), 'metaapp.zip');
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

test('standalone Browser server serves Browser shell for MAP route wrappers', async (t) => {
  const server = createStandaloneBrowserServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const paths = [
    `/browser/map/simplebuzz/pin/${MAP_PIN_ID}`,
    `/browser/map/simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
  ];
  for (const pathname of paths) {
    const response = await fetch(`${baseUrl}${pathname}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Agent Internet Browser/);
    assert.match(html, /data-browser-shell/);
  }
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

test('standalone Browser server resolves MetaApps and serves preview assets', async (t) => {
  const zipBuffer = await makeZipBuffer();
  const adapter = createStandaloneBrowserHostAdapter({
    fetch: async (url) => {
      const textUrl = String(url);
      if (textUrl === `https://manapi.metaid.io/pin/${METAAPP_PIN_ID}`) {
        return jsonResponse({
          data: {
            id: METAAPP_PIN_ID,
            path: '/protocols/metaapp',
            address: '1StandalonePublisher',
            timestamp: 1780833765,
            contentSummary: JSON.stringify({
              title: 'Standalone MetaApp',
              appName: 'standalone-metaapp',
              version: '1.0.0',
              runtime: 'browser',
              content: `metafile://${ZIP_PIN_ID}.zip`,
              contentType: 'application/zip',
              indexFile: 'index.html',
            }),
          },
        });
      }
      if (textUrl.includes(`/content/${ZIP_PIN_ID}`)) {
        return bufferResponse(zipBuffer);
      }
      throw new Error(`Unexpected fetch URL: ${textUrl}`);
    },
  });
  const server = createStandaloneBrowserServer({ adapter });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = await listen(server);

  const resolveResponse = await fetch(`${baseUrl}/api/browser/resolve?actorId=standalone-wallet&uri=metaapp%3A%2F%2F${METAAPP_PIN_ID}`);
  const resolved = await readJson(resolveResponse);
  assert.equal(resolveResponse.status, 200);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'metaapp');
  assert.equal(resolved.data.renderer.type, 'html-iframe');
  assert.match(resolved.data.renderer.url, /^\/api\/browser\/preview-assets\/standalone-/);

  const previewResponse = await fetch(`${baseUrl}${resolved.data.renderer.url}`);
  assert.equal(previewResponse.status, 200);
  assert.match(previewResponse.headers.get('content-type'), /text\/html/);
  assert.match(await previewResponse.text(), /Standalone Preview/);
});
