import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

const ALICE_MVC_ADDRESS = '16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS';
const TARGET_PIN_ID = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

function aliceIdentity() {
  return {
    metabotId: 1,
    name: 'alice',
    createdAt: 1_777_600_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'alice-public-key',
    chatPublicKey: 'alice-chat-public-key',
    addresses: {
      mvc: ALICE_MVC_ADDRESS,
    },
    mvcAddress: ALICE_MVC_ADDRESS,
    metaId: 'metaid-alice',
    globalMetaId: 'idq1alice',
    subsidyState: 'claimed',
    syncState: 'synced',
  };
}

async function createAliceFixture(t, options = {}) {
  const homeDir = await createProfileHome('metabot-apps-routes-', 'alice');
  const systemHomeDir = deriveSystemHome(homeDir);
  t.after(async () => cleanupProfileHome(homeDir));
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'alice',
    homeDir,
    globalMetaId: 'idq1alice',
    mvcAddress: ALICE_MVC_ADDRESS,
  });
  if (options.withIdentity !== false) {
    await createRuntimeStateStore(homeDir).writeState({
      identity: aliceIdentity(),
      services: [],
      traces: [],
      sellerOrders: [],
    });
  }
  return { homeDir, systemHomeDir };
}

function fakeSigner(writes = []) {
  return {
    writePin: async (input) => {
      writes.push(input);
      const index = writes.length;
      const pinIds = [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbi0',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccci0',
      ];
      return {
        pinId: pinIds[index - 1] ?? pinIds[0],
        txids: [`apps-write-tx-${index}`],
        totalCost: index,
        network: input.network ?? 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
      };
    },
  };
}

async function startServer(handlers = {}) {
  const server = createHttpServer(handlers);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    response,
    payload: await response.json(),
  };
}

test('GET /api/apps forwards list and mutation routes to apps handlers', async (t) => {
  const calls = [];
  const server = await startServer({
    apps: {
      list: async (input) => {
        calls.push(['list', input]);
        return {
          ok: true,
          state: 'success',
          data: [],
        };
      },
      publish: async (input) => {
        calls.push(['publish', input]);
        return {
          ok: true,
          state: 'success',
          data: { published: true },
        };
      },
      update: async (input) => {
        calls.push(['update', input]);
        return {
          ok: true,
          state: 'success',
          data: { updated: true },
        };
      },
      delete: async (input) => {
        calls.push(['delete', input]);
        return {
          ok: true,
          state: 'success',
          data: { deleted: true },
        };
      },
    },
  });
  t.after(async () => server.close());

  await fetchJson(server.baseUrl, '/api/apps?from=alice&cursor=c1&size=12&refresh=true');
  await fetchJson(server.baseUrl, '/api/apps/publish', {
    method: 'POST',
    body: { from: 'alice', title: 'App' },
  });
  await fetchJson(server.baseUrl, '/api/apps/update', {
    method: 'POST',
    body: { from: 'alice', targetPinId: 'target', title: 'App' },
  });
  await fetchJson(server.baseUrl, '/api/apps/delete', {
    method: 'POST',
    body: { from: 'alice', targetPinId: 'target' },
  });

  assert.deepEqual(calls, [
    ['list', { from: 'alice', cursor: 'c1', size: 12, refresh: true }],
    ['publish', { from: 'alice', title: 'App' }],
    ['update', { from: 'alice', targetPinId: 'target', title: 'App' }],
    ['delete', { from: 'alice', targetPinId: 'target' }],
  ]);
});

test('GET /api/apps normalizes query values', async (t) => {
  const calls = [];
  const server = await startServer({
    apps: {
      list: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: [],
        };
      },
    },
  });
  t.after(async () => server.close());

  await fetchJson(server.baseUrl, '/api/apps?from=%20alice%20&cursor=%20c2%20&size=bad&refresh=yes');

  assert.deepEqual(calls, [
    { from: 'alice', cursor: 'c2', size: 12, refresh: true },
  ]);
});

test('GET /api/apps falls back to default size for fractional values', async (t) => {
  const calls = [];
  const server = await startServer({
    apps: {
      list: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: [],
        };
      },
    },
  });
  t.after(async () => server.close());

  await fetchJson(server.baseUrl, '/api/apps?size=1.5');

  assert.deepEqual(calls, [
    { size: 12, refresh: false },
  ]);
});

test('unsupported methods for apps routes return method_not_allowed', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const listResponse = await fetch(`${server.baseUrl}/api/apps`, {
    method: 'POST',
  });
  const publishResponse = await fetch(`${server.baseUrl}/api/apps/publish`, {
    method: 'GET',
  });

  assert.equal(listResponse.status, 405);
  assert.equal(await listResponse.text(), JSON.stringify({
    ok: false,
    state: 'failed',
    code: 'method_not_allowed',
    message: 'Expected GET.',
  }, null, 2) + '\n');
  assert.equal(publishResponse.status, 405);
  assert.equal(await publishResponse.text(), JSON.stringify({
    ok: false,
    state: 'failed',
    code: 'method_not_allowed',
    message: 'Expected POST.',
  }, null, 2) + '\n');
});

test('GET /api/apps without handlers returns not_implemented', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/apps`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'not_implemented');
  assert.equal(payload.message, 'Apps list handler is not configured.');
});

test('default apps list uses selected Bot MVC address against MAN', async (t) => {
  const fixture = await createAliceFixture(t);
  const urls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
    metaAppManFetch: async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 1, data: { list: [], nextCursor: '', total: 0 } }),
      };
    },
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const { payload } = await fetchJson(server.baseUrl, '/api/apps?from=alice&size=12');

  assert.equal(payload.ok, true);
  assert.equal(urls.length, 1);
  const manUrl = urls[0];
  assert.match(manUrl, /\/address\/pin\/list\/16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS\?/);
  assert.match(manUrl, /(?:\?|&)path=%2Fprotocols%2Fmetaapp(?:&|$)/);
});

test('default apps publish update and delete write expected chain operations', async (t) => {
  const fixture = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:24885' }),
    signer: fakeSigner(writes),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());
  const body = {
    from: 'alice',
    title: 'Agent Wiki Builder',
    appName: 'Agent Wiki Builder',
    icon: TARGET_PIN_ID,
    coverImg: TARGET_PIN_ID,
    introImgs: [TARGET_PIN_ID],
    runtime: ['browser'],
    content: TARGET_PIN_ID,
    code: TARGET_PIN_ID,
  };

  const publish = await fetchJson(server.baseUrl, '/api/apps/publish', {
    method: 'POST',
    body,
  });
  const update = await fetchJson(server.baseUrl, '/api/apps/update', {
    method: 'POST',
    body: { ...body, targetPinId: TARGET_PIN_ID, disabled: true },
  });
  await fetchJson(server.baseUrl, '/api/apps/delete', {
    method: 'POST',
    body: { from: 'alice', targetPinId: TARGET_PIN_ID },
  });

  assert.equal(writes.length, 3);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaapp');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(JSON.parse(writes[0].payload).content, `metafile://${TARGET_PIN_ID}`);
  assert.equal(writes[1].operation, 'modify');
  assert.equal(writes[1].path, `@${TARGET_PIN_ID}`);
  assert.equal(JSON.parse(writes[1].payload).disabled, true);
  assert.equal(writes[2].operation, 'revoke');
  assert.equal(writes[2].path, `@${TARGET_PIN_ID}`);
  assert.match(publish.payload.data.localUiUrl, /^http:\/\/127\.0\.0\.1:24885\/ui\/apps\?/);
  assert.match(update.payload.data.localUiUrl, /^http:\/\/127\.0\.0\.1:24885\/ui\/apps\?/);
});

test('default apps list returns identity_missing when selected Bot has no runtime identity', async (t) => {
  const fixture = await createAliceFixture(t, { withIdentity: false });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const { payload } = await fetchJson(server.baseUrl, '/api/apps?from=alice');

  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'identity_missing');
});
