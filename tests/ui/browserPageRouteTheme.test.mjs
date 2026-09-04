import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { handleUiRoutes } = require('../../dist/daemon/routes/ui.js');

function makeContext(path) {
  const sent = [];
  const context = {
    req: { method: 'GET', headers: {} },
    res: {},
    url: new URL(`http://127.0.0.1${path}`),
    handlers: {},
    readJsonBody: async () => ({}),
    readRawBody: async () => Buffer.alloc(0),
    streamRawBodyToFile: async () => ({ bytes: 0 }),
    sendJson: (status, payload) => sent.push({ status, payload }),
    sendHtml: (status, html) => sent.push({ status, html }),
    sendText: (status, body) => sent.push({ status, body }),
    sendMethodNotAllowed: (allowed) => sent.push({ status: 405, allowed }),
  };
  return { context, sent };
}

test('Browser shell route bakes the ?theme= param into the served page', async () => {
  const { context, sent } = makeContext('/browser?theme=dark');
  const handled = await handleUiRoutes(context);

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200);
  assert.match(sent[0].html, /data-browser-theme="dark"/);
  assert.match(sent[0].html, /data-browser-resolved-theme="dark"/);
});

test('Browser shell route falls back to light for missing or unknown themes', async () => {
  for (const path of ['/browser', '/browser?theme=neon', '/ui/browser?theme=dark']) {
    const { context, sent } = makeContext(path);
    const handled = await handleUiRoutes(context);

    assert.equal(handled, true, path);
    assert.equal(sent[0].status, 200, path);
    // `/ui/browser?theme=dark` forwards its query into the theme param too;
    // the bare paths normalize to light (ABC's legacy default).
    const expected = path === '/ui/browser?theme=dark' ? 'dark' : 'light';
    assert.match(sent[0].html, new RegExp(`data-browser-theme="${expected}"`), path);
  }
});
