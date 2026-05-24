import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createProductStateStore,
} = require('../../dist/core/products/productStateStore.js');

async function createTempProfileRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-products-'));
  return path.join(root, '.metabot', 'profiles', 'alice');
}

function listingPayload(title = 'Mobile Top-Up Card Pack') {
  return {
    name: 'mobile top-up card',
    title,
    productType: 'virtual',
    coverImage: 'metafile://cover_pinid.jpg',
    descriptionContentType: 'text/markdown',
    description: 'Two virtual card options.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['S1'],
    },
    skus: [
      {
        skuId: 'sku2',
        name: 'Large Top-Up Card',
        image: 'metafile://sku_2.png',
        descriptionContentType: 'text/markdown',
        description: 'Large mobile top-up card.',
        price: {
          amount: '0.00005',
          currency: 'SPACE',
        },
        initialStock: 100,
      },
    ],
  };
}

async function sleep(ms) {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

test('product state store persists owned listings in the profile runtime products directory', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  const listing = await store.upsertOwnedListing({
    listingPinId: 'listing-pin-id',
    localMetabotSlug: 'alice',
    payload: listingPayload(),
    available: true,
    revokedAt: null,
    localUpdatedAt: 1770000000000,
  });

  assert.equal(listing.listingPinId, 'listing-pin-id');
  assert.equal(listing.title, 'Mobile Top-Up Card Pack');
  assert.equal(listing.skuCount, 1);
  assert.deepEqual(listing.fulfillmentSkills, ['S1']);

  const persisted = JSON.parse(await fs.readFile(store.productStatePath, 'utf8'));
  assert.equal(
    store.productStatePath,
    path.join(profileRoot, '.runtime', 'products', 'products-state.json'),
  );
  assert.equal(persisted.version, 1);
  assert.equal(persisted.ownedListings.length, 1);

  const reloaded = await createProductStateStore(profileRoot).readState();
  assert.equal(reloaded.ownedListings[0].listingPinId, 'listing-pin-id');
});

test('product state store upserts product directory cache entries and looks up listings cache-first by listingPinId', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  await store.upsertDirectoryItem({
    listingPinId: 'listing-pin-id',
    payload: listingPayload('Old title'),
    sellerGlobalMetaId: 'seller-global-metaid',
    sellerName: 'Alice',
    online: true,
    cachedAt: 1770000000000,
  });
  await store.upsertDirectoryItem({
    listingPinId: 'listing-pin-id',
    payload: listingPayload('New title'),
    sellerGlobalMetaId: 'seller-global-metaid',
    sellerName: 'Alice',
    online: false,
    cachedAt: 1770000001000,
  });

  const state = await store.readState();
  assert.equal(state.directoryCache.length, 1);
  assert.equal(state.directoryCache[0].title, 'New title');
  assert.equal(state.directoryCache[0].online, false);

  const found = await store.findListingByPinId('listing-pin-id');
  assert.equal(found.source, 'directoryCache');
  assert.equal(found.item.title, 'New title');
});

test('product state store skips malformed persisted listing payloads without crashing', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);
  await store.ensureLayout();
  await fs.writeFile(
    store.productStatePath,
    `${JSON.stringify({
      version: 1,
      ownedListings: [{ listingPinId: 'owned-bad', payload: {} }],
      directoryCache: [{ listingPinId: 'directory-bad', payload: {} }],
      buyerOrders: [],
      sellerOrders: [],
    }, null, 2)}\n`,
    'utf8',
  );

  const state = await store.readState();

  assert.deepEqual(state.ownedListings, []);
  assert.deepEqual(state.directoryCache, []);
});

test('product state store rejects invalid listing payloads before upserting listings', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);
  const invalidListing = {
    ...listingPayload('Invalid Listing'),
    skus: [],
  };

  await assert.rejects(
    () => store.upsertOwnedListing({
      listingPinId: 'invalid-owned-listing-pin-id',
      payload: invalidListing,
    }),
    /Invalid product listing payload/,
  );
  await assert.rejects(
    () => store.upsertDirectoryItem({
      listingPinId: 'invalid-directory-listing-pin-id',
      payload: invalidListing,
    }),
    /Invalid product listing payload/,
  );

  const state = await store.readState();
  assert.deepEqual(state.ownedListings, []);
  assert.deepEqual(state.directoryCache, []);
});

test('product state store persists buyer and seller orders with cache-first lookups', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  await store.upsertBuyerOrder({
    productOrderPinId: 'buyer-product-order-pin-id',
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    paymentTxid: 'buyer-payment-txid',
    orderTxid: 'buyer-order-txid',
    sellerGlobalMetaId: 'seller-global-metaid',
    deliverySummary: {
      result: 'Top-up card: 1234-5678',
      deliveryPinId: 'delivery-pin-id',
      deliveredAt: 1770000002000,
    },
    state: 'paid',
    localUpdatedAt: 1770000000000,
  });
  await store.upsertSellerOrder({
    productOrderPinId: 'seller-product-order-pin-id',
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    paymentTxid: 'seller-payment-txid',
    orderTxid: 'seller-order-txid',
    buyerGlobalMetaId: 'buyer-global-metaid',
    fulfillmentSkills: ['S1'],
    paymentVerified: true,
    selectedSku: listingPayload().skus[0],
    fulfillmentState: 'delivered',
    deliveryPinId: 'seller-delivery-pin-id',
    failureReason: 'prior transient fulfillment error',
    state: 'received',
    localUpdatedAt: 1770000001000,
  });

  assert.equal(
    (await store.findOrderByProductOrderPinId('buyer-product-order-pin-id')).source,
    'buyerOrders',
  );
  assert.equal(
    (await store.findOrderByProductOrderPinId('seller-product-order-pin-id')).source,
    'sellerOrders',
  );
  assert.equal((await store.findOrderByPaymentTxid('buyer-payment-txid')).item.role, 'buyer');
  assert.equal((await store.findOrderByPaymentTxid('seller-payment-txid')).item.role, 'seller');
  assert.equal((await store.findOrderByOrderTxid('buyer-order-txid')).item.role, 'buyer');
  assert.equal((await store.findOrderByOrderTxid('seller-order-txid')).item.role, 'seller');

  const reloaded = await createProductStateStore(profileRoot).readState();
  assert.deepEqual(reloaded.buyerOrders[0].deliverySummary, {
    result: 'Top-up card: 1234-5678',
    deliveryPinId: 'delivery-pin-id',
    deliveredAt: 1770000002000,
  });
  assert.equal(reloaded.sellerOrders[0].paymentVerified, true);
  assert.equal(reloaded.sellerOrders[0].selectedSku.skuId, 'sku2');
  assert.equal(reloaded.sellerOrders[0].fulfillmentState, 'delivered');
  assert.equal(reloaded.sellerOrders[0].deliveryPinId, 'seller-delivery-pin-id');
  assert.equal(reloaded.sellerOrders[0].failureReason, 'prior transient fulfillment error');

  const buyerLookup = await store.findOrderByProductOrderPinId('buyer-product-order-pin-id');
  assert.equal(buyerLookup.item.deliverySummary.result, 'Top-up card: 1234-5678');
  const sellerLookup = await store.findOrderByProductOrderPinId('seller-product-order-pin-id');
  assert.equal(sellerLookup.item.paymentVerified, true);
  assert.equal(sellerLookup.item.selectedSku.skuId, 'sku2');
  assert.equal(sellerLookup.item.fulfillmentState, 'delivered');
  assert.equal(sellerLookup.item.deliveryPinId, 'seller-delivery-pin-id');
  assert.equal(sellerLookup.item.failureReason, 'prior transient fulfillment error');
});

test('product state store rejects blank required identifiers before upserting', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  await assert.rejects(
    () => store.upsertOwnedListing({
      listingPinId: ' ',
      payload: listingPayload(),
    }),
    /listingPinId is required/,
  );
  await assert.rejects(
    () => store.upsertDirectoryItem({
      listingPinId: ' ',
      payload: listingPayload(),
    }),
    /listingPinId is required/,
  );
  await assert.rejects(
    () => store.upsertBuyerOrder({
      listingPinId: ' ',
      skuId: 'sku2',
    }),
    /listingPinId is required/,
  );
  await assert.rejects(
    () => store.upsertBuyerOrder({
      listingPinId: 'listing-pin-id',
      skuId: ' ',
    }),
    /skuId is required/,
  );
  await assert.rejects(
    () => store.upsertSellerOrder({
      productOrderPinId: ' ',
      listingPinId: 'listing-pin-id',
      skuId: 'sku2',
      paymentTxid: 'seller-payment-txid',
    }),
    /productOrderPinId is required/,
  );
  await assert.rejects(
    () => store.upsertSellerOrder({
      productOrderPinId: 'product-order-pin-id',
      listingPinId: ' ',
      skuId: 'sku2',
      paymentTxid: 'seller-payment-txid',
    }),
    /listingPinId is required/,
  );
  await assert.rejects(
    () => store.upsertSellerOrder({
      productOrderPinId: 'product-order-pin-id',
      listingPinId: 'listing-pin-id',
      skuId: ' ',
      paymentTxid: 'seller-payment-txid',
    }),
    /skuId is required/,
  );
  await assert.rejects(
    () => store.upsertSellerOrder({
      productOrderPinId: 'product-order-pin-id',
      listingPinId: 'listing-pin-id',
      skuId: 'sku2',
      paymentTxid: ' ',
    }),
    /paymentTxid is required/,
  );

  const state = await store.readState();
  assert.deepEqual(state.ownedListings, []);
  assert.deepEqual(state.directoryCache, []);
  assert.deepEqual(state.buyerOrders, []);
  assert.deepEqual(state.sellerOrders, []);
});

test('product state store serializes concurrent independent state updates', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  await Promise.all([
    store.updateState(async state => {
      await sleep(25);
      return {
        ...state,
        ownedListings: [
          ...state.ownedListings,
          {
            listingPinId: 'concurrent-listing-pin-id',
            localMetabotSlug: 'alice',
            name: 'mobile top-up card',
            title: 'Concurrent Listing',
            productType: 'virtual',
            skuCount: 1,
            fulfillmentSkills: ['S1'],
            payload: listingPayload('Concurrent Listing'),
            available: true,
            revokedAt: null,
            localUpdatedAt: 1770000003000,
          },
        ],
      };
    }),
    store.updateState(async state => {
      await sleep(25);
      return {
        ...state,
        buyerOrders: [
          ...state.buyerOrders,
          {
            role: 'buyer',
            productOrderPinId: 'concurrent-product-order-pin-id',
            listingPinId: 'concurrent-listing-pin-id',
            skuId: 'sku2',
            paymentTxid: 'concurrent-payment-txid',
            orderTxid: 'concurrent-order-txid',
            sellerGlobalMetaId: 'seller-global-metaid',
            deliverySummary: null,
            state: 'paid',
            localUpdatedAt: 1770000004000,
          },
        ],
      };
    }),
  ]);

  const state = await store.readState();

  assert.equal(state.ownedListings.length, 1);
  assert.equal(state.ownedListings[0].listingPinId, 'concurrent-listing-pin-id');
  assert.equal(state.buyerOrders.length, 1);
  assert.equal(state.buyerOrders[0].productOrderPinId, 'concurrent-product-order-pin-id');
});

test('product state store keeps its lock file under the profile locks directory', async () => {
  const profileRoot = await createTempProfileRoot();
  const store = createProductStateStore(profileRoot);

  await store.updateState(async state => {
    const lockPath = path.join(store.paths.locksRoot, 'product-state.lock');
    await fs.access(lockPath);
    return state;
  });

  await assert.rejects(
    () => fs.access(`${store.productStatePath}.lock`),
    { code: 'ENOENT' },
  );
});
