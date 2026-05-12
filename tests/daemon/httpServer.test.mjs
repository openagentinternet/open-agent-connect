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
    identityProfiles: [],
    chain: [],
    file: [],
    buzz: [],
    master: [],
    masterTrace: [],
    services: [],
    publishSkills: [],
    serviceExecutions: [],
    trace: [],
    networkServices: [],
    networkBots: [],
    chatConversation: [],
    llmExecute: [],
    llmGetSession: [],
    llmCancelSession: [],
    llmListSessions: [],
    llmStreamSessionEvents: [],
    llmListRuntimes: [],
    llmDiscoverRuntimes: [],
    llmListBindings: [],
    llmUpsertBindings: [],
    llmRemoveBinding: [],
    llmGetPreferredRuntime: [],
    llmSetPreferredRuntime: [],
    botStats: [],
    botProfiles: [],
    botProfile: [],
    botCreateProfile: [],
    botUpdateProfile: [],
    botWallet: [],
    botBackup: [],
    botDeleteProfile: [],
    botListRuntimes: [],
    botDiscoverRuntimes: [],
    botListSessions: [],
    botConfigGet: [],
    botConfigSet: [],
    configGet: [],
    configSet: [],
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
      listProfiles: async () => {
        calls.identityProfiles.push({});
        return commandSuccess({
          profiles: [
            {
              name: 'Alice',
              slug: 'alice',
              homeDir: '/tmp/alice',
              globalMetaId: 'gm-local-alice',
            },
          ],
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
      listPublishSkills: async (input) => {
        calls.publishSkills.push(input);
        return commandSuccess({
          metaBotSlug: input?.slug || 'alice',
          runtime: {
            id: 'runtime-codex',
            provider: 'codex',
            displayName: 'Codex',
            health: 'healthy',
          },
          skills: [
            {
              skillName: 'metabot-weather-oracle',
              platformId: 'codex',
            },
          ],
        });
      },
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
    llm: {
      execute: async (input) => {
        calls.llmExecute.push(input);
        return commandSuccess({
          sessionId: 'llm-session-1',
          status: 'starting',
        });
      },
      getSession: async (input) => {
        calls.llmGetSession.push(input);
        return commandSuccess({
          sessionId: input.sessionId,
          status: 'completed',
          runtimeId: 'llm-runtime-1',
          provider: 'codex',
          prompt: 'Say hello',
          result: {
            status: 'completed',
            output: 'Hello',
            durationMs: 42,
          },
          createdAt: '2026-05-05T00:00:00.000Z',
          completedAt: '2026-05-05T00:00:01.000Z',
        });
      },
      cancelSession: async (input) => {
        calls.llmCancelSession.push(input);
        return commandSuccess({ status: 'cancelled' });
      },
      listSessions: async (input) => {
        calls.llmListSessions.push(input);
        return commandSuccess({
          sessions: [
            {
              sessionId: 'llm-session-1',
              status: 'completed',
              runtimeId: 'llm-runtime-1',
              provider: 'codex',
              prompt: 'Say hello',
              createdAt: '2026-05-05T00:00:00.000Z',
            },
          ],
        });
      },
      streamSessionEvents: async function* (input) {
        calls.llmStreamSessionEvents.push(input);
        yield { type: 'status', status: 'running', sessionId: input.sessionId };
        yield { type: 'text', content: 'Hello' };
        yield {
          type: 'result',
          result: {
            status: 'completed',
            output: 'Hello',
            durationMs: 42,
          },
        };
      },
      listRuntimes: async () => {
        calls.llmListRuntimes.push({});
        return commandSuccess({
          version: 1,
          runtimes: [
            {
              id: 'llm-runtime-1',
              provider: 'codex',
              displayName: 'Codex',
              binaryPath: '/bin/codex',
              authState: 'authenticated',
              health: 'healthy',
              capabilities: ['streaming'],
              lastSeenAt: '2026-05-05T00:00:00.000Z',
              createdAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
            {
              id: 'llm-runtime-2',
              provider: 'claude-code',
              displayName: 'Claude Code',
              binaryPath: '/bin/claude',
              authState: 'unknown',
              health: 'unavailable',
              capabilities: ['streaming'],
              lastSeenAt: '2026-05-04T00:00:00.000Z',
              createdAt: '2026-05-04T00:00:00.000Z',
              updatedAt: '2026-05-04T00:00:00.000Z',
            },
          ],
        });
      },
      discoverRuntimes: async () => {
        calls.llmDiscoverRuntimes.push({});
        return commandSuccess({
          discovered: 1,
          runtimes: [
            {
              id: 'llm-runtime-1',
              provider: 'codex',
              displayName: 'Codex',
              binaryPath: '/bin/codex',
              authState: 'authenticated',
              health: 'healthy',
              capabilities: ['streaming'],
              lastSeenAt: '2026-05-05T00:00:00.000Z',
              createdAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
          ],
          errors: [],
        });
      },
      listBindings: async (input) => {
        calls.llmListBindings.push(input);
        return commandSuccess({
          version: 1,
          bindings: [
            {
              id: 'binding-primary',
              metaBotSlug: input.slug,
              llmRuntimeId: 'llm-runtime-1',
              role: 'primary',
              priority: 0,
              enabled: true,
              createdAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
          ],
        });
      },
      upsertBindings: async (input) => {
        calls.llmUpsertBindings.push(input);
        return commandSuccess({
          version: 2,
          bindings: input.bindings,
        });
      },
      removeBinding: async (input) => {
        calls.llmRemoveBinding.push(input);
        return commandSuccess({
          removed: input.bindingId,
        });
      },
      getPreferredRuntime: async (input) => {
        calls.llmGetPreferredRuntime.push(input);
        return commandSuccess({
          runtimeId: 'llm-runtime-1',
        });
      },
      setPreferredRuntime: async (input) => {
        calls.llmSetPreferredRuntime.push(input);
        return commandSuccess({
          runtimeId: input.runtimeId,
        });
      },
    },
    bot: {
      getStats: async () => {
        calls.botStats.push({});
        return commandSuccess({
          botCount: 2,
          healthyRuntimes: 1,
          totalExecutions: 5,
          successRate: 80,
        });
      },
      listProfiles: async () => {
        calls.botProfiles.push({});
        return commandSuccess({
          profiles: [
            {
              name: 'Alice Bot',
              slug: 'alice-bot',
              aliases: ['alice-bot'],
              homeDir: '/tmp/alice',
              globalMetaId: 'gm-alice',
              mvcAddress: 'addr-alice',
              createdAt: 1776836000000,
              updatedAt: 1776836100000,
              role: 'Assistant',
              soul: 'Practical',
              goal: 'Ship useful work.',
              primaryProvider: 'codex',
              fallbackProvider: null,
            },
          ],
        });
      },
      getProfile: async (input) => {
        calls.botProfile.push(input);
        if (input.slug === 'missing') {
          return commandFailed('profile_not_found', 'Profile not found: missing');
        }
        return commandSuccess({
          profile: {
            name: 'Alice Bot',
            slug: input.slug,
            aliases: [input.slug],
            homeDir: '/tmp/alice',
            globalMetaId: 'gm-alice',
            mvcAddress: 'addr-alice',
            createdAt: 1776836000000,
            updatedAt: 1776836100000,
            role: 'Assistant',
            soul: 'Practical',
            goal: 'Ship useful work.',
            primaryProvider: 'codex',
            fallbackProvider: null,
          },
        });
      },
      createProfile: async (input) => {
        calls.botCreateProfile.push(input);
        return commandSuccess({
          profile: {
            name: input.name,
            slug: 'new-bot',
            aliases: ['new-bot'],
            homeDir: '/tmp/new-bot',
            globalMetaId: '',
            mvcAddress: '',
            createdAt: 1776836200000,
            updatedAt: 1776836200000,
            role: input.role ?? 'Assistant',
            soul: input.soul ?? '',
            goal: input.goal ?? '',
            primaryProvider: null,
            fallbackProvider: null,
          },
        });
      },
      updateProfile: async (input) => {
        calls.botUpdateProfile.push(input);
        return commandSuccess({
          profile: {
            name: input.name ?? 'Alice Bot',
            slug: input.slug,
            aliases: [input.slug],
            homeDir: '/tmp/alice',
            globalMetaId: 'gm-alice',
            mvcAddress: 'addr-alice',
            createdAt: 1776836000000,
            updatedAt: 1776836300000,
            role: input.role ?? 'Assistant',
            soul: input.soul ?? 'Practical',
            goal: input.goal ?? 'Ship useful work.',
            primaryProvider: input.primaryProvider ?? 'codex',
            fallbackProvider: input.fallbackProvider ?? null,
          },
          chainWrites: [
            {
              txids: ['tx-profile-update-1'],
              pinId: 'pin-profile-update-1',
              path: '/info/name',
            },
          ],
        });
      },
      getWallet: async (input) => {
        calls.botWallet.push(input);
        return commandSuccess({
          wallet: {
            slug: input.slug,
            name: 'Alice Bot',
            addresses: {
              btc: 'btc-address-alice',
              mvc: 'mvc-address-alice',
            },
          },
        });
      },
      getBackup: async (input) => {
        calls.botBackup.push(input);
        return commandSuccess({
          backup: {
            slug: input.slug,
            name: 'Alice Bot',
            words: ['abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about'],
          },
        });
      },
      deleteProfile: async (input) => {
        calls.botDeleteProfile.push(input);
        return commandSuccess({
          deleted: true,
          profile: {
            slug: input.slug,
            name: 'Alice Bot',
          },
        });
      },
      listRuntimes: async () => {
        calls.botListRuntimes.push({});
        return commandSuccess({
          version: 1,
          runtimes: [
            {
              id: 'llm-runtime-1',
              provider: 'codex',
              displayName: 'Codex',
              binaryPath: '/bin/codex',
              authState: 'authenticated',
              health: 'healthy',
              capabilities: ['streaming'],
              lastSeenAt: '2026-05-05T00:00:00.000Z',
              createdAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
          ],
        });
      },
      discoverRuntimes: async () => {
        calls.botDiscoverRuntimes.push({});
        return commandSuccess({
          discovered: 1,
          runtimes: [
            {
              id: 'llm-runtime-1',
              provider: 'codex',
              displayName: 'Codex',
              binaryPath: '/bin/codex',
              authState: 'authenticated',
              health: 'healthy',
              capabilities: ['streaming'],
              lastSeenAt: '2026-05-05T00:00:00.000Z',
              createdAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:00.000Z',
            },
          ],
          errors: [],
        });
      },
      listSessions: async (input) => {
        calls.botListSessions.push(input);
        return commandSuccess({
          sessions: [
            {
              sessionId: 'llm-session-1',
              status: 'completed',
              runtimeId: 'llm-runtime-1',
              provider: 'codex',
              metaBotSlug: input.slug,
              prompt: 'Say hello',
              createdAt: '2026-05-05T00:00:00.000Z',
            },
          ],
        });
      },
      getConfig: async (input) => {
        calls.botConfigGet.push(input);
        if (input.slug === 'missing') {
          return commandFailed('profile_not_found', 'Profile not found: missing');
        }
        return commandSuccess({
          chain: {
            defaultWriteNetwork: input.slug === 'eric-bot' ? 'doge' : 'mvc',
          },
        });
      },
      setConfig: async (input) => {
        calls.botConfigSet.push(input);
        if (input.slug === 'missing') {
          return commandFailed('profile_not_found', 'Profile not found: missing');
        }
        if (input.chain?.defaultWriteNetwork === 'eth') {
          return commandFailed('invalid_argument', 'defaultWriteNetwork must be one of mvc, btc, doge, opcat.');
        }
        return commandSuccess({
          chain: {
            defaultWriteNetwork: input.chain?.defaultWriteNetwork ?? 'mvc',
          },
        });
      },
    },
    config: {
      get: async () => {
        calls.configGet.push({});
        return commandSuccess({
          chain: {
            defaultWriteNetwork: 'mvc',
          },
        });
      },
      set: async (input) => {
        calls.configSet.push(input);
        if (input.chain?.defaultWriteNetwork === 'eth') {
          return commandFailed('invalid_argument', 'defaultWriteNetwork must be one of mvc, btc, doge, opcat.');
        }
        return commandSuccess({
          chain: {
            defaultWriteNetwork: input.chain?.defaultWriteNetwork ?? 'mvc',
          },
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

test('GET /api/identity/profiles remains available for compatibility', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/identity/profiles`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.identityProfiles, [{}]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.profiles[0].slug, 'alice');
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

test('POST /api/llm/execute forwards the request and returns an accepted session id', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    runtimeId: 'llm-runtime-1',
    prompt: 'Say hello',
    systemPrompt: 'Be concise.',
    skills: ['metabot-post-buzz'],
    metaBotSlug: 'alice',
  };

  const response = await fetch(`${server.baseUrl}/api/llm/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(server.calls.llmExecute, [request]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: {
      sessionId: 'llm-session-1',
      status: 'starting',
    },
  });
});

test('GET /api/llm/sessions/:id returns the session JSON envelope', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions/llm-session-1`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmGetSession, [{ sessionId: 'llm-session-1' }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sessionId, 'llm-session-1');
  assert.equal(payload.data.result.output, 'Hello');
});

test('GET /api/llm/sessions/:id rejects unsafe encoded session ids', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions/%2e%2e%2fsecret`);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'invalid_llm_session_id');
  assert.deepEqual(server.calls.llmGetSession, []);
});

test('GET /api/llm/sessions/:id streams session events when SSE is accepted', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions/llm-session-1`, {
    headers: {
      accept: 'text/event-stream',
    },
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.deepEqual(server.calls.llmGetSession, [{ sessionId: 'llm-session-1' }]);
  assert.deepEqual(server.calls.llmStreamSessionEvents, [{ sessionId: 'llm-session-1' }]);
  assert.match(body, /data: {"type":"status","status":"running","sessionId":"llm-session-1"}/);
  assert.match(body, /data: {"type":"text","content":"Hello"}/);
  assert.match(body, /data: {"type":"result","result":{"status":"completed","output":"Hello","durationMs":42}}/);
});

test('POST /api/llm/sessions/:id/cancel forwards cancellation', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions/llm-session-1/cancel`, {
    method: 'POST',
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmCancelSession, [{ sessionId: 'llm-session-1' }]);
  assert.deepEqual(payload, {
    ok: true,
    state: 'success',
    data: { status: 'cancelled' },
  });
});

test('POST /api/llm/sessions/:id/cancel rejects unsafe encoded session ids', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions/%2e%2e%2fsecret/cancel`, {
    method: 'POST',
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'invalid_llm_session_id');
  assert.deepEqual(server.calls.llmCancelSession, []);
});

test('GET /api/llm/sessions forwards a clamped limit to the handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/sessions?limit=500`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmListSessions, [{ limit: 100 }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sessions[0].sessionId, 'llm-session-1');
});

test('GET /api/llm/runtimes returns runtime health rows for the bot page', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/runtimes`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmListRuntimes, [{}]);
  assert.equal(payload.ok, true);
  assert.deepEqual(
    payload.data.runtimes.map((runtime) => `${runtime.id}:${runtime.health}`),
    ['llm-runtime-1:healthy', 'llm-runtime-2:unavailable'],
  );
});

test('POST /api/llm/runtimes/discover forwards runtime rediscovery for the bot page', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/runtimes/discover`, {
    method: 'POST',
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmDiscoverRuntimes, [{}]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.discovered, 1);
  assert.equal(payload.data.runtimes[0].id, 'llm-runtime-1');
});

test('GET and PUT /api/llm/bindings/:slug remain available for compatibility', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const listResponse = await fetch(`${server.baseUrl}/api/llm/bindings/alice-bot`);
  const listPayload = await listResponse.json();
  const bindings = [
    {
      id: 'binding-primary',
      metaBotSlug: 'ignored-by-route',
      llmRuntimeId: 'llm-runtime-1',
      role: 'primary',
      priority: 0,
      enabled: true,
    },
  ];
  const putResponse = await fetch(`${server.baseUrl}/api/llm/bindings/alice-bot`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bindings }),
  });
  const putPayload = await putResponse.json();

  assert.equal(listResponse.status, 200);
  assert.deepEqual(server.calls.llmListBindings, [{ slug: 'alice-bot' }]);
  assert.equal(listPayload.data.bindings[0].metaBotSlug, 'alice-bot');
  assert.equal(putResponse.status, 200);
  assert.deepEqual(server.calls.llmUpsertBindings, [{ slug: 'alice-bot', bindings }]);
  assert.equal(putPayload.data.version, 2);
});

test('DELETE /api/llm/bindings/:id/delete remains available for compatibility', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/llm/bindings/binding-primary/delete`, {
    method: 'DELETE',
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.llmRemoveBinding, [{ bindingId: 'binding-primary' }]);
  assert.equal(payload.data.removed, 'binding-primary');
});

test('GET and PUT /api/llm/preferred-runtime/:slug remain available for compatibility', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const getResponse = await fetch(`${server.baseUrl}/api/llm/preferred-runtime/alice-bot`);
  const getPayload = await getResponse.json();
  const putResponse = await fetch(`${server.baseUrl}/api/llm/preferred-runtime/alice-bot`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runtimeId: 'llm-runtime-2' }),
  });
  const putPayload = await putResponse.json();

  assert.equal(getResponse.status, 200);
  assert.deepEqual(server.calls.llmGetPreferredRuntime, [{ slug: 'alice-bot' }]);
  assert.equal(getPayload.data.runtimeId, 'llm-runtime-1');
  assert.equal(putResponse.status, 200);
  assert.deepEqual(server.calls.llmSetPreferredRuntime, [{ slug: 'alice-bot', runtimeId: 'llm-runtime-2' }]);
  assert.equal(putPayload.data.runtimeId, 'llm-runtime-2');
});

test('GET /api/bot/stats forwards to the MetaBot stats handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/stats`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botStats, [{}]);
  assert.deepEqual(payload.data, {
    botCount: 2,
    healthyRuntimes: 1,
    totalExecutions: 5,
    successRate: 80,
  });
});

test('GET /api/bot/profiles forwards to the MetaBot profile list handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botProfiles, [{}]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.profiles[0].slug, 'alice-bot');
});

test('GET /api/bot/profiles/:slug returns one MetaBot profile or a 404', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot`);
  const payload = await response.json();
  const missingResponse = await fetch(`${server.baseUrl}/api/bot/profiles/missing`);
  const missingPayload = await missingResponse.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.profile.slug, 'alice-bot');
  assert.equal(missingResponse.status, 404);
  assert.equal(missingPayload.code, 'profile_not_found');
  assert.deepEqual(server.calls.botProfile, [{ slug: 'alice-bot' }, { slug: 'missing' }]);
});

test('POST /api/bot/profiles validates and forwards MetaBot creation', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const missingResponse = await fetch(`${server.baseUrl}/api/bot/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ' }),
  });
  const missingPayload = await missingResponse.json();

  const request = {
    name: 'New Bot',
    role: 'Assistant',
    soul: 'Focused',
    goal: 'Help the operator.',
  };
  const response = await fetch(`${server.baseUrl}/api/bot/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(missingResponse.status, 400);
  assert.equal(missingPayload.code, 'missing_name');
  assert.equal(response.status, 201);
  assert.deepEqual(server.calls.botCreateProfile, [request]);
  assert.equal(payload.data.profile.slug, 'new-bot');
});

test('PUT /api/bot/profiles/:slug forwards MetaBot profile updates', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const request = {
    name: 'Alice Updated',
    role: 'Writes careful code.',
    fallbackProvider: null,
  };
  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botUpdateProfile, [{ slug: 'alice-bot', ...request }]);
  assert.equal(payload.data.profile.name, 'Alice Updated');
});

test('PUT /api/bot/profiles/:slug does not let the JSON body override the path slug', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'bob-bot',
      name: 'Alice Updated',
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botUpdateProfile, [{ slug: 'alice-bot', name: 'Alice Updated' }]);
  assert.equal(payload.data.profile.slug, 'alice-bot');
});

test('GET /api/bot/profiles/:slug/wallet forwards to the MetaBot wallet handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot/wallet`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botWallet, [{ slug: 'alice-bot' }]);
  assert.equal(payload.data.wallet.addresses.btc, 'btc-address-alice');
  assert.equal(payload.data.wallet.addresses.mvc, 'mvc-address-alice');
});

test('GET /api/bot/profiles/:slug/backup forwards to the MetaBot backup handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot/backup`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botBackup, [{ slug: 'alice-bot' }]);
  assert.equal(payload.data.backup.words.length, 12);
});

test('DELETE /api/bot/profiles/:slug forwards to the MetaBot delete handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/alice-bot`, {
    method: 'DELETE',
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botDeleteProfile, [{ slug: 'alice-bot' }]);
  assert.equal(payload.data.deleted, true);
});

test('GET and POST /api/bot/runtimes use the MetaBot runtime handlers', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const listResponse = await fetch(`${server.baseUrl}/api/bot/runtimes`);
  const listPayload = await listResponse.json();
  const discoverResponse = await fetch(`${server.baseUrl}/api/bot/runtimes/discover`, {
    method: 'POST',
  });
  const discoverPayload = await discoverResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(discoverResponse.status, 200);
  assert.deepEqual(server.calls.botListRuntimes, [{}]);
  assert.deepEqual(server.calls.botDiscoverRuntimes, [{}]);
  assert.equal(listPayload.data.runtimes[0].provider, 'codex');
  assert.equal(discoverPayload.data.discovered, 1);
});

test('GET /api/bot/sessions forwards slug and clamped limit to the MetaBot sessions handler', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/sessions?slug=alice-bot&limit=500`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botListSessions, [{ slug: 'alice-bot', limit: 100 }]);
  assert.equal(payload.data.sessions[0].metaBotSlug, 'alice-bot');
});

test('GET /api/bot/profiles/:slug/config reads config for the selected MetaBot', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/eric-bot/config`);
  const payload = await response.json();
  const missingResponse = await fetch(`${server.baseUrl}/api/bot/profiles/missing/config`);
  const missingPayload = await missingResponse.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botConfigGet, [{ slug: 'eric-bot' }, { slug: 'missing' }]);
  assert.deepEqual(payload.data.chain, {
    defaultWriteNetwork: 'doge',
  });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingPayload.code, 'profile_not_found');
});

test('PUT /api/bot/profiles/:slug/config persists config for the selected MetaBot', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/bot/profiles/eric-bot/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: 'alice-bot',
      chain: {
        defaultWriteNetwork: 'opcat',
      },
    }),
  });
  const payload = await response.json();
  const invalidResponse = await fetch(`${server.baseUrl}/api/bot/profiles/eric-bot/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chain: {
        defaultWriteNetwork: 'eth',
      },
    }),
  });
  const invalidPayload = await invalidResponse.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.botConfigSet[0], {
    slug: 'eric-bot',
    chain: {
      defaultWriteNetwork: 'opcat',
    },
  });
  assert.deepEqual(payload.data.chain, {
    defaultWriteNetwork: 'opcat',
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.code, 'invalid_argument');
});

test('GET /api/config returns normalized local runtime config', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/config`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.configGet, [{}]);
  assert.deepEqual(payload.data.chain, {
    defaultWriteNetwork: 'mvc',
  });
});

test('PUT /api/config persists the default write network and rejects invalid values', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chain: {
        defaultWriteNetwork: 'opcat',
      },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.configSet, [{
    chain: {
      defaultWriteNetwork: 'opcat',
    },
  }]);
  assert.deepEqual(payload.data.chain, {
    defaultWriteNetwork: 'opcat',
  });

  const invalidResponse = await fetch(`${server.baseUrl}/api/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chain: {
        defaultWriteNetwork: 'eth',
      },
    }),
  });
  const invalidPayload = await invalidResponse.json();

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.ok, false);
  assert.equal(invalidPayload.code, 'invalid_argument');
});

test('GET /ui/bot renders the MetaBot-centered management workspace', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/bot`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-stat-bots/);
  assert.match(html, /data-stat-runtimes/);
  assert.match(html, /data-stat-executions/);
  assert.match(html, /data-stat-success/);
  assert.match(html, /data-metabot-list/);
  assert.match(html, /data-act="add-metabot"/);
  assert.ok(html.indexOf('data-act="open-wallet"') < html.indexOf('data-act="discover-runtimes"'));
  assert.ok(html.indexOf('data-act="open-delete"') < html.indexOf('data-act="discover-runtimes"'));
  assert.ok(html.indexOf('data-act="open-backup"') < html.indexOf('data-act="discover-runtimes"'));
  assert.match(html, /data-tab="info"/);
  assert.match(html, /data-tab="history"/);
  assert.match(html, /data-tab="settings"/);
  assert.match(html, /data-default-write-network/);
  assert.match(html, /data-info-content/);
  assert.match(html, /data-execution-history-list/);
  assert.match(html, /<th>Time<\/th>/);
  assert.match(html, /<th>Provider<\/th>/);
  assert.match(html, /<th>Runtime<\/th>/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /<th>Details<\/th>/);
  assert.match(html, /exec-detail/);
  assert.match(html, /copy-toast/);
  assert.ok(html.includes("api('/api/bot/stats'"));
  assert.ok(html.includes("api('/api/bot/profiles'"));
  assert.ok(html.includes("api('/api/bot/runtimes'"));
  assert.ok(html.includes("api('/api/bot/sessions?slug='+encodeURIComponent"));
  assert.ok(!html.includes("api('/api/bot/sessions?limit=50'"));
  assert.ok(html.includes("api('/api/bot/profiles/'+encodeURIComponent"));
  assert.ok(html.includes("'/config'"));
  assert.ok(!html.includes("api('/api/config'"));
  assert.match(html, /r\.health==='healthy'\|\|r\.health==='degraded'/);
  assert.ok(!html.includes(" / unavailable"));
  assert.match(html, /max-height:\s*220px/);
  assert.match(html, /MetaBot Created On-Chain/);
  assert.match(html, /Profile Updated On-Chain/);
  assert.doesNotMatch(html, /✓ Saved/);
  assert.match(html, /data-modal-root/);
  assert.doesNotMatch(html, /profile-select/);
  assert.doesNotMatch(html, /data-new-role/);
  assert.doesNotMatch(html, /reviewer/i);
  assert.doesNotMatch(html, /specialist/i);
  assert.doesNotMatch(html, /preferred runtime/i);
  assert.doesNotMatch(html, /data-binding-list/);
});

test('GET /ui/shared.css keeps active status animated and the topbar narrow-safe', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/shared.css`);
  const css = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/i);
  assert.match(css, /\.status-active \.status-dot\s*\{[^}]*animation: pulse/s);
  assert.match(css, /\.topbar-nav\s*\{[^}]*min-width: 0[^}]*overflow-x: auto/s);
  assert.match(css, /\.topbar-title\s*\{\s*display: none;\s*\}/);
});

test('GET /ui/assets/platforms/codex.svg serves a platform logo asset', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/assets/platforms/codex.svg`);
  const svg = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/i);
  assert.match(svg, /<svg\b/i);
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

test('GET /api/services/publish/skills forwards to services.listPublishSkills', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/services/publish/skills?slug=alice-weather-bot`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(server.calls.publishSkills, [{ slug: 'alice-weather-bot' }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.metaBotSlug, 'alice-weather-bot');
  assert.equal(payload.data.runtime.provider, 'codex');
  assert.deepEqual(
    payload.data.skills.map((skill) => skill.skillName),
    ['metabot-weather-oracle'],
  );
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

test('GET /ui/publish serves the primary-runtime-aware publish console', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/publish`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Publish Service/);
  assert.match(html, /data-metabot-select/);
  assert.match(html, /data-provider-skill-select/);
  assert.match(html, /\/api\/services\/publish\/skills/);
  assert.match(html, /name="inputType"/);
  assert.match(html, /value="BTC-OPCAT"/);
  assert.match(html, /value="DOGE"/);
  assert.match(html, /value="image"/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /Skill Document/);
  assert.doesNotMatch(html, /Service Icon URI/);
  assert.doesNotMatch(html, /name="runtimeId"/);
  assert.doesNotMatch(html, /name="llmRuntimeId"/);
  assert.doesNotMatch(html, /runtime picker/i);
  assert.match(html, /href="\/ui\/publish"/);
});

test('GET /ui/my-services renders provider operations console', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/my-services`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /My Services/);
  assert.match(html, /data-recent-orders/);
  assert.match(html, /data-manual-actions/);
  assert.match(html, /Payment/);
  assert.match(html, /Runtime/);
  assert.match(html, /Refund/);
  assert.match(html, /\/api\/provider\/summary/);
});

test('GET /ui/refund renders buyer and seller refund operations', async (t) => {
  const server = await startServer({ useBuiltInUiPages: true });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/refund`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /Refund Operations/);
  assert.match(html, /Buyer initiated/);
  assert.match(html, /Seller received/);
  assert.match(html, /data-refund-total-count/);
  assert.match(html, /data-refund-pending-count/);
  assert.match(html, /data-refund-buyer-list/);
  assert.match(html, /data-refund-seller-list/);
  assert.match(html, /\/api\/provider\/refunds/);
  assert.match(html, /\/api\/provider\/refund\/settle/);
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
