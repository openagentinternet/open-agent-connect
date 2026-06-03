import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  SERVICE_REFUND_FINALIZE_PATH,
  SERVICE_REFUND_REQUEST_PATH,
  buildServiceRefundRequestPayload,
  parseServiceRefundFinalizePin,
  parseServiceRefundRequestPin,
} = require('../../dist/core/orders/serviceRefundProtocol.js');

test('buildServiceRefundRequestPayload builds request payload with stable field names and version', () => {
  const payload = buildServiceRefundRequestPayload({
    version: 1,
    serviceOrderPinId: 'skill-service-order-pin-1',
    servicePinId: 'skill-service-pin-1',
    paymentTxid: 'b'.repeat(64),
    paymentAmount: '0.00001',
    paymentAsset: 'SPACE',
    buyerGlobalMetaId: 'idq1buyer',
    sellerGlobalMetaId: 'idq1seller',
    refundAddress: 'buyer-mvc-address',
    reason: 'delivery_timeout',
    requestedAt: '2026-06-03T00:00:00.000Z',
  });

  assert.equal(SERVICE_REFUND_REQUEST_PATH, '/protocols/service-refund-request');
  assert.deepEqual(payload, {
    version: 1,
    serviceOrderPinId: 'skill-service-order-pin-1',
    servicePinId: 'skill-service-pin-1',
    paymentTxid: 'b'.repeat(64),
    paymentAmount: '0.00001',
    paymentAsset: 'SPACE',
    buyerGlobalMetaId: 'idq1buyer',
    sellerGlobalMetaId: 'idq1seller',
    refundAddress: 'buyer-mvc-address',
    reason: 'delivery_timeout',
    requestedAt: '2026-06-03T00:00:00.000Z',
  });
});

test('parseServiceRefundRequestPin parses IDBots-compatible request payload aliases', () => {
  const parsed = parseServiceRefundRequestPin({
    pinId: 'refund-request-pin-1',
    path: SERVICE_REFUND_REQUEST_PATH,
    content: JSON.stringify({
      version: '1.0.0',
      orderMessagePinId: 'skill-service-order-pin-1',
      servicePinId: 'skill-service-pin-1',
      paymentTxid: 'b'.repeat(64),
      refundAmount: '0.00001',
      refundCurrency: 'MVC',
      refundToAddress: 'buyer-mvc-address',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
      failureReason: 'delivery_timeout',
      failureDetectedAt: 1_777_000_000,
    }),
  });

  assert.deepEqual(parsed, {
    pinId: 'refund-request-pin-1',
    path: SERVICE_REFUND_REQUEST_PATH,
    payload: {
      version: 1,
      serviceOrderPinId: 'skill-service-order-pin-1',
      servicePinId: 'skill-service-pin-1',
      paymentTxid: 'b'.repeat(64),
      paymentAmount: '0.00001',
      paymentAsset: 'SPACE',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
      refundAddress: 'buyer-mvc-address',
      reason: 'delivery_timeout',
      requestedAt: '2026-04-24T03:06:40.000Z',
    },
  });
});

test('parseServiceRefundRequestPin preserves unsupported settlement metadata from request payloads', () => {
  const parsed = parseServiceRefundRequestPin({
    pinId: 'refund-request-pin-mrc20',
    path: SERVICE_REFUND_REQUEST_PATH,
    content: {
      version: 1,
      serviceOrderPinId: 'skill-service-order-pin-1',
      servicePinId: 'skill-service-pin-1',
      paymentTxid: 'b'.repeat(64),
      paymentAmount: '10',
      paymentAsset: 'OPCAT',
      paymentChain: 'opcat',
      settlementKind: 'mrc20',
      mrc20Ticker: 'TEST',
      mrc20Id: 'mrc20-test-id',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
      refundAddress: 'buyer-opcat-address',
      reason: 'delivery_timeout',
      requestedAt: '2026-06-03T00:00:00.000Z',
    },
  });

  assert.equal(parsed?.payload.settlementKind, 'mrc20');
  assert.equal(parsed?.payload.mrc20Ticker, 'TEST');
  assert.equal(parsed?.payload.mrc20Id, 'mrc20-test-id');
  assert.equal(parsed?.payload.paymentChain, 'opcat');
});

test('parseServiceRefundRequestPin rejects missing order or payment identity for paid refunds', () => {
  const basePayload = {
    version: 1,
    serviceOrderPinId: 'skill-service-order-pin-1',
    servicePinId: 'skill-service-pin-1',
    paymentTxid: 'b'.repeat(64),
    paymentAmount: '0.00001',
    paymentAsset: 'SPACE',
    buyerGlobalMetaId: 'idq1buyer',
    sellerGlobalMetaId: 'idq1seller',
    refundAddress: 'buyer-mvc-address',
    reason: 'delivery_timeout',
    requestedAt: '2026-06-03T00:00:00.000Z',
  };

  assert.equal(parseServiceRefundRequestPin({
    pinId: 'refund-request-pin-1',
    path: SERVICE_REFUND_REQUEST_PATH,
    content: { ...basePayload, serviceOrderPinId: '' },
  }), null);
  assert.equal(parseServiceRefundRequestPin({
    pinId: 'refund-request-pin-1',
    path: SERVICE_REFUND_REQUEST_PATH,
    content: { ...basePayload, paymentTxid: '' },
  }), null);
});

test('parseServiceRefundFinalizePin parses finalize payload with refund txid, request pin id, amount, asset, and parties', () => {
  const parsed = parseServiceRefundFinalizePin({
    id: 'refund-finalize-pin-1',
    path: SERVICE_REFUND_FINALIZE_PATH,
    content: {
      data: {
        contentSummary: JSON.stringify({
          version: '1.0.0',
          refundRequestPinId: 'refund-request-pin-1',
          paymentTxid: 'b'.repeat(64),
          servicePinId: 'skill-service-pin-1',
          refundTxid: 'refund-transfer-txid-1',
          refundAmount: '0.00001',
          refundCurrency: 'SPACE',
          buyerGlobalMetaId: 'idq1buyer',
          sellerGlobalMetaId: 'idq1seller',
        }),
      },
    },
  });

  assert.deepEqual(parsed, {
    pinId: 'refund-finalize-pin-1',
    path: SERVICE_REFUND_FINALIZE_PATH,
    payload: {
      version: 1,
      refundRequestPinId: 'refund-request-pin-1',
      paymentTxid: 'b'.repeat(64),
      servicePinId: 'skill-service-pin-1',
      refundTxid: 'refund-transfer-txid-1',
      paymentAmount: '0.00001',
      paymentAsset: 'SPACE',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
    },
  });
});

test('parseServiceRefundFinalizePin keeps free refund payloads valid without a transfer txid', () => {
  const parsed = parseServiceRefundFinalizePin({
    pinId: 'refund-finalize-pin-1',
    path: SERVICE_REFUND_FINALIZE_PATH,
    content: {
      version: 1,
      refundRequestPinId: 'refund-request-pin-1',
      paymentTxid: '',
      servicePinId: 'skill-service-pin-1',
      refundAmount: '0',
      refundCurrency: 'SPACE',
      settlementKind: 'free',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
    },
  });

  assert.equal(parsed?.payload.refundTxid, undefined);
  assert.equal(parsed?.payload.paymentAmount, '0');
  assert.equal(parsed?.payload.paymentAsset, 'SPACE');
});
