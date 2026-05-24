import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  planProductPurchase,
} = require('../../dist/core/products/productPurchasePlanner.js');

function listing(overrides = {}) {
  return {
    name: 'space-mobile-top-up',
    title: 'SPACE Mobile Top-up Card',
    productType: 'virtual',
    coverImage: 'metafile://cover.png',
    descriptionContentType: 'text/markdown',
    description: 'Mobile top-up card delivered through private chat.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['deliver-mobile-top-up', 'answer-top-up-question'],
      estimatedDeliverySeconds: 300,
    },
    skus: [
      {
        skuId: 'space-00005',
        name: '0.00005 SPACE card',
        image: 'metafile://sku.png',
        descriptionContentType: 'text/markdown',
        description: 'A small mobile top-up code.',
        price: { amount: '0.00005', currency: 'SPACE' },
        initialStock: 10,
      },
      {
        skuId: 'space-00010',
        name: '0.00010 SPACE card',
        image: 'metafile://sku-2.png',
        descriptionContentType: 'text/markdown',
        description: 'A larger mobile top-up code.',
        price: { amount: '0.00010', currency: 'SPACE' },
        initialStock: 10,
      },
    ],
    ...overrides,
  };
}

function product(overrides = {}) {
  const payload = overrides.payload ?? listing(overrides.listing ?? {});
  return {
    listingPinId: 'listing-space-card',
    name: payload.name,
    title: payload.title,
    productType: payload.productType,
    skuCount: payload.skus.length,
    skus: payload.skus,
    fulfillment: payload.fulfillment,
    payload,
    sellerGlobalMetaId: 'alice-global-metaid',
    sellerName: 'Alice',
    online: true,
    cachedAt: 1770000000000,
    ...overrides,
  };
}

function purchaseRequest(overrides = {}) {
  return {
    query: 'buy Alice 0.00005 SPACE mobile top-up card',
    listingPinId: 'listing-space-card',
    skuId: 'space-00005',
    comment: '',
    spendCap: {
      amount: '0.00005',
      currency: 'SPACE',
    },
    policyMode: 'confirm_paid_only',
    confirmed: true,
    ...overrides,
  };
}

test('planProductPurchase selects an exact listingPinId and skuId pair', () => {
  const result = planProductPurchase({
    request: purchaseRequest(),
    products: [
      product({ listingPinId: 'other-listing' }),
      product(),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.product.listingPinId, 'listing-space-card');
  assert.equal(result.sku.skuId, 'space-00005');
  assert.equal(result.payment.amount, '0.00005');
  assert.equal(result.payment.currency, 'SPACE');
});

test('planProductPurchase selects a query-only request from the online product cache', () => {
  const result = planProductPurchase({
    request: purchaseRequest({ listingPinId: '', skuId: '', confirmed: true }),
    products: [
      product({
        listingPinId: 'unrelated',
        sellerName: 'Carol',
        listing: {
          name: 'weather-report',
          title: 'Weather Report',
          description: 'Weather forecast delivered by private chat.',
          skus: [
            {
              skuId: 'weather-basic',
              name: 'Basic forecast',
              image: 'metafile://weather.png',
              descriptionContentType: 'text/markdown',
              description: 'Tomorrow forecast.',
              price: { amount: '1', currency: 'SPACE' },
              initialStock: 10,
            },
          ],
        },
      }),
      product(),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.product.listingPinId, 'listing-space-card');
  assert.equal(result.sku.skuId, 'space-00005');
});

test('planProductPurchase returns cached_product_match_not_found when no cached product matches', () => {
  const result = planProductPurchase({
    request: purchaseRequest({ listingPinId: '', skuId: '', query: 'buy a missing item' }),
    products: [product()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'cached_product_match_not_found');
});

test('planProductPurchase rejects offline products before payment planning', () => {
  const result = planProductPurchase({
    request: purchaseRequest(),
    products: [product({ online: false })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_offline');
});

test('planProductPurchase rejects physical products for V1', () => {
  const result = planProductPurchase({
    request: purchaseRequest(),
    products: [product({ listing: { productType: 'physical' } })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_product_type');
});

test('planProductPurchase rejects non-digital fulfillment for V1', () => {
  const result = planProductPurchase({
    request: purchaseRequest(),
    products: [product({
      listing: {
        fulfillment: {
          fulfillmentType: 'physical_shipping',
          deliveryEndpoint: 'simplemsg',
          fulfillmentSkills: ['ship-product'],
        },
      },
    })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_fulfillment_type');
});

test('planProductPurchase rejects non-simplemsg fulfillment endpoints for V1', () => {
  const result = planProductPurchase({
    request: purchaseRequest(),
    products: [product({
      listing: {
        fulfillment: {
          fulfillmentType: 'digital_delivery',
          deliveryEndpoint: 'logistics',
          fulfillmentSkills: ['deliver-product'],
        },
      },
    })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_fulfillment_endpoint');
});

test('planProductPurchase rejects prices above the spend cap', () => {
  const result = planProductPurchase({
    request: purchaseRequest({
      spendCap: {
        amount: '0.00004',
        currency: 'SPACE',
      },
    }),
    products: [product()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_spend_cap_exceeded');
});

test('planProductPurchase returns confirmation metadata for the first paid unconfirmed call', () => {
  const result = planProductPurchase({
    request: purchaseRequest({ confirmed: false }),
    products: [product()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.confirmation.requiresConfirmation, true);
  assert.equal(result.confirmation.policyMode, 'confirm_paid_only');
  assert.deepEqual(result.confirmRequest.request, {
    query: 'buy Alice 0.00005 SPACE mobile top-up card',
    listingPinId: 'listing-space-card',
    skuId: 'space-00005',
    comment: '',
    spendCap: {
      amount: '0.00005',
      currency: 'SPACE',
    },
    policyMode: 'confirm_paid_only',
    confirmed: true,
  });
});

test('planProductPurchase returns a payment-ready plan for confirmed requests', () => {
  const result = planProductPurchase({
    request: purchaseRequest({ confirmed: true }),
    products: [product()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.confirmation.requiresConfirmation, true);
  assert.equal(result.payment.amount, '0.00005');
  assert.equal(result.payment.currency, 'SPACE');
});
