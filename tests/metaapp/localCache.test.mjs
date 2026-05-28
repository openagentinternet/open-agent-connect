import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMetaAppLocalCacheStore,
} = require('../../dist/core/metaapp/localCache.js');

async function makeProfileRoot(prefix) {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), `metabot-metaapp-cache-${prefix}-`));
  return path.join(systemHome, '.metabot', 'profiles', 'alice');
}

function record(pinId, overrides = {}) {
  return {
    pinId,
    firstPinId: overrides.firstPinId ?? pinId,
    operation: overrides.operation ?? 'create',
    title: overrides.title ?? `App ${pinId}`,
    appName: overrides.appName ?? `app-${pinId}`,
    version: overrides.version ?? '1.0.0',
    runtime: overrides.runtime ?? 'browser',
    indexFile: overrides.indexFile ?? 'index.html',
    code: overrides.code ?? `metafile://${pinId}`,
    content: overrides.content ?? `metafile://${pinId}`,
    contentType: overrides.contentType ?? 'application/zip',
    codeType: overrides.codeType ?? 'application/zip',
    tags: overrides.tags ?? ['demo'],
    ownerGlobalMetaId: overrides.ownerGlobalMetaId ?? 'owner-meta-id',
    ownerAddress: overrides.ownerAddress ?? 'owner-address',
    network: overrides.network ?? 'mvc',
    metawebUrl: overrides.metawebUrl ?? `https://metaweb.world/metaapp/${pinId}`,
    localUiUrl: overrides.localUiUrl,
    updatedAt: overrides.updatedAt ?? 1_700_000_000,
    source: overrides.source ?? 'local',
    raw: overrides.raw,
  };
}

test('cache paths resolve under profile runtime state metaapps directory', async () => {
  const profileRoot = await makeProfileRoot('paths');
  const store = createMetaAppLocalCacheStore(profileRoot);

  assert.equal(
    store.localCachePath,
    path.join(profileRoot, '.runtime', 'state', 'metaapps', 'local-cache.json'),
  );
  assert.equal(
    store.indexerCachePath,
    path.join(profileRoot, '.runtime', 'state', 'metaapps', 'indexer-cache.json'),
  );
});

test('missing cache files read as empty versioned states', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('missing'));

  assert.deepEqual(await store.readLocal(), {
    version: 1,
    records: [],
    updatedAt: null,
  });
  assert.deepEqual(await store.readIndexer(), {
    version: 1,
    records: [],
    updatedAt: null,
  });
});

test('writing and reading an empty cache state preserves updatedAt null', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('empty-null-updated-at'));

  await store.writeLocal({
    version: 1,
    records: [],
    updatedAt: null,
  });

  assert.deepEqual(await store.readLocal(), {
    version: 1,
    records: [],
    updatedAt: null,
  });
});

test('malformed cache records are dropped without crashing', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('malformed'));
  await mkdir(path.dirname(store.localCachePath), { recursive: true });
  await writeFile(store.localCachePath, `${JSON.stringify({
    version: 1,
    updatedAt: 123,
    records: [
      { pinId: '' },
      { pinId: 'missing-required-fields' },
      record('valid-pin', { title: 'Valid app' }),
    ],
  })}\n`, 'utf8');

  const state = await store.readLocal();

  assert.equal(state.version, 1);
  assert.equal(state.updatedAt, 123);
  assert.deepEqual(state.records.map((item) => item.pinId), ['valid-pin']);
});

test('malformed cache records with null updatedAt are dropped without coercing to zero', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('null-record-updated-at'));
  await mkdir(path.dirname(store.localCachePath), { recursive: true });
  await writeFile(store.localCachePath, `${JSON.stringify({
    version: 1,
    updatedAt: null,
    records: [
      { ...record('null-updated-at'), updatedAt: null },
      { ...record('empty-updated-at'), updatedAt: '' },
      { ...record('boolean-updated-at'), updatedAt: false },
      { ...record('array-updated-at'), updatedAt: [] },
      record('valid-updated-at', { updatedAt: 456 }),
    ],
  })}\n`, 'utf8');

  const state = await store.readLocal();

  assert.equal(state.updatedAt, null);
  assert.deepEqual(state.records.map((item) => item.pinId), ['valid-updated-at']);
  assert.equal(state.records[0].updatedAt, 456);
});

test('local records are upserted by pinId and written with a trailing newline', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('upsert'));

  await store.upsertLocal(record('pin-1', { title: 'Original title', updatedAt: 1 }));
  const state = await store.upsertLocal(record('pin-1', { title: 'Updated title', updatedAt: 2 }));

  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].title, 'Updated title');
  assert.equal(state.records[0].updatedAt, 2);
  assert.equal((await readFile(store.localCachePath, 'utf8')).endsWith('\n'), true);
});

test('modify update records keep firstPinId from the supplied target', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('modify'));

  const state = await store.upsertLocal(record('new-version-pin', {
    firstPinId: 'original-create-pin',
    operation: 'modify',
    version: '1.1.0',
  }));

  assert.equal(state.records[0].pinId, 'new-version-pin');
  assert.equal(state.records[0].operation, 'modify');
  assert.equal(state.records[0].firstPinId, 'original-create-pin');
});

test('merged listing returns indexer records first and then local optimistic records not yet indexed', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('merge'));
  await store.writeIndexer({
    version: 1,
    updatedAt: 20,
    records: [
      record('indexed-pin', { source: 'indexer', title: 'Indexed' }),
      record('indexed-update-pin', { source: 'indexer', firstPinId: 'shared-first', title: 'Indexed update' }),
    ],
  });
  await store.writeLocal({
    version: 1,
    updatedAt: 21,
    records: [
      record('indexed-pin', { source: 'local', title: 'Optimistic duplicate' }),
      record('local-new-pin', { source: 'local', firstPinId: 'shared-first', operation: 'modify', title: 'Local update' }),
    ],
  });

  const merged = await store.listMerged();

  assert.deepEqual(merged.map((item) => `${item.source}:${item.pinId}`), [
    'indexer:indexed-pin',
    'indexer:indexed-update-pin',
    'local:local-new-pin',
  ]);
});

test('merged listing is derived in memory and does not write a third cache file', async () => {
  const store = createMetaAppLocalCacheStore(await makeProfileRoot('no-third-file'));
  await store.writeIndexer({ version: 1, updatedAt: 1, records: [record('indexed', { source: 'indexer' })] });
  await store.writeLocal({ version: 1, updatedAt: 2, records: [record('local-only')] });

  await store.listMerged();

  assert.deepEqual((await readdir(path.dirname(store.localCachePath))).sort(), [
    'indexer-cache.json',
    'local-cache.json',
  ]);
});
