import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = {
    context: [],
    runtime: [],
    resolve: [],
    getSettings: [],
    updateSettings: [],
    getCache: [],
    clearCache: [],
    actions: [],
  };
  const server = createHttpServer({
    browser: {
      getRuntime: async (input) => {
        calls.runtime.push(input);
        return commandSuccess({
          host: { kind: 'oac', name: 'Open Agent Connect', localMode: true },
          actors: [{
            id: 'alice',
            label: 'Alice Bot',
            kind: 'oac-bot',
            globalMetaId: 'idq1alice',
            isDefault: true,
            capabilities: ['private-chat', 'service-call', 'template-settings'],
          }],
          defaultActor: {
            id: 'alice',
            label: 'Alice Bot',
            kind: 'oac-bot',
            globalMetaId: 'idq1alice',
            isDefault: true,
            capabilities: ['private-chat', 'service-call', 'template-settings'],
          },
          defaultUri: 'metaid://idq1alice',
          features: {
            privateChat: true,
            serviceCall: true,
            cacheManagement: true,
            templateSettings: true,
            walletLogin: false,
          },
          labels: {
            actorChip: 'Using',
            noActorTitle: 'No Bot',
            noActorBody: 'Create a local Bot before using Browser actions.',
            noActorAction: { label: 'Create Bot', href: '/ui/bot' },
          },
        });
      },
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
      getSettings: async (input) => {
        calls.getSettings.push(input);
        return commandSuccess({
          browser: {
            metasoP2PBaseUrl: 'https://so.metaid.io',
            metafileContentBaseUrl: 'https://so.metaid.io/content',
            manApiBaseUrl: 'https://manapi.metaid.io',
            blockExplorerBaseUrl: 'https://www.mvcscan.com/tx',
            botHomepageTemplateId: 'document',
            defaultChainName: 'mvc',
            localMode: true,
          },
        });
      },
      updateSettings: async (input) => {
        calls.updateSettings.push(input);
        return commandSuccess({
          browser: {
            metasoP2PBaseUrl: input.browser?.metasoP2PBaseUrl,
            manApiBaseUrl: input.browser?.manApiBaseUrl,
            botHomepageTemplateId: input.browser?.botHomepageTemplateId,
          },
        });
      },
      getCache: async (input) => {
        calls.getCache.push(input);
        return commandSuccess({
          cacheRoot: '/tmp/.metabot/cache/metaapps',
          artifactCount: 1,
          pinRecordCount: 1,
          totalBytes: 4096,
          artifacts: [],
        });
      },
      clearCache: async (input) => {
        calls.clearCache.push(input);
        if (input.scope === 'unknown') return commandFailed('invalid_argument', 'Unsupported cache clear scope.');
        return commandSuccess({ clearedArtifacts: 1, clearedPinRecords: 1 });
      },
      runTrustedAction: async (input) => {
        calls.actions.push(input);
        if (input.kind === 'unsupported') return commandFailed('browser_action_not_supported', 'Unsupported Browser action.');
        return commandSuccess({ kind: input.kind, handled: true, data: { accepted: true } });
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

test('GET /api/browser/runtime forwards host-neutral actorId before legacy from', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/runtime?actorId=alice&from=legacy-alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.host.kind, 'oac');
  assert.equal(payload.data.defaultActor.id, 'alice');
  assert.deepEqual(calls.runtime, [{ actorId: 'alice', from: 'legacy-alice' }]);
});

test('POST /api/browser/actions forwards trusted action payload and actorId', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/actions?actorId=alice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceUri: 'metaid://idq1target',
      kind: 'private-chat',
      payload: {
        to: 'idq1target',
        content: 'Hello from Browser',
      },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.handled, true);
  assert.deepEqual(calls.actions, [{
    actorId: 'alice',
    resourceUri: 'metaid://idq1target',
    kind: 'private-chat',
    payload: {
      to: 'idq1target',
      content: 'Hello from Browser',
    },
  }]);
});

test('POST /api/browser/actions maps unsupported actions to a client error', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${baseUrl}/api/browser/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceUri: 'metaid://idq1target',
      kind: 'unsupported',
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.code, 'browser_action_not_supported');
});

test('GET and PUT /api/browser/settings forward from slug and browser settings payload', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const getResponse = await fetch(`${baseUrl}/api/browser/settings?from=alice`);
  const getPayload = await getResponse.json();

  assert.equal(getResponse.status, 200);
  assert.equal(getPayload.data.browser.manApiBaseUrl, 'https://manapi.metaid.io');
  assert.deepEqual(calls.getSettings, [{ from: 'alice' }]);

  const putResponse = await fetch(`${baseUrl}/api/browser/settings?from=alice`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      browser: {
        metasoP2PBaseUrl: 'https://so.example.test',
        manApiBaseUrl: 'https://manapi.example.test',
        botHomepageTemplateId: 'compact-list',
      },
    }),
  });
  const putPayload = await putResponse.json();

  assert.equal(putResponse.status, 200);
  assert.equal(putPayload.data.browser.manApiBaseUrl, 'https://manapi.example.test');
  assert.equal(putPayload.data.browser.botHomepageTemplateId, 'compact-list');
  assert.deepEqual(calls.updateSettings, [{
    from: 'alice',
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      manApiBaseUrl: 'https://manapi.example.test',
      botHomepageTemplateId: 'compact-list',
    },
  }]);
});

test('Browser settings, cache, and resolve routes forward host-neutral actorId', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  await fetch(`${baseUrl}/api/browser/settings?actorId=alice`);
  await fetch(`${baseUrl}/api/browser/settings?actorId=alice`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ browser: { botHomepageTemplateId: 'compact-list' } }),
  });
  await fetch(`${baseUrl}/api/browser/cache?actorId=alice`);
  await fetch(`${baseUrl}/api/browser/cache?actorId=alice`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'all' }),
  });
  await fetch(`${baseUrl}/api/browser/resolve?uri=${encodeURIComponent('metaid://idq1alice')}&actorId=alice`);

  assert.deepEqual(calls.getSettings.at(-1), { actorId: 'alice' });
  assert.deepEqual(calls.updateSettings.at(-1), {
    actorId: 'alice',
    browser: { botHomepageTemplateId: 'compact-list' },
  });
  assert.deepEqual(calls.getCache.at(-1), { actorId: 'alice' });
  assert.deepEqual(calls.clearCache.at(-1), { actorId: 'alice', scope: 'all' });
  assert.deepEqual(calls.resolve.at(-1), { uri: 'metaid://idq1alice', actorId: 'alice' });
});

test('GET and DELETE /api/browser/cache forward cache management requests', async (t) => {
  const { server, calls, baseUrl } = await startServer();
  t.after(async () => server.close());

  const getResponse = await fetch(`${baseUrl}/api/browser/cache?from=alice`);
  const getPayload = await getResponse.json();

  assert.equal(getResponse.status, 200);
  assert.equal(getPayload.data.cacheRoot, '/tmp/.metabot/cache/metaapps');
  assert.deepEqual(calls.getCache, [{ from: 'alice' }]);

  const deleteResponse = await fetch(`${baseUrl}/api/browser/cache?from=alice`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'pin', pinId: 'pin-fixture' }),
  });
  const deletePayload = await deleteResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deletePayload.data, { clearedArtifacts: 1, clearedPinRecords: 1 });
  assert.deepEqual(calls.clearCache, [{ from: 'alice', scope: 'pin', pinId: 'pin-fixture' }]);

  const invalidResponse = await fetch(`${baseUrl}/api/browser/cache`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'unknown' }),
  });
  const invalidPayload = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.code, 'invalid_argument');
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
