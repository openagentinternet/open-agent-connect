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

function fetchSocketPresenceRows(rows, calls = []) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('/pin/path/list')) {
      throw new Error('cached mode should not fetch chain product rows');
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          data: {
            total: rows.length,
            onlineWindowSeconds: 120,
            list: rows.map((row) => ({
              globalMetaId: row.globalMetaId,
              lastSeenAt: row.lastSeenAt ?? 1770000000000,
              lastSeenAgoSeconds: row.lastSeenAgoSeconds ?? 3,
              deviceCount: row.deviceCount ?? 1,
              userInfo: {
                name: row.name ?? '',
                bio: row.goal ? JSON.stringify({ goal: row.goal }) : '',
              },
            })),
          },
        };
      },
    };
  };
}

function fetchChainRowsThenPresenceFailure(rows) {
  return async (url) => {
    if (String(url).includes('/pin/path/list')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 0, data: { list: rows, nextCursor: null } };
        },
      };
    }
    throw new Error('socket presence unavailable');
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
  assert.deepEqual(result.products[0].skus, result.products[0].payload.skus);
  assert.equal(result.products[0].fulfillment.deliveryEndpoint, 'simplemsg');
  assert.equal(result.products[0].fulfillment.fulfillmentType, 'digital_delivery');
  assert.equal(Object.hasOwn(result.products[0], 'lastSeenSec'), false);
});

test('online product directory rejects when current socket presence is unavailable', async () => {
  const homeDir = await createProfileHome('oac-product-directory-presence-failure-');
  const store = createProductStateStore(homeDir);

  await assert.rejects(
    () => listProductDirectory({
      productStateStore: store,
      onlineOnly: true,
      fetchImpl: fetchChainRowsThenPresenceFailure([
        chainRow({
          id: 'listing-presence-failure',
          sellerGlobalMetaId: 'gm-presence-failure-seller',
          sellerName: 'Presence Failure Seller',
          payload: listing({ title: 'Presence Failure Listing' }),
        }),
      ]),
    }),
    /socket presence unavailable/,
  );
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
    onlineBots: [
      {
        globalMetaId: 'gm-decoration-seller',
        name: 'Decoration Seller',
        online: true,
        lastSeenAt: 1770000000000,
        lastSeenAgoSeconds: 1,
        deviceCount: 1,
        goal: '',
      },
    ],
  });

  const product = result.products[0];
  assert.equal(product.sellerGlobalMetaId, 'gm-decoration-seller');
  assert.equal(product.sellerName, 'Decoration Seller');
  assert.equal(product.online, true);
  assert.equal(product.payload.sellerGlobalMetaId, undefined);
  assert.equal(product.payload.sellerName, undefined);
  assert.equal(product.payload.online, undefined);
});

test('cached online product directory excludes stale cached online sellers missing from current presence', async () => {
  const homeDir = await createProfileHome('oac-product-directory-stale-online-');
  const store = createProductStateStore(homeDir);
  const calls = [];

  await store.upsertDirectoryItem({
    listingPinId: 'listing-stale-online',
    payload: listing({ title: 'Stale Online Listing' }),
    sellerGlobalMetaId: 'gm-stale-online-seller',
    sellerName: 'Stale Online Seller',
    online: true,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    cached: true,
    onlineOnly: true,
    fetchImpl: fetchSocketPresenceRows([], calls),
  });

  assert.deepEqual(result.products, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/group-chat\/socket\/online-users/);
});

test('cached online product directory includes stale cached offline sellers present in current presence', async () => {
  const homeDir = await createProfileHome('oac-product-directory-current-online-');
  const store = createProductStateStore(homeDir);
  const calls = [];

  await store.upsertDirectoryItem({
    listingPinId: 'listing-current-online',
    payload: listing({ title: 'Current Online Listing' }),
    sellerGlobalMetaId: 'gm-current-online-seller',
    sellerName: 'Current Online Seller',
    online: false,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    cached: true,
    onlineOnly: true,
    fetchImpl: fetchSocketPresenceRows([
      { globalMetaId: 'gm-current-online-seller', name: 'Current Online Seller', lastSeenAgoSeconds: 2 },
    ], calls),
  });

  assert.deepEqual(result.products.map((item) => item.listingPinId), ['listing-current-online']);
  assert.equal(result.products[0].online, true);
  assert.equal(result.products[0].lastSeenAgoSeconds, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/group-chat\/socket\/online-users/);
});

test('fallback cache product directory excludes stale cached online sellers missing from current presence', async () => {
  const homeDir = await createProfileHome('oac-product-directory-fallback-stale-online-');
  const store = createProductStateStore(homeDir);
  let chainFetchCount = 0;

  await store.upsertDirectoryItem({
    listingPinId: 'listing-fallback-stale-online',
    payload: listing({ title: 'Fallback Stale Online Listing' }),
    sellerGlobalMetaId: 'gm-fallback-stale-online-seller',
    sellerName: 'Fallback Stale Online Seller',
    online: true,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    onlineOnly: true,
    onlineBots: [],
    fetchImpl: async () => {
      chainFetchCount += 1;
      throw new Error('chain unavailable');
    },
  });

  assert.equal(chainFetchCount, 1);
  assert.equal(result.source, 'cache');
  assert.deepEqual(result.products, []);
});

test('fallback cache product directory includes stale cached offline sellers present in current presence', async () => {
  const homeDir = await createProfileHome('oac-product-directory-fallback-current-online-');
  const store = createProductStateStore(homeDir);
  let chainFetchCount = 0;

  await store.upsertDirectoryItem({
    listingPinId: 'listing-fallback-current-online',
    payload: listing({ title: 'Fallback Current Online Listing' }),
    sellerGlobalMetaId: 'gm-fallback-current-online-seller',
    sellerName: 'Fallback Current Online Seller',
    online: false,
    cachedAt: 1770000000000,
  });

  const result = await listProductDirectory({
    productStateStore: store,
    onlineOnly: true,
    onlineBots: [
      {
        globalMetaId: 'gm-fallback-current-online-seller',
        name: 'Fallback Current Online Seller',
        online: true,
        lastSeenAt: 1770000000000,
        lastSeenAgoSeconds: 2,
        deviceCount: 1,
        goal: '',
      },
    ],
    fetchImpl: async () => {
      chainFetchCount += 1;
      throw new Error('chain unavailable');
    },
  });

  assert.equal(chainFetchCount, 1);
  assert.equal(result.source, 'cache');
  assert.deepEqual(result.products.map((item) => item.listingPinId), ['listing-fallback-current-online']);
  assert.equal(result.products[0].online, true);
  assert.equal(result.products[0].lastSeenAgoSeconds, 2);
});

test('product directory does not fall back to stale cache when local directory persistence fails', async () => {
  const homeDir = await createProfileHome('oac-product-directory-upsert-failure-');
  const store = createProductStateStore(homeDir);

  await store.upsertDirectoryItem({
    listingPinId: 'listing-stale-cache',
    payload: listing({ title: 'Stale Cache Listing' }),
    sellerGlobalMetaId: 'gm-stale-cache-seller',
    sellerName: 'Stale Cache Seller',
    online: true,
    cachedAt: 1770000000000,
  });
  store.upsertDirectoryItem = async () => {
    throw new Error('local product directory write failed');
  };

  await assert.rejects(
    () => listProductDirectory({
      productStateStore: store,
      fetchImpl: fetchChainRows([
        chainRow({
          id: 'listing-fresh-chain',
          sellerGlobalMetaId: 'gm-fresh-chain-seller',
          sellerName: 'Fresh Chain Seller',
          payload: listing({ title: 'Fresh Chain Listing' }),
        }),
      ], []),
      onlineBots: [
        {
          globalMetaId: 'gm-fresh-chain-seller',
          name: 'Fresh Chain Seller',
          online: true,
          lastSeenAt: 1770000000000,
          lastSeenAgoSeconds: 1,
          deviceCount: 1,
          goal: '',
        },
      ],
    }),
    /local product directory write failed/,
  );
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
