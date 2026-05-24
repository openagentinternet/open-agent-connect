import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  normalizeProductCurrency,
  validateProductListingPayload,
  validateProductOrderPayload,
} = require('../../dist/core/products/productValidation.js');

function validListing(overrides = {}) {
  return {
    name: 'mobile top-up card',
    title: 'Mobile Top-Up Card Pack',
    productType: 'virtual',
    coverImage: 'metafile://cover_pinid.jpg',
    galleryImages: ['metafile://gallery_1.png', 'metafile://gallery_2.png'],
    descriptionContentType: 'text/markdown',
    description: '## What is included\n\nTwo virtual card options.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['S1'],
      estimatedDeliverySeconds: 300,
      deliverableDescription: 'A top-up card number is sent after payment verification.',
    },
    skus: [
      {
        skuId: 'sku1',
        name: 'Small Top-Up Card',
        image: 'metafile://sku_1.png',
        descriptionContentType: 'text/markdown',
        description: 'Small mobile top-up card.',
        price: {
          amount: '0.00001',
          currency: 'SPACE',
        },
        initialStock: 100,
      },
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
    ...overrides,
  };
}

function validOrder(overrides = {}) {
  return {
    listingPinId: 'listing_pinid_i0',
    skuId: 'sku2',
    paymentTxid: 'a'.repeat(64),
    ...overrides,
  };
}

test('validates a V1 virtual product listing with two SKUs and simplemsg fulfillment', () => {
  const result = validateProductListingPayload(validListing());

  assert.equal(result.ok, true);
  assert.equal(result.value.skus.length, 2);
  assert.deepEqual(result.value.fulfillment.fulfillmentSkills, ['S1']);
});

test('preserves all fulfillment skills in a valid product listing', () => {
  const payload = validListing({
    fulfillment: {
      ...validListing().fulfillment,
      fulfillmentSkills: ['S1', 'S2'],
    },
  });

  const result = validateProductListingPayload(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.fulfillment.fulfillmentSkills, ['S1', 'S2']);
});

test('returns stable validation codes for invalid product-listing payloads', () => {
  const cases = [
    ['invalid_product_type', { productType: 'service' }],
    ['invalid_cover_image_uri', { coverImage: 'https://example.test/cover.png' }],
    ['invalid_gallery_image_uri', { galleryImages: ['metafile://gallery_1.png', 'ipfs://bad'] }],
    ['invalid_description_content_type', { descriptionContentType: 'application/json' }],
    [
      'missing_fulfillment_skill',
      {
        fulfillment: {
          ...validListing().fulfillment,
          fulfillmentSkills: [],
        },
      },
    ],
    [
      'duplicate_sku_id',
      {
        skus: validListing().skus.map((sku) => ({ ...sku, skuId: 'same-sku' })),
      },
    ],
    [
      'invalid_sku_price',
      {
        skus: [{ ...validListing().skus[0], price: { amount: 'free', currency: 'SPACE' } }],
      },
    ],
    [
      'invalid_initial_stock',
      {
        skus: [{ ...validListing().skus[0], initialStock: 0 }],
      },
    ],
    [
      'unsupported_fulfillment_endpoint',
      {
        fulfillment: {
          ...validListing().fulfillment,
          deliveryEndpoint: 'email',
        },
      },
    ],
  ];

  for (const [expectedCode, overrides] of cases) {
    const result = validateProductListingPayload(validListing(overrides));
    assert.equal(result.ok, false, expectedCode);
    assert.equal(result.code, expectedCode);
  }
});

test('validates product-order payloads and defaults settlementKind to native', () => {
  const result = validateProductOrderPayload(validOrder({ comment: 'Please send to the default account.' }));

  assert.equal(result.ok, true);
  assert.equal(result.value.listingPinId, 'listing_pinid_i0');
  assert.equal(result.value.skuId, 'sku2');
  assert.equal(result.value.paymentTxid, 'a'.repeat(64));
  assert.equal(result.value.settlementKind, 'native');
  assert.equal(result.value.comment, 'Please send to the default account.');
});

test('accepts an explicit native settlementKind in product-order payloads', () => {
  const result = validateProductOrderPayload(validOrder({ settlementKind: 'native' }));

  assert.equal(result.ok, true);
  assert.equal(result.value.settlementKind, 'native');
});

test('rejects invalid product-order payloads', () => {
  const cases = [
    ['missing_listing_pin_id', { listingPinId: '' }],
    ['missing_sku_id', { skuId: '' }],
    ['invalid_payment_txid', { paymentTxid: '' }],
    ['unsupported_settlement_kind', { settlementKind: 'mrc20' }],
    ['invalid_comment', { comment: { text: 'not plain text' } }],
  ];

  for (const [expectedCode, overrides] of cases) {
    const result = validateProductOrderPayload(validOrder(overrides));
    assert.equal(result.ok, false, expectedCode);
    assert.equal(result.code, expectedCode);
  }
});

test('normalizes product currency to uppercase SPACE first', () => {
  assert.equal(normalizeProductCurrency('space'), 'SPACE');
  assert.equal(normalizeProductCurrency(' SPACE '), 'SPACE');
});
