import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const {
  commandSuccess,
  commandManualActionRequired,
  commandFailed,
} = require('../../dist/core/contracts/commandResult.js');

async function startServer(options = {}) {
  const useBuiltInUiPages = options.useBuiltInUiPages === true;
  const calls = {
    identity: [],
    chain: [],
    file: [],
    buzz: [],
    services: [],
    serviceExecutions: [],
    trace: [],
    network: [],
  };

  const server = createHttpServer({
    daemon: {
      getStatus: async () => commandSuccess({
        daemonId: 'daemon-local',
        state: 'online',
        lockOwner: 'metabot-daemon',
      }),
      doctor: async () => commandSuccess({
        checks: [
          { code: 'identity_loaded', ok: true },
          { code: 'runtime_lock_held', ok: true },
        ],
      }),
    },
    identity: {
      create: async (input) => {
        calls.identity.push(input);
        return commandSuccess({
          name: input.name,
          globalMetaId: 'gm-local-alice',
          subsidyState: 'claimed',
        });
      },
    },
    chain: {
      write: async (input) => {
        calls.chain.push(input);
        return commandSuccess({
          pinId: 'pin-chain-write-1',
          path: input.path,
          txids: ['tx-chain-write-1'],
        });
      },
    },
    file: {
      upload: async (input) => {
        calls.file.push(input);
        return commandSuccess({
          pinId: 'file-pin-1',
          metafileUri: 'metafile://file-pin-1.png',
        });
      },
    },
    buzz: {
      post: async (input) => {
        calls.buzz.push(input);
        return commandSuccess({
          pinId: 'buzz-pin-1',
          attachments: ['metafile://file-pin-1.png'],
        });
      },
    },
    network: {
      listServices: async (input) => {
        calls.network.push(input);
        return commandSuccess({
          services: [
            {
              servicePinId: 'service-weather',
              providerGlobalMetaId: 'gm-weather-seller',
              displayName: 'Weather Oracle',
              online: true,
            },
          ],
        });
      },
    },
    services: {
      call: async (input) => {
        calls.services.push(input);
        if (input.request?.servicePinId === 'service-refund') {
          return commandManualActionRequired(
            'manual_refund_required',
            'Seller refund requires manual confirmation.',
            '/ui/refund?orderId=order-1'
          );
        }
        if (input.request?.servicePinId === 'service-missing') {
          return commandFailed('service_offline', 'Remote service is offline.');
        }
        return commandSuccess({
          traceId: 'trace-weather-123',
          service: {
            servicePinId: 'service-weather',
            providerGlobalMetaId: 'gm-weather-seller',
            serviceName: 'Weather Oracle',
            price: '0.00001',
            currency: 'SPACE',
          },
          payment: {
            amount: '0.00001',
            currency: 'SPACE',
          },
          confirmation: {
            requiresConfirmation: true,
            policyMode: 'confirm_all',
            policyReason: 'confirm_all_requires_confirmation',
            requestedPolicyMode: 'confirm_all',
            confirmationBypassed: false,
            bypassReason: null,
          },
          session: {
            sessionId: 'session-weather-123',
            taskRunId: 'run-weather-123',
            role: 'caller',
            state: 'requesting_remote',
            publicStatus: 'requesting_remote',
            event: 'request_sent',
            coworkSessionId: null,
            externalConversationId: 'a2a-session:gm-weather-seller:trace-weather-1',
          },
        });
      },
      execute: async (input) => {
        calls.serviceExecutions.push(input);
        return commandSuccess({
          traceId: input.traceId,
          externalConversationId: input.externalConversationId,
          responseText: 'Tomorrow will be bright with a light wind.',
          providerGlobalMetaId: 'gm-weather-seller',
          servicePinId: input.servicePinId,
          traceJsonPath: '/tmp/provider-trace.json',
          traceMarkdownPath: '/tmp/provider-trace.md',
          transcriptMarkdownPath: '/tmp/provider-transcript.md',
        });
      },
    },
    trace: {
      getTrace: async (input) => {
        calls.trace.push(input);
        return commandSuccess({
          traceId: input.traceId,
          status: 'completed',
          transcriptPath: '/tmp/trace-weather-123.md',
        });
      },
      watchTrace: async (input) => [
        JSON.stringify({
          traceId: input.traceId,
          status: 'requesting_remote',
          terminal: false,
        }),
        JSON.stringify({
          traceId: input.traceId,
          status: 'completed',
          terminal: true,
        }),
        '',
      ].join('\n'),
    },
    ui: useBuiltInUiPages
      ? undefined
      : {
          renderPage: async (page) => {
            if (page !== 'hub') {
              throw new Error(`Unexpected page ${page}`);
            }
            return `<!doctype html><html><head><title>MetaBot Hub</title></head><body><h1>MetaBot Hub</h1></body></html>`;
          },
        },
  });

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
    calls,
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

test('GET /api/daemon/status returns the daemon status envelope', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/daemon/status`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      daemonId: 'daemon-local',
      state: 'online',
      lockOwner: 'metabot-daemon',
    },
  });
});

test('GET /api/doctor returns the machine-first health envelope', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/doctor`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'success');
  assert.deepEqual(payload.data.checks, [
    { code: 'identity_loaded', ok: true },
    { code: 'runtime_lock_held', ok: true },
  ]);
});

test('POST /api/identity/create parses the JSON body and forwards it to identity.create', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/identity/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Alice',
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.identity, [{ name: 'Alice' }]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      name: 'Alice',
      globalMetaId: 'gm-local-alice',
      subsidyState: 'claimed',
    },
  });
});

test('POST /api/chain/write parses the JSON body and forwards it to chain.write', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello metabot"}',
    contentType: 'application/json',
  };

  const response = await fetch(`${server.baseUrl}/api/chain/write`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.chain, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      pinId: 'pin-chain-write-1',
      path: '/protocols/simplebuzz',
      txids: ['tx-chain-write-1'],
    },
  });
});

test('POST /api/file/upload parses the JSON body and forwards it to file.upload', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    filePath: '/tmp/photo.png',
    contentType: 'image/png',
  };

  const response = await fetch(`${server.baseUrl}/api/file/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.file, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      pinId: 'file-pin-1',
      metafileUri: 'metafile://file-pin-1.png',
    },
  });
});

test('POST /api/buzz/post parses the JSON body and forwards it to buzz.post', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    content: 'hello metabot buzz',
    attachments: ['/tmp/photo.png'],
  };

  const response = await fetch(`${server.baseUrl}/api/buzz/post`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.buzz, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      pinId: 'buzz-pin-1',
      attachments: ['metafile://file-pin-1.png'],
    },
  });
});

test('GET /api/network/services forwards query filters to network.listServices', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/network/services?online=true`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.network, [{ online: true }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.services.length, 1);
  assert.equal(payload.data.services[0].servicePinId, 'service-weather');
});

test('POST /api/services/call returns a delegation, session, and trace start contract', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'gm-weather-seller',
      userTask: 'tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  };

  const response = await fetch(`${server.baseUrl}/api/services/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.services, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      traceId: 'trace-weather-123',
      service: {
        servicePinId: 'service-weather',
        providerGlobalMetaId: 'gm-weather-seller',
        serviceName: 'Weather Oracle',
        price: '0.00001',
        currency: 'SPACE',
      },
      payment: {
        amount: '0.00001',
        currency: 'SPACE',
      },
      confirmation: {
        requiresConfirmation: true,
        policyMode: 'confirm_all',
        policyReason: 'confirm_all_requires_confirmation',
        requestedPolicyMode: 'confirm_all',
        confirmationBypassed: false,
        bypassReason: null,
      },
      session: {
        sessionId: 'session-weather-123',
        taskRunId: 'run-weather-123',
        role: 'caller',
        state: 'requesting_remote',
        publicStatus: 'requesting_remote',
        event: 'request_sent',
        coworkSessionId: null,
        externalConversationId: 'a2a-session:gm-weather-seller:trace-weather-1',
      },
    },
  });
});

test('POST /api/services/execute forwards remote execution payloads to services.execute', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    traceId: 'trace-weather-123',
    externalConversationId: 'a2a-session:gm-weather-seller:trace-weather-1',
    servicePinId: 'service-weather',
    providerGlobalMetaId: 'gm-weather-seller',
    buyer: {
      host: 'codex',
      globalMetaId: 'gm-caller',
      name: 'Caller Bot',
    },
    request: {
      userTask: 'tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  };

  const response = await fetch(`${server.baseUrl}/api/services/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.serviceExecutions, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      traceId: 'trace-weather-123',
      externalConversationId: 'a2a-session:gm-weather-seller:trace-weather-1',
      responseText: 'Tomorrow will be bright with a light wind.',
      providerGlobalMetaId: 'gm-weather-seller',
      servicePinId: 'service-weather',
      traceJsonPath: '/tmp/provider-trace.json',
      traceMarkdownPath: '/tmp/provider-trace.md',
      transcriptMarkdownPath: '/tmp/provider-transcript.md',
    },
  });
});

test('POST /api/services/publish forwards the JSON payload to services.publish', async (t) => {
  const calls = [];
  const server = createHttpServer({
    services: {
      publish: async (input) => {
        calls.push(input);
        return commandSuccess({
          servicePinId: 'service-weather',
          displayName: 'Weather Oracle',
        });
      },
    },
  });

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

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const request = {
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Weather',
    providerSkill: 'metabot-weather-oracle',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
  };

  const response = await fetch(`http://127.0.0.1:${address.port}/api/services/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      servicePinId: 'service-weather',
      displayName: 'Weather Oracle',
    },
  });
});

test('GET /api/trace/:traceId forwards the route parameter to trace.getTrace', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/trace/trace-weather-123`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.trace, [{ traceId: 'trace-weather-123' }]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      traceId: 'trace-weather-123',
      status: 'completed',
      transcriptPath: '/tmp/trace-weather-123.md',
    },
  });
});

test('GET /api/trace/:traceId/watch returns newline-delimited public status events', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/trace/trace-weather-123/watch`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');

  const events = body.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events, [
    {
      traceId: 'trace-weather-123',
      status: 'requesting_remote',
      terminal: false,
    },
    {
      traceId: 'trace-weather-123',
      status: 'completed',
      terminal: true,
    },
  ]);
});

test('GET /api/trace/:traceId/events returns server-sent trace status events for the local inspector', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/trace/trace-weather-123/events`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(body, /event: trace-status/);
  assert.match(body, /"traceId":"trace-weather-123"/);
  assert.match(body, /"status":"requesting_remote"/);
  assert.match(body, /"status":"completed"/);
});

test('GET /ui/hub serves the local HTML hub page', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/hub`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /MetaBot Hub/);
});

test('GET /ui/trace serves a built-in trace inspector wired to the trace API, SSE, and first-class timeout/clarification/manual-action states', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/trace?traceId=trace-weather-123`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Trace Inspector/);
  assert.match(html, /new EventSource\(/);
  assert.match(html, /\/api\/trace\//);
  assert.match(html, /\/events/);
  assert.match(html, /Timeout/);
  assert.match(html, /Clarification/);
  assert.match(html, /Manual Action/);
});
