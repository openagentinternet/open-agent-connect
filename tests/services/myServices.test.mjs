import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildMyServiceSummaries,
  buildMyServiceOrderDetails,
  buildMyServiceModifyRecord,
  buildMyServiceRevokeRecord,
  buildMyServiceModifyChainWrite,
  buildMyServiceRevokeChainWrite,
  validateMyServiceMutation,
} = require('../../dist/core/services/myServices.js');

function createService(overrides = {}) {
  return {
    id: 'service-create-pin',
    sourceServicePinId: 'service-create-pin',
    currentPinId: 'service-create-pin',
    chainPinIds: ['service-create-pin'],
    creatorMetabotId: 7,
    providerGlobalMetaId: 'idq1seller',
    providerSkill: 'tarot-reading',
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads tarot cards.',
    serviceIcon: null,
    price: '0.00005',
    currency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    mrc20Ticker: null,
    mrc20Id: null,
    skillDocument: '',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: '1seller',
    payloadJson: '',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_000_000,
    ...overrides,
  };
}

function createOrder(overrides = {}) {
  return {
    id: 'seller-order-1',
    state: 'completed',
    localMetabotId: 7,
    localMetabotSlug: 'seller',
    providerGlobalMetaId: 'idq1seller',
    buyerGlobalMetaId: 'idq1buyer',
    servicePinId: 'service-create-pin',
    currentServicePinId: 'service-create-pin',
    serviceName: 'Tarot Reading',
    providerSkill: 'tarot-reading',
    orderMessageId: 'message-1',
    orderPinId: 'order-pin-1',
    orderTxid: 'order-txid-1',
    orderReference: null,
    paymentTxid: 'payment-txid-1',
    paymentCommitTxid: null,
    paymentAmount: '0.00005',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    mrc20Ticker: null,
    mrc20Id: null,
    traceId: 'trace-1',
    a2aSessionId: 'a2a-session-1',
    a2aTaskRunId: null,
    llmSessionId: 'llm-session-1',
    runtimeId: 'runtime-1',
    runtimeProvider: 'codex',
    fallbackSelected: false,
    publicStatus: 'completed',
    latestEvent: 'service.completed',
    failureReason: null,
    endReason: null,
    refundRequestPinId: null,
    refundRequestTxid: null,
    refundTxid: null,
    refundFinalizePinId: null,
    refundBlockingReason: null,
    receivedAt: 1_775_000_010_000,
    acknowledgedAt: 1_775_000_011_000,
    startedAt: 1_775_000_012_000,
    deliveredAt: 1_775_000_020_000,
    ratingRequestedAt: 1_775_000_021_000,
    endedAt: null,
    refundedAt: null,
    refundCompletedAt: null,
    createdAt: 1_775_000_010_000,
    updatedAt: 1_775_000_020_000,
    ...overrides,
  };
}

test('buildMyServiceSummaries aggregates services across local profiles with chain pin history', () => {
  const profileAService = createService({
    currentPinId: 'service-modify-pin',
    chainPinIds: ['service-create-pin', 'service-modify-pin'],
    updatedAt: 1_775_000_030_000,
  });
  const profileBService = createService({
    id: 'bot-b-service',
    sourceServicePinId: 'bot-b-service',
    currentPinId: 'bot-b-service',
    chainPinIds: ['bot-b-service'],
    creatorMetabotId: 8,
    providerGlobalMetaId: 'idq1seller-b',
    serviceName: 'copy-service',
    displayName: 'Copy Service',
    price: '0.00010',
    updatedAt: 1_775_000_020_000,
  });
  const revoked = createService({
    id: 'revoked-service',
    currentPinId: 'revoked-service',
    providerGlobalMetaId: 'idq1seller',
    available: 0,
    revokedAt: 1_775_000_040_000,
  });

  const page = buildMyServiceSummaries({
    profiles: [
      {
        slug: 'seller',
        name: 'Seller Bot',
        homeDir: '/tmp/seller',
        identity: {
          metabotId: 7,
          name: 'Seller Bot',
          globalMetaId: 'idq1seller',
          mvcAddress: '1seller',
          addresses: { mvc: '1seller' },
        },
        services: [profileAService, revoked],
        sellerOrders: [
          createOrder({
            servicePinId: 'service-create-pin',
            currentServicePinId: 'service-modify-pin',
            paymentTxid: 'payment-completed',
            paymentAmount: '0.00005',
          }),
          createOrder({
            id: 'seller-order-refunded',
            state: 'refunded',
            servicePinId: 'service-modify-pin',
            currentServicePinId: 'service-modify-pin',
            paymentTxid: 'payment-refunded',
            paymentAmount: '0.00005',
            refundCompletedAt: 1_775_000_025_000,
            refundedAt: 1_775_000_025_000,
          }),
          createOrder({
            id: 'seller-order-open',
            state: 'in_progress',
            servicePinId: 'service-modify-pin',
            paymentTxid: 'payment-open',
            paymentAmount: '9',
          }),
        ],
        ratingDetails: [
          {
            pinId: 'rating-1',
            serviceId: 'service-create-pin',
            servicePaidTx: 'payment-completed',
            rate: 4,
            comment: 'Good reading.',
            raterGlobalMetaId: 'idq1buyer',
            raterMetaId: null,
            createdAt: 1_775_000_022_000,
          },
          {
            pinId: 'rating-2',
            serviceId: 'service-modify-pin',
            servicePaidTx: 'payment-refunded',
            rate: 2,
            comment: 'Refunded.',
            raterGlobalMetaId: 'idq1buyer',
            raterMetaId: null,
            createdAt: 1_775_000_026_000,
          },
          {
            pinId: 'rating-unmatched-payment',
            serviceId: 'service-modify-pin',
            servicePaidTx: 'payment-stale-open-or-unrelated',
            rate: 5,
            comment: 'This rating must not count without a matching closed seller order payment tx.',
            raterGlobalMetaId: 'idq1buyer',
            raterMetaId: null,
            createdAt: 1_775_000_027_000,
          },
        ],
      },
      {
        slug: 'seller-b',
        name: 'Seller B',
        homeDir: '/tmp/seller-b',
        identity: {
          metabotId: 8,
          name: 'Seller B',
          globalMetaId: 'idq1seller-b',
          mvcAddress: '1sellerb',
          addresses: { mvc: '1sellerb' },
        },
        services: [profileBService],
        sellerOrders: [],
        ratingDetails: [],
      },
    ],
    page: 1,
    pageSize: 10,
  });

  assert.equal(page.total, 2);
  assert.equal(page.items[0].id, 'service-modify-pin');
  assert.equal(page.items[0].creatorMetabotSlug, 'seller');
  assert.deepEqual(page.items[0].chainPinIds, ['service-create-pin', 'service-modify-pin']);
  assert.equal(page.items[0].successCount, 1);
  assert.equal(page.items[0].refundCount, 1);
  assert.equal(page.items[0].grossRevenue, '0.0001');
  assert.equal(page.items[0].netIncome, '0.00005');
  assert.equal(page.items[0].ratingAvg, 3);
  assert.equal(page.items[0].ratingCount, 2);
  assert.equal(page.items[0].canModify, true);
  assert.equal(page.items[0].canRevoke, true);
  assert.equal(page.items[1].creatorMetabotSlug, 'seller-b');
});

test('buildMyServiceOrderDetails returns closed orders for every service version with ratings', () => {
  const detailPage = buildMyServiceOrderDetails({
    serviceId: 'service-modify-pin',
    profiles: [
      {
        slug: 'seller',
        name: 'Seller Bot',
        homeDir: '/tmp/seller',
        identity: {
          metabotId: 7,
          name: 'Seller Bot',
          globalMetaId: 'idq1seller',
          mvcAddress: '1seller',
          addresses: { mvc: '1seller' },
        },
        services: [
          createService({
            currentPinId: 'service-modify-pin',
            chainPinIds: ['service-create-pin', 'service-modify-pin'],
          }),
        ],
        sellerOrders: [
          createOrder({
            id: 'old-version-order',
            servicePinId: 'service-create-pin',
            currentServicePinId: 'service-modify-pin',
            paymentTxid: 'payment-old',
            deliveredAt: 1_775_000_050_000,
          }),
          createOrder({
            id: 'refunded-order',
            state: 'refunded',
            servicePinId: 'service-modify-pin',
            currentServicePinId: 'service-modify-pin',
            paymentTxid: 'payment-refunded',
            refundCompletedAt: 1_775_000_060_000,
            refundedAt: 1_775_000_060_000,
            updatedAt: 1_775_000_060_000,
          }),
          createOrder({
            id: 'open-order',
            state: 'in_progress',
            servicePinId: 'service-modify-pin',
            paymentTxid: 'payment-open',
          }),
        ],
        ratingDetails: [
          {
            pinId: 'rating-refunded',
            serviceId: 'service-modify-pin',
            servicePaidTx: 'payment-refunded',
            rate: 5,
            comment: 'Handled fairly.',
            raterGlobalMetaId: 'idq1buyer',
            raterMetaId: null,
            createdAt: 1_775_000_061_000,
          },
        ],
      },
    ],
    page: 1,
    pageSize: 10,
  });

  assert.equal(detailPage.total, 2);
  assert.equal(detailPage.items[0].id, 'refunded-order');
  assert.equal(detailPage.items[0].rating.rate, 5);
  assert.equal(detailPage.items[0].rating.comment, 'Handled fairly.');
  assert.equal(detailPage.items[1].id, 'old-version-order');
  assert.equal(detailPage.items[1].rating, null);
});

test('mutation helpers build MetaID writes and local modify/revoke records', () => {
  const service = createService({
    currentPinId: 'service-modify-pin',
    sourceServicePinId: 'service-create-pin',
    chainPinIds: ['service-create-pin', 'service-modify-pin'],
  });
  const target = {
    profileSlug: 'seller',
    profileName: 'Seller Bot',
    profileHomeDir: '/tmp/seller',
    identity: {
      metabotId: 7,
      name: 'Seller Bot',
      globalMetaId: 'idq1seller',
      mvcAddress: '1seller',
      addresses: { mvc: '1seller' },
    },
    service,
  };

  assert.deepEqual(validateMyServiceMutation({ action: 'modify', target }), {
    ok: true,
    creatorMetabotId: 7,
  });

  const modifyWrite = buildMyServiceModifyChainWrite({
    targetPinId: 'service-modify-pin',
    payloadJson: '{"serviceName":"new-service"}',
    network: 'mvc',
  });
  assert.deepEqual(modifyWrite, {
    operation: 'modify',
    path: '@service-modify-pin',
    payload: '{"serviceName":"new-service"}',
    contentType: 'application/json',
    network: 'mvc',
  });

  const modified = buildMyServiceModifyRecord({
    service,
    currentPinId: 'service-modify-pin-2',
    providerGlobalMetaId: 'idq1seller',
    paymentAddress: '1seller',
    draft: {
      serviceName: 'new-service',
      displayName: 'New Service',
      description: 'Updated description.',
      providerSkill: 'new-skill',
      price: '0.001',
      currency: 'BTC',
      outputType: 'image',
      serviceIconUri: 'metafile://icon',
    },
    payloadJson: '{"serviceName":"new-service"}',
    now: 1_775_000_100_000,
  });

  assert.equal(modified.sourceServicePinId, 'service-create-pin');
  assert.equal(modified.currentPinId, 'service-modify-pin-2');
  assert.deepEqual(modified.chainPinIds, ['service-create-pin', 'service-modify-pin', 'service-modify-pin-2']);
  assert.equal(modified.displayName, 'New Service');
  assert.equal(modified.currency, 'BTC');
  assert.equal(modified.revokedAt, null);

  const revokeWrite = buildMyServiceRevokeChainWrite({
    targetPinId: 'service-modify-pin-2',
    network: 'mvc',
  });
  assert.deepEqual(revokeWrite, {
    operation: 'revoke',
    path: '@service-modify-pin-2',
    payload: '',
    contentType: 'application/json',
    network: 'mvc',
  });

  const revoked = buildMyServiceRevokeRecord({
    service: modified,
    now: 1_775_000_110_000,
  });
  assert.equal(revoked.available, 0);
  assert.equal(revoked.revokedAt, 1_775_000_110_000);
  assert.deepEqual(revoked.chainPinIds, ['service-create-pin', 'service-modify-pin', 'service-modify-pin-2']);
});

test('validateMyServiceMutation rejects revoked or missing-creator services', () => {
  const service = createService({ available: 0, revokedAt: 1_775_000_010_000 });

  assert.deepEqual(
    validateMyServiceMutation({
      action: 'revoke',
      target: {
        profileSlug: 'seller',
        profileName: 'Seller Bot',
        profileHomeDir: '/tmp/seller',
        identity: {
          metabotId: 7,
          name: 'Seller Bot',
          globalMetaId: 'idq1seller',
          mvcAddress: '1seller',
          addresses: { mvc: '1seller' },
        },
        service,
      },
    }),
    {
      ok: false,
      error: 'Service is revoked',
      errorCode: 'my_services_blocked_revoked',
    },
  );

  assert.deepEqual(
    validateMyServiceMutation({
      action: 'modify',
      target: {
        profileSlug: 'missing',
        profileName: 'Missing Bot',
        profileHomeDir: '',
        identity: null,
        service: createService({ creatorMetabotId: 0 }),
      },
    }),
    {
      ok: false,
      error: 'Creator MetaBot profile is unavailable',
      errorCode: 'my_services_blocked_missing_creator_profile',
    },
  );
});
