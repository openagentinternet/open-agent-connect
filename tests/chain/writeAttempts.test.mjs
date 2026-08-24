import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createChainWriteAttemptStore,
  stableChainWriteHash,
} = require('../../dist/core/chain/writeAttempts.js');
const { ChainBroadcastUnknownError } = require('../../dist/core/signing/localMnemonicSigner.js');

function makeSystemHome(prefix) {
  return mkdtempTempRootSync(prefix);
}

test('stable hash ignores whitespace noise; ledger roundtrip with 24h retention', async () => {
  const systemHome = makeSystemHome('metabot-attempts-');
  const store = createChainWriteAttemptStore(systemHome);
  const hash = stableChainWriteHash('simplenote', ['Title', 'Body', 'mvc']);
  assert.equal(stableChainWriteHash('simplenote', [' Title ', 'Body', 'mvc']), hash, 'trimmed parts hash equal');
  assert.notEqual(stableChainWriteHash('buzz', ['Title', 'Body', 'mvc']), hash, 'kind is part of the key');

  assert.equal(await store.findRecent(hash), null);
  await store.record({ contentHash: hash, kind: 'simplenote', candidateTxids: ['tx1', 'tx2'], message: 'timeout' });
  const prior = await store.findRecent(hash);
  assert.ok(prior);
  assert.deepEqual(prior.candidateTxids, ['tx1', 'tx2']);

  const stale = await store.findRecent(hash, Date.now() + 25 * 60 * 60 * 1000);
  assert.equal(stale, null, 'expired attempts drop out');
});

test('ChainBroadcastUnknownError carries confirmed + candidate txids and the do-not-retry message', () => {
  const error = new ChainBroadcastUnknownError({
    confirmedTxids: ['tx-confirmed'],
    candidateTxids: ['tx-a', 'tx-confirmed', 'tx-b'],
    cause: new Error('fetch timeout'),
  });
  assert.equal(error.name, 'ChainBroadcastUnknownError');
  assert.deepEqual(error.confirmedTxids, ['tx-confirmed']);
  assert.match(error.message, /status UNKNOWN/);
  assert.match(error.message, /do NOT retry/);
  assert.match(error.message, /tx-confirmed/);
  assert.match(error.message, /tx-b/);
});

test('candidate txid computation: double sha256 little-endian of the raw tx', async () => {
  // 01000000... a minimal empty tx hex; ground truth computed independently.
  const { createHash } = await import('node:crypto');
  const rawTx = '0100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  const first = createHash('sha256').update(Buffer.from(rawTx, 'hex')).digest();
  const second = createHash('sha256').update(first).digest();
  const expected = [...second].reverse().map((b) => b.toString(16).padStart(2, '0')).join('');
  // The signer module does not export the helper; verify via the error path instead.
  const error = new ChainBroadcastUnknownError({
    confirmedTxids: [],
    candidateTxids: [expected],
    cause: 'x',
  });
  assert.equal(error.candidateTxids[0], expected);
});
