import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  LOOM_PROTOCOLS,
  LOOM_PROTOCOL_NAMES,
  readLoomRawChainRecords,
} = require('../../dist/core/loom/index.js');

const validPinId = `${'a'.repeat(64)}i0`;

function response(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return payload;
    },
  };
}

function page(list = [], nextCursor = null) {
  return response({ data: { list, nextCursor } });
}

function taskRow(overrides = {}) {
  return {
    id: validPinId,
    path: '/protocols/loom-task',
    operation: 'create',
    contentType: 'application/json',
    timestamp: 1750000000000,
    createAddress: '1CreatorAddress',
    metaid: 'metaid-creator',
    globalMetaId: 'global-creator',
    contentSummary: JSON.stringify({
      title: 'Reader test',
      requirementContentType: 'text/markdown',
      requirement: 'Test the reader.',
      criteriaContentType: 'text/markdown',
      criteria: 'Pass tests.',
      projectBase: 'chain',
      project: {},
      bounty: { amount: '1', currency: 'SPACE' },
    }),
    ...overrides,
  };
}

test('fetches all six Loom protocol paths using injected fetchImpl', async () => {
  const seenPaths = [];
  const result = await readLoomRawChainRecords({
    chainApiBaseUrl: 'https://example.test',
    fetchImpl: async (url) => {
      seenPaths.push(new URL(url).searchParams.get('path'));
      return page();
    },
  });

  assert.deepEqual(seenPaths, LOOM_PROTOCOL_NAMES.map((name) => LOOM_PROTOCOLS[name].path));
  assert.equal(result.records.length, 0);
});

test('uses cursor pagination and stops on a repeated cursor', async () => {
  const taskCursors = [];
  const result = await readLoomRawChainRecords({
    chainApiBaseUrl: 'https://example.test',
    pageSize: 1,
    maxPages: 5,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const path = parsed.searchParams.get('path');
      const cursor = parsed.searchParams.get('cursor');
      if (path !== '/protocols/loom-task') {
        return page();
      }
      taskCursors.push(cursor);
      return page([taskRow({ id: `${String(taskCursors.length).padStart(64, 'b')}i0` })], 'again');
    },
  });

  assert.deepEqual(taskCursors, [null, 'again']);
  assert.equal(result.byProtocol.task, 2);
});

test('retains invalid JSON payloads as invalid records', async () => {
  const result = await readLoomRawChainRecords({
    chainApiBaseUrl: 'https://example.test',
    fetchImpl: async (url) => {
      const path = new URL(url).searchParams.get('path');
      return path === '/protocols/loom-task'
        ? page([taskRow({ contentSummary: '{' })])
        : page();
    },
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].payloadValid, false);
  assert.ok(result.records[0].validationErrors.some((error) => error.code === 'invalid_json'));
});

test('retains malformed row paths instead of throwing', async () => {
  const result = await readLoomRawChainRecords({
    chainApiBaseUrl: 'https://example.test',
    fetchImpl: async (url) => {
      const path = new URL(url).searchParams.get('path');
      return path === '/protocols/loom-task'
        ? page([taskRow({ path: '/protocols/not-loom' })])
        : page();
    },
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].protocol, 'task');
  assert.equal(result.records[0].path, '/protocols/not-loom');
  assert.equal(result.records[0].payloadValid, false);
  assert.ok(result.records[0].validationErrors.some((error) => error.path === 'path' && error.code === 'invalid_path'));
});

test('rejects non-OK HTTP responses with the existing HTTP error', async () => {
  await assert.rejects(
    readLoomRawChainRecords({
      chainApiBaseUrl: 'https://example.test',
      fetchImpl: async () => response({}, { ok: false, status: 503 }),
    }),
    /loom_chain_reader_http_503/,
  );
});
