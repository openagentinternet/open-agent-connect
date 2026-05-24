import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  publishProductListingToChain,
  publishProductOrderToChain,
} = require('../../dist/core/products/productPublishChain.js');

function productListing(overrides = {}) {
  return {
    name: 'mobile top-up card',
    title: 'Mobile Top-Up Card Pack',
    productType: 'virtual',
    coverImage: 'metafile://cover_pinid.jpg',
    galleryImages: ['metafile://gallery_1.png'],
    descriptionContentType: 'text/markdown',
    description: 'Two virtual card options.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['S1', 'S2'],
      estimatedDeliverySeconds: 300,
      deliverableDescription: 'A top-up card number is sent after payment verification.',
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
    sellerMetaBot: 'must-not-leak',
    sellerName: 'must-not-leak',
    sellerPaymentAddress: 'must-not-leak',
    paymentChain: 'mvc',
    settlementKind: 'native',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    descriptionUri: 'metafile://must-not-leak.md',
    reviewPolicy: { required: true },
    ...overrides,
  };
}

function productOrder(overrides = {}) {
  return {
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    settlementKind: 'native',
    paymentTxid: 'a'.repeat(64),
    comment: 'Please send to the default account.',
    price: '0.00005',
    currency: 'SPACE',
    sellerMetaId: 'must-not-leak',
    sellerName: 'must-not-leak',
    buyerMetaId: 'must-not-leak',
    buyerName: 'must-not-leak',
    fulfillmentState: 'pending',
    reviewState: 'pending',
    snapshot: { title: 'must-not-leak' },
    paymentChain: 'mvc',
    sellerPaymentAddress: 'must-not-leak',
    ...overrides,
  };
}

test('publishProductListingToChain writes only the product-listing protocol payload', async () => {
  const writes = [];

  const result = await publishProductListingToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['listing-txid'],
          pinId: 'listing-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-listing',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'seller-global-metaid',
          mvcAddress: '1seller',
        };
      },
    },
    payload: productListing(),
    network: 'mvc',
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/product-listing');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].network, 'mvc');

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(payload.fulfillment.fulfillmentSkills, ['S1', 'S2']);
  assert.equal(payload.sellerMetaBot, undefined);
  assert.equal(payload.sellerName, undefined);
  assert.equal(payload.sellerPaymentAddress, undefined);
  assert.equal(payload.paymentChain, undefined);
  assert.equal(payload.createdAt, undefined);
  assert.equal(payload.updatedAt, undefined);
  assert.equal(payload.descriptionUri, undefined);
  assert.equal(payload.reviewPolicy, undefined);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.chainWrite.pinId, 'listing-pin-id');
});

test('publishProductOrderToChain writes only the product-order protocol payload', async () => {
  const writes = [];

  const result = await publishProductOrderToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['order-txid'],
          pinId: 'product-order-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-order',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'buyer-global-metaid',
          mvcAddress: '1buyer',
        };
      },
    },
    payload: productOrder(),
    network: 'mvc',
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/product-order');
  assert.equal(writes[0].contentType, 'application/json');

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(Object.keys(payload), [
    'listingPinId',
    'skuId',
    'settlementKind',
    'paymentTxid',
    'comment',
  ]);
  assert.deepEqual(payload, {
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    settlementKind: 'native',
    paymentTxid: 'a'.repeat(64),
    comment: 'Please send to the default account.',
  });
  assert.equal(payload.price, undefined);
  assert.equal(payload.currency, undefined);
  assert.equal(payload.sellerMetaId, undefined);
  assert.equal(payload.buyerMetaId, undefined);
  assert.equal(payload.fulfillmentState, undefined);
  assert.equal(payload.reviewState, undefined);
  assert.equal(payload.snapshot, undefined);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.chainWrite.pinId, 'product-order-pin-id');
});

test('publishProductOrderToChain omits optional fields when they are not provided', async () => {
  const writes = [];

  await publishProductOrderToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['order-txid'],
          pinId: 'product-order-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-order',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'buyer-global-metaid',
          mvcAddress: '1buyer',
        };
      },
    },
    payload: productOrder({ settlementKind: undefined, comment: undefined }),
  });

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(Object.keys(payload), ['listingPinId', 'skuId', 'paymentTxid']);
});
