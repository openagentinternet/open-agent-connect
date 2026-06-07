import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

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
