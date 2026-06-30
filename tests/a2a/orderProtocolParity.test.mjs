import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('scoped protocol helpers match IDBots tag syntax', () => {
  const {
    buildOrderStatusMessage,
    buildDeliveryMessage,
    buildNeedsRatingMessage,
    buildOrderEndMessage,
    parseOrderStatusMessage,
    parseDeliveryMessage,
    parseNeedsRatingMessage,
    parseOrderEndMessage,
    parseOrderScopedProtocolMessage,
  } = require('../../dist/core/a2a/protocol/orderProtocol.js');

  const orderTxid = 'a'.repeat(64);
  const orderPinId = 'skill-service-order-pin-1';
  assert.equal(buildOrderStatusMessage(orderTxid, 'accepted'), `[ORDER_STATUS:${orderTxid}] accepted`);
  assert.equal(buildNeedsRatingMessage(orderTxid, 'please rate'), `[NeedsRating:${orderTxid}] please rate`);
  assert.equal(buildOrderEndMessage(orderTxid, 'rated', 'thanks'), `[ORDER_END:${orderTxid} rated] thanks`);
  assert.equal(
    buildNeedsRatingMessage(orderTxid, 'please rate', orderPinId),
    `[NeedsRating:${orderTxid}] please rate\norder pin id: ${orderPinId}`
  );
  assert.equal(
    buildOrderEndMessage(orderTxid, 'rated', 'thanks', { serviceOrderPinId: orderPinId }),
    `[ORDER_END:${orderTxid} rated] thanks\norder pin id: ${orderPinId}`
  );

  const delivery = buildDeliveryMessage({ paymentTxid: 'b'.repeat(64), result: '# Done' }, orderTxid);
  assert.ok(delivery.startsWith(`[DELIVERY:${orderTxid}] `));
  assert.deepEqual(parseDeliveryMessage(delivery), {
    orderTxid,
    paymentTxid: 'b'.repeat(64),
    result: '# Done',
  });
  assert.deepEqual(parseOrderScopedProtocolMessage(delivery), {
    orderTxid,
    paymentTxid: 'b'.repeat(64),
    result: '# Done',
  });
  assert.deepEqual(parseNeedsRatingMessage(`[NeedsRating:${orderTxid}] please rate`), {
    orderTxid,
    content: 'please rate',
  });
  assert.deepEqual(parseNeedsRatingMessage(`[NeedsRating:${orderTxid}] please rate\norder pin id: ${orderPinId}`), {
    orderTxid,
    orderPinId,
    content: 'please rate',
  });
  assert.deepEqual(parseNeedsRatingMessage(`[NeedsRating:${orderTxid}] please rate\norder pin id: /protocols/${orderPinId}`), {
    orderTxid,
    orderPinId: `/protocols/${orderPinId}`,
    content: 'please rate',
  });
  assert.deepEqual(parseOrderStatusMessage(`[ORDER_STATUS:${orderTxid}] accepted`), {
    orderTxid,
    content: 'accepted',
  });
  assert.deepEqual(parseOrderEndMessage(`[ORDER_END:${orderTxid} rated] thanks`), {
    orderTxid,
    reason: 'rated',
    content: 'thanks',
  });
  assert.deepEqual(parseOrderEndMessage(`[ORDER_END:${orderTxid} rated] thanks\norder pin id: ${orderPinId}`), {
    orderTxid,
    orderPinId,
    reason: 'rated',
    content: 'thanks',
  });
  assert.deepEqual(parseOrderEndMessage(`[ORDER_END:${orderTxid} rated] thanks\norder pin id: /protocols/${orderPinId}`), {
    orderTxid,
    orderPinId: `/protocols/${orderPinId}`,
    reason: 'rated',
    content: 'thanks',
  });
  assert.deepEqual(parseOrderScopedProtocolMessage(`[ORDER_STATUS:${orderTxid}] accepted`), {
    orderTxid,
    content: 'accepted',
  });
  assert.deepEqual(parseOrderScopedProtocolMessage(`[ORDER_END:${orderTxid} rated] thanks`), {
    orderTxid,
    reason: 'rated',
    content: 'thanks',
  });
});

test('scoped order protocol parsers reject malformed or unrelated content', () => {
  const {
    parseOrderStatusMessage,
    parseDeliveryMessage,
    parseNeedsRatingMessage,
    parseOrderEndMessage,
    parseOrderScopedProtocolMessage,
  } = require('../../dist/core/a2a/protocol/orderProtocol.js');

  assert.equal(parseOrderStatusMessage('[ORDER_STATUS:not-a-txid] accepted'), null);
  assert.equal(parseDeliveryMessage('[DELIVERY:not-a-txid] {"result":"ok"}'), null);
  assert.equal(parseNeedsRatingMessage('[NeedsRating:not-a-txid] rate'), null);
  assert.equal(parseOrderEndMessage('[ORDER_END:not-a-txid rated] thanks'), null);
  assert.equal(parseOrderScopedProtocolMessage('plain private chat'), null);
});
