import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

/**
 * The management verbs added to /api/schedule/* alongside the existing host
 * lease protocol. The lease endpoints (heartbeat/due/list/show/runs/claim/
 * complete) keep working unchanged — covered here with one heartbeat guard.
 */

async function startServer() {
  const calls = {
    heartbeat: [],
    due: [],
    create: [],
    update: [],
    delete: [],
    enable: [],
    disable: [],
    run: [],
  };
  const server = createHttpServer({
    schedule: {
      heartbeat: async (input) => {
        calls.heartbeat.push(input);
        return commandSuccess({ slug: 'alice', host: 'dsh', expiresAtMs: 1 });
      },
      due: async (input) => {
        calls.due.push(input);
        return commandSuccess({ due: [] });
      },
      create: async (input) => {
        calls.create.push(input);
        return commandSuccess({ task: { id: 'task-1', name: input.name } });
      },
      update: async (input) => {
        calls.update.push(input);
        return commandSuccess({ task: { id: input.id }, warnings: [] });
      },
      delete: async (input) => {
        calls.delete.push(input);
        return commandSuccess({ deleted: true });
      },
      enable: async (input) => {
        calls.enable.push(input);
        return commandSuccess({ task: { id: input.id, enabled: true }, warnings: [] });
      },
      disable: async (input) => {
        calls.disable.push(input);
        return commandSuccess({ task: { id: input.id, enabled: false }, warnings: [] });
      },
      run: async (input) => {
        calls.run.push(input);
        return commandSuccess({ taskId: input.id, status: 'running', wait: false });
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

test('POST /api/schedule/{create,update,delete,enable,disable} forward JSON bodies to the handlers', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const checks = [
    ['/api/schedule/create', 'create', {
      from: 'alice',
      name: 'Nightly report',
      prompt: 'summarize today',
      schedule: { type: 'cron', expression: '0 9 * * *' },
      channel: 'auto',
    }],
    ['/api/schedule/update', 'update', { from: 'alice', id: 'task-1', payload: { name: 'Morning report' } }],
    ['/api/schedule/delete', 'delete', { from: 'alice', id: 'task-1' }],
    ['/api/schedule/enable', 'enable', { from: 'alice', id: 'task-1' }],
    ['/api/schedule/disable', 'disable', { from: 'alice', id: 'task-1' }],
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

test('schedule lease protocol endpoints keep working unchanged', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const heartbeat = await fetch(`${server.baseUrl}/api/schedule/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'alice', host: 'dsh' }),
  });
  const heartbeatPayload = await heartbeat.json();
  assert.equal(heartbeat.status, 200);
  assert.deepEqual(server.calls.heartbeat, [{ slug: 'alice', host: 'dsh' }]);
  assert.equal(heartbeatPayload.ok, true);

  const due = await fetch(`${server.baseUrl}/api/schedule/due?from=alice`);
  const duePayload = await due.json();
  assert.equal(due.status, 200);
  assert.deepEqual(server.calls.due, [{ from: 'alice' }]);
  assert.equal(duePayload.ok, true);
});

test('schedule management verbs reject wrong methods', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/schedule/create?from=alice`);
  const payload = await response.json();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(payload.code, 'method_not_allowed');
  assert.deepEqual(server.calls.create, []);
});

test('local daemon boundary rejects cross-site POSTs to /api/schedule/create before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/schedule/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ from: 'alice', name: 'x', prompt: 'y', schedule: { type: 'interval', intervalMs: 1000 } }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.create, []);
});

test('POST /api/schedule/run forwards the body and defaults to fire-and-return', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/schedule/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'alice', id: 'task-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(server.calls.run, [{ from: 'alice', id: 'task-1' }]);
  assert.deepEqual(payload.data, { taskId: 'task-1', status: 'running', wait: false });
});

test('local daemon boundary rejects cross-site POSTs to /api/schedule/run before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/schedule/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({ from: 'alice', id: 'task-1' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.run, []);
});
