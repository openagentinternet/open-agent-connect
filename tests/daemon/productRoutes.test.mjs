import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { commandAwaitingConfirmation, commandFailed, commandSuccess } = require('../../dist/core/contracts/commandResult.js');
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

test('/api/products/buy returns awaiting_confirmation for paid unconfirmed requests', async (t) => {
  const calls = [];
  const request = {
    query: 'buy Alice 0.00005 SPACE mobile top-up card',
    listingPinId: '',
    skuId: 'space-00005',
    comment: '',
    spendCap: {
      amount: '0.00005',
      currency: 'SPACE',
    },
    policyMode: 'confirm_paid_only',
    confirmed: false,
  };
  const app = await startServer({
    products: {
      buy: async (input) => {
        calls.push(input);
        return commandAwaitingConfirmation({
          product: { listingPinId: 'listing-space-card', title: 'SPACE Mobile Top-up Card' },
          sku: { skuId: 'space-00005', name: '0.00005 SPACE card' },
          seller: { globalMetaId: 'alice-global-metaid', name: 'Alice' },
          payment: { amount: '0.00005', currency: 'SPACE' },
          confirmation: { requiresConfirmation: true, policyMode: 'confirm_paid_only' },
          confirmRequest: {
            request: {
              ...request,
              listingPinId: 'listing-space-card',
              confirmed: true,
            },
          },
        });
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: request,
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.state, 'awaiting_confirmation');
  assert.deepEqual(calls, [request]);
  assert.equal(response.payload.data.payment.amount, '0.00005');
  assert.equal(response.payload.data.confirmRequest.request.confirmed, true);
});

test('/api/products/buy returns product_offline before wallet payment', async (t) => {
  const walletCalls = [];
  const app = await startServer({
    products: {
      buy: async () => commandFailed('product_offline', 'Product seller is offline.'),
    },
    wallet: {
      confirmWalletTransfer: async (input) => {
        walletCalls.push(input);
        return commandSuccess({ txid: 'should-not-happen' });
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: { listingPinId: 'listing-space-card', skuId: 'space-00005', confirmed: true },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'product_offline');
  assert.deepEqual(walletCalls, []);
});

test('/api/products/buy returns the V1 unsupported code for physical logistics products before wallet payment', async (t) => {
  const walletCalls = [];
  const app = await startServer({
    products: {
      buy: async () => commandFailed('unsupported_product_type', 'Physical products are not supported in Product V1.'),
    },
    wallet: {
      confirmWalletTransfer: async (input) => {
        walletCalls.push(input);
        return commandSuccess({ txid: 'should-not-happen' });
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: { listingPinId: 'physical-listing', skuId: 'shipping-sku', confirmed: true },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'unsupported_product_type');
  assert.deepEqual(walletCalls, []);
});

test('/api/products/buy forwards a stable command envelope without route payment logic', async (t) => {
  const calls = [];
  const request = {
    request: {
      query: 'buy Alice 0.00005 SPACE mobile top-up card',
      listingPinId: 'listing-space-card',
      skuId: 'space-00005',
      policyMode: 'confirm_paid_only',
      confirmed: true,
    },
  };
  const app = await startServer({
    products: {
      buy: async (input) => {
        calls.push(input);
        return commandSuccess({
          state: 'ready_for_payment',
          payment: { amount: '0.00005', currency: 'SPACE' },
        });
      },
    },
    chain: {
      write: async () => {
        throw new Error('route must not write product-order pins');
      },
    },
    wallet: {
      confirmWalletTransfer: async () => {
        throw new Error('route must not execute wallet payments');
      },
    },
  });
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: request,
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data, {
    state: 'ready_for_payment',
    payment: { amount: '0.00005', currency: 'SPACE' },
  });
  assert.deepEqual(calls, [request]);
});
