import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  runBuyerRefundRequestLifecycle,
  selectDueBuyerRefundRequests,
} = require('../../dist/core/orders/serviceRefundLifecycle.js');
const {
  DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS,
} = require('../../dist/core/orders/orderLifecycle.js');

const NOW = 1_775_000_000_000;

function createBuyerTrace(overrides = {}) {
  const orderOverrides = overrides.order ?? {};
  const a2aOverrides = overrides.a2a ?? {};
  return {
    traceId: overrides.traceId ?? 'trace-refund-retry-1',
    channel: 'a2a',
    createdAt: NOW - 120_000,
    session: {
      id: 'session-refund-retry-1',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Weather Oracle',
      externalConversationId: null,
    },
    order: {
      id: 'order-refund-retry-1',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: 'order-pin-1',
      orderTxid: 'a'.repeat(64),
      orderTxids: ['a'.repeat(64)],
      paymentTxid: 'b'.repeat(64),
      paymentCommitTxid: null,
      orderReference: null,
      serviceOrderPinId: null,
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
      failedAt: NOW - 90_000,
      failureReason: 'delivery_timeout',
      refundRequestPinId: null,
      refundRequestTxid: null,
      refundRequestedAt: null,
      refundCompletedAt: null,
      refundFinalizePinId: null,
      refundBlockingReason: null,
      refundApplyRetryCount: 1,
      nextRetryAt: NOW - 1,
      refundTxid: null,
      refundedAt: null,
      updatedAt: NOW - 90_000,
      ...orderOverrides,
    },
    a2a: {
      sessionId: 'session-refund-retry-1',
      taskRunId: 'run-refund-retry-1',
      role: 'caller',
      publicStatus: 'failed',
      latestEvent: 'provider_timeout',
      taskRunState: 'failed',
      callerGlobalMetaId: 'idq1buyer',
      callerName: 'Buyer Bot',
      providerGlobalMetaId: 'idq1provider',
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

test('selectDueBuyerRefundRequests selects failed paid buyer trace with no request and due retry time', () => {
  const due = createBuyerTrace();

  const selected = selectDueBuyerRefundRequests({
    traces: [due],
    nowMs: NOW,
  });

  assert.deepEqual(selected.map((trace) => trace.traceId), ['trace-refund-retry-1']);
});

test('selectDueBuyerRefundRequests skips traces whose retry time is in the future', () => {
  const selected = selectDueBuyerRefundRequests({
    traces: [
      createBuyerTrace({
        traceId: 'trace-future-retry',
        order: { nextRetryAt: NOW + 1 },
      }),
    ],
    nowMs: NOW,
  });

  assert.deepEqual(selected, []);
});

test('selectDueBuyerRefundRequests skips already pending and refunded traces', () => {
  const selected = selectDueBuyerRefundRequests({
    traces: [
      createBuyerTrace({
        traceId: 'trace-refund-pending',
        order: { status: 'refund_pending', refundRequestPinId: 'refund-request-pin-1' },
      }),
      createBuyerTrace({
        traceId: 'trace-refunded',
        order: { status: 'refunded' },
      }),
    ],
    nowMs: NOW,
  });

  assert.deepEqual(selected, []);
});

test('selectDueBuyerRefundRequests selects due paid retry marker without payment txid', () => {
  const selected = selectDueBuyerRefundRequests({
    traces: [
      createBuyerTrace({
        traceId: 'trace-missing-payment-txid',
        order: { paymentTxid: null },
      }),
    ],
    nowMs: NOW,
  });

  assert.deepEqual(selected.map((trace) => trace.traceId), ['trace-missing-payment-txid']);
});

test('selectDueBuyerRefundRequests skips free orders', () => {
  const selected = selectDueBuyerRefundRequests({
    traces: [
      createBuyerTrace({
        traceId: 'trace-free',
        order: { paymentAmount: '0', paymentTxid: null },
      }),
    ],
    nowMs: NOW,
  });

  assert.deepEqual(selected, []);
});

test('selectDueBuyerRefundRequests skips self-directed buyer traces', () => {
  const selected = selectDueBuyerRefundRequests({
    traces: [
      createBuyerTrace({
        traceId: 'trace-self-directed',
        a2a: {
          callerGlobalMetaId: 'idq1self',
          providerGlobalMetaId: 'idq1self',
        },
      }),
    ],
    nowMs: NOW,
  });

  assert.deepEqual(selected, []);
});

test('runBuyerRefundRequestLifecycle reports retry metadata from returned failed trace', async () => {
  const trace = createBuyerTrace({
    order: { refundApplyRetryCount: 2 },
  });
  const returnedTrace = {
    ...trace,
    order: {
      ...trace.order,
      refundApplyRetryCount: 3,
      nextRetryAt: NOW + 12_345,
    },
  };

  const result = await runBuyerRefundRequestLifecycle({
    traces: [trace],
    nowMs: NOW,
    writer: {
      async writeRefundRequest() {
        return { trace: returnedTrace };
      },
    },
  });

  assert.equal(result.attempted, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].traceId, trace.traceId);
  assert.equal(result.failures[0].retryCount, 3);
  assert.equal(result.failures[0].nextRetryAt, NOW + 12_345);
});

test('runBuyerRefundRequestLifecycle records retry error and next retry when request write fails', async () => {
  const trace = createBuyerTrace({
    order: { refundApplyRetryCount: 2 },
  });

  const result = await runBuyerRefundRequestLifecycle({
    traces: [trace],
    nowMs: NOW,
    writer: {
      async writeRefundRequest() {
        throw new Error('simulated writer outage');
      },
    },
  });

  assert.equal(result.attempted, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].traceId, trace.traceId);
  assert.equal(result.failures[0].error, 'simulated writer outage');
  assert.equal(result.failures[0].retryCount, 3);
  assert.equal(result.failures[0].nextRetryAt, NOW + DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS);
});
