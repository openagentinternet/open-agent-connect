import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  SERVICE_REFUND_REQUEST_PATH,
  processSellerRefundSettlement,
} = require('../../dist/core/orders/serviceRefundSettlement.js');
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');
const {
  SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON,
} = require('../../dist/core/orders/orderLifecycle.js');

function createState(overrides = {}) {
  const order = createSellerOrderRecord({
    id: 'seller-order-refund-1',
    state: 'refund_pending',
    localMetabotId: 1,
    localMetabotSlug: 'provider-bot',
    providerGlobalMetaId: 'idq1seller',
    buyerGlobalMetaId: 'idq1buyer',
    servicePinId: 'service-pin-1',
    currentServicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    providerSkill: 'metabot-weather-oracle',
    orderMessageId: 'order-message-pin-1',
    orderPinId: 'order-message-pin-1',
    orderTxid: 'a'.repeat(64),
    paymentTxid: 'b'.repeat(64),
    paymentCommitTxid: 'c'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-seller-refund-1',
    a2aSessionId: 'a2a-session-1',
    a2aTaskRunId: 'a2a-run-1',
    refundRequestPinId: 'refund-request-pin-1',
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_010_000,
    ...(overrides.order ?? {}),
  });
  const mirrorOrder = createSellerOrderRecord({
    ...order,
    id: 'seller-order-refund-1-mirror',
    state: 'failed',
    traceId: 'trace-seller-refund-mirror',
  });

  return {
    identity: {
      metabotId: 1,
      name: 'Provider Bot',
      createdAt: 1_775_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'seller-public-key',
      chatPublicKey: 'seller-chat-key',
      addresses: { mvc: 'seller-mvc-address' },
      mvcAddress: 'seller-mvc-address',
      metaId: 'seller-metaid',
      globalMetaId: 'idq1seller',
    },
    services: [],
    traces: [
      {
        traceId: 'trace-buyer-refund-1',
        channel: 'a2a',
        createdAt: 1_775_000_005_000,
        session: {
          id: 'session-buyer-refund-1',
          title: 'Buyer mirror',
          type: 'a2a',
          metabotId: 1,
          peerGlobalMetaId: 'idq1buyer',
          peerName: 'Buyer Bot',
          externalConversationId: null,
        },
        order: {
          id: 'buyer-order-refund-1',
          role: 'buyer',
          serviceId: 'service-pin-1',
          serviceName: 'Weather Oracle',
          orderPinId: 'order-message-pin-1',
          orderTxid: 'a'.repeat(64),
          orderTxids: ['a'.repeat(64)],
          paymentTxid: order.paymentTxid,
          paymentCommitTxid: order.paymentCommitTxid,
          orderReference: null,
          paymentCurrency: order.paymentCurrency,
          paymentAmount: order.paymentAmount,
          paymentChain: order.paymentChain,
          settlementKind: order.settlementKind,
          mrc20Ticker: null,
          mrc20Id: null,
          providerSkill: order.providerSkill,
          outputType: 'text',
          requestText: 'weather',
          status: 'refund_pending',
          failedAt: 1_775_000_006_000,
          failureReason: 'delivery_timeout',
          refundRequestPinId: order.refundRequestPinId,
          refundRequestTxid: null,
          refundRequestedAt: 1_775_000_006_000,
          refundCompletedAt: null,
          refundFinalizePinId: null,
          refundBlockingReason: null,
          refundApplyRetryCount: null,
          nextRetryAt: null,
          refundTxid: null,
          refundedAt: null,
          updatedAt: 1_775_000_006_000,
        },
        a2a: null,
        providerRuntime: null,
        askMaster: null,
        artifacts: {
          transcriptMarkdownPath: '',
          traceMarkdownPath: '',
          traceJsonPath: '',
        },
      },
    ],
    sellerOrders: [order, mirrorOrder],
    ...(overrides.state ?? {}),
  };
}

function createRefundRequestPayload(overrides = {}) {
  return {
    version: '1.0.0',
    paymentTxid: 'b'.repeat(64),
    servicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    refundAmount: '0.00001',
    refundCurrency: 'SPACE',
    amount: '0.00001',
    currency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    mrc20Ticker: null,
    mrc20Id: null,
    paymentCommitTxid: 'c'.repeat(64),
    refundToAddress: 'buyer-mvc-address',
    buyerGlobalMetaId: 'idq1buyer',
    sellerGlobalMetaId: 'idq1seller',
    orderMessagePinId: 'order-message-pin-1',
    failureReason: 'delivery_timeout',
    failureDetectedAt: 1_775_000_006,
    reasonComment: 'delivery timed out',
    evidencePinIds: ['order-message-pin-1'],
    ...overrides,
  };
}

async function settle(input = {}) {
  const transferCalls = [];
  const finalizeWrites = [];
  const state = input.state ?? createState(input.stateOverrides);
  const result = await processSellerRefundSettlement({
    state,
    orderId: input.orderId ?? 'seller-order-refund-1',
    now: input.now ?? (() => 1_775_000_020_000),
    fetchRefundRequestPin: input.fetchRefundRequestPin ?? (async () => ({
      pinId: 'refund-request-pin-1',
      path: SERVICE_REFUND_REQUEST_PATH,
      content: JSON.stringify(input.payload ?? createRefundRequestPayload(input.payloadOverrides)),
    })),
    executeRefundTransfer: input.executeRefundTransfer ?? (async (transfer) => {
      transferCalls.push(transfer);
      return { success: true, txid: 'refund-transfer-txid-1' };
    }),
    writeRefundFinalizePin: input.writeRefundFinalizePin ?? (async (write) => {
      finalizeWrites.push(write);
      return { pinId: 'refund-finalize-pin-1', txids: ['refund-finalize-txid-1'] };
    }),
    persistSettlementState: input.persistSettlementState,
    resolveLocalSellerGlobalMetaId: () => 'idq1seller',
  });
  return { result, transferCalls, finalizeWrites };
}

test('processSellerRefundSettlement performs paid transfer, writes finalization, and marks local mirrors refunded', async () => {
  const { result, transferCalls, finalizeWrites } = await settle();

  assert.equal(result.ok, true);
  assert.equal(result.refundTxid, 'refund-transfer-txid-1');
  assert.equal(result.refundFinalizePinId, 'refund-finalize-pin-1');
  assert.equal(transferCalls.length, 1);
  assert.equal(transferCalls[0].refundToAddress, 'buyer-mvc-address');
  assert.equal(transferCalls[0].refundAmount, '0.00001');
  assert.equal(finalizeWrites.length, 1);
  assert.equal(finalizeWrites[0].payload.refundRequestPinId, 'refund-request-pin-1');
  assert.equal(finalizeWrites[0].payload.paymentTxid, 'b'.repeat(64));
  assert.equal(finalizeWrites[0].payload.servicePinId, 'service-pin-1');
  assert.equal(finalizeWrites[0].payload.refundTxid, 'refund-transfer-txid-1');
  assert.equal(finalizeWrites[0].payload.refundAmount, '0.00001');
  assert.equal(finalizeWrites[0].payload.refundCurrency, 'SPACE');
  assert.equal(finalizeWrites[0].payload.paymentChain, 'mvc');
  assert.equal(finalizeWrites[0].payload.settlementKind, 'native');
  assert.equal(finalizeWrites[0].payload.buyerGlobalMetaId, 'idq1buyer');
  assert.equal(finalizeWrites[0].payload.sellerGlobalMetaId, 'idq1seller');

  assert.equal(result.nextState.sellerOrders.every((entry) => entry.state === 'refunded'), true);
  assert.equal(result.nextState.sellerOrders.every((entry) => entry.refundTxid === 'refund-transfer-txid-1'), true);
  assert.equal(result.nextState.sellerOrders.every((entry) => entry.refundFinalizePinId === 'refund-finalize-pin-1'), true);
  assert.equal(result.nextState.traces[0].order.status, 'refunded');
  assert.equal(result.nextState.traces[0].order.refundFinalizePinId, 'refund-finalize-pin-1');
});

test('processSellerRefundSettlement finalizes with the refund request service pin after service republish', async () => {
  const state = createState({
    order: {
      servicePinId: 'service-pin-original',
      currentServicePinId: 'service-pin-current',
    },
  });

  const { result, finalizeWrites } = await settle({
    state,
    payloadOverrides: {
      servicePinId: 'service-pin-original',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(finalizeWrites.length, 1);
  assert.equal(finalizeWrites[0].payload.servicePinId, 'service-pin-original');
});

test('processSellerRefundSettlement rejects refund request payload mismatches before transfer', async () => {
  const cases = [
    ['refund_request_payment_mismatch', { paymentTxid: 'x'.repeat(64) }],
    ['refund_request_service_mismatch', { servicePinId: 'other-service-pin' }],
    ['refund_request_buyer_mismatch', { buyerGlobalMetaId: 'idq1otherbuyer' }],
    ['refund_request_seller_mismatch', { sellerGlobalMetaId: 'idq1otherseller' }],
    ['refund_request_amount_mismatch', { refundAmount: '0.00002', amount: '0.00002' }],
    ['refund_request_currency_mismatch', { refundCurrency: 'BTC', currency: 'BTC' }],
    ['refund_request_chain_mismatch', { paymentChain: 'btc' }],
    ['refund_request_settlement_mismatch', { settlementKind: 'mrc20' }],
  ];

  for (const [code, payloadOverrides] of cases) {
    const { result, transferCalls, finalizeWrites } = await settle({ payloadOverrides });
    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
    assert.equal(transferCalls.length, 0);
    assert.equal(finalizeWrites.length, 0);
    assert.equal(result.nextState.sellerOrders[0].state, 'refund_pending');
    assert.equal(result.nextState.sellerOrders[0].refundBlockingReason, code);
  }
});

test('processSellerRefundSettlement resolves zero-price refunds locally without transfer or finalization', async () => {
  const state = createState({
    order: {
      paymentTxid: null,
      paymentAmount: '0',
      paymentCurrency: 'SPACE',
      settlementKind: 'free',
    },
  });
  const { result, transferCalls, finalizeWrites } = await settle({
    state,
    payload: createRefundRequestPayload({
      paymentTxid: '',
      refundAmount: '0',
      refundCurrency: 'SPACE',
      amount: '0',
      currency: 'SPACE',
      settlementKind: 'free',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.noTransferReason, SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON);
  assert.equal(result.refundTxid, null);
  assert.equal(result.refundFinalizePinId, null);
  assert.equal(transferCalls.length, 0);
  assert.equal(finalizeWrites.length, 0);
  assert.equal(result.nextState.sellerOrders[0].state, 'refunded');
});

test('processSellerRefundSettlement blocks missing refund address and transfer failures with machine-readable reasons', async () => {
  const missingAddress = await settle({
    payloadOverrides: { refundToAddress: '' },
  });
  assert.equal(missingAddress.result.ok, false);
  assert.equal(missingAddress.result.code, 'refund_address_missing');
  assert.equal(missingAddress.transferCalls.length, 0);

  const transferFailureCalls = [];
  const transferFailure = await settle({
    executeRefundTransfer: async (transfer) => {
      transferFailureCalls.push(transfer);
      return { success: false, error: 'insufficient_balance: seller wallet cannot cover the refund' };
    },
  });
  assert.equal(transferFailure.result.ok, false);
  assert.equal(transferFailure.result.code, 'insufficient_balance');
  assert.equal(transferFailureCalls.length, 1);
  assert.equal(transferFailure.result.nextState.sellerOrders[0].state, 'refund_pending');
  assert.equal(transferFailure.result.nextState.sellerOrders[0].refundBlockingReason, 'insufficient_balance');
});

test('processSellerRefundSettlement persists refund transfer state before finalization', async () => {
  const events = [];
  const persistedStates = [];
  const { result } = await settle({
    persistSettlementState: async (nextState) => {
      events.push('persist_transfer');
      persistedStates.push(nextState);
    },
    writeRefundFinalizePin: async () => {
      events.push('write_finalize');
      return { pinId: 'refund-finalize-pin-1', txids: ['refund-finalize-txid-1'] };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, ['persist_transfer', 'write_finalize']);
  assert.equal(persistedStates.length, 1);
  assert.equal(persistedStates[0].sellerOrders.every((entry) => entry.refundTxid === 'refund-transfer-txid-1'), true);
  assert.equal(persistedStates[0].sellerOrders.every((entry) => entry.refundFinalizePinId === null), true);
});

test('processSellerRefundSettlement records transfer state across ended mirror orders', async () => {
  const state = createState();
  state.sellerOrders[1] = createSellerOrderRecord({
    ...state.sellerOrders[1],
    state: 'ended',
  });

  const { result } = await settle({ state });

  assert.equal(result.ok, true);
  assert.equal(result.nextState.sellerOrders.every((entry) => entry.state === 'refunded'), true);
  assert.equal(result.nextState.sellerOrders.every((entry) => entry.refundTxid === 'refund-transfer-txid-1'), true);
});

test('processSellerRefundSettlement does not finalize if transfer state persistence fails', async () => {
  const { result, transferCalls, finalizeWrites } = await settle({
    persistSettlementState: async () => {
      throw new Error('disk full');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'refund_transfer_persist_failed');
  assert.equal(transferCalls.length, 1);
  assert.equal(finalizeWrites.length, 0);
  assert.equal(result.nextState.sellerOrders[0].state, 'refund_pending');
  assert.equal(result.nextState.sellerOrders[0].refundTxid, 'refund-transfer-txid-1');
  assert.equal(result.nextState.sellerOrders[0].refundBlockingReason, 'refund_transfer_persist_failed');
});

test('processSellerRefundSettlement preserves failed paid orders that have no refund request proof', async () => {
  const state = createState({
    order: {
      state: 'failed',
      refundRequestPinId: null,
    },
  });

  const { result, transferCalls, finalizeWrites } = await settle({ state });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'refund_request_missing');
  assert.equal(transferCalls.length, 0);
  assert.equal(finalizeWrites.length, 0);
  assert.equal(result.nextState.sellerOrders[0].state, 'failed');
  assert.equal(result.nextState.sellerOrders[0].refundBlockingReason, 'refund_request_missing');
});

test('processSellerRefundSettlement is idempotent after transfer and after completed refund', async () => {
  const pendingWithTransfer = createState({
    order: {
      refundTxid: 'existing-refund-txid',
    },
  });
  const pendingRetry = await settle({ state: pendingWithTransfer });
  assert.equal(pendingRetry.result.ok, true);
  assert.equal(pendingRetry.result.refundTxid, 'existing-refund-txid');
  assert.equal(pendingRetry.transferCalls.length, 0);
  assert.equal(pendingRetry.finalizeWrites.length, 1);

  const completedState = createState({
    order: {
      state: 'refunded',
      refundTxid: 'completed-refund-txid',
      refundFinalizePinId: 'completed-finalize-pin',
      refundedAt: 1_775_000_030_000,
    },
  });
  const completedRetry = await settle({ state: completedState });
  assert.equal(completedRetry.result.ok, true);
  assert.equal(completedRetry.result.refundTxid, 'completed-refund-txid');
  assert.equal(completedRetry.result.refundFinalizePinId, 'completed-finalize-pin');
  assert.equal(completedRetry.transferCalls.length, 0);
  assert.equal(completedRetry.finalizeWrites.length, 0);
});
