import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifySimplemsgContent,
} = require('../../dist/core/a2a/simplemsgClassifier.js');
const {
  buildProductOrderNotification,
} = require('../../dist/core/products/productOrderMessages.js');
const {
  buildDeliveryMessage,
} = require('../../dist/core/a2a/protocol/orderProtocol.js');

const ORDER_TXID = 'a'.repeat(64);

test('simplemsg classifier treats ordinary plaintext as private chat', () => {
  assert.deepEqual(classifySimplemsgContent('hello remote bot'), {
    kind: 'private_chat',
  });
});

test('simplemsg classifier recognizes the ORDER start tag', () => {
  assert.deepEqual(classifySimplemsgContent('[ORDER] please run the weather service'), {
    kind: 'order_protocol',
    tag: 'ORDER',
    orderTxid: null,
    orderPinId: null,
    reason: null,
  });
});

test('simplemsg classifier recognizes scoped IDBots order protocol tags', () => {
  assert.deepEqual(classifySimplemsgContent(`[ORDER_STATUS:${ORDER_TXID}] accepted`), {
    kind: 'order_protocol',
    tag: 'ORDER_STATUS',
    orderTxid: ORDER_TXID,
    orderPinId: null,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[DELIVERY:${ORDER_TXID}] {"result":"ok"}`), {
    kind: 'order_protocol',
    tag: 'DELIVERY',
    orderTxid: ORDER_TXID,
    orderPinId: null,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[NeedsRating:${ORDER_TXID}] please rate`), {
    kind: 'order_protocol',
    tag: 'NeedsRating',
    orderTxid: ORDER_TXID,
    orderPinId: null,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[ORDER_END:${ORDER_TXID} rated] done`), {
    kind: 'order_protocol',
    tag: 'ORDER_END',
    orderTxid: ORDER_TXID,
    orderPinId: null,
    reason: 'rated',
  });
});

test('simplemsg classifier keeps legacy delivery and needs-rating compatible', () => {
  assert.deepEqual(classifySimplemsgContent('[DELIVERY] {"result":"ok"}'), {
    kind: 'order_protocol',
    tag: 'DELIVERY',
    orderTxid: null,
    orderPinId: null,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent('[NEEDSRATING] please rate'), {
    kind: 'order_protocol',
    tag: 'NeedsRating',
    orderTxid: null,
    orderPinId: null,
    reason: null,
  });
});

test('simplemsg classifier treats unknown bracketed text as private chat', () => {
  assert.deepEqual(classifySimplemsgContent('[HELLO] not a known A2A protocol tag'), {
    kind: 'private_chat',
  });
});

test('simplemsg classifier exposes product order metadata without changing service orders', () => {
  const content = buildProductOrderNotification({
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
  });

  assert.deepEqual(classifySimplemsgContent(content), {
    kind: 'order_protocol',
    tag: 'ORDER',
    orderTxid: null,
    orderPinId: null,
    reason: null,
    orderKind: 'product_order',
    product: {
      productOrderPinId: 'product-order-pin-1',
      listingPinId: 'listing-pin-1',
      skuId: 'space-00005',
      paymentTxid: 'payment-txid-1',
    },
  });

  assert.deepEqual(classifySimplemsgContent('[ORDER] please run the weather service'), {
    kind: 'order_protocol',
    tag: 'ORDER',
    orderTxid: null,
    orderPinId: null,
    reason: null,
  });
});

test('simplemsg classifier does not treat product-looking raw service requests as product orders', () => {
  const content = [
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

  assert.deepEqual(classifySimplemsgContent(content), {
    kind: 'order_protocol',
    tag: 'ORDER',
    orderTxid: null,
    orderPinId: null,
    reason: null,
  });
});

test('simplemsg classifier keeps product delivery compatible with DELIVERY and exposes product metadata', () => {
  const delivery = buildDeliveryMessage({
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-pin-1',
    skuId: 'space-00005',
    paymentTxid: 'payment-txid-1',
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: 1770000000000,
  }, ORDER_TXID);

  assert.deepEqual(classifySimplemsgContent(delivery), {
    kind: 'order_protocol',
    tag: 'DELIVERY',
    orderTxid: ORDER_TXID,
    orderPinId: null,
    reason: null,
    orderKind: 'product_order',
    product: {
      productOrderPinId: 'product-order-pin-1',
      listingPinId: 'listing-pin-1',
      skuId: 'space-00005',
      paymentTxid: 'payment-txid-1',
      deliveredAt: 1770000000000,
    },
  });
});
