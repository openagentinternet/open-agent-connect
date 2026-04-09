import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildProviderConsoleSnapshot } = require('../../dist/core/provider/providerConsole.js');

function createServiceRecord(overrides = {}) {
  return {
    id: 'service-pin-1',
    sourceServicePinId: 'service-pin-1',
    currentPinId: 'service-pin-1',
    creatorMetabotId: 1,
    providerGlobalMetaId: 'idq1provider',
    providerSkill: 'tarot-rws',
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads one tarot card.',
    serviceIcon: null,
    price: '0.00001',
    currency: 'SPACE',
    skillDocument: '# Tarot Reading',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: 'mvc-address-1',
    payloadJson: '{"serviceName":"tarot-rws-service"}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_000_000,
    ...overrides,
  };
}

function createSellerTrace(overrides = {}) {
  return {
    traceId: 'trace-provider-1',
    createdAt: 1_775_000_010_000,
    session: {
      id: 'session-trace-provider-1',
      title: 'Tarot Reading Execution',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1buyer',
      peerName: 'Buyer Bot',
      externalConversationId: 'a2a-session:idq1buyer:trace-provider-1',
    },
    order: {
      id: 'order-trace-provider-1',
      role: 'seller',
      serviceId: 'service-pin-1',
      serviceName: 'Tarot Reading',
      paymentTxid: 'a'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00001',
    },
    a2a: {
      publicStatus: 'completed',
      taskRunState: 'completed',
    },
    ...overrides,
  };
}

test('buildProviderConsoleSnapshot summarizes published services and seller-side order activity', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [createServiceRecord()],
    traces: [createSellerTrace()],
  });

  assert.equal(snapshot.services.length, 1);
  assert.equal(snapshot.services[0].servicePinId, 'service-pin-1');
  assert.equal(snapshot.services[0].available, true);
  assert.equal(snapshot.recentOrders.length, 1);
  assert.equal(snapshot.recentOrders[0].traceId, 'trace-provider-1');
  assert.equal(snapshot.recentOrders[0].servicePinId, 'service-pin-1');
  assert.equal(snapshot.totals.sellerOrderCount, 1);
});

test('buildProviderConsoleSnapshot surfaces refund_pending seller traces as manual refund actions', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [],
    traces: [
      createSellerTrace({
        traceId: 'trace-provider-refund',
        order: {
          id: 'order-refund-1',
          role: 'seller',
          status: 'refund_pending',
          serviceId: 'service-pin-1',
          serviceName: 'Tarot Reading',
          paymentTxid: 'b'.repeat(64),
          paymentCurrency: 'SPACE',
          paymentAmount: '0.00001',
          refundRequestPinId: 'refund-pin-1',
          coworkSessionId: 'seller-session-1',
        },
      }),
    ],
  });

  assert.equal(snapshot.manualActions.length, 1);
  assert.deepEqual(snapshot.manualActions[0], {
    kind: 'refund',
    traceId: 'trace-provider-refund',
    orderId: 'order-refund-1',
    refundRequestPinId: 'refund-pin-1',
    sessionId: 'seller-session-1',
  });
});

test('buildProviderConsoleSnapshot drops manual refund work once the seller trace is already refunded', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [],
    traces: [
      createSellerTrace({
        traceId: 'trace-provider-refund-complete',
        order: {
          id: 'order-refund-2',
          role: 'seller',
          status: 'refunded',
          serviceId: 'service-pin-1',
          serviceName: 'Tarot Reading',
          paymentTxid: 'c'.repeat(64),
          paymentCurrency: 'SPACE',
          paymentAmount: '0.00001',
          refundRequestPinId: 'refund-pin-2',
          coworkSessionId: 'seller-session-2',
        },
      }),
    ],
  });

  assert.deepEqual(snapshot.manualActions, []);
});
