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

async function fetchJson(baseUrl, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

test('/api/products routes forward requests to product handlers', async (t) => {
  const calls = [];
  const app = await startServer({
    products: {
      listPublishSkills: async (input) => {
        calls.push(['skills', input]);
        return commandSuccess({ skills: [] });
      },
      publish: async (input) => {
        calls.push(['publish', input]);
        return commandSuccess({ listingPinId: 'listing-pin-1' });
      },
      listOwned: async (input) => {
        calls.push(['owned', input]);
        return commandSuccess({ items: [], page: input.page, pageSize: input.pageSize });
      },
    },
  });
  t.after(async () => app.close());

  const skills = await fetchJson(app.baseUrl, '/api/products/skills?from=alice');
  const publish = await fetchJson(app.baseUrl, '/api/products/publish', {
    method: 'POST',
    body: { name: 'digital-guide', network: 'mvc' },
  });
  const owned = await fetchJson(app.baseUrl, '/api/products/owned?from=alice&page=2&pageSize=10&refresh=true');

  assert.equal(skills.status, 200);
  assert.equal(publish.status, 200);
  assert.equal(owned.status, 200);
  assert.deepEqual(calls, [
    ['skills', { from: 'alice' }],
    ['publish', { name: 'digital-guide', network: 'mvc' }],
    ['owned', { from: 'alice', page: 2, pageSize: 10, refresh: true }],
  ]);
});
