import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

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
