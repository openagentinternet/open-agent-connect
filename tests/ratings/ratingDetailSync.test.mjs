import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const {
  createRatingDetailStateStore,
} = require('../../dist/core/ratings/ratingDetailState.js');
const {
  findRatingDetailByServicePayment,
  parseRatingDetailItem,
  refreshRatingDetailCache,
} = require('../../dist/core/ratings/ratingDetailSync.js');

function createRatingPin(overrides = {}) {
  return {
    id: 'rating-pin-1',
    globalMetaId: 'idq1buyer',
    metaid: 'buyer-meta-id',
    timestamp: 1_775_000_000,
    contentSummary: JSON.stringify({
      serviceID: 'service-pin-1',
      servicePaidTx: 'payment-tx-1',
      rate: '4',
      comment: 'Useful and concrete.',
    }),
    ...overrides,
  };
}

test('parseRatingDetailItem normalizes one /protocols/skill-service-rate row with IDBots-compatible fields', () => {
  const parsed = parseRatingDetailItem(createRatingPin({
    id: 'rating-pin-parse-1',
    createMetaId: 'buyer-meta-create',
    metaid: '',
    timestamp: 'not-a-number',
    contentSummary: {
      serviceID: 'service-pin-parse-1',
      servicePaidTx: '',
      rate: 5,
      comment: '   ',
    },
  }), {
    now: () => 1_775_000_123_456,
  });

  assert.deepEqual(parsed, {
    pinId: 'rating-pin-parse-1',
    serviceId: 'service-pin-parse-1',
    servicePaidTx: null,
    rate: 5,
    comment: null,
    raterGlobalMetaId: 'idq1buyer',
    raterMetaId: 'buyer-meta-create',
    createdAt: 1_775_000_123_456,
  });
});

test('refreshRatingDetailCache skips invalid rows and persists initial latest pin plus backfill cursor', async () => {
  const homeDir = await createProfileHome('metabot-rating-detail-sync-');
  const fetchCalls = [];

  try {
    const store = createRatingDetailStateStore(homeDir);
    const refreshed = await refreshRatingDetailCache({
      store,
      maxPages: 1,
      now: () => 1_775_000_222_000,
      fetchPage: async (cursor) => {
        fetchCalls.push(cursor ?? null);
        return {
          list: [
            createRatingPin({
              id: 'broken-rating-pin',
              contentSummary: '{bad-json',
            }),
            createRatingPin({
              id: 'rating-pin-1',
              metaid: 'buyer-meta-id-1',
            }),
          ],
          nextCursor: 'cursor-older-1',
        };
      },
    });

    assert.deepEqual(fetchCalls, [null]);
    assert.equal(refreshed.insertedCount, 1);
    assert.equal(refreshed.state.latestPinId, 'rating-pin-1');
    assert.equal(refreshed.state.backfillCursor, 'cursor-older-1');
    assert.equal(refreshed.state.lastSyncedAt, 1_775_000_222_000);
    assert.deepEqual(refreshed.state.items, [
      {
        pinId: 'rating-pin-1',
        serviceId: 'service-pin-1',
        servicePaidTx: 'payment-tx-1',
        rate: 4,
        comment: 'Useful and concrete.',
        raterGlobalMetaId: 'idq1buyer',
        raterMetaId: 'buyer-meta-id-1',
        createdAt: 1_775_000_000_000,
      },
    ]);
  } finally {
    await cleanupProfileHome(homeDir);
  }
});

test('refreshRatingDetailCache ignores already-seen pin ids and finds rating detail by serviceID plus servicePaidTx', async () => {
  const homeDir = await createProfileHome('metabot-rating-detail-incremental-');

  try {
    const store = createRatingDetailStateStore(homeDir);
    await store.write({
      items: [
        {
          pinId: 'rating-pin-1',
          serviceId: 'service-pin-1',
          servicePaidTx: 'payment-tx-1',
          rate: 4,
          comment: 'Useful and concrete.',
          raterGlobalMetaId: 'idq1buyer',
          raterMetaId: 'buyer-meta-id',
          createdAt: 1_775_000_000_000,
        },
      ],
      latestPinId: 'rating-pin-1',
      backfillCursor: null,
      lastSyncedAt: 1_775_000_100_000,
    });

    const refreshed = await refreshRatingDetailCache({
      store,
      maxPages: 2,
      now: () => 1_775_000_333_000,
      fetchPage: async () => ({
        list: [
          createRatingPin({
            id: 'rating-pin-2',
            metaid: 'buyer-meta-id-2',
            contentSummary: JSON.stringify({
              serviceID: 'service-pin-2',
              servicePaidTx: 'payment-tx-2',
              rate: '5',
              comment: 'Clear and fast.',
            }),
          }),
          createRatingPin({
            id: 'rating-pin-1',
            metaid: 'buyer-meta-id',
          }),
        ],
        nextCursor: 'cursor-head-1',
      }),
    });

    assert.equal(refreshed.insertedCount, 1);
    assert.equal(refreshed.hitLatestPinId, true);
    assert.equal(refreshed.state.latestPinId, 'rating-pin-2');
    assert.equal(refreshed.state.items.length, 2);

    const matched = findRatingDetailByServicePayment(refreshed.state, {
      serviceId: 'service-pin-2',
      servicePaidTx: 'payment-tx-2',
    });

    assert.deepEqual(matched, {
      pinId: 'rating-pin-2',
      serviceId: 'service-pin-2',
      servicePaidTx: 'payment-tx-2',
      rate: 5,
      comment: 'Clear and fast.',
      raterGlobalMetaId: 'idq1buyer',
      raterMetaId: 'buyer-meta-id-2',
      createdAt: 1_775_000_000_000,
    });
  } finally {
    await cleanupProfileHome(homeDir);
  }
});
