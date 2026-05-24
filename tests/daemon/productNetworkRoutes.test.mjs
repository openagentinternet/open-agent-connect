import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

async function startServer(handlers) {
  const server = createHttpServer(handlers);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
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
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

test('GET /api/network/products forwards query filters to network.listProducts', async (t) => {
  const calls = [];
  const app = await startServer({
    network: {
      listProducts: async (input) => {
        calls.push(input);
        return commandSuccess({
          products: [{ listingPinId: 'listing-mobile-top-up' }],
          total: 1,
          source: 'cache',
          onlineOnly: true,
          cacheUpdatedAt: 1770000000000,
        });
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetch(`${app.baseUrl}/api/network/products?online=true&cached=true&query=mobile&limit=5`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ online: true, cached: true, query: 'mobile', limit: 5 }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.products[0].listingPinId, 'listing-mobile-top-up');
});

test('GET /api/network/products rejects invalid limit values', async (t) => {
  const calls = [];
  const app = await startServer({
    network: {
      listProducts: async (input) => {
        calls.push(input);
        return commandSuccess({ products: [], total: 0, source: 'cache', onlineOnly: false, cacheUpdatedAt: null });
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetch(`${app.baseUrl}/api/network/products?limit=5abc`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  assert.deepEqual(payload, {
    ok: false,
    state: 'failed',
    code: 'invalid_flag',
    message: 'Unsupported --limit value: 5abc. Supported range: 1-100.',
  });
});
