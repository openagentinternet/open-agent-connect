import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const { buildMasterTraceMetadata } = require('../../dist/core/master/masterTrace.js');

async function startServer(handlers) {
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

test('GET /api/master/trace/:id returns ask master semantics for provider-side traces', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trace-route-'));
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const traceId = 'trace-master-provider-1';

  await runtimeStateStore.writeState({
    identity: {
      metabotId: 3,
      name: 'Provider Bot',
      createdAt: 1_776_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'metaid-provider',
      globalMetaId: 'idq1provider',
    },
    services: [],
    traces: [
      buildSessionTrace({
        traceId,
        channel: 'a2a',
        exportRoot: runtimeStateStore.paths.exportsRoot,
        session: {
          id: `master-provider-${traceId}`,
          title: 'Official Debug Master Ask',
          type: 'a2a',
          metabotId: 3,
          peerGlobalMetaId: 'idq1caller',
          peerName: 'Caller Bot',
          externalConversationId: `master:idq1caller:idq1provider:${traceId}`,
        },
        a2a: {
          role: 'provider',
          publicStatus: 'completed',
          latestEvent: 'provider_completed',
          taskRunState: 'completed',
          callerGlobalMetaId: 'idq1caller',
          callerName: 'Caller Bot',
          providerGlobalMetaId: 'idq1provider',
          providerName: 'Provider Bot',
          servicePinId: 'master-pin-1',
        },
        askMaster: buildMasterTraceMetadata({
          role: 'provider',
          latestEvent: 'provider_completed',
          publicStatus: 'completed',
          requestId: 'master-req-provider-1',
          masterKind: 'debug',
          servicePinId: 'master-pin-1',
          providerGlobalMetaId: 'idq1provider',
          displayName: 'Official Debug Master',
          response: {
            status: 'completed',
            summary: 'The provider identified a missing source registration and suggested re-adding it.',
            followUpQuestion: 'Can you share the current output of `metabot network sources list`?',
          },
        }),
      }),
    ],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });
  const server = await startServer(handlers);

  t.after(async () => {
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  });

  const response = await fetch(`${server.baseUrl}/api/master/trace/${traceId}`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.flow, 'master');
  assert.equal(payload.data.role, 'provider');
  assert.equal(payload.data.canonicalStatus, 'completed');
  assert.equal(payload.data.latestEvent, 'provider_completed');
  assert.equal(
    payload.data.response.summary,
    'The provider identified a missing source registration and suggested re-adding it.'
  );
  assert.equal(payload.data.display.statusText, 'Completed');
});
