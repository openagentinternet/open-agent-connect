import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  SERVICE_REFUND_FINALIZE_PATH,
  SERVICE_REFUND_REQUEST_PATH,
} = require('../../dist/core/orders/serviceRefundProtocol.js');
const {
  createServiceRefundChainReader,
} = require('../../dist/core/orders/serviceRefundChainReader.js');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function requestPin(overrides = {}) {
  return {
    id: 'refund-request-pin-1',
    path: SERVICE_REFUND_REQUEST_PATH,
    timestamp: 1_777_000_000,
    contentSummary: JSON.stringify({
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
    }),
    ...overrides,
  };
}

function finalizePin(overrides = {}) {
  return {
    id: 'refund-finalize-pin-1',
    path: SERVICE_REFUND_FINALIZE_PATH,
    timestamp: 1_777_000_100,
    contentSummary: JSON.stringify({
      version: 1,
      refundRequestPinId: 'refund-request-pin-1',
      paymentTxid: 'b'.repeat(64),
      servicePinId: 'skill-service-pin-1',
      refundTxid: 'refund-transfer-txid-1',
      paymentAmount: '0.00001',
      paymentAsset: 'SPACE',
      buyerGlobalMetaId: 'idq1buyer',
      sellerGlobalMetaId: 'idq1seller',
    }),
    ...overrides,
  };
}

test('listRefundRequests reads one page of request pins', async () => {
  const urls = [];
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test',
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse({
        data: {
          list: [requestPin()],
          nextCursor: null,
        },
      });
    },
  });

  const requests = await reader.listRefundRequests({ pageSize: 25 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].pinId, 'refund-request-pin-1');
  assert.equal(requests[0].payload.serviceOrderPinId, 'skill-service-order-pin-1');

  const url = new URL(urls[0]);
  assert.equal(url.origin, 'https://chain.test');
  assert.equal(url.pathname, '/pin/path/list');
  assert.equal(url.searchParams.get('path'), SERVICE_REFUND_REQUEST_PATH);
  assert.equal(url.searchParams.get('size'), '25');
  assert.equal(url.searchParams.has('cursor'), false);
});

test('listRefundFinalizations reads multiple pages until the cursor is exhausted', async () => {
  const cursors = [];
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test/',
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      cursors.push(parsed.searchParams.get('cursor'));
      if (!parsed.searchParams.has('cursor')) {
        return jsonResponse({
          data: {
            list: [finalizePin({ id: 'refund-finalize-pin-1' })],
            nextCursor: 'cursor-2',
          },
        });
      }
      assert.equal(parsed.searchParams.get('cursor'), 'cursor-2');
      return jsonResponse({
        list: [finalizePin({ id: 'refund-finalize-pin-2' })],
        nextCursor: null,
      });
    },
  });

  const finalizations = await reader.listRefundFinalizations({ pageSize: 2, maxPages: 5 });

  assert.deepEqual(cursors, [null, 'cursor-2']);
  assert.deepEqual(finalizations.map((entry) => entry.pinId), [
    'refund-finalize-pin-1',
    'refund-finalize-pin-2',
  ]);
});

test('listRefundRequests stops on a repeated cursor and skips malformed pins', async () => {
  const cursors = [];
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test',
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      cursors.push(parsed.searchParams.get('cursor'));
      return jsonResponse({
        data: {
          list: [
            requestPin({
              id: `refund-request-pin-${cursors.length}`,
              contentSummary: '{bad-json',
            }),
            requestPin({
              id: `valid-refund-request-pin-${cursors.length}`,
            }),
          ],
          nextCursor: 'same-cursor',
        },
      });
    },
  });

  const requests = await reader.listRefundRequests({ maxPages: 5 });

  assert.deepEqual(cursors, [null, 'same-cursor']);
  assert.deepEqual(requests.map((entry) => entry.pinId), [
    'valid-refund-request-pin-1',
    'valid-refund-request-pin-2',
  ]);
});

test('listRefundRequests stops when a page is empty even if a cursor is present', async () => {
  let calls = 0;
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        data: {
          list: [],
          nextCursor: 'unexpected-next-cursor',
        },
      });
    },
  });

  const requests = await reader.listRefundRequests({ maxPages: 5 });

  assert.equal(calls, 1);
  assert.deepEqual(requests, []);
});

test('listRefundRequests normalizes timestamp and pin id fields from chain response variants', async () => {
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test',
    fetchImpl: async () => jsonResponse({
      data: {
        rows: [
          requestPin({
            PINID: 'refund-request-pin-from-PINID',
            id: undefined,
            path: undefined,
            timestamp: undefined,
            content: {
              data: {
                contentSummary: JSON.stringify({
                  version: 1,
                  serviceOrderPinId: 'skill-service-order-pin-variant',
                  servicePinId: 'skill-service-pin-variant',
                  paymentTxid: 'c'.repeat(64),
                  paymentAmount: '0.00002',
                  paymentAsset: 'MVC',
                  buyerGlobalMetaId: 'idq1buyer',
                  sellerGlobalMetaId: 'idq1seller',
                  refundAddress: 'buyer-mvc-address',
                  reason: 'provider_failed',
                }),
              },
            },
            createTime: 1_777_001_000,
          }),
        ],
        cursor: null,
      },
    }),
  });

  const requests = await reader.listRefundRequests({});

  assert.deepEqual(requests, [
    {
      pinId: 'refund-request-pin-from-PINID',
      path: SERVICE_REFUND_REQUEST_PATH,
      payload: {
        version: 1,
        serviceOrderPinId: 'skill-service-order-pin-variant',
        servicePinId: 'skill-service-pin-variant',
        paymentTxid: 'c'.repeat(64),
        paymentAmount: '0.00002',
        paymentAsset: 'SPACE',
        buyerGlobalMetaId: 'idq1buyer',
        sellerGlobalMetaId: 'idq1seller',
        refundAddress: 'buyer-mvc-address',
        reason: 'provider_failed',
        requestedAt: '2026-04-24T03:23:20.000Z',
      },
    },
  ]);
});

test('listRefundRequests applies identity and since filters expected by daemon callers', async () => {
  const urls = [];
  const reader = createServiceRefundChainReader({
    chainApiBaseUrl: 'https://chain.test',
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse({
        data: {
          list: [
            requestPin({
              id: 'old-matching-pin',
              contentSummary: JSON.stringify({
                version: 1,
                serviceOrderPinId: 'skill-service-order-pin-old',
                paymentTxid: 'd'.repeat(64),
                paymentAmount: '0.00001',
                paymentAsset: 'SPACE',
                buyerGlobalMetaId: 'idq1buyer',
                sellerGlobalMetaId: 'idq1seller',
                refundAddress: 'buyer-mvc-address',
                reason: 'delivery_timeout',
                requestedAt: '2026-06-02T00:00:00.000Z',
              }),
            }),
            requestPin({
              id: 'wrong-seller-pin',
              contentSummary: JSON.stringify({
                version: 1,
                serviceOrderPinId: 'skill-service-order-pin-other-seller',
                paymentTxid: 'e'.repeat(64),
                paymentAmount: '0.00001',
                paymentAsset: 'SPACE',
                buyerGlobalMetaId: 'idq1buyer',
                sellerGlobalMetaId: 'idq1otherSeller',
                refundAddress: 'buyer-mvc-address',
                reason: 'delivery_timeout',
                requestedAt: '2026-06-04T00:00:00.000Z',
              }),
            }),
            requestPin({
              id: 'matching-pin',
              contentSummary: JSON.stringify({
                version: 1,
                serviceOrderPinId: 'skill-service-order-pin-new',
                paymentTxid: 'f'.repeat(64),
                paymentAmount: '0.00001',
                paymentAsset: 'SPACE',
                buyerGlobalMetaId: 'idq1buyer',
                sellerGlobalMetaId: 'idq1seller',
                refundAddress: 'buyer-mvc-address',
                reason: 'delivery_timeout',
                requestedAt: '2026-06-04T00:00:00.000Z',
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    },
  });

  const requests = await reader.listRefundRequests({
    buyerGlobalMetaId: 'idq1buyer',
    sellerGlobalMetaId: 'idq1seller',
    sinceMs: Date.parse('2026-06-03T00:00:00.000Z'),
  });

  assert.deepEqual(requests.map((entry) => entry.pinId), ['matching-pin']);
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get('path'), SERVICE_REFUND_REQUEST_PATH);
  assert.equal(url.searchParams.has('buyerGlobalMetaId'), false);
  assert.equal(url.searchParams.has('sellerGlobalMetaId'), false);
  assert.equal(url.searchParams.has('sinceMs'), false);
});
