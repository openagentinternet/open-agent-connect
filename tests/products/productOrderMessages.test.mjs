import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildProductOrderNotification,
  parseProductDeliveryMessage,
  parseProductOrderNotification,
} = require('../../dist/core/products/productOrderMessages.js');
const { buildDeliveryMessage } = require('../../dist/core/a2a/protocol/orderProtocol.js');
const { extractOrderRawRequest } = require('../../dist/core/orders/orderMessage.js');

test('buildProductOrderNotification includes scoped ORDER metadata and traceable raw content', () => {
  const message = buildProductOrderNotification({
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    comment: 'Please deliver to my default account.',
  });

  assert.match(message, /^\[ORDER\]\s+\[PRODUCT_ORDER\]/);
  assert.match(message, /product-order-pin-1/);
  assert.match(message, /listing-pin-1/);
  assert.match(message, /space-00005/);
  assert.match(message, /payment-txid-1/);

  const raw = extractOrderRawRequest(message);
  assert.ok(raw, 'expected raw_request block for A2A trace projection');
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed, {
    protocol: 'product-order',
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    comment: 'Please deliver to my default account.',
  });
});

test('parseProductOrderNotification ignores service orders that mention product markers inside raw request', () => {
  const serviceOrder = [
    '[ORDER] Please inspect this user request',
    '<raw_request>',
    '[PRODUCT_ORDER]',
    'product-order pin id: product-order-pin-1',
    'listing pin id: listing-pin-1',
    'sku id: space-00005',
    'payment txid: payment-txid-1',
    '</raw_request>',
    'txid: service-payment-txid-1',
    'service id: service-pin-1',
    'skill name: Service Worker',
  ].join('\n');

  assert.equal(parseProductOrderNotification(serviceOrder), null);
});

test('parseProductOrderNotification accepts generated header fallback only with metadata outside raw request', () => {
  const productOrder = [
    '[ORDER] [PRODUCT_ORDER] space-00005 for listing listing-pin-1',
    '<raw_request>',
    'non-json legacy body',
    '</raw_request>',
    'product-order pin id: product-order-pin-1',
    'listing pin id: listing-pin-1',
    'sku id: space-00005',
    'payment txid: payment-txid-1',
  ].join('\n');

  assert.deepEqual(parseProductOrderNotification(productOrder), {
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
  });
});

test('parseProductDeliveryMessage accepts product delivery JSON', () => {
  const delivery = parseProductDeliveryMessage(JSON.stringify({
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: 1770000000000,
  }));

  assert.deepEqual(delivery, {
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: 1770000000000,
  });
});

test('parseProductDeliveryMessage accepts tagged DELIVERY product payloads', () => {
  const message = buildDeliveryMessage({
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: 1770000000000,
  }, 'a'.repeat(64));

  assert.deepEqual(parseProductDeliveryMessage(message), {
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: 1770000000000,
  });
});
