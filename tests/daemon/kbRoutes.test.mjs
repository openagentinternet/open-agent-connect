import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = {
    list: [],
    create: [],
    update: [],
    remove: [],
    query: [],
    addDocument: [],
    learn: [],
    studyList: [],
    studyEnqueue: [],
    studyRetry: [],
  };
  const server = createHttpServer({
    kb: {
      list: async (input) => { calls.list.push(input); return commandSuccess({ knowledgeBases: [] }); },
      create: async (input) => { calls.create.push(input); return commandSuccess({ knowledgeBase: { id: 'kb-1' } }); },
      update: async (input) => { calls.update.push(input); return commandSuccess({ knowledgeBase: { id: 'kb-1' } }); },
      remove: async (input) => { calls.remove.push(input); return commandSuccess({ removed: true, knowledgeBaseId: 'kb-1' }); },
      query: async (input) => { calls.query.push(input); return commandSuccess({ results: [] }); },
      addDocument: async (input) => { calls.addDocument.push(input); return commandSuccess({ indexed: true }); },
      learn: async (input) => { calls.learn.push(input); return commandSuccess({ knowledgeBase: {} }); },
      studyList: async (input) => { calls.studyList.push(input); return commandSuccess({ jobs: [] }); },
      studyEnqueue: async (input) => { calls.studyEnqueue.push(input); return commandSuccess({ job: { id: 'study-1' }, created: true }); },
      studyRetry: async (input) => { calls.studyRetry.push(input); return commandSuccess({ retried: [], count: 0 }); },
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

test('GET /api/kb/list and /api/kb/study/status forward query input', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const listResponse = await fetch(`${server.baseUrl}/api/kb/list?from=alice`);
  const listPayload = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.deepEqual(server.calls.list, [{ from: 'alice' }]);
  assert.equal(listPayload.ok, true);

  const studyResponse = await fetch(`${server.baseUrl}/api/kb/study/status?from=alice`);
  const studyPayload = await studyResponse.json();
  assert.equal(studyResponse.status, 200);
  assert.deepEqual(server.calls.studyList, [{ from: 'alice' }]);
  assert.equal(studyPayload.ok, true);
});

test('POST kb management verbs forward the JSON body to handlers', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/kb/create', 'create', { from: 'alice', name: 'Research', autoLearn: true }],
    ['/api/kb/update', 'update', { from: 'alice', id: 'kb-1', name: 'Research v2' }],
    ['/api/kb/remove', 'remove', { from: 'alice', id: 'kb-1' }],
    ['/api/kb/query', 'query', { from: 'alice', text: 'surf', topK: 5, minScore: 0.2 }],
    ['/api/kb/add-document', 'addDocument', { from: 'alice', title: 'Doc', content: 'body', sourceType: 'manual' }],
    ['/api/kb/learn', 'learn', { from: 'alice', id: 'kb-1', full: true }],
    ['/api/kb/study/enqueue', 'studyEnqueue', { from: 'alice', topic: 'metaweb protocols', budgetPins: 10 }],
    ['/api/kb/study/retry', 'studyRetry', { from: 'alice', jobId: 'study-1' }],
  ];

  for (const [path, key, body] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, true, path);
    assert.deepEqual(server.calls[key], [body], path);
  }
});

test('POST kb verbs validate required fields before the handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/kb/create', { from: 'alice' }, 'missing_name', 'name is required.'],
    ['/api/kb/update', { from: 'alice' }, 'missing_id', 'id is required.'],
    ['/api/kb/query', { from: 'alice' }, 'missing_text', 'text is required.'],
    ['/api/kb/add-document', { from: 'alice', title: 'Doc' }, 'missing_content', 'content is required.'],
    ['/api/kb/study/enqueue', { from: 'alice' }, 'missing_topic', 'topic is required.'],
  ];

  for (const [path, body, code, message] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.code, code, path);
    assert.equal(payload.message, message, path);
  }
  assert.equal(server.calls.create.length, 0);
  assert.equal(server.calls.studyEnqueue.length, 0);
});

test('POST /api/kb/query rejects a non-numeric topK', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/kb/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'alice', text: 'surf', topK: 'lots' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, commandFailed('invalid_flag', 'topK must be a number.'));
  assert.deepEqual(server.calls.query, []);
});

test('kb routes reject wrong methods and unknown verbs', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const wrongMethod = await fetch(`${server.baseUrl}/api/kb/create?from=alice`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  const unknown = await fetch(`${server.baseUrl}/api/kb/nope`);
  const unknownPayload = await unknown.json();
  assert.equal(unknown.status, 200);
  assert.equal(unknownPayload.code, 'unknown_command');
});

test('local daemon boundary rejects cross-site POSTs to /api/kb/create before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/kb/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ from: 'alice', name: 'x' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.create, []);
});
