import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = { context: [], resolve: [] };
  const server = createHttpServer({
    browser: {
      getContext: async (input) => {
        calls.context.push(input);
        return commandSuccess({
          usingIdentities: [{ slug: 'alice', name: 'Alice Bot', globalMetaId: 'idq1alice', isDefault: true }],
          defaultUsingIdentity: { slug: 'alice', name: 'Alice Bot', globalMetaId: 'idq1alice', isDefault: true },
          defaultUri: 'metaid://idq1alice',
        });
      },
      resolve: async (input) => {
        calls.resolve.push(input);
        if (input.uri === 'metaid://missing') return commandFailed('browser_resource_not_found', 'Resource not found.');
        return commandSuccess({
          uri: input.uri,
          normalizedUri: input.uri.toLowerCase(),
          resourceType: 'bot',
          title: 'Alice Bot',
          owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
          renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
          status: { state: 'resolved', verificationState: 'verified', message: '' },
          source: { resolver: 'test' },
          actions: [],
        });
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, calls, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('GET /api/browser/context forwards optional from slug', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/context?from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.defaultUri, 'metaid://idq1alice');
  assert.deepEqual(calls.context, [{ from: 'alice' }]);
});

test('GET /api/browser/resolve forwards URI and from slug', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/resolve?uri=${encodeURIComponent('METAID://idq1alice')}&from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.resourceType, 'bot');
  assert.deepEqual(calls.resolve, [{ uri: 'METAID://idq1alice', from: 'alice' }]);
});

test('GET /api/browser/resolve validates missing uri and maps not found status', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const missingUri = await fetch(`${baseUrl}/api/browser/resolve`);
  const missingPayload = await missingUri.json();
  assert.equal(missingUri.status, 400);
  assert.equal(missingPayload.code, 'missing_uri');

  const notFound = await fetch(`${baseUrl}/api/browser/resolve?uri=${encodeURIComponent('metaid://missing')}`);
  const notFoundPayload = await notFound.json();
  assert.equal(notFound.status, 404);
  assert.equal(notFoundPayload.code, 'browser_resource_not_found');
});
