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

function createMasterTrace(overrides = {}) {
  return {
    traceId: 'trace-master-provider-1',
    createdAt: 1_775_000_040_000,
    session: {
      id: 'session-master-provider-1',
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1caller',
      peerName: 'Caller Bot',
      externalConversationId: 'master:idq1caller:idq1provider:trace-master-provider-1',
    },
    order: null,
    a2a: {
      role: 'provider',
      publicStatus: 'completed',
      latestEvent: 'provider_completed',
      taskRunState: 'completed',
      callerGlobalMetaId: 'idq1caller',
      callerName: 'Caller Bot',
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
    },
    ...overrides,
  };
}

function createMasterRecord(overrides = {}) {
  return {
    id: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    currentPinId: 'master-pin-1',
    creatorMetabotId: 1,
    providerGlobalMetaId: 'idq1provider',
    providerAddress: 'mvc-address-1',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfoJson: '{"provider":"metaweb","model":"official-debug-master-v1"}',
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: 1,
    trustedTier: 'official',
    payloadJson: '{}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_035_000,
    ...overrides,
  };
}

test('buildProviderConsoleSnapshot summarizes published services and seller-side order activity', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [createServiceRecord()],
    traces: [createSellerTrace()],
    sellerOrders: [
      {
        id: 'seller-order-runtime-1',
        state: 'in_progress',
        localMetabotId: 1,
        localMetabotSlug: 'provider-bot',
        providerGlobalMetaId: 'idq1provider',
        buyerGlobalMetaId: 'idq1buyer',
        servicePinId: 'service-pin-1',
        currentServicePinId: 'service-pin-1',
        serviceName: 'Tarot Reading',
        providerSkill: 'tarot-rws',
        orderMessageId: 'order-message-pin-1',
        orderPinId: 'order-message-pin-1',
        orderTxid: 'd'.repeat(64),
        paymentTxid: 'e'.repeat(64),
        paymentAmount: '0.00001',
        paymentCurrency: 'SPACE',
        traceId: 'trace-provider-runtime',
        a2aSessionId: 'a2a-order-session-runtime',
        a2aTaskRunId: 'a2a-task-runtime',
        llmSessionId: 'llm-session-runtime',
        runtimeId: 'runtime-codex',
        runtimeProvider: 'codex',
        createdAt: 1_775_000_015_000,
        updatedAt: 1_775_000_016_000,
      },
    ],
    ratingDetails: [],
  });

  assert.equal(snapshot.services.length, 1);
  assert.equal(snapshot.services[0].servicePinId, 'service-pin-1');
  assert.equal(snapshot.services[0].available, true);
  assert.equal(snapshot.recentOrders.length, 2);
  assert.equal(snapshot.recentOrders[0].traceId, 'trace-provider-runtime');
  assert.equal(snapshot.recentOrders[0].state, 'in_progress');
  assert.equal(snapshot.recentOrders[0].llmSessionId, 'llm-session-runtime');
  assert.equal(snapshot.recentOrders[0].runtimeId, 'runtime-codex');
  assert.equal(snapshot.recentOrders[1].traceId, 'trace-provider-1');
  assert.equal(snapshot.recentOrders[1].servicePinId, 'service-pin-1');
  assert.equal(snapshot.recentOrders[1].ratingStatus, 'requested_unrated');
  assert.equal(snapshot.recentOrders[1].ratingValue, null);
  assert.equal(snapshot.recentOrders[1].ratingComment, null);
  assert.equal(snapshot.recentOrders[1].ratingPinId, null);
  assert.equal(snapshot.recentOrders[1].ratingCreatedAt, null);
  assert.equal(snapshot.totals.sellerOrderCount, 2);
});

test('buildProviderConsoleSnapshot joins a matching on-chain rating onto the seller order', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [createServiceRecord()],
    traces: [createSellerTrace()],
    ratingDetails: [
      {
        pinId: 'rating-pin-1',
        serviceId: 'service-pin-1',
        servicePaidTx: 'a'.repeat(64),
        rate: 4,
        comment: '解释得很清楚。',
        raterGlobalMetaId: 'idq1buyer',
        raterMetaId: 'buyer-meta-id',
        createdAt: 1_775_000_020_000,
      },
    ],
  });

  assert.deepEqual(snapshot.recentOrders[0], {
    traceId: 'trace-provider-1',
    orderId: 'order-trace-provider-1',
    servicePinId: 'service-pin-1',
    serviceName: 'Tarot Reading',
    paymentTxid: 'a'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    buyerGlobalMetaId: 'idq1buyer',
    buyerName: 'Buyer Bot',
    publicStatus: 'completed',
    createdAt: 1_775_000_010_000,
    ratingStatus: 'rated_on_chain',
    ratingValue: 4,
    ratingComment: '解释得很清楚。',
    ratingPinId: 'rating-pin-1',
    ratingCreatedAt: 1_775_000_020_000,
  });
});

test('buildProviderConsoleSnapshot marks a rated seller order as follow-up unconfirmed when provider delivery was not confirmed', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [createServiceRecord()],
    traces: [
      createSellerTrace({
        traceId: 'trace-provider-rating-unconfirmed',
        ratingMessageSent: false,
        ratingMessageError: 'Remote provider follow-up delivery not confirmed.',
      }),
    ],
    ratingDetails: [
      {
        pinId: 'rating-pin-2',
        serviceId: 'service-pin-1',
        servicePaidTx: 'a'.repeat(64),
        rate: 5,
        comment: '闭环完整，回复及时。',
        raterGlobalMetaId: 'idq1buyer',
        raterMetaId: 'buyer-meta-id',
        createdAt: 1_775_000_030_000,
      },
    ],
  });

  assert.equal(snapshot.recentOrders[0].ratingStatus, 'rated_on_chain_followup_unconfirmed');
  assert.equal(snapshot.recentOrders[0].ratingValue, 5);
  assert.equal(snapshot.recentOrders[0].ratingComment, '闭环完整，回复及时。');
  assert.equal(snapshot.recentOrders[0].ratingPinId, 'rating-pin-2');
  assert.equal(snapshot.recentOrders[0].ratingCreatedAt, 1_775_000_030_000);
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
    ratingDetails: [],
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
    ratingDetails: [],
  });

  assert.deepEqual(snapshot.manualActions, []);
});

test('buildProviderConsoleSnapshot projects recent provider-side master requests', () => {
  const snapshot = buildProviderConsoleSnapshot({
    services: [],
    masters: [createMasterRecord()],
    traces: [createMasterTrace()],
    ratingDetails: [],
  });

  assert.deepEqual(snapshot.recentMasterRequests, [
    {
      traceId: 'trace-master-provider-1',
      servicePinId: 'master-pin-1',
      serviceName: 'official-debug-master',
      displayName: 'Official Debug Master',
      masterKind: 'debug',
      callerGlobalMetaId: 'idq1caller',
      callerName: 'Caller Bot',
      publicStatus: 'completed',
      latestEvent: 'provider_completed',
      createdAt: 1_775_000_040_000,
    },
  ]);
  assert.equal(snapshot.totals.masterRequestCount, 1);
});
