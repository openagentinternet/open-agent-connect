import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = {
    list: [],
    search: [],
    recall: [],
    add: [],
    update: [],
    delete: [],
    unarchive: [],
    knowledgeList: [],
    knowledgeUpsert: [],
    knowledgeUpdate: [],
    knowledgeArchive: [],
    knowledgeDelete: [],
    impressionsList: [],
    impressionsShow: [],
    policyGet: [],
    policySet: [],
    policyDelete: [],
    hygieneStatus: [],
    hygieneRun: [],
    hygieneConfigGet: [],
    hygieneConfigSet: [],
  };
  const server = createHttpServer({
    memory: {
      list: async (input) => { calls.list.push(input); return commandSuccess({ entries: [] }); },
      search: async (input) => { calls.search.push(input); return commandSuccess({ records: [] }); },
      recall: async (input) => { calls.recall.push(input); return commandSuccess({ text: '', summaries: [] }); },
      add: async (input) => { calls.add.push(input); return commandSuccess({ memory: { id: 'mem-1' } }); },
      update: async (input) => { calls.update.push(input); return commandSuccess({ memory: { id: 'mem-1' } }); },
      delete: async (input) => { calls.delete.push(input); return commandSuccess({ deleted: true }); },
      unarchive: async (input) => { calls.unarchive.push(input); return commandSuccess({ restored: 1 }); },
      knowledgeList: async (input) => { calls.knowledgeList.push(input); return commandSuccess({ entries: [] }); },
      knowledgeUpsert: async (input) => { calls.knowledgeUpsert.push(input); return commandSuccess({ entry: {}, created: true }); },
      knowledgeUpdate: async (input) => { calls.knowledgeUpdate.push(input); return commandSuccess({ entry: {} }); },
      knowledgeArchive: async (input) => { calls.knowledgeArchive.push(input); return commandSuccess({ entry: {} }); },
      knowledgeDelete: async (input) => { calls.knowledgeDelete.push(input); return commandSuccess({ deleted: true }); },
      impressionsList: async (input) => { calls.impressionsList.push(input); return commandSuccess({ snapshots: [] }); },
      impressionsShow: async (input) => { calls.impressionsShow.push(input); return commandSuccess({ snapshot: null, observations: [] }); },
      policyGet: async (input) => { calls.policyGet.push(input); return commandSuccess({ effective: {} }); },
      policySet: async (input) => { calls.policySet.push(input); return commandSuccess({ policy: {} }); },
      policyDelete: async (input) => { calls.policyDelete.push(input); return commandSuccess({ deleted: true }); },
      hygieneStatus: async (input) => { calls.hygieneStatus.push(input); return commandSuccess({ due: false }); },
      hygieneRun: async (input) => { calls.hygieneRun.push(input); return commandSuccess({ consolidated: 1 }); },
      hygieneConfigGet: async (input) => { calls.hygieneConfigGet.push(input); return commandSuccess({ config: {} }); },
      hygieneConfigSet: async (input) => { calls.hygieneConfigSet.push(input); return commandSuccess({ config: {} }); },
    },
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    calls,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('GET memory read verbs forward query input to handlers', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/memory/list?from=alice&usageClass=fact&limit=20', 'list', { from: 'alice', usageClass: 'fact', limit: 20 }],
    ['/api/memory/knowledge/list?from=alice&kind=skill', 'knowledgeList', { from: 'alice', kind: 'skill' }],
    ['/api/memory/impressions/list?from=alice', 'impressionsList', { from: 'alice' }],
    ['/api/memory/impressions/show?from=alice&subject=gm-bob', 'impressionsShow', { from: 'alice', subject: 'gm-bob' }],
    ['/api/memory/policy?from=alice', 'policyGet', { from: 'alice' }],
    ['/api/memory/hygiene/status?from=alice', 'hygieneStatus', { from: 'alice' }],
    ['/api/memory/hygiene/config?from=alice', 'hygieneConfigGet', { from: 'alice' }],
  ];

  for (const [path, key, expectedInput] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`);
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, true, path);
    assert.deepEqual(server.calls[key], [expectedInput], path);
  }
});

test('GET /api/memory/list rejects a non-positive-integer limit before the handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/memory/list?from=alice&limit=-3`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, commandFailed('invalid_flag', 'limit must be a positive integer.'));
  assert.deepEqual(server.calls.list, []);
});

test('GET /api/memory/impressions/show requires a subject', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/memory/impressions/show?from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.code, 'missing_subject');
  assert.deepEqual(server.calls.impressionsShow, []);
});

test('POST memory write verbs split from and payload exactly like the CLI envelope', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/memory/add', 'add', { from: 'alice', text: 'likes tea', usageClass: 'preference' }, { text: 'likes tea', usageClass: 'preference' }],
    ['/api/memory/update', 'update', { from: 'alice', id: 'mem-1', text: 'likes coffee' }, { id: 'mem-1', text: 'likes coffee' }],
    ['/api/memory/delete', 'delete', { from: 'alice', id: 'mem-1' }, { id: 'mem-1' }],
    ['/api/memory/unarchive', 'unarchive', { from: 'alice', id: 'mem-1' }, { id: 'mem-1' }],
    ['/api/memory/search', 'search', { from: 'alice', query: 'tea' }, { query: 'tea' }],
    ['/api/memory/recall', 'recall', { from: 'alice', query: 'yesterday' }, { query: 'yesterday' }],
    ['/api/memory/knowledge/upsert', 'knowledgeUpsert', { from: 'alice', topic: 'surf', summary: 'surf flow' }, { topic: 'surf', summary: 'surf flow' }],
    ['/api/memory/knowledge/update', 'knowledgeUpdate', { from: 'alice', id: 'k-1', summary: 'v2' }, { id: 'k-1', summary: 'v2' }],
    ['/api/memory/knowledge/archive', 'knowledgeArchive', { from: 'alice', id: 'k-1' }, { id: 'k-1' }],
    ['/api/memory/knowledge/delete', 'knowledgeDelete', { from: 'alice', id: 'k-1' }, { id: 'k-1' }],
    ['/api/memory/policy', 'policySet', { from: 'alice', memoryEnabled: true }, { memoryEnabled: true }],
    ['/api/memory/hygiene/run', 'hygieneRun', { from: 'alice', noDeep: true }, undefined],
    ['/api/memory/hygiene/config', 'hygieneConfigSet', { from: 'alice', deepConsolidationHour: 3 }, { deepConsolidationHour: 3 }],
  ];

  for (const [path, key, body, expectedPayload] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, true, path);
    if (expectedPayload === undefined) {
      assert.deepEqual(server.calls[key], [{ from: 'alice', ...body }], path);
    } else {
      assert.deepEqual(server.calls[key], [{ from: 'alice', payload: expectedPayload }], path);
    }
  }
});

test('POST memory verbs validate required payload fields before the handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/memory/update', { from: 'alice', text: 'x' }, 'payload.id is required.'],
    ['/api/memory/add', { from: 'alice' }, 'payload.text is required.'],
    ['/api/memory/search', { from: 'alice' }, 'payload.query is required.'],
    ['/api/memory/knowledge/upsert', { from: 'alice', topic: 't' }, 'payload.topic and payload.summary are required.'],
  ];

  for (const [path, body, message] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, false, path);
    assert.equal(payload.code, 'invalid_payload', path);
    assert.equal(payload.message, message, path);
  }
});

test('DELETE /api/memory/policy dispatches to policyDelete', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/memory/policy?from=alice`, { method: 'DELETE' });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.policyDelete, [{ from: 'alice' }]);
  assert.equal(payload.data.deleted, true);
});

test('memory routes reject wrong methods and unknown verbs', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const wrongMethod = await fetch(`${server.baseUrl}/api/memory/add?from=alice`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  const unknown = await fetch(`${server.baseUrl}/api/memory/nope`);
  const unknownPayload = await unknown.json();
  assert.equal(unknown.status, 200);
  assert.equal(unknownPayload.code, 'unknown_command');
});

test('local daemon boundary rejects cross-site POSTs to /api/memory/add before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/memory/add`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ from: 'alice', text: 'x' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.add, []);
});
