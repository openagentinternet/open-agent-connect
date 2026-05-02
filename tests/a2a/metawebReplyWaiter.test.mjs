import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('scoped delivery correlation does not fall back to service id for a different order', () => {
  const {
    normalizeOrderProtocolReference,
    shouldAcceptServiceDeliveryForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const expectedOrderTxid = 'a'.repeat(64);
  const otherOrderTxid = 'b'.repeat(64);
  const expectedPaymentTxid = 'c'.repeat(64);
  const otherPaymentTxid = 'd'.repeat(64);

  assert.equal(normalizeOrderProtocolReference(`${expectedOrderTxid}i0`), expectedOrderTxid);
  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: otherOrderTxid,
      paymentTxid: otherPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: expectedOrderTxid,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), false);
});

test('scoped delivery requires order or payment correlation when no expected order txid is known', () => {
  const {
    shouldAcceptServiceDeliveryForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const scopedOrderTxid = 'a'.repeat(64);
  const expectedPaymentTxid = 'c'.repeat(64);
  const otherPaymentTxid = 'd'.repeat(64);

  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: scopedOrderTxid,
      paymentTxid: otherPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: null,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), false);

  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: scopedOrderTxid,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: null,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), true);
});

test('rating request scope must match expected or pending delivery order scope', () => {
  const {
    shouldAcceptServiceRatingRequestForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const expectedOrderTxid = 'a'.repeat(64);
  const otherOrderTxid = 'b'.repeat(64);

  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: otherOrderTxid,
    expectedOrderTxid,
    pendingDeliveryOrderTxid: expectedOrderTxid,
  }), false);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid,
    pendingDeliveryOrderTxid: null,
  }), true);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid: null,
    pendingDeliveryOrderTxid: expectedOrderTxid,
  }), true);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid: null,
    pendingDeliveryOrderTxid: null,
  }), false);
});
