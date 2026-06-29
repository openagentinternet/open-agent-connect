import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const MAP_PIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0';
const PIN_ID = `${'b'.repeat(64)}i0`;

async function startServer() {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('GET /browser and /ui/browser serve the same Agent Internet Browser shell', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const product = await fetch(`${baseUrl}/browser?uri=${encodeURIComponent('metaid://idq1alice')}`);
  const framework = await fetch(`${baseUrl}/ui/browser?uri=${encodeURIComponent('metaid://idq1alice')}`);
  const productHtml = await product.text();
  const frameworkHtml = await framework.text();

  assert.equal(product.status, 200);
  assert.equal(framework.status, 200);
  assert.match(productHtml, /Agent Internet Browser/);
  assert.match(productHtml, /data-browser-shell/);
  assert.match(productHtml, /data-browser-uri-input/);
  assert.match(productHtml, /data-browser-viewport/);
  assert.match(productHtml, /data-browser-status-strip/);
  assert.match(productHtml, /\/api\/browser\/resolve/);
  assert.equal(productHtml, frameworkHtml);
});

test('GET Browser deep links serve the Agent Internet Browser shell', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const metaId = await fetch(`${baseUrl}/browser/metaid/idq1alice`);
  const metaApp = await fetch(`${baseUrl}/browser/metaapp/8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0`);
  const pin = await fetch(`${baseUrl}/browser/pin/${PIN_ID}`);
  const metaIdHtml = await metaId.text();
  const metaAppHtml = await metaApp.text();
  const pinHtml = await pin.text();

  assert.equal(metaId.status, 200);
  assert.equal(metaApp.status, 200);
  assert.equal(pin.status, 200);
  assert.match(metaIdHtml, /Agent Internet Browser/);
  assert.match(metaIdHtml, /data-browser-uri-input/);
  assert.match(metaAppHtml, /Agent Internet Browser/);
  assert.match(metaAppHtml, /data-browser-uri-input/);
  assert.match(pinHtml, /Agent Internet Browser/);
  assert.match(pinHtml, /data-browser-uri-input/);
});

test('serves Browser shell for /browser/map/simplebuzz/pin MAP routes', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/browser/map/simplebuzz/pin/${MAP_PIN_ID}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Agent Internet Browser/);
  assert.match(html, /data-browser-uri-input/);
});

test('serves Browser shell for /browser/map/simplemsg/conversation MAP routes', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/browser/map/simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Agent Internet Browser/);
  assert.match(html, /data-browser-uri-input/);
});

test('Browser default shell hides drawer and inspector by default and avoids rejected labels', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/ui/browser`);
  const html = await response.text();

  assert.match(html, /data-browser-drawer hidden/);
  assert.match(html, /data-browser-inspector hidden/);
  assert.doesNotMatch(html, />Rendered</);
  assert.doesNotMatch(html, />Chain Proof</);
  assert.doesNotMatch(html, />Source</);
  assert.doesNotMatch(html, /TSID/);
  assert.match(html, /TXID/);
});
