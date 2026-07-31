import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createHasActiveOrderWithPeer,
  isBuyerTraceOrderActiveForChatSuppression,
  isSellerOrderActiveForChatSuppression,
} = require('../../dist/core/orders/orderChatSuppression.js');
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');

const PEER = 'idq1peerbot00000000000000000000000000';
const OTHER_PEER = 'idq1otherbot0000000000000000000000000';
const LOCAL = 'idq1localbot0000000000000000000000000';

test('isSellerOrderActiveForChatSuppression mirrors the IDBots active state set', () => {
  // IDBots hasActiveOrderForPrivateChatSuppression active set
  // ('awaiting_first_response', 'in_progress', 'rating_pending',
  // 'refund_pending') mapped onto the OAC seller states.
  for (const state of ['received', 'acknowledged', 'in_progress', 'rating_pending', 'refund_pending']) {
    assert.equal(isSellerOrderActiveForChatSuppression({ state }), true, `${state} must be active`);
  }
  for (const state of ['completed', 'failed', 'refunded']) {
    assert.equal(isSellerOrderActiveForChatSuppression({ state }), false, `${state} must not be active`);
  }
});

test('isBuyerTraceOrderActiveForChatSuppression mirrors the IDBots buyer failed/refund branch', () => {
  const failedOpenRefund = {
    status: 'failed',
    refundRequestPinId: null,
    refundTxid: null,
    refundCompletedAt: null,
  };
  assert.equal(isBuyerTraceOrderActiveForChatSuppression(failedOpenRefund), true);
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, refundRequestPinId: 'pin-1' }),
    false,
  );
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, refundTxid: 'tx-1' }),
    false,
  );
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, refundCompletedAt: 123 }),
    false,
  );
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, status: 'refund_pending' }),
    true,
  );
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, status: 'refunded' }),
    false,
  );
  assert.equal(
    isBuyerTraceOrderActiveForChatSuppression({ ...failedOpenRefund, status: '' }),
    false,
  );
});

function createSellerOrder(state, overrides = {}) {
  return createSellerOrderRecord({
    id: `seller-order-${state}`,
    state,
    localMetabotId: 1,
    localMetabotSlug: 'local-bot',
    providerGlobalMetaId: LOCAL,
    buyerGlobalMetaId: PEER,
    servicePinId: 'service-pin-1',
    currentServicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    providerSkill: 'metabot-weather-oracle',
    orderMessageId: 'order-message-pin-1',
    traceId: `trace-${state}`,
    a2aSessionId: `a2a-order-session-${state}`,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
    ...overrides,
  });
}

function createBuyerTrace(overrides = {}) {
  return {
    traceId: 'trace-buyer-1',
    channel: 'a2a',
    createdAt: 1_770_000_000_000,
    session: {
      id: 'session-buyer-1',
      title: null,
      type: 'a2a',
      metabotId: null,
      peerGlobalMetaId: PEER,
      peerName: 'Peer Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-buyer-1',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: null,
      orderTxid: 'a'.repeat(64),
      orderTxids: [],
      paymentTxid: 'b'.repeat(64),
      paymentCommitTxid: null,
      orderReference: null,
      serviceOrderPinId: null,
      paymentCurrency: null,
      paymentAmount: null,
      paymentChain: null,
      settlementKind: null,
      mrc20Ticker: null,
      mrc20Id: null,
      outputType: null,
      requestText: null,
      status: null,
      firstResponseDeadlineAt: null,
      deliveryDeadlineAt: null,
      firstResponseReceivedAt: null,
      failedAt: null,
      failureReason: null,
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
      updatedAt: null,
    },
    a2a: {
      sessionId: 'session-buyer-1',
      taskRunId: 'run-buyer-1',
      role: 'caller',
      publicStatus: null,
      latestEvent: null,
      taskRunState: null,
      callerGlobalMetaId: LOCAL,
      callerName: null,
      providerGlobalMetaId: PEER,
      providerName: 'Peer Bot',
      servicePinId: 'service-pin-1',
    },
    providerRuntime: null,
    artifacts: {},
    ...overrides,
  };
}

async function createHarness({ sellerOrders = [], traces = [], sessions = [] } = {}) {
  const base = await mkdtempTempRoot('order-chat-suppression-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStateStore = createRuntimeStateStore(paths);
  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces,
    sellerOrders,
  });
  const sessionStateStore = createSessionStateStore(paths);
  for (const session of sessions) {
    await sessionStateStore.writeSession(session);
  }
  return createHasActiveOrderWithPeer({ runtimeStateStore, sessionStateStore });
}

function createCallerSession(state, overrides = {}) {
  return {
    sessionId: `session-${state}`,
    traceId: 'trace-buyer-1',
    role: 'caller',
    state,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
    callerGlobalMetaId: LOCAL,
    providerGlobalMetaId: PEER,
    servicePinId: 'service-pin-1',
    currentTaskRunId: 'run-1',
    latestTaskRunState: null,
    ...overrides,
  };
}

test('hasActiveOrderWithPeer suppresses for each active seller order state and ignores other peers', async () => {
  for (const state of ['received', 'acknowledged', 'in_progress', 'rating_pending', 'refund_pending']) {
    const hasActiveOrderWithPeer = await createHarness({
      sellerOrders: [createSellerOrder(state)],
    });
    assert.equal(await hasActiveOrderWithPeer(PEER), true, `seller order ${state} must suppress`);
    assert.equal(await hasActiveOrderWithPeer(OTHER_PEER), false);
    assert.equal(await hasActiveOrderWithPeer(''), false);
  }
});

test('hasActiveOrderWithPeer does not suppress for terminal seller order states', async () => {
  for (const state of ['completed', 'failed', 'refunded']) {
    const hasActiveOrderWithPeer = await createHarness({
      sellerOrders: [createSellerOrder(state)],
    });
    assert.equal(await hasActiveOrderWithPeer(PEER), false, `seller order ${state} must not suppress`);
  }
});

test('hasActiveOrderWithPeer suppresses while a caller session waits on the provider', async () => {
  for (const state of ['requesting_remote', 'remote_received', 'remote_executing']) {
    const hasActiveOrderWithPeer = await createHarness({
      traces: [createBuyerTrace()],
      sessions: [createCallerSession(state)],
    });
    assert.equal(await hasActiveOrderWithPeer(PEER), true, `caller session ${state} must suppress`);
  }
});

test('hasActiveOrderWithPeer does not suppress for terminal caller sessions or recorded deliveries', async () => {
  for (const state of ['completed', 'remote_failed', 'timeout']) {
    const hasActiveOrderWithPeer = await createHarness({
      traces: [createBuyerTrace()],
      sessions: [createCallerSession(state)],
    });
    assert.equal(await hasActiveOrderWithPeer(PEER), false, `caller session ${state} must not suppress`);
  }

  const delivered = await createHarness({
    traces: [createBuyerTrace({
      a2a: {
        ...createBuyerTrace().a2a,
        publicStatus: 'completed',
        taskRunState: 'completed',
      },
    })],
    sessions: [createCallerSession('remote_executing')],
  });
  assert.equal(await delivered(PEER), false, 'a recorded delivery must not suppress');
});

test('hasActiveOrderWithPeer keeps suppressing a buyer order whose refund is still open', async () => {
  const failedOpenRefund = await createHarness({
    traces: [createBuyerTrace({
      order: { ...createBuyerTrace().order, status: 'failed' },
    })],
    sessions: [createCallerSession('timeout')],
  });
  assert.equal(await failedOpenRefund(PEER), true);

  const refundPending = await createHarness({
    traces: [createBuyerTrace({
      order: {
        ...createBuyerTrace().order,
        status: 'refund_pending',
        refundRequestPinId: 'refund-request-pin-1',
      },
    })],
    sessions: [createCallerSession('timeout')],
  });
  assert.equal(await refundPending(PEER), true);

  const refundRequested = await createHarness({
    traces: [createBuyerTrace({
      order: {
        ...createBuyerTrace().order,
        status: 'failed',
        refundRequestPinId: 'refund-request-pin-1',
      },
    })],
    sessions: [createCallerSession('timeout')],
  });
  assert.equal(await refundRequested(PEER), false);

  const refunded = await createHarness({
    traces: [createBuyerTrace({
      order: {
        ...createBuyerTrace().order,
        status: 'refunded',
        refundRequestPinId: 'refund-request-pin-1',
        refundTxid: 'c'.repeat(64),
        refundCompletedAt: 1_770_000_100_000,
      },
    })],
    sessions: [createCallerSession('timeout')],
  });
  assert.equal(await refunded(PEER), false);
});
