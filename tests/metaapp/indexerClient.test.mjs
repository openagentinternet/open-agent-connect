import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMetaAppIndexerClient,
} = require('../../dist/core/metaapp/indexerClient.js');

function officialRecord(overrides = {}) {
  return {
    first_pin_id: overrides.first_pin_id ?? 'first-pin',
    pin_id: overrides.pin_id ?? 'record-pin',
    operation: overrides.operation ?? 'create',
    title: overrides.title ?? 'Official MetaApp',
    app_name: overrides.app_name ?? 'official-metaapp',
    version: overrides.version ?? '1.2.3',
    runtime: overrides.runtime ?? 'browser',
    index_file: overrides.index_file ?? 'index.html',
    code: overrides.code ?? 'metafile://code-pin',
    content: overrides.content ?? 'metafile://content-pin',
    content_type: overrides.content_type ?? 'application/zip',
    code_type: overrides.code_type ?? 'application/zip',
    tags: overrides.tags ?? ['game', 'demo'],
    creator_meta_id: overrides.creator_meta_id ?? 'creator-meta-id',
    creator_address: overrides.creator_address ?? 'creator-address',
    owner_meta_id: overrides.owner_meta_id,
    owner_address: overrides.owner_address,
    chain_name: overrides.chain_name ?? 'mvc',
    updated_at: overrides.updated_at ?? '2026-05-26T01:02:03Z',
    deploy_info: overrides.deploy_info ?? { status: 'ready' },
    unexpected_field: 'preserved',
  };
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return body;
    },
  };
}

function makeFetch(responseBody, calls) {
  return async (url) => {
    calls.push(String(url));
    return jsonResponse(responseBody);
  };
}

test('list fetch reads the official metaapps route', async () => {
  const calls = [];
  const client = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example/',
    fetch: makeFetch({ code: 0, data: { apps: [] } }, calls),
  });

  await client.list();

  assert.deepEqual(calls, ['https://indexer.example/api/v1/metaapps']);
});

test('pin fetch reads the official pin detail route', async () => {
  const calls = [];
  const client = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example/',
    fetch: makeFetch({ code: 0, data: officialRecord({ pin_id: 'pin-123' }) }, calls),
  });

  await client.getByPinId('pin-123');

  assert.deepEqual(calls, ['https://indexer.example/api/v1/metaapps/pin-123']);
});

test('history fetch reads the official first-pin history route', async () => {
  const calls = [];
  const client = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example/',
    fetch: makeFetch({ code: 0, data: { history: [] } }, calls),
  });

  await client.getHistory('first-123');

  assert.deepEqual(calls, ['https://indexer.example/api/v1/metaapps/first/first-123/history']);
});

test('creator fetch reads the official creator route', async () => {
  const calls = [];
  const client = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example/',
    fetch: makeFetch({ code: 0, data: { apps: [] } }, calls),
  });

  await client.list({ creatorGlobalMetaId: 'creator-meta-id' });

  assert.deepEqual(calls, ['https://indexer.example/api/v1/metaapps/creator/creator-meta-id']);
});

test('normalizer maps official records into MetaAppGalleryRecord', async () => {
  const client = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example',
    fetch: makeFetch({ code: 0, data: { apps: [officialRecord()] } }, []),
    now: () => 1_800_000_000,
  });

  const result = await client.list();

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.data[0], {
    pinId: 'record-pin',
    firstPinId: 'first-pin',
    operation: 'create',
    title: 'Official MetaApp',
    appName: 'official-metaapp',
    version: '1.2.3',
    runtime: 'browser',
    indexFile: 'index.html',
    code: 'metafile://code-pin',
    content: 'metafile://content-pin',
    contentType: 'application/zip',
    codeType: 'application/zip',
    tags: ['game', 'demo'],
    ownerGlobalMetaId: 'creator-meta-id',
    ownerAddress: 'creator-address',
    network: 'mvc',
    metawebUrl: 'https://indexer.example/api/v1/metaapps/record-pin',
    updatedAt: Date.parse('2026-05-26T01:02:03Z'),
    source: 'indexer',
    raw: officialRecord(),
  });
});

test('malformed and failed indexer responses return typed failures without throwing', async () => {
  const malformedClient = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example',
    fetch: makeFetch({ code: 0, data: { apps: [{ pin_id: '' }] } }, []),
  });
  const failedClient = createMetaAppIndexerClient({
    baseUrl: 'https://indexer.example',
    fetch: async () => jsonResponse({ message: 'service unavailable' }, { ok: false, status: 503 }),
  });

  const malformed = await malformedClient.list();
  const failed = await failedClient.list();

  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'indexer_malformed_response');
  assert.deepEqual(malformed.data, []);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'indexer_http_error');
  assert.equal(failed.error.status, 503);
  assert.deepEqual(failed.data, []);
});

test('METABOT_METAAPP_INDEXER_BASE_URL overrides the default base URL', async () => {
  const calls = [];
  const client = createMetaAppIndexerClient({
    env: {
      METABOT_METAAPP_INDEXER_BASE_URL: 'https://override.example/',
    },
    fetch: makeFetch({ code: 0, data: { apps: [] } }, calls),
  });

  assert.equal(client.baseUrl, 'https://override.example');
  await client.list();

  assert.deepEqual(calls, ['https://override.example/api/v1/metaapps']);
});
