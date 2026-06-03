import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  applyServiceRefundFinalizationsToState,
  applyServiceRefundRequestsToState,
} = require('../../dist/core/orders/serviceRefundSync.js');
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');
const { buildSellerReceivedRefundItems } = require('../../dist/core/provider/providerOperations.js');

const NOW = 1_775_000_000_000;
const BUYER = 'idq1buyer';
const PROVIDER = 'idq1provider';
const OTHER_PROVIDER = 'idq1otherprovider';
const PAYMENT_TXID = 'b'.repeat(64);

const identity = {
  localMetabotId: 7,
  localMetabotSlug: 'provider-bot',
  localGlobalMetaId: PROVIDER,
};

function createState(overrides = {}) {
  return {
    identity: null,
    services: [],
    traces: [],
    sellerOrders: [],
    ...overrides,
  };
}

function createBuyerTrace(overrides = {}) {
  const orderOverrides = overrides.order ?? {};
  const a2aOverrides = overrides.a2a ?? {};
  return {
    traceId: overrides.traceId ?? 'trace-buyer-refund-sync-1',
    channel: 'a2a',
    createdAt: NOW - 30_000,
    session: {
      id: 'session-buyer-refund-sync-1',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PROVIDER,
      peerName: 'Weather Oracle',
      externalConversationId: null,
    },
    order: {
      id: 'buyer-order-refund-sync-1',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: 'order-message-pin-1',
      orderTxid: 'a'.repeat(64),
      orderTxids: ['a'.repeat(64)],
      paymentTxid: PAYMENT_TXID,
      paymentCommitTxid: null,
      orderReference: null,
      serviceOrderPinId: 'skill-service-order-pin-1',
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00001',
      paymentChain: 'mvc',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
      providerSkill: 'metabot-weather-oracle',
      providerSkills: ['metabot-weather-oracle'],
      outputType: 'text',
      requestText: 'weather',
      status: 'failed',
      failedAt: NOW - 20_000,
      failureReason: 'delivery_timeout',
      refundRequestPinId: null,
      refundRequestTxid: null,
      refundRequestedAt: null,
      refundCompletedAt: null,
      refundFinalizePinId: null,
      refundBlockingReason: null,
      refundApplyRetryCount: null,
      nextRetryAt: null,
      refundTxid: null,
      refundedAt: null,
      updatedAt: NOW - 20_000,
      ...orderOverrides,
    },
    a2a: {
      sessionId: 'a2a-session-1',
      taskRunId: 'a2a-run-1',
      role: 'caller',
      publicStatus: 'failed',
      latestEvent: 'provider_timeout',
      taskRunState: 'failed',
      callerGlobalMetaId: BUYER,
      callerName: 'Buyer Bot',
      providerGlobalMetaId: PROVIDER,
      providerName: 'Weather Oracle',
      servicePinId: 'service-pin-1',
      ...a2aOverrides,
    },
    providerRuntime: null,
    askMaster: null,
    artifacts: {
      transcriptMarkdownPath: '',
      traceMarkdownPath: '',
      traceJsonPath: '',
    },
  };
}

function createSellerOrder(overrides = {}) {
  return createSellerOrderRecord({
    id: 'seller-order-refund-sync-1',
    state: 'failed',
    localMetabotId: identity.localMetabotId,
    localMetabotSlug: identity.localMetabotSlug,
    providerGlobalMetaId: PROVIDER,
    buyerGlobalMetaId: BUYER,
    servicePinId: 'service-pin-1',
    currentServicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    providerSkill: 'metabot-weather-oracle',
    orderMessageId: 'order-message-pin-1',
    orderPinId: 'order-message-pin-1',
    orderTxid: 'a'.repeat(64),
    serviceOrderPinId: 'skill-service-order-pin-1',
    paymentTxid: PAYMENT_TXID,
    paymentCommitTxid: null,
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-seller-refund-sync-1',
    a2aSessionId: 'a2a-session-1',
    a2aTaskRunId: 'a2a-run-1',
    failureReason: 'delivery_timeout',
    createdAt: NOW - 30_000,
    updatedAt: NOW - 20_000,
    ...overrides,
  });
}

function createRequest(overrides = {}) {
  const payloadOverrides = overrides.payload ?? {};
  return {
    pinId: overrides.pinId ?? 'refund-request-pin-1',
    path: '/protocols/service-refund-request',
    payload: {
      version: 1,
      serviceOrderPinId: 'skill-service-order-pin-1',
      servicePinId: 'service-pin-1',
      paymentTxid: PAYMENT_TXID,
      paymentAmount: '0.00001',
      paymentAsset: 'SPACE',
      buyerGlobalMetaId: BUYER,
      sellerGlobalMetaId: PROVIDER,
      refundAddress: 'buyer-mvc-address',
      reason: 'delivery_timeout',
      requestedAt: new Date(NOW - 10_000).toISOString(),
      ...payloadOverrides,
    },
  };
}

function createFinalize(overrides = {}) {
  const payloadOverrides = overrides.payload ?? {};
  return {
    pinId: overrides.pinId ?? 'refund-finalize-pin-1',
    path: '/protocols/service-refund-finalize',
    payload: {
      version: 1,
      refundRequestPinId: 'refund-request-pin-1',
      servicePinId: 'service-pin-1',
      paymentTxid: PAYMENT_TXID,
      refundTxid: 'refund-transfer-txid-1',
      paymentAmount: '0.00001',
      paymentAsset: 'SPACE',
      buyerGlobalMetaId: BUYER,
      sellerGlobalMetaId: PROVIDER,
      ...payloadOverrides,
    },
  };
}

test('applyServiceRefundRequestsToState attaches request pin to existing buyer trace by payment txid', () => {
  const state = createState({
    traces: [createBuyerTrace({ order: { serviceOrderPinId: 'different-order-pin' } })],
  });

  const result = applyServiceRefundRequestsToState({
    state,
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  });

  assert.equal(result.applied.buyerRequests, 1);
  assert.equal(result.nextState.traces[0].order.status, 'refund_pending');
  assert.equal(result.nextState.traces[0].order.refundRequestPinId, 'refund-request-pin-1');
  assert.equal(result.nextState.traces[0].order.refundRequestedAt, NOW);
  assert.equal(result.nextState.traces[0].order.updatedAt, NOW);
});

test('applyServiceRefundRequestsToState attaches request pin to existing seller order by order pin id', () => {
  const state = createState({
    sellerOrders: [
      createSellerOrder({
        serviceOrderPinId: null,
        paymentTxid: null,
      }),
    ],
  });

  const result = applyServiceRefundRequestsToState({
    state,
    requests: [
      createRequest({
        payload: {
          serviceOrderPinId: 'order-message-pin-1',
          paymentTxid: 'unmatched-payment-txid',
        },
      }),
    ],
    identity,
    nowMs: NOW,
  });

  const order = result.nextState.sellerOrders[0];
  assert.equal(result.applied.sellerRequests, 1);
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.refundRequestPinId, 'refund-request-pin-1');
  assert.equal(order.updatedAt, NOW);
  assert.equal(buildSellerReceivedRefundItems(result.nextState)[0].manualActionRequired, true);
});

test('applyServiceRefundRequestsToState synthesizes provider seller order from chain request when local order is missing', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState(),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  });

  assert.equal(result.applied.synthesizedSellerOrders, 1);
  assert.equal(result.nextState.sellerOrders.length, 1);
  const order = result.nextState.sellerOrders[0];
  assert.equal(order.id, 'seller-refund-refund-request-pin-1');
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.localMetabotId, identity.localMetabotId);
  assert.equal(order.localMetabotSlug, identity.localMetabotSlug);
  assert.equal(order.providerGlobalMetaId, PROVIDER);
  assert.equal(order.buyerGlobalMetaId, BUYER);
  assert.equal(order.servicePinId, 'service-pin-1');
  assert.equal(order.currentServicePinId, 'service-pin-1');
  assert.equal(order.serviceOrderPinId, 'skill-service-order-pin-1');
  assert.equal(order.paymentTxid, PAYMENT_TXID);
  assert.equal(order.paymentAmount, '0.00001');
  assert.equal(order.paymentCurrency, 'SPACE');
  assert.equal(order.paymentChain, 'mvc');
  assert.equal(order.settlementKind, 'native');
  assert.equal(order.refundRequestPinId, 'refund-request-pin-1');
  assert.equal(order.traceId, 'seller-refund-trace-refund-request-pin-1');
  assert.equal(buildSellerReceivedRefundItems(result.nextState).length, 1);
});

test('applyServiceRefundRequestsToState synthesizes unsupported provider seller order with visible blocker', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState(),
    requests: [
      createRequest({
        pinId: 'refund-request-pin-mrc20',
        payload: {
          paymentAmount: '10',
          paymentAsset: 'OPCAT',
          paymentChain: 'opcat',
          settlementKind: 'mrc20',
          mrc20Ticker: 'TEST',
          mrc20Id: 'mrc20-test-id',
        },
      }),
    ],
    identity,
    nowMs: NOW,
  });

  assert.equal(result.applied.synthesizedSellerOrders, 1);
  const order = result.nextState.sellerOrders[0];
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.settlementKind, 'mrc20');
  assert.equal(order.mrc20Ticker, 'TEST');
  assert.equal(order.mrc20Id, 'mrc20-test-id');
  assert.equal(order.paymentCurrency, 'OPCAT');
  assert.equal(order.paymentChain, 'opcat');
  assert.equal(order.refundRequestPinId, 'refund-request-pin-mrc20');
  assert.equal(order.refundBlockingReason, 'refund_settlement_unsupported');
  assert.equal(buildSellerReceivedRefundItems(result.nextState)[0].manualActionRequired, false);
});

test('applyServiceRefundRequestsToState does not synthesize when local profile is not the provider', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState(),
    requests: [createRequest()],
    identity: {
      ...identity,
      localGlobalMetaId: OTHER_PROVIDER,
    },
    nowMs: NOW,
  });

  assert.equal(result.applied.synthesizedSellerOrders, 0);
  assert.equal(result.nextState.sellerOrders.length, 0);
  assert.equal(result.skipped, 1);
});

test('applyServiceRefundRequestsToState blocks existing seller order for unsupported request', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState({
      sellerOrders: [
        createSellerOrder({
          settlementKind: 'native',
          mrc20Ticker: null,
          mrc20Id: null,
        }),
      ],
    }),
    requests: [
      createRequest({
        payload: {
          settlementKind: 'mrc20',
          mrc20Ticker: 'TEST',
          mrc20Id: 'mrc20-test-id',
          paymentAsset: 'OPCAT',
          paymentChain: 'opcat',
        },
      }),
    ],
    identity,
    nowMs: NOW,
  });

  const order = result.nextState.sellerOrders[0];
  assert.equal(result.applied.sellerRequests, 1);
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.settlementKind, 'mrc20');
  assert.equal(order.mrc20Ticker, 'TEST');
  assert.equal(order.mrc20Id, 'mrc20-test-id');
  assert.equal(order.refundBlockingReason, 'refund_settlement_unsupported');
  assert.equal(buildSellerReceivedRefundItems(result.nextState)[0].manualActionRequired, false);
});

test('applyServiceRefundRequestsToState converges stale seller metadata for already applied unsupported request', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState({
      sellerOrders: [
        createSellerOrder({
          state: 'refund_pending',
          refundRequestPinId: 'refund-request-pin-1',
          settlementKind: 'native',
          paymentCurrency: 'SPACE',
          paymentChain: 'mvc',
          mrc20Ticker: null,
          mrc20Id: null,
          refundBlockingReason: null,
        }),
      ],
    }),
    requests: [
      createRequest({
        payload: {
          settlementKind: 'mrc20',
          mrc20Ticker: 'TEST',
          mrc20Id: 'mrc20-test-id',
          paymentAsset: 'OPCAT',
          paymentChain: 'opcat',
        },
      }),
    ],
    identity,
    nowMs: NOW,
  });

  const order = result.nextState.sellerOrders[0];
  assert.equal(result.applied.sellerRequests, 1);
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.settlementKind, 'mrc20');
  assert.equal(order.paymentCurrency, 'OPCAT');
  assert.equal(order.paymentChain, 'opcat');
  assert.equal(order.mrc20Ticker, 'TEST');
  assert.equal(order.mrc20Id, 'mrc20-test-id');
  assert.equal(order.refundBlockingReason, 'refund_settlement_unsupported');
  assert.equal(buildSellerReceivedRefundItems(result.nextState)[0].manualActionRequired, false);
});

test('applyServiceRefundRequestsToState does not match ambiguous local records', () => {
  const result = applyServiceRefundRequestsToState({
    state: createState({
      traces: [
        createBuyerTrace({ traceId: 'trace-ambiguous-1' }),
        createBuyerTrace({ traceId: 'trace-ambiguous-2' }),
      ],
    }),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  });

  assert.equal(result.applied.buyerRequests, 0);
  assert.equal(result.applied.synthesizedSellerOrders, 0);
  assert.equal(result.nextState.sellerOrders.length, 0);
  assert.equal(result.nextState.traces.every((trace) => trace.order.refundRequestPinId === null), true);
  assert.equal(result.skipped, 1);
});

test('applyServiceRefundRequestsToState does not update seller role traces through buyer matching', () => {
  const sellerTrace = createBuyerTrace({
    traceId: 'trace-seller-role-request-sync',
    order: {
      role: 'seller',
      status: 'failed',
    },
    a2a: {
      role: 'provider',
    },
  });

  const result = applyServiceRefundRequestsToState({
    state: createState({
      traces: [sellerTrace],
    }),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  });

  assert.equal(result.applied.buyerRequests, 0);
  assert.equal(result.applied.synthesizedSellerOrders, 1);
  assert.equal(result.nextState.sellerOrders.length, 1);
  assert.equal(result.nextState.traces[0].order.status, 'failed');
  assert.equal(result.nextState.traces[0].order.refundRequestPinId, null);
  assert.equal(result.nextState.traces[0].order.refundRequestedAt, null);
  assert.equal(result.nextState.traces[0].order.updatedAt, NOW - 20_000);
});

test('applyServiceRefundFinalizationsToState applies verified finalize pin to both local views', async () => {
  const pending = applyServiceRefundRequestsToState({
    state: createState({
      traces: [createBuyerTrace()],
      sellerOrders: [createSellerOrder()],
    }),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  }).nextState;

  const result = await applyServiceRefundFinalizationsToState({
    state: pending,
    finalizations: [createFinalize()],
    identity,
    nowMs: NOW + 1_000,
    verifyFinalize: () => true,
  });

  assert.equal(result.applied.finalizations, 1);
  assert.equal(result.nextState.traces[0].order.status, 'refunded');
  assert.equal(result.nextState.traces[0].order.refundFinalizePinId, 'refund-finalize-pin-1');
  assert.equal(result.nextState.traces[0].order.refundTxid, 'refund-transfer-txid-1');
  assert.equal(result.nextState.sellerOrders[0].state, 'refunded');
  assert.equal(result.nextState.sellerOrders[0].refundFinalizePinId, 'refund-finalize-pin-1');
  assert.equal(result.nextState.sellerOrders[0].refundTxid, 'refund-transfer-txid-1');
});

test('applyServiceRefundFinalizationsToState leaves non-native unsupported refund pending with blocker', async () => {
  const result = await applyServiceRefundFinalizationsToState({
    state: createState({
      sellerOrders: [
        createSellerOrder({
          state: 'refund_pending',
          settlementKind: 'mrc20',
          refundRequestPinId: 'refund-request-pin-1',
        }),
      ],
    }),
    finalizations: [createFinalize()],
    identity,
    nowMs: NOW,
    verifyFinalize: () => true,
  });

  const order = result.nextState.sellerOrders[0];
  assert.equal(result.applied.finalizations, 0);
  assert.equal(result.blocked, 1);
  assert.equal(order.state, 'refund_pending');
  assert.equal(order.refundBlockingReason, 'refund_settlement_unsupported');
  assert.equal(order.refundFinalizePinId, null);
});

test('applyServiceRefundFinalizationsToState does not refund seller role traces through buyer matching', async () => {
  const sellerTrace = createBuyerTrace({
    traceId: 'trace-seller-role-finalize-sync',
    order: {
      role: 'seller',
      status: 'refund_pending',
      refundRequestPinId: 'refund-request-pin-1',
    },
    a2a: {
      role: 'provider',
    },
  });

  const result = await applyServiceRefundFinalizationsToState({
    state: createState({
      traces: [sellerTrace],
    }),
    finalizations: [createFinalize()],
    identity,
    nowMs: NOW,
    verifyFinalize: () => true,
  });

  assert.equal(result.applied.finalizations, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.nextState.traces[0].order.status, 'refund_pending');
  assert.equal(result.nextState.traces[0].order.refundFinalizePinId, null);
  assert.equal(result.nextState.traces[0].order.refundTxid, null);
  assert.equal(result.nextState.traces[0].order.refundedAt, null);
});

test('applyServiceRefundRequestsToState is idempotent and produces no duplicate seller orders', () => {
  const first = applyServiceRefundRequestsToState({
    state: createState(),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  });

  const second = applyServiceRefundRequestsToState({
    state: first.nextState,
    requests: [createRequest()],
    identity,
    nowMs: NOW + 1_000,
  });

  assert.equal(first.applied.synthesizedSellerOrders, 1);
  assert.equal(second.applied.synthesizedSellerOrders, 0);
  assert.equal(second.nextState.sellerOrders.length, 1);
  assert.equal(second.nextState.sellerOrders[0].id, 'seller-refund-refund-request-pin-1');
});

test('applyServiceRefundFinalizationsToState is idempotent when finalize was already applied', async () => {
  const pending = applyServiceRefundRequestsToState({
    state: createState({
      traces: [createBuyerTrace()],
      sellerOrders: [createSellerOrder()],
    }),
    requests: [createRequest()],
    identity,
    nowMs: NOW,
  }).nextState;
  const first = await applyServiceRefundFinalizationsToState({
    state: pending,
    finalizations: [createFinalize()],
    identity,
    nowMs: NOW + 1_000,
    verifyFinalize: () => true,
  });

  const second = await applyServiceRefundFinalizationsToState({
    state: first.nextState,
    finalizations: [createFinalize()],
    identity,
    nowMs: NOW + 2_000,
    verifyFinalize: () => true,
  });

  assert.equal(second.applied.finalizations, 0);
  assert.equal(second.nextState.traces[0].order.status, 'refunded');
  assert.equal(second.nextState.sellerOrders[0].state, 'refunded');
  assert.equal(second.nextState.sellerOrders[0].refundFinalizePinId, 'refund-finalize-pin-1');
});
