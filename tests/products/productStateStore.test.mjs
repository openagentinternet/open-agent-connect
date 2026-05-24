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
});
