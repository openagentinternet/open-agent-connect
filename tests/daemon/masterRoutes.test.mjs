import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');

async function startServer(handlers = {}) {
  const server = createHttpServer(handlers);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

test('GET /api/master/list returns not_implemented before master handlers exist', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/list`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: 'Master list handler is not configured.',
  });
});

test('GET /api/master/trace/trace-master-1 returns not_implemented before master handlers exist', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/trace/trace-master-1`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: 'Master trace handler is not configured.',
  });
});

test('GET /api/master/list forwards query filters to master.list', async (t) => {
  const calls = [];
  const server = await startServer({
    master: {
      list: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            masters: [
              {
                masterPinId: 'master-pin-1',
                masterKind: input.masterKind,
                online: input.online,
              },
            ],
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/list?online=true&kind=debug`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      online: true,
      masterKind: 'debug',
    },
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.masters[0].masterKind, 'debug');
});

test('POST /api/master/publish forwards the JSON payload to master.publish', async (t) => {
  const calls = [];
  const server = await startServer({
    master: {
      publish: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            masterPinId: 'master-pin-1',
            displayName: input.displayName,
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      serviceName: 'official-debug-master',
      displayName: 'Official Debug Master',
      masterKind: 'debug',
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].displayName, 'Official Debug Master');
  assert.equal(payload.ok, true);
  assert.equal(payload.data.masterPinId, 'master-pin-1');
});

test('POST /api/master/receive forwards the JSON payload to master.receive', async (t) => {
  const calls = [];
  const server = await startServer({
    master: {
      receive: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            traceId: input.traceId,
            accepted: true,
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/receive`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'master_request',
      traceId: 'trace-master-receive-1',
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      type: 'master_request',
      traceId: 'trace-master-receive-1',
    },
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.accepted, true);
});

test('POST /api/master/host-action forwards the JSON payload to master.hostAction', async (t) => {
  const calls = [];
  const server = await startServer({
    master: {
      hostAction: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'awaiting_confirmation',
          data: {
            hostAction: input.action?.kind ?? null,
            traceId: 'trace-master-host-action-1',
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/host-action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: {
        kind: 'manual_ask',
        utterance: 'Go ask Debug Master about this bug.',
      },
      context: {
        hostMode: 'codex',
      },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      action: {
        kind: 'manual_ask',
        utterance: 'Go ask Debug Master about this bug.',
      },
      context: {
        hostMode: 'codex',
      },
    },
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.hostAction, 'manual_ask');
});

test('GET /api/master/trace/:id forwards the trace id to master.trace', async (t) => {
  const calls = [];
  const server = await startServer({
    master: {
      trace: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            traceId: input.traceId,
            flow: 'master',
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/trace/trace-master-route-1`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      traceId: 'trace-master-route-1',
    },
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.flow, 'master');
});
