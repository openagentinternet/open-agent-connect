import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createRatingDetailStateStore,
} = require('../../dist/core/ratings/ratingDetailState.js');

async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(path.join(systemHome, '.metabot', 'manager'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

test('createRatingDetailStateStore persists rating detail items in .runtime/state/rating-detail.json', async () => {
  const homeDir = await createProfileHome('metabot-rating-detail-state-');

  try {
    const store = createRatingDetailStateStore(homeDir);
    const written = await store.write({
      items: [
        {
          pinId: 'rating-pin-1',
          serviceId: 'service-pin-1',
          servicePaidTx: 'payment-tx-1',
          rate: 5,
          comment: 'Precise and helpful.',
          raterGlobalMetaId: 'idq1buyer',
          raterMetaId: 'buyer-meta-id',
          createdAt: 1_775_000_000_000,
        },
      ],
      latestPinId: 'rating-pin-1',
      backfillCursor: 'cursor-1',
      lastSyncedAt: 1_775_000_000_100,
    });

    assert.equal(
      store.paths.ratingDetailStatePath,
      path.join(homeDir, '.runtime', 'state', 'rating-detail.json')
    );
    assert.deepEqual(written, {
      items: [
        {
          pinId: 'rating-pin-1',
          serviceId: 'service-pin-1',
          servicePaidTx: 'payment-tx-1',
          rate: 5,
          comment: 'Precise and helpful.',
          raterGlobalMetaId: 'idq1buyer',
          raterMetaId: 'buyer-meta-id',
          createdAt: 1_775_000_000_000,
        },
      ],
      latestPinId: 'rating-pin-1',
      backfillCursor: 'cursor-1',
      lastSyncedAt: 1_775_000_000_100,
    });
    assert.deepEqual(await store.read(), written);
    assert.deepEqual(
      JSON.parse(await readFile(store.paths.ratingDetailStatePath, 'utf8')),
      written
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('createRatingDetailStateStore persists sync cursors through update and normalizes a missing file to empty state', async () => {
  const homeDir = await createProfileHome('metabot-rating-detail-update-');

  try {
    const store = createRatingDetailStateStore(homeDir);

    assert.deepEqual(await store.read(), {
      items: [],
      latestPinId: null,
      backfillCursor: null,
      lastSyncedAt: null,
    });

    const updated = await store.update((currentState) => ({
      ...currentState,
      latestPinId: 'rating-pin-2',
      backfillCursor: 'cursor-2',
      lastSyncedAt: 1_775_000_000_200,
    }));

    assert.deepEqual(updated, {
      items: [],
      latestPinId: 'rating-pin-2',
      backfillCursor: 'cursor-2',
      lastSyncedAt: 1_775_000_000_200,
    });
    assert.deepEqual(await store.read(), updated);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('createRatingDetailStateStore normalizes malformed files to an empty state', async () => {
  const homeDir = await createProfileHome('metabot-rating-detail-malformed-');

  try {
    const store = createRatingDetailStateStore(homeDir);
    await store.ensureLayout();
    await writeFile(store.paths.ratingDetailStatePath, 'not-json', 'utf8');

    assert.deepEqual(await store.read(), {
      items: [],
      latestPinId: null,
      backfillCursor: null,
      lastSyncedAt: null,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
