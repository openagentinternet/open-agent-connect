import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  findSellerOrderBySelector,
  buildProviderSellerOrderInspection,
  buildSellerReceivedRefundItems,
} = require('../../dist/core/provider/providerOperations.js');

function createSellerOrder(overrides = {}) {
  return {
    id: 'seller-order-payment-txid-1',
    serviceOrderPinId: 'skill-service-order-pin-1',
    state: 'refund_pending',
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
    orderReference: 'skill-service-order-pin-1',
    paymentTxid: 'b'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-provider-1',
    a2aSessionId: 'a2a-order-session-1',
    refundRequestPinId: 'refund-request-pin-1',
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_001_000,
    ...overrides,
  };
}

test('provider seller order lookup and refund projection accept service order pin ids', () => {
  const order = createSellerOrder();
  const state = {
    identity: null,
    services: [],
    traces: [],
    sellerOrders: [order],
  };

  const selected = findSellerOrderBySelector(state, {
    orderId: 'skill-service-order-pin-1',
  });

  assert.equal(selected.status, 'found');
  assert.equal(selected.order.id, 'seller-order-payment-txid-1');
  assert.equal(buildProviderSellerOrderInspection(selected.order).serviceOrderPinId, 'skill-service-order-pin-1');
  assert.equal(buildSellerReceivedRefundItems(state)[0].orderId, 'skill-service-order-pin-1');
});
