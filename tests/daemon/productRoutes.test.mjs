import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { commandAwaitingConfirmation, commandFailed, commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createProductStateStore } = require('../../dist/core/products/productStateStore.js');

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

function buyerIdentity() {
  return {
    metabotId: 1,
    name: 'Buyer Bot',
    createdAt: 1770000000000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'buyer-public-key',
    chatPublicKey: 'buyer-chat-public-key',
    mvcAddress: 'buyer-mvc-address',
    addresses: { mvc: 'buyer-mvc-address' },
    metaId: 'buyer-metaid',
    globalMetaId: 'buyer-global-metaid',
  };
}

function routeListingPayload(overrides = {}) {
  return {
    name: 'mobile top-up card',
    title: 'Mobile Top-Up Card Pack',
    productType: 'virtual',
    coverImage: 'metafile://cover-image',
    descriptionContentType: 'text/markdown',
    description: 'Two virtual card options.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['fulfill-card', 'support-card'],
    },
    skus: [
      {
        skuId: 'space-00001',
        name: 'Small Top-Up Card',
        image: 'metafile://sku-1',
        descriptionContentType: 'text/markdown',
        description: 'Small mobile top-up card.',
        price: { amount: '0.00001', currency: 'SPACE' },
        initialStock: 100,
      },
      {
        skuId: 'space-00005',
        name: 'Large Top-Up Card',
        image: 'metafile://sku-2',
        descriptionContentType: 'text/markdown',
        description: 'Large mobile top-up card.',
        price: { amount: '0.00005', currency: 'SPACE' },
        initialStock: 100,
      },
    ],
    ...overrides,
  };
}

async function startProductExecutionServer(t, options = {}) {
  const homeDir = await createProfileHome('metabot-product-route-buy-', 'buyer-bot');
  t.after(async () => cleanupProfileHome(homeDir));
  const identity = buyerIdentity();
  await createRuntimeStateStore(homeDir).writeState({
    identity,
    services: [],
    traces: [],
  });
  await createProductStateStore(homeDir).upsertDirectoryItem({
    listingPinId: 'listing-space-card',
    payload: routeListingPayload(options.payload ?? {}),
    sellerGlobalMetaId: 'seller-global-metaid',
    sellerName: 'Seller Bot',
    sellerMvcAddress: 'seller-derived-mvc-address',
    sellerChatPublicKey: 'seller-chat-public-key',
    online: options.online ?? true,
  });

  const calls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir: deriveSystemHome(homeDir),
    chainApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceFailureMode: 'assume_service_providers_online',
    getDaemonRecord: () => ({
      ownerId: 'test',
      pid: 1,
      host: '127.0.0.1',
      port: 25200,
      baseUrl: 'http://127.0.0.1:25200',
      startedAt: 1770000000000,
    }),
    signer: {
      async getIdentity() {
        return identity;
      },
    },
    productPaymentExecutor: {
      async execute(input) {
        calls.push(['payment', input]);
        if (options.paymentError) throw options.paymentError;
        return {
          paymentTxid: 'payment-txid-1',
          paymentAmount: input.amount,
          paymentCurrency: input.currency,
          paymentChain: input.paymentChain,
          settlementKind: input.settlementKind,
          network: input.paymentChain,
        };
      },
    },
    productOrderPublisher: {
      async publish(input) {
        calls.push(['product-order', input]);
        if (options.productOrderError) throw options.productOrderError;
        return {
          payload: input.payload,
          chainWrite: {
            txids: ['product-order-write-txid-1'],
            pinId: 'product-order-pin-1',
            totalCost: 1,
            network: input.network,
            operation: 'create',
            path: '/protocols/product-order',
            contentType: 'application/json',
            encoding: 'utf-8',
            globalMetaId: identity.globalMetaId,
            mvcAddress: identity.mvcAddress,
          },
        };
      },
    },
    productSimplemsgSender: {
      async send(input) {
        calls.push(['simplemsg', input]);
        if (options.simplemsgError) throw options.simplemsgError;
        return {
          orderTxid: 'simplemsg-order-txid-1',
          txids: ['simplemsg-order-txid-1'],
          pinId: 'simplemsg-pin-1',
        };
      },
    },
  });
  const app = await startServer(handlers);
  t.after(async () => app.close());
  return { ...app, calls };
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

test('/api/products/buy confirmed=true executes payment, product-order publish, then simplemsg', async (t) => {
  const app = await startProductExecutionServer(t);

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: {
      listingPinId: 'listing-space-card',
      skuId: 'space-00005',
      policyMode: 'confirm_paid_only',
      confirmed: true,
      spendCap: { amount: '0.00005', currency: 'SPACE' },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(app.calls.map(([name]) => name), ['payment', 'product-order', 'simplemsg']);
  assert.equal(app.calls[0][1].toAddress, 'seller-derived-mvc-address');
  assert.equal(app.calls[1][1].payload.paymentTxid, 'payment-txid-1');
  assert.equal(app.calls[2][1].productOrderPinId, 'product-order-pin-1');
  assert.equal(response.payload.data.productOrderPinId, 'product-order-pin-1');
  assert.equal(response.payload.data.paymentTxid, 'payment-txid-1');
  assert.equal(response.payload.data.orderTxid, 'simplemsg-order-txid-1');
  assert.match(response.payload.data.localUiUrl, /\/ui\/trace\?traceId=/);
});

test('/api/products/buy returns stable failure when payment fails', async (t) => {
  const app = await startProductExecutionServer(t, {
    paymentError: new Error('insufficient_balance: wallet cannot cover product payment'),
  });

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: { listingPinId: 'listing-space-card', skuId: 'space-00005', confirmed: true },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'insufficient_balance');
  assert.deepEqual(app.calls.map(([name]) => name), ['payment']);
});

test('/api/products/buy returns stable failure when product-order write fails after payment', async (t) => {
  const app = await startProductExecutionServer(t, {
    productOrderError: new Error('product_order_publish_failed: product-order write rejected'),
  });

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: { listingPinId: 'listing-space-card', skuId: 'space-00005', confirmed: true },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'product_order_publish_failed');
  assert.deepEqual(app.calls.map(([name]) => name), ['payment', 'product-order']);
});

test('/api/products/buy returns stable failure when simplemsg dispatch fails after payment and product-order write', async (t) => {
  const app = await startProductExecutionServer(t, {
    simplemsgError: new Error('product_order_dispatch_failed: simplemsg broadcast rejected'),
  });

  const response = await fetchJson(app.baseUrl, '/api/products/buy', {
    method: 'POST',
    body: { listingPinId: 'listing-space-card', skuId: 'space-00005', confirmed: true },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'product_order_dispatch_failed');
  assert.deepEqual(app.calls.map(([name]) => name), ['payment', 'product-order', 'simplemsg']);
});
