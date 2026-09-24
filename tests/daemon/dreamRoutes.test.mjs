import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess, commandFailed } = require('../../dist/core/contracts/commandResult.js');

async function startServer() {
  const calls = {
    status: [],
    due: [],
    summaries: [],
    selfIdentity: [],
    capabilities: [],
    run: [],
  };
  const server = createHttpServer({
    dream: {
      status: async (input) => {
        calls.status.push(input);
        return commandSuccess({ runs: [], summaryCount: 0 });
      },
      due: async (input) => {
        calls.due.push(input);
        return commandSuccess({ due: ['2026-09-23'] });
      },
      summaries: async (input) => {
        calls.summaries.push(input);
        return commandSuccess({ summaries: [{ summaryDate: '2026-09-23' }] });
      },
      selfIdentity: async (input) => {
        calls.selfIdentity.push(input);
        return commandSuccess({ text: 'I am a test bot.', updatedAt: null });
      },
      capabilities: async (input) => {
        calls.capabilities.push(input);
        return commandSuccess({ drafts: [] });
      },
      run: async (input) => {
        calls.run.push(input);
        return commandSuccess({ date: '2026-09-23', kind: 'completed' });
      },
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

test('GET /api/dream/{status,due,summaries,self-identity,capabilities} dispatch query input to handlers', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/dream/status?from=alice', 'status', { from: 'alice' }],
    ['/api/dream/due?from=alice', 'due', { from: 'alice' }],
    ['/api/dream/summaries?from=alice&limit=7&before=2026-09-20', 'summaries', { from: 'alice', limit: '7', before: '2026-09-20' }],
    ['/api/dream/self-identity?from=alice', 'selfIdentity', { from: 'alice' }],
    ['/api/dream/capabilities?from=alice&limit=3', 'capabilities', { from: 'alice', limit: '3' }],
  ];

  for (const [path, key, expectedInput] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`);
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, true, path);
    assert.deepEqual(server.calls[key], [expectedInput], path);
  }
});

test('POST /api/dream/run forwards the JSON body and returns the run envelope', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const body = { from: 'alice', date: '2026-09-23', wait: true, llm: 'codex/gpt-5', isRepair: false };
  const response = await fetch(`${server.baseUrl}/api/dream/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.run, [body]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: { date: '2026-09-23', kind: 'completed' },
  });
});

test('POST /api/dream/run rejects a malformed date before calling the handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/dream/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'alice', date: '09/23/2026' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, commandFailed('invalid_flag', 'date must be YYYY-MM-DD.'));
  assert.deepEqual(server.calls.run, []);
});

test('dream routes reject the wrong method and unknown verbs', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const getRun = await fetch(`${server.baseUrl}/api/dream/run`);
  assert.equal(getRun.status, 405);
  assert.equal(getRun.headers.get('allow'), 'POST');
  assert.deepEqual(server.calls.run, []);

  const unknown = await fetch(`${server.baseUrl}/api/dream/nope`);
  const unknownPayload = await unknown.json();
  assert.equal(unknown.status, 200);
  assert.equal(unknownPayload.code, 'unknown_command');
});

test('dream routes return not_implemented when the handler group is missing', async (t) => {
  const server = createHttpServer({});
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/dream/status`);
  const payload = await response.json();

  assert.equal(response.status, 501);
  assert.equal(payload.code, 'not_implemented');
});

test('local daemon boundary rejects cross-site POSTs to /api/dream/run before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/dream/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ from: 'alice' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.run, []);
});
