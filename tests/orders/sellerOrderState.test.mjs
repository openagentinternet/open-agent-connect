import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  SELLER_ORDER_STATES,
  createSellerOrderRecord,
  transitionSellerOrderRecord,
} = require('../../dist/core/orders/sellerOrderState.js');

function createBaseInput(overrides = {}) {
  return {
    id: 'seller-order-1',
    localMetabotId: 1,
    localMetabotSlug: 'provider-bot',
    providerGlobalMetaId: 'idq1provider',
    buyerGlobalMetaId: 'idq1buyer',
    servicePinId: 'service-pin-1',
    currentServicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    providerSkill: 'metabot-weather-oracle',
    orderMessageId: 'order-message-pin-1',
    orderPinId: 'order-message-pin-1',
    orderTxid: 'a'.repeat(64),
    paymentTxid: 'b'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    traceId: 'trace-provider-1',
    a2aSessionId: 'a2a-order-session-1',
    a2aTaskRunId: 'a2a-task-run-1',
    state: 'received',
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_000_000,
    ...overrides,
  };
}

test('seller order state list includes every Phase 5 lifecycle state', () => {
  assert.deepEqual(SELLER_ORDER_STATES, [
    'received',
    'acknowledged',
    'in_progress',
    'completed',
    'rating_pending',
    'failed',
    'refund_pending',
    'refunded',
    'ended',
  ]);
});

test('createSellerOrderRecord stores required provider, service, order, payment, trace, and runtime fields', () => {
  const record = createSellerOrderRecord(createBaseInput({
    llmSessionId: 'llm-session-1',
    runtimeId: 'runtime-codex',
    runtimeProvider: 'codex',
    fallbackSelected: false,
  }));

  assert.equal(record.localMetabotId, 1);
  assert.equal(record.localMetabotSlug, 'provider-bot');
  assert.equal(record.providerGlobalMetaId, 'idq1provider');
  assert.equal(record.buyerGlobalMetaId, 'idq1buyer');
  assert.equal(record.servicePinId, 'service-pin-1');
  assert.equal(record.currentServicePinId, 'service-pin-1');
  assert.equal(record.providerSkill, 'metabot-weather-oracle');
  assert.equal(record.orderMessageId, 'order-message-pin-1');
  assert.equal(record.paymentTxid, 'b'.repeat(64));
  assert.equal(record.traceId, 'trace-provider-1');
  assert.equal(record.a2aSessionId, 'a2a-order-session-1');
  assert.equal(record.llmSessionId, 'llm-session-1');
  assert.equal(record.runtimeId, 'runtime-codex');
  assert.equal(record.runtimeProvider, 'codex');
});

test('transitionSellerOrderRecord allows forward seller lifecycle transitions and rejects impossible backwards transitions', () => {
  let record = createSellerOrderRecord(createBaseInput());

  for (const state of ['acknowledged', 'in_progress', 'completed', 'rating_pending', 'refund_pending', 'refunded', 'ended']) {
    record = transitionSellerOrderRecord(record, {
      state,
      updatedAt: record.updatedAt + 1,
    });
    assert.equal(record.state, state);
  }

  assert.throws(
    () => transitionSellerOrderRecord(record, { state: 'in_progress', updatedAt: record.updatedAt + 1 }),
    /invalid seller order state transition/i,
  );
});

test('transitionSellerOrderRecord supports failure-to-refund lifecycle transitions', () => {
  let record = createSellerOrderRecord(createBaseInput());
  record = transitionSellerOrderRecord(record, {
    state: 'failed',
    failureReason: 'provider execution failed',
    endedAt: 1_775_000_010_000,
    updatedAt: 1_775_000_010_000,
  });
  assert.equal(record.state, 'failed');
  assert.equal(record.failureReason, 'provider execution failed');

  record = transitionSellerOrderRecord(record, {
    state: 'refund_pending',
    refundRequestPinId: 'refund-request-pin-1',
    updatedAt: 1_775_000_020_000,
  });
  assert.equal(record.state, 'refund_pending');
  assert.equal(record.refundRequestPinId, 'refund-request-pin-1');

  record = transitionSellerOrderRecord(record, {
    state: 'refunded',
    refundTxid: 'refund-txid-1',
    refundedAt: 1_775_000_030_000,
    updatedAt: 1_775_000_030_000,
  });
  assert.equal(record.state, 'refunded');
  assert.equal(record.refundTxid, 'refund-txid-1');
});
