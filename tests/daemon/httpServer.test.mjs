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
    master: [],
    masterTrace: [],
    services: [],
    serviceExecutions: [],
    trace: [],
    networkServices: [],
    networkBots: [],
    chatConversation: [],
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
        calls.networkServices.push(input);
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
      listBots: async (input) => {
        calls.networkBots.push(input);
        return commandSuccess({
          source: 'socket_presence',
          total: 1,
          onlineWindowSeconds: 1200,
          bots: [
            {
              globalMetaId: 'idq1onlinebot',
              lastSeenAt: 1776836184230,
              lastSeenAgoSeconds: 13,
              deviceCount: 1,
              online: true,
            },
          ],
        });
      },
    },
    master: {
      ask: async (input) => {
        calls.master.push(input);
        return commandSuccess({
          traceId: 'trace-master-123',
          session: {
            state: 'requesting_remote',
            publicStatus: 'requesting_remote',
            event: 'request_sent',
          },
        });
      },
      trace: async (input) => {
        calls.masterTrace.push(input);
        return commandSuccess({
          traceId: input.traceId,
          canonicalStatus: 'completed',
          response: {
            status: 'completed',
            summary: 'The Debug Master found the likely root cause.',
          },
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
    chat: {
      privateConversation: async (input) => {
        calls.chatConversation.push(input);
        return commandSuccess({
          selfGlobalMetaId: 'gm-local-alice',
          peerGlobalMetaId: input.peer,
          messages: [
            {
              id: 'pin-chat-1',
              pinId: 'pin-chat-1',
              protocol: '/protocols/simplemsg',
              type: '2',
              content: 'hello bob',
              timestamp: 1776836184,
              index: 8,
              fromGlobalMetaId: 'gm-local-alice',
              toGlobalMetaId: input.peer,
            },
          ],
          nextPollAfterIndex: 8,
          serverTime: 1776836184230,
        });
      },
    },
    ui: useBuiltInUiPages
      ? undefined
      : {
          renderPage: async (page) => {
            if (page !== 'hub') {
              throw new Error(`Unexpected page ${page}`);
            }
            return `<!doctype html><html><head><title>Agent Hub</title></head><body><h1>Agent Hub</h1></body></html>`;
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

test('GET /api/file/avatar resolves MetaID avatar pin references through the daemon', async (t) => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    if (String(url).includes('/content/avatar-pin-1i0')) {
      return new Response(Buffer.from([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    return new Response('<html>not an image</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const server = await startServer();
  t.after(async () => server.close());

  const response = await originalFetch(`${server.baseUrl}/api/file/avatar?ref=${encodeURIComponent('/content/avatar-pin-1i0')}`);
  const body = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/png/i);
  assert.deepEqual([...body], [137, 80, 78, 71]);
  assert.ok(
    fetchedUrls.some((url) => url === 'http://localhost:7281/content/avatar-pin-1i0'),
    `Expected local P2P content endpoint to be tried first, got ${fetchedUrls.join(', ')}`,
  );
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

  const response = await fetch(`${server.baseUrl}/api/network/services?online=true&cached=true&query=tarot`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.networkServices, [{ online: true, query: 'tarot', cached: true }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.services.length, 1);
  assert.equal(payload.data.services[0].servicePinId, 'service-weather');
});

test('GET /api/network/bots forwards query filters to network.listBots', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/network/bots?online=true&limit=10`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.networkBots, [{ online: true, limit: 10 }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.source, 'socket_presence');
  assert.equal(payload.data.total, 1);
  assert.equal(payload.data.bots[0].globalMetaId, 'idq1onlinebot');
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

test('POST /api/master/ask forwards the preview-or-confirm payload to master.ask', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    traceId: 'trace-master-123',
    confirm: true,
  };

  const response = await fetch(`${server.baseUrl}/api/master/ask`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.master, [request]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.traceId, 'trace-master-123');
  assert.equal(payload.data.session.publicStatus, 'requesting_remote');
});

test('GET /api/master/trace/:traceId is mounted on the main HTTP server', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/master/trace/trace-master-123`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.masterTrace, [{ traceId: 'trace-master-123' }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.canonicalStatus, 'completed');
  assert.equal(payload.data.response.summary, 'The Debug Master found the likely root cause.');
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

test('GET /api/chat/private/conversation returns the read-only viewer API shape', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/chat/private/conversation?peer=gm-remote-bob&afterIndex=7&limit=20`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.chatConversation, [
    {
      peer: 'gm-remote-bob',
      afterIndex: 7,
      limit: 20,
    },
  ]);
  assert.deepEqual(payload, {
    ok: true,
    selfGlobalMetaId: 'gm-local-alice',
    peerGlobalMetaId: 'gm-remote-bob',
    messages: [
      {
        id: 'pin-chat-1',
        pinId: 'pin-chat-1',
        protocol: '/protocols/simplemsg',
        type: '2',
        content: 'hello bob',
        timestamp: 1776836184,
        index: 8,
        fromGlobalMetaId: 'gm-local-alice',
        toGlobalMetaId: 'gm-remote-bob',
      },
    ],
    nextPollAfterIndex: 8,
    serverTime: 1776836184230,
  });
});

test('GET /api/chat/private/conversation rejects requests without a peer', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/chat/private/conversation`);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(server.calls.chatConversation, []);
  assert.deepEqual(payload, {
    ok: false,
    code: 'missing_peer',
    message: 'peer query parameter is required.',
  });
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

test('GET /ui/hub serves the built-in yellow-pages view with a real service directory section', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/hub`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Agent Hub/);
  assert.match(html, /Yellow Pages Directory/);
  assert.match(html, /data-service-directory/);
  assert.match(html, /data-service-list/);
  assert.match(html, /\/api\/network\/services\?online=true/);
});

test('GET /ui/trace serves a built-in trace inspector wired to the trace API, SSE, and first-class timeout/clarification/manual-action states', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/trace`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /A2A Trace/);
  assert.match(html, /\/api\/trace\/sessions/);
  assert.match(html, /data-session-list/);
  assert.match(html, /data-session-detail/);
  assert.match(html, /data-trace-total/);
  assert.match(html, /session-panel/);
  assert.match(html, /detail-panel/);
});

test('GET /ui/trace gives verbose cards more room and allows long participant values to wrap', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/trace`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /trace-workspace/);
  assert.match(html, /participant-avatar/);
  assert.match(html, /word-break:\s*break-word/);
  assert.match(html, /msg-bubble/);
});

test('GET /ui/chat-viewer serves the built-in private chat viewer shell', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/chat-viewer?peer=gm-remote-bob`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Private Chat Viewer/);
  assert.match(html, /id-chat-msg-list/);
  assert.match(html, /viewer-mode="standalone"/);
  assert.match(html, /\/api\/chat\/private\/conversation/);
  assert.match(html, /\/ui\/chat\/idframework\/components\/id-chat-msg-list\.js/);
  assert.match(html, /afterIndex/);
});

test('GET /ui/trace navigation omits Chat Viewer while legacy direct route remains available', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/trace`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, />Chat Viewer(?: \*)?</);
  assert.doesNotMatch(html, /href="\/ui\/chat-viewer"/);

  const legacyResponse = await fetch(`${server.baseUrl}/ui/chat-viewer?peer=gm-remote-bob`);
  assert.equal(legacyResponse.status, 200);
});

test('GET /ui/chat/idframework/components/id-chat-msg-list.js serves the standalone-capable IDFramework component', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/chat/idframework/components/id-chat-msg-list.js`);
  const javascript = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/i);
  assert.match(javascript, /customElements\.define\('id-chat-msg-list'/);
  assert.match(javascript, /viewer-mode/);
  assert.match(javascript, /standalone/);
  assert.doesNotMatch(javascript, /import\s+\{\s*getSimpleTalkStore\s*\}\s+from/);
  assert.match(javascript, /this\._isStandaloneViewer\(\)\)\s+return/);
  assert.match(javascript, /await import\('\.\.\/stores\/chat\/simple-talk\.js'\)/);
  assert.match(javascript, /snapshot\.viewerMode === 'standalone'\s*\?\s*null/);
});

test('GET /ui/publish is intentionally hidden from direct UI route exposure', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/publish`);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'not_found');
});

test('GET /ui/my-services is intentionally hidden from direct UI route exposure', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/my-services`);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'not_found');
});

test('GET /ui/refund renders the buyer-side initiated refund ledger', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/refund`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Refunds I Initiated/);
  assert.match(html, /data-refund-total-count/);
  assert.match(html, /data-refund-pending-count/);
  assert.match(html, /data-refund-list/);
  assert.match(html, /\/api\/provider\/refunds\/initiated/);
});

test('GET /ui/buzz serves the bundled Buzz MetaApp entry from the daemon server', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/buzz`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /IDFramework - Buzz Feed Demo/);
  assert.match(html, /<base href="\/ui\/buzz\/app\/">/);
  assert.match(html, /id-buzz-list/);
  assert.match(html, /app\.js/);
});

test('GET /ui/buzz/app/index.html serves the bundled Buzz entry html from the daemon server', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/buzz/app/index.html`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /IDFramework - Buzz Feed Demo/);
  assert.match(html, /<base href="\/ui\/buzz\/app\/">/);
});

test('GET /ui/buzz/app/app.css serves bundled Buzz static assets from the same daemon', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/buzz/app/app.css`);
  const css = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/i);
  assert.match(css, /\.connect-button-wrapper/);
});

test('GET /ui/chat serves the bundled Chat MetaApp entry from the daemon server', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/chat`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /IDFramework - Chat Demo/);
  assert.match(html, /<base href="\/ui\/chat\/app\/">/);
  assert.match(html, /id-chat-input-box/);
  assert.match(html, /chat\.js/);
});

test('GET /ui/chat/app/chat.html serves the bundled Chat entry html from the daemon server', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/chat/app/chat.html`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /IDFramework - Chat Demo/);
  assert.match(html, /<base href="\/ui\/chat\/app\/">/);
});

test('GET /ui/chat/app/chat.js serves bundled Chat static assets from the same daemon', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/chat/app/chat.js`);
  const javascript = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/i);
  assert.match(javascript, /GROUP_TEXT_PROTOCOL/);
});
