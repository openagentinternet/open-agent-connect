import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createChainHistoryStore } = require('../../dist/core/chainhistory/store.js');
const { shouldRecordChainWrite, wrapSignerWithChainHistory } = require('../../dist/core/chainhistory/writeLedger.js');

async function createTempProfilePaths() {
  const base = await mkdtempTempRoot('metabot-chainhistory-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function fakeWriteResult(overrides = {}) {
  return {
    txids: ['tx-abc'],
    pinId: 'pin-ledger-1',
    totalCost: 100,
    network: 'mvc',
    operation: 'create',
    path: '/protocols/simplebuzz',
    contentType: 'text/plain',
    encoding: 'utf-8',
    globalMetaId: 'idq1test',
    mvcAddress: 'mvc-address',
    ...overrides,
  };
}

function fakeSigner(result, writePinImpl) {
  return {
    getIdentity: async () => ({ globalMetaId: 'idq1test', mvcAddress: 'mvc-address' }),
    getPrivateChatIdentity: async () => ({
      globalMetaId: 'idq1test',
      chatPublicKey: 'chat-pk',
      privateKeyHex: 'chat-sk',
    }),
    writePin: writePinImpl ?? (async () => result),
  };
}

async function listWriteRecordFiles(paths) {
  const writesRoot = path.join(paths.chainHistoryRoot, 'writes');
  let shards = [];
  try {
    shards = await fs.readdir(writesRoot);
  } catch {
    return [];
  }
  const files = [];
  for (const shard of shards) {
    for (const entry of await fs.readdir(path.join(writesRoot, shard))) {
      if (entry.endsWith('.json')) {
        files.push(`${shard}/${entry}`);
      }
    }
  }
  return files.sort();
}

test('shouldRecordChainWrite excludes chat/group/identity paths, records everything else', () => {
  for (const excluded of [
    '/protocols/simplemsg',
    '/protocols/simplegroupcreate',
    '/protocols/simplegroupjoin',
    '/protocols/simplegroupchat',
    '/protocols/simplegroupremoveuser',
  ]) {
    assert.equal(shouldRecordChainWrite(excluded), false, excluded);
  }
  for (const excluded of ['/info/', '/info/name', '/info/avatar']) {
    assert.equal(shouldRecordChainWrite(excluded), false, excluded);
  }
  for (const recorded of [
    '/protocols/simplebuzz',
    '/protocols/simplenote',
    '/file',
    // Exact-match/prefix discipline: near-misses are still recorded.
    '/protocols/simplemsgs',
    '/protocols/simplegroupchatx',
    '/info',
    '/information',
  ]) {
    assert.equal(shouldRecordChainWrite(recorded), true, recorded);
  }
  assert.equal(shouldRecordChainWrite(null), true);
  assert.equal(shouldRecordChainWrite(undefined), true);
  assert.equal(shouldRecordChainWrite(''), true);
});

test('identity methods delegate to the wrapped signer', async () => {
  const paths = await createTempProfilePaths();
  const identity = { globalMetaId: 'idq1delegate' };
  const chatIdentity = { globalMetaId: 'idq1delegate', chatPublicKey: 'pk', privateKeyHex: 'sk' };
  const signer = wrapSignerWithChainHistory({
    getIdentity: async () => identity,
    getPrivateChatIdentity: async () => chatIdentity,
    writePin: async () => {
      throw new Error('unused');
    },
  }, paths);
  assert.equal(await signer.getIdentity(), identity);
  assert.equal(await signer.getPrivateChatIdentity(), chatIdentity);
});

test('wrap records a text payload write with exact field mapping', async () => {
  const paths = await createTempProfilePaths();
  const result = fakeWriteResult();
  const signer = wrapSignerWithChainHistory(fakeSigner(result), paths);
  const request = {
    operation: 'create',
    path: '/protocols/simplebuzz',
    contentType: 'text/plain',
    payload: 'hello chain history',
    encoding: 'utf-8',
    network: 'mvc',
  };
  const returned = await signer.writePin(request);
  assert.equal(returned, result); // the write result passes through unaltered

  // The default store is wired from `paths`; read back through a fresh store.
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-1');
  assert.equal(record.pinId, 'pin-ledger-1');
  assert.equal(record.txId, 'tx-abc');
  assert.equal(record.path, '/protocols/simplebuzz');
  assert.equal(record.operation, 'create');
  assert.equal(record.network, 'mvc');
  assert.equal(record.contentText, 'hello chain history');
  assert.ok(record.contentBytes > 0);
  assert.equal(record.contentBytes, Buffer.byteLength('hello chain history', 'utf8'));
  assert.equal(record.contentType, 'text/plain');
  assert.ok(record.occurredAtMs > 0);
});

test('operation/network fall back to result fields when the request omits them', async () => {
  const paths = await createTempProfilePaths();
  const signer = wrapSignerWithChainHistory(
    fakeSigner(fakeWriteResult({ pinId: 'pin-ledger-fallback', operation: 'modify', network: 'btc' })),
    paths,
  );
  await signer.writePin({ path: '/protocols/simplenote', payload: 'note text', contentType: 'text/plain' });
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-fallback');
  assert.equal(record.operation, 'modify');
  assert.equal(record.network, 'btc');
});

test('wrap records a Buffer payload as byte count only', async () => {
  const paths = await createTempProfilePaths();
  const payload = Buffer.from([0, 1, 2, 3, 255, 254, 199]);
  const signer = wrapSignerWithChainHistory(
    fakeSigner(fakeWriteResult({ pinId: 'pin-ledger-buffer' })),
    paths,
  );
  await signer.writePin({
    path: '/file',
    payload,
    encoding: 'binary',
    contentType: 'application/octet-stream',
  });
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-buffer');
  assert.equal(record.contentText, null);
  assert.equal(record.contentTruncated, false);
  assert.equal(record.contentBytes, payload.byteLength);
});

test('wrap records a base64 string payload with its decoded byte length', async () => {
  const paths = await createTempProfilePaths();
  const raw = Buffer.from('binary-payload-bytes', 'utf8');
  const signer = wrapSignerWithChainHistory(
    fakeSigner(fakeWriteResult({ pinId: 'pin-ledger-base64' })),
    paths,
  );
  await signer.writePin({
    path: '/file',
    payload: raw.toString('base64'),
    encoding: 'base64',
    contentType: 'application/octet-stream',
  });
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-base64');
  assert.equal(record.contentText, null);
  assert.equal(record.contentBytes, raw.byteLength);
});

test('wrap records a payload-less write with null text, zero bytes, and null txId', async () => {
  const paths = await createTempProfilePaths();
  const signer = wrapSignerWithChainHistory(
    fakeSigner(fakeWriteResult({ pinId: 'pin-ledger-empty', txids: [] })),
    paths,
  );
  await signer.writePin({ path: '/protocols/simplenote' });
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-empty');
  assert.equal(record.txId, null);
  assert.equal(record.contentText, null);
  assert.equal(record.contentBytes, 0);
});

test('excluded paths record nothing', async () => {
  const paths = await createTempProfilePaths();
  const signer = wrapSignerWithChainHistory(
    fakeSigner(fakeWriteResult({ pinId: 'pin-ledger-excluded', path: '/protocols/simplemsg' })),
    paths,
  );
  const result = await signer.writePin({
    path: '/protocols/simplemsg',
    payload: 'secret chat content',
    contentType: 'text/plain',
  });
  assert.equal(result.pinId, 'pin-ledger-excluded');
  assert.equal(await createChainHistoryStore(paths).getWrite('pin-ledger-excluded'), null);
  assert.deepEqual(await listWriteRecordFiles(paths), []);
});

test('a failed writePin propagates unchanged and records nothing', async () => {
  const paths = await createTempProfilePaths();
  const failure = new Error('broadcast failed');
  const signer = wrapSignerWithChainHistory(fakeSigner(null, async () => {
    throw failure;
  }), paths);
  await assert.rejects(
    () => signer.writePin({ path: '/protocols/simplebuzz', payload: 'x', contentType: 'text/plain' }),
    (error) => error === failure,
  );
  assert.deepEqual(await listWriteRecordFiles(paths), []);
});

test('store failures are swallowed and warned, never propagated', async () => {
  const paths = await createTempProfilePaths();
  const warnings = [];
  const failingStore = {
    recordWrite: async () => {
      throw new Error('disk full');
    },
  };
  const result = fakeWriteResult({ pinId: 'pin-ledger-storefail' });
  const signer = wrapSignerWithChainHistory(fakeSigner(result), paths, {
    store: failingStore,
    warn: (message) => warnings.push(message),
  });
  const returned = await signer.writePin({
    path: '/protocols/simplebuzz',
    payload: 'still returned',
    contentType: 'text/plain',
  });
  assert.equal(returned, result);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[chain-history\] failed to record chain write: disk full$/);
});

test('double-wrapping a signer still yields exactly one record file', async () => {
  const paths = await createTempProfilePaths();
  const result = fakeWriteResult({ pinId: 'pin-ledger-double' });
  const wrappedOnce = wrapSignerWithChainHistory(fakeSigner(result), paths);
  const wrappedTwice = wrapSignerWithChainHistory(wrappedOnce, paths);
  const returned = await wrappedTwice.writePin({
    path: '/protocols/simplebuzz',
    payload: 'double wrap me',
    contentType: 'text/plain',
  });
  assert.equal(returned, result);
  const record = await createChainHistoryStore(paths).getWrite('pin-ledger-double');
  assert.equal(record.contentText, 'double wrap me');
  const shardFiles = await listWriteRecordFiles(paths);
  assert.equal(shardFiles.length, 1);
  assert.ok(shardFiles[0].endsWith('/pin-ledger-double.json'));
});

test('a result with an empty pinId records nothing', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const emptyPin = wrapSignerWithChainHistory(fakeSigner(fakeWriteResult({ pinId: '' })), paths);
  await emptyPin.writePin({ path: '/protocols/simplebuzz', payload: 'no pin', contentType: 'text/plain' });
  const blankPin = wrapSignerWithChainHistory(fakeSigner(fakeWriteResult({ pinId: '   ' })), paths);
  await blankPin.writePin({ path: '/protocols/simplebuzz', payload: 'blank pin', contentType: 'text/plain' });
  assert.deepEqual(await store.searchWrites({}), []);
  assert.deepEqual(await listWriteRecordFiles(paths), []);
});
