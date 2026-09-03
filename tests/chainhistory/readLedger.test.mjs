import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createChainHistoryStore } = require('../../dist/core/chainhistory/store.js');
const { readInputFromMetawebPin, recordMetawebPinRead } = require('../../dist/core/chainhistory/readLedger.js');

async function createTempProfilePaths() {
  const base = await mkdtempTempRoot('metabot-chainhistory-ledger-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function fullPin(overrides = {}) {
  return {
    pinId: 'pin-ledger-1',
    currentPinId: 'pin-ledger-1',
    protocol: 'simplenote',
    path: '/protocols/simplenote',
    chainName: 'mvc',
    operation: 'create',
    creator: { globalMetaId: 'gm-author', metaid: 'meta-1', name: 'Author', address: 'addr' },
    createdAt: 1,
    contentType: 'text/markdown',
    payload: null,
    text: 'full body text',
    truncated: false,
    totalLength: 14,
    meta: { title: 'A Note', summary: 's', tags: [] },
    attachments: [],
    source: 'local',
    ...overrides,
  };
}

test('readInputFromMetawebPin maps a full pin', () => {
  const input = readInputFromMetawebPin(fullPin(), 'read_metaweb_pin');
  assert.deepEqual(input, {
    pinId: 'pin-ledger-1',
    path: '/protocols/simplenote',
    protocol: 'simplenote',
    title: 'A Note',
    authorGlobalMetaId: 'gm-author',
    contentText: 'full body text',
    source: 'read_metaweb_pin',
  });
});

test('readInputFromMetawebPin maps null text and tolerates missing nested fields', () => {
  const nullText = readInputFromMetawebPin(fullPin({ text: null, totalLength: null, truncated: null }), 'study_job');
  assert.equal(nullText.contentText, null);
  assert.equal(nullText.source, 'study_job');

  const partial = readInputFromMetawebPin(
    { pinId: 'pin-partial', text: 'body' },
    'study_job',
  );
  assert.deepEqual(partial, {
    pinId: 'pin-partial',
    path: null,
    protocol: null,
    title: null,
    authorGlobalMetaId: null,
    contentText: 'body',
    source: 'study_job',
  });

  // Non-string nested values never leak through.
  const odd = readInputFromMetawebPin(
    { pinId: 'pin-odd', meta: { title: 42 }, creator: {}, text: '' },
    'x',
  );
  assert.equal(odd.title, null);
  assert.equal(odd.authorGlobalMetaId, null);
  assert.equal(odd.contentText, null);
});

test('readInputFromMetawebPin returns null without a usable pinId', () => {
  assert.equal(readInputFromMetawebPin(fullPin({ pinId: '' }), 'x'), null);
  assert.equal(readInputFromMetawebPin(fullPin({ pinId: '   ' }), 'x'), null);
  assert.equal(readInputFromMetawebPin({ text: 'body' }, 'x'), null);
  assert.equal(readInputFromMetawebPin(null, 'x'), null);
});

test('recordMetawebPinRead writes a read record through the real store', async () => {
  const paths = await createTempProfilePaths();
  await recordMetawebPinRead(paths, fullPin(), 'study_job');

  const store = createChainHistoryStore(paths);
  const record = await store.getRead('pin-ledger-1');
  assert.ok(record);
  assert.equal(record.pinId, 'pin-ledger-1');
  assert.equal(record.path, '/protocols/simplenote');
  assert.equal(record.protocol, 'simplenote');
  assert.equal(record.title, 'A Note');
  assert.equal(record.authorGlobalMetaId, 'gm-author');
  assert.equal(record.contentExcerpt, 'full body text');
  assert.equal(record.source, 'study_job');
  assert.equal(record.readCount, 1);
  assert.equal(record.savedToKb, false);
});

test('recordMetawebPinRead swallows store failures and warns once', async () => {
  const paths = await createTempProfilePaths();
  // Break the store: a regular file where the .runtime directory must be.
  await fs.writeFile(path.join(paths.profileRoot, '.runtime'), 'not a dir', 'utf8');

  const warnings = [];
  // Must not throw.
  await recordMetawebPinRead(paths, fullPin(), 'read_metaweb_pin', { warn: (msg) => warnings.push(msg) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[chain-history\] failed to record chain read: /);
});

test('recordMetawebPinRead with an unusable pin records nothing and stays silent', async () => {
  const paths = await createTempProfilePaths();
  const warnings = [];
  await recordMetawebPinRead(paths, fullPin({ pinId: '' }), 'x', { warn: (msg) => warnings.push(msg) });
  assert.deepEqual(warnings, []);
  const store = createChainHistoryStore(paths);
  assert.equal(await store.getRead('pin-ledger-1'), null);
});

test('ledger re-read upserts and never clobbers summary or KB state', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);

  await recordMetawebPinRead(paths, fullPin(), 'read_metaweb_pin');
  await store.applySummaryOutcome('read', 'pin-ledger-1', { status: 'done', summary: 'Kept summary.' });
  await store.markReadSavedToKb('pin-ledger-1', 'kb-7');

  // A later re-read (e.g. a study job re-opening the pin) bumps counters and
  // refreshes only the metadata it actually provides.
  await recordMetawebPinRead(paths, fullPin({ title: undefined, meta: undefined, text: null }), 'study_job');

  const record = await store.getRead('pin-ledger-1');
  assert.equal(record.readCount, 2);
  assert.ok(record.lastReadAtMs >= record.firstReadAtMs);
  assert.equal(record.source, 'study_job');
  // Summary and KB fields survive the re-read untouched.
  assert.equal(record.summary, 'Kept summary.');
  assert.equal(record.summaryStatus, 'done');
  assert.equal(record.savedToKb, true);
  assert.equal(record.kbId, 'kb-7');
  // Metadata not provided by the second read keeps its stored values.
  assert.equal(record.title, 'A Note');
  assert.equal(record.contentExcerpt, 'full body text');
});
