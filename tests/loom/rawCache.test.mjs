import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLoomRawCacheStore,
  LOOM_PROTOCOL_NAMES,
} = require('../../dist/core/loom/index.js');

async function createProfileHome() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metabot-loom-cache-'));
  return path.join(root, '.metabot', 'profiles', 'eric');
}

function record(overrides = {}) {
  return {
    pinId: `${'a'.repeat(64)}i0`,
    protocol: 'task',
    path: '/protocols/loom-task',
    operation: 'create',
    contentType: 'application/json',
    timestamp: 1750000000000,
    creatorAddress: '1CreatorAddress',
    creatorMetaId: 'metaid-creator',
    globalMetaId: 'global-creator',
    payload: { title: 'Fix cache' },
    payloadValid: true,
    validationErrors: [],
    raw: { id: `${'a'.repeat(64)}i0` },
    ...overrides,
  };
}

test('empty cache read returns version 1 and all Loom protocol buckets', async () => {
  const store = createLoomRawCacheStore(await createProfileHome());

  const state = await store.read();

  assert.equal(state.version, 1);
  assert.deepEqual(Object.keys(state.records).sort(), [...LOOM_PROTOCOL_NAMES].sort());
  for (const protocol of LOOM_PROTOCOL_NAMES) {
    assert.deepEqual(state.records[protocol], []);
  }
});

test('write/read roundtrip preserves invalid records', async () => {
  const store = createLoomRawCacheStore(await createProfileHome());
  const invalid = record({
    payloadValid: false,
    validationErrors: [
      { path: 'payoutAddress', code: 'required', message: 'payoutAddress is required.' },
    ],
  });

  await store.write({
    version: 1,
    updatedAt: 1750000001000,
    records: {
      task: [invalid],
      claim: [],
      status: [],
      delivery: [],
      acceptance: [],
      'claim-reject': [],
    },
  });

  const state = await store.read();
  assert.deepEqual(state.records.task, [invalid]);
});

test('duplicate pinId rows deduplicate by latest timestamp', async () => {
  const store = createLoomRawCacheStore(await createProfileHome());
  const oldRecord = record({
    pinId: `${'b'.repeat(64)}i0`,
    timestamp: 1750000000000,
    payload: { title: 'old' },
  });
  const latestRecord = record({
    pinId: `${'b'.repeat(64)}i0`,
    timestamp: 1750000005000,
    payload: { title: 'latest' },
  });

  await store.write({
    version: 1,
    updatedAt: 1750000010000,
    records: {
      task: [oldRecord, latestRecord],
      claim: [],
      status: [],
      delivery: [],
      acceptance: [],
      'claim-reject': [],
    },
  });

  const state = await store.read();
  assert.equal(state.records.task.length, 1);
  assert.deepEqual(state.records.task[0], latestRecord);
});
