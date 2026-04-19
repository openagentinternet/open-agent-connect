import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRatingDetailStateStore } = require('../../dist/core/ratings/ratingDetailState.js');

function createIdentity() {
  return {
    metabotId: 1,
    name: 'Provider Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'pubkey',
    chatPublicKey: 'chat-pubkey',
    mvcAddress: 'mvc-provider-address',
    btcAddress: 'btc-provider-address',
    dogeAddress: 'doge-provider-address',
    metaId: 'metaid-provider',
    globalMetaId: 'idq1provider',
  };
}

test('provider summary projects recent master requests alongside existing provider presence data', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-provider-master-summary-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const ratingDetailStateStore = createRatingDetailStateStore(homeDir);

  await runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [],
    traces: [
      {
        traceId: 'trace-master-provider-1',
        channel: 'a2a',
        createdAt: 1_776_200_000_000,
        session: {
          id: 'master-trace-provider-1',
          title: 'Official Debug Master Ask',
          type: 'a2a',
          metabotId: 1,
          peerGlobalMetaId: 'idq1caller',
          peerName: 'Caller Bot',
          externalConversationId: 'master:idq1caller:idq1provider:trace-master-provider-1',
        },
        order: null,
        a2a: {
          sessionId: 'provider-session-1',
          taskRunId: 'provider-run-1',
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
        artifacts: {
          transcriptMarkdownPath: '/tmp/master-transcript.md',
          traceMarkdownPath: '/tmp/master-trace.md',
          traceJsonPath: '/tmp/master-trace.json',
        },
      },
    ],
  });
  await masterStateStore.write({
    masters: [
      {
        id: 'master-pin-1',
        sourceMasterPinId: 'master-pin-1',
        currentPinId: 'master-pin-1',
        creatorMetabotId: 1,
        providerGlobalMetaId: 'idq1provider',
        providerAddress: 'mvc-provider-address',
        serviceName: 'official-debug-master',
        displayName: 'Official Debug Master',
        description: 'Structured debugging help.',
        masterKind: 'debug',
        specialties: ['debugging'],
        hostModes: ['codex'],
        modelInfoJson: '{"provider":"metaweb","model":"official-debug-master-v1"}',
        style: 'direct_and_structured',
        pricingMode: 'free',
        price: '0',
        currency: 'MVC',
        responseMode: 'structured',
        contextPolicy: 'standard',
        official: 1,
        trustedTier: 'official',
        payloadJson: '{}',
        available: 1,
        revokedAt: null,
        updatedAt: 1_776_199_000_000,
      },
    ],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
  });
  await ratingDetailStateStore.write({
    items: [],
    latestPinId: null,
    backfillCursor: null,
    lastSyncedAt: Date.now(),
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:25200' }),
  });

  const result = await handlers.provider.getSummary();
  assert.equal(result.ok, true);
  assert.equal(result.data.recentMasterRequests.length, 1);
  assert.deepEqual(result.data.recentMasterRequests[0], {
    traceId: 'trace-master-provider-1',
    servicePinId: 'master-pin-1',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    masterKind: 'debug',
    callerGlobalMetaId: 'idq1caller',
    callerName: 'Caller Bot',
    publicStatus: 'completed',
    latestEvent: 'provider_completed',
    createdAt: 1_776_200_000_000,
  });
  assert.equal(result.data.totals.masterRequestCount, 1);
});
