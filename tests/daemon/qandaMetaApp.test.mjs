import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { handleBundledMetaAppRoutes } from '../../dist/daemon/routes/uiMetaApps.js';

const APP_ROOT = path.resolve('src/ui/metaapps/qanda');

test('qanda entry is served with base href and the infrastructure script', async () => {
  let response = null;
  const handled = await handleBundledMetaAppRoutes({
    url: new URL('http://127.0.0.1:1/ui/qanda'),
    req: { method: 'GET' },
    handlers: {
      browser: {
        getSettings: async () => ({
          ok: true,
          state: 'success',
          data: { browser: { metasoP2PBaseUrl: 'https://metaso.example.test' } },
        }),
      },
    },
    sendMethodNotAllowed: () => {},
    sendJson: () => {},
    sendHtml: (status, html) => {
      response = { status, html };
    },
    sendText: () => {},
  });
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.match(response.html, /<base href="\/ui\/qanda\/app\/">/);
  assert.match(response.html, /window\.__OAC_INFRASTRUCTURE__/);
  assert.match(response.html, /https:\/\/metaso\.example\.test/);
});

test('qanda assets resolve under the app root', async () => {
  const served = [];
  await handleBundledMetaAppRoutes({
    url: new URL('http://127.0.0.1:1/ui/qanda/app/app.js'),
    req: { method: 'GET' },
    handlers: {},
    sendMethodNotAllowed: () => {},
    sendJson: () => {},
    sendHtml: () => {},
    sendText: (status, body, contentType) => {
      served.push({ status, body, contentType });
    },
  });
  assert.equal(served.length, 1);
  assert.equal(served[0].contentType, 'text/javascript; charset=utf-8');
});

test('qanda app static contract: read-only Q&A APIs, escaped rendering, hash + ?q routing', async () => {
  const js = await readFile(path.join(APP_ROOT, 'app', 'app.js'), 'utf8');
  // The only fetch targets are the read-only Q&A + generic pin read APIs.
  const apiCalls = [...js.matchAll(/apiGet\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(apiCalls.every((entry) => entry.startsWith('/api/qa/questions') || entry.startsWith('/api/metaweb/pin/')));
  assert.ok(!js.includes('/api/qa/post'), 'no write endpoints');
  assert.ok(!js.includes('paylike'), 'no reaction endpoints — read-only viewer');
  // Infrastructure-aware base with a public fallback.
  assert.match(js, /metasoP2PBaseUrl/);
  assert.match(js, /https:\/\/so\.metaid\.io/);
  // Both question-entry forms work.
  assert.match(js, /#\//);
  assert.match(js, /URLSearchParams\(window\.location\.search\)\.get\('q'\)/);
  // XSS discipline: interpolation goes through escapeHtml or textContent.
  assert.match(js, /function escapeHtml/);
  assert.match(js, /textContent/);
  const manifest = await readFile(path.join(APP_ROOT, 'APP.md'), 'utf8');
  assert.match(manifest, /name: qanda-app/);
  assert.match(manifest, /entry: \/qanda\/app\/index\.html/);
});
