import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createProductStateStore } = require('../../dist/core/products/productStateStore.js');
const {
  listProductDirectory,
} = require('../../dist/core/products/productDirectory.js');

function listing(overrides = {}) {
  return {
    name: 'mobile-top-up',
    title: 'Mobile Top-Up',
    productType: 'virtual',
    coverImage: 'metafile://cover.png',
    descriptionContentType: 'text/markdown',
    description: 'Instant prepaid recharge for mobile phones.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['mobile-top-up-delivery'],
      estimatedDeliverySeconds: 300,
    },
    skus: [
      {
        skuId: 'topup-10',
        name: '10 SPACE recharge',
        image: 'metafile://sku.png',
        descriptionContentType: 'text/markdown',
        description: 'Small phone credit package.',
        price: { amount: '10', currency: 'SPACE' },
        initialStock: 100,
      },
    ],
    ...overrides,
  };
}

async function createProfileHome(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(root, '.metabot', 'profiles', 'seller');
}

function chainRow({ id, sellerGlobalMetaId, sellerName, payload }) {
  return {
    id,
    operation: 'create',
    status: 0,
    path: '/protocols/product-listing',
    createMetaId: `${sellerGlobalMetaId}-metaid`,
    createAddress: `${sellerGlobalMetaId}-address`,
    globalMetaId: sellerGlobalMetaId,
    name: sellerName,
    timestamp: 1770000000,
    contentSummary: JSON.stringify(payload),
  };
}

function fetchChainRows(rows, calls) {
  return async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() {
        return { code: 0, data: { list: rows, nextCursor: null } };
      },
    };
  };
}

test('product directory excludes offline sellers when onlineOnly is true and includes online sellers', async () => {
  const homeDir = await createProfileHome('oac-product-directory-');
  const store = createProductStateStore(homeDir);
  const calls = [];

  const result = await listProductDirectory({
    productStateStore: store,
    fetchImpl: fetchChainRows([
      chainRow({
        id: 'listing-offline',
        sellerGlobalMetaId: 'gm-offline-seller',
        sellerName: 'Offline Seller',
        payload: listing({ name: 'offline-kit', title: 'Offline Kit' }),
      }),
      chainRow({
        id: 'listing-online',
        sellerGlobalMetaId: 'gm-online-seller',
        sellerName: 'Online Seller',
        payload: listing({ name: 'online-kit', title: 'Online Kit' }),
      }),
    ], calls),
    onlineBots: [
      {
        globalMetaId: 'gm-online-seller',
        name: 'Online Seller',
        online: true,
        lastSeenAt: 1770000000000,
        lastSeenAgoSeconds: 4,
        deviceCount: 1,
        goal: '',
      },
    ],
    onlineOnly: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(result.source, 'chain');
  assert.deepEqual(result.products.map((item) => item.listingPinId), ['listing-online']);
  assert.equal(result.products[0].sellerGlobalMetaId, 'gm-online-seller');
  assert.equal(result.products[0].sellerName, 'Online Seller');
  assert.equal(result.products[0].online, true);
  assert.equal(result.products[0].lastSeenAgoSeconds, 4);
});

test('product directory query searches listing, SKU, seller, and currency fields', async () => {
  const homeDir = await createProfileHome('oac-product-directory-query-');
  const store = createProductStateStore(homeDir);
  const payload = listing({
    name: 'mobile-top-up',
    title: 'Phone Recharge Voucher',
    description: 'Instant prepaid mobile top-up delivered by chat.',
    skus: [
      {
        skuId: 'sku-mobile',
        name: 'Mobile top-up pack',
        image: 'metafile://sku.png',
        descriptionContentType: 'text/markdown',
        description: 'Works for prepaid phone numbers.',
        price: { amount: '5', currency: 'SPACE' },
        initialStock: 20,
      },
    ],
  });

  await store.upsertDirectoryItem({
    listingPinId: 'listing-query',
    payload,
    sellerGlobalMetaId: 'gm-seller-query',
    sellerName: 'Recharge Market',
    online: true,
    cachedAt: 1770000000000,
  });

  for (const query of [
    'mobile-top-up',
    'Phone Recharge',
    'prepaid mobile',
    'top-up pack',
    'prepaid phone',
    'Recharge Market',
    'space',
  ]) {
    const result = await listProductDirectory({
      productStateStore: store,
      cached: true,
      query,
    });
    assert.deepEqual(result.products.map((item) => item.listingPinId), ['listing-query'], `query matched ${query}`);
  }
});

test('product directory query excludes protocol and identifier-only fields', async () => {
  const homeDir = await createProfileHome('oac-product-directory-query-exclusions-');
  const store = createProductStateStore(homeDir);
  const payload = listing({
    name: 'recharge-card',
    title: 'Phone Credit',
    description: 'Delivered by chat.',
    skus: [
      {
        skuId: 'sku-secret-token',
        name: 'Phone credit pack',
        image: 'metafile://sku.png',
        descriptionContentType: 'text/markdown',
        description: 'Works for prepaid numbers.',
        price: { amount: '987654321', currency: 'SPACE' },
        initialStock: 20,
      },
    ],
  });

  await store.upsertDirectoryItem({
    listingPinId: 'listing-query-exclusions',
    payload,
    sellerGlobalMetaId: 'gm-secret-seller',
    sellerName: 'Recharge Market',
    online: true,
    cachedAt: 1770000000000,
  });

  for (const query of [
    'gm-secret-seller',
    'sku-secret-token',
    '987654321',
  ]) {
    const result = await listProductDirectory({
      productStateStore: store,
      cached: true,
      query,
    });
    assert.deepEqual(result.products, [], `query did not match excluded field ${query}`);
  }
});

test('product directory keeps seller and online decoration out of protocol payload', async () => {
  const homeDir = await createProfileHome('oac-product-directory-payload-');
  const store = createProductStateStore(homeDir);

  await store.upsertDirectoryItem({
    listingPinId: 'listing-decoration',
    payload: listing(),
    sellerGlobalMetaId: 'gm-decoration-seller',
    sellerName: 'Decoration Seller',
    online: true,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    cached: true,
    onlineOnly: true,
  });

  const product = result.products[0];
  assert.equal(product.sellerGlobalMetaId, 'gm-decoration-seller');
  assert.equal(product.sellerName, 'Decoration Seller');
  assert.equal(product.online, true);
  assert.equal(product.payload.sellerGlobalMetaId, undefined);
  assert.equal(product.payload.sellerName, undefined);
  assert.equal(product.payload.online, undefined);
});

test('product directory result exposes only the public envelope fields', async () => {
  const homeDir = await createProfileHome('oac-product-directory-envelope-');
  const store = createProductStateStore(homeDir);

  await store.upsertDirectoryItem({
    listingPinId: 'listing-envelope',
    payload: listing(),
    sellerGlobalMetaId: 'gm-envelope-seller',
    sellerName: 'Envelope Seller',
    online: true,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    cached: true,
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'cacheUpdatedAt',
    'onlineOnly',
    'products',
    'source',
    'total',
  ]);
  assert.equal(result.fallbackUsed, undefined);
});

test('cached product directory uses local cache without forcing chain refresh', async () => {
  const homeDir = await createProfileHome('oac-product-directory-cache-');
  const store = createProductStateStore(homeDir);
  let fetchCount = 0;

  await store.upsertDirectoryItem({
    listingPinId: 'listing-cached',
    payload: listing({ title: 'Cached Mobile Top-Up' }),
    sellerGlobalMetaId: 'gm-cached-seller',
    sellerName: 'Cached Seller',
    online: true,
    cachedAt: 1770000001234,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    cached: true,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('chain should not be read in cached mode');
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(result.source, 'cache');
  assert.equal(result.cacheUpdatedAt, 1770000001234);
  assert.deepEqual(result.products.map((item) => item.listingPinId), ['listing-cached']);
});
