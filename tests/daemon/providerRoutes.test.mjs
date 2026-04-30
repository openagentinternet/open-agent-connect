import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');

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

function createService() {
  return {
    id: '/protocols/skill-service-pin-1',
    sourceServicePinId: '/protocols/skill-service-pin-1',
    currentPinId: '/protocols/skill-service-pin-1',
    creatorMetabotId: 1,
    providerGlobalMetaId: 'idq1provider',
    providerSkill: 'tarot-rws',
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads one tarot card.',
    serviceIcon: null,
    price: '0.00001',
    currency: 'SPACE',
    skillDocument: '# Tarot Reading',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: 'mvc-provider-address',
    payloadJson: '{"serviceName":"tarot-rws-service"}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_010_000,
  };
}

function createRefundPendingTrace() {
  return {
    traceId: 'trace-provider-refund',
    channel: 'a2a',
    createdAt: 1_775_000_020_000,
    session: {
      id: 'session-trace-provider-refund',
      title: 'Tarot Reading Execution',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1buyer',
      peerName: 'Buyer Bot',
      externalConversationId: 'a2a-session:idq1buyer:trace-provider-refund',
    },
    order: {
      id: 'order-refund-1',
      role: 'seller',
      status: 'refund_pending',
      serviceId: '/protocols/skill-service-pin-1',
      serviceName: 'Tarot Reading',
      paymentTxid: 'a'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00001',
      refundRequestPinId: 'refund-pin-1',
      coworkSessionId: 'seller-session-1',
    },
    a2a: {
      publicStatus: 'manual_action_required',
      taskRunState: 'manual_action_required',
    },
    artifacts: {
      transcriptMarkdownPath: '/tmp/transcript.md',
      traceMarkdownPath: '/tmp/trace.md',
      traceJsonPath: '/tmp/trace.json',
    },
  };
}

function createBuyerRefundTrace() {
  return {
    traceId: 'trace-buyer-refund',
    channel: 'a2a',
    createdAt: 1_775_000_040_000,
    session: {
      id: 'session-trace-buyer-refund',
      title: 'Buyer Refund Flow',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1seller',
      peerName: 'Seller Bot',
      externalConversationId: 'a2a-session:idq1seller:trace-buyer-refund',
    },
    order: {
      id: 'order-buyer-refund-1',
      role: 'buyer',
      status: 'refund_pending',
      serviceId: '/protocols/skill-service-pin-1',
      serviceName: 'Tarot Reading',
      paymentTxid: 'b'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00001',
      failureReason: 'delivery_timeout',
      refundRequestPinId: 'buyer-refund-pin-1',
      refundRequestedAt: 1_775_000_045_000,
      coworkSessionId: 'buyer-session-1',
    },
    a2a: {
      publicStatus: 'manual_action_required',
      taskRunState: 'manual_action_required',
    },
    artifacts: {
      transcriptMarkdownPath: '/tmp/transcript-buyer.md',
      traceMarkdownPath: '/tmp/trace-buyer.md',
      traceJsonPath: '/tmp/trace-buyer.json',
    },
  };
}

async function fetchJson(baseUrl, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

async function startProviderServer() {
  const homeDir = await createProfileHome('metabot-provider-routes-');
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const presenceChanges = [];

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    onProviderPresenceChanged: async (enabled) => {
      presenceChanges.push(enabled);
    },
  });
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
    throw new Error('Expected TCP provider route server');
  }

  return {
    homeDir,
    runtimeStateStore,
    providerPresenceStore,
    presenceChanges,
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
      await cleanupProfileHome(homeDir);
    },
  };
}

test('GET /api/provider/summary returns provider presence, services, recent orders, and manual refund queue', async (t) => {
  const app = await startProviderServer();
  t.after(async () => app.close());

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [createService()],
    traces: [createRefundPendingTrace()],
  });
  await app.providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: 1_775_000_030_000,
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: '/protocols/metabot-heartbeat-tx-1',
  });

  const response = await fetchJson(app.baseUrl, '/api/provider/summary');

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data.identity.globalMetaId, 'idq1provider');
  assert.equal(response.payload.data.presence.enabled, true);
  assert.equal(response.payload.data.services.length, 1);
  assert.equal(response.payload.data.recentOrders.length, 1);
  assert.equal(response.payload.data.manualActions.length, 1);
  assert.equal(response.payload.data.manualActions[0].kind, 'refund');
  assert.equal(response.payload.data.manualActions[0].orderId, 'order-refund-1');
});

test('POST /api/provider/presence persists enabled state and notifies the runtime callback', async (t) => {
  const app = await startProviderServer();
  t.after(async () => app.close());

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [],
    traces: [],
  });

  const enabledResponse = await fetchJson(app.baseUrl, '/api/provider/presence', {
    method: 'POST',
    body: { enabled: true },
  });

  assert.equal(enabledResponse.status, 200);
  assert.equal(enabledResponse.payload.ok, true);
  assert.equal(enabledResponse.payload.data.presence.enabled, true);
  assert.deepEqual(app.presenceChanges, [true]);
  assert.equal((await app.providerPresenceStore.read()).enabled, true);

  const disabledResponse = await fetchJson(app.baseUrl, '/api/provider/presence', {
    method: 'POST',
    body: { enabled: false },
  });

  assert.equal(disabledResponse.payload.ok, true);
  assert.equal(disabledResponse.payload.data.presence.enabled, false);
  assert.deepEqual(app.presenceChanges, [true, false]);
  assert.equal((await app.providerPresenceStore.read()).enabled, false);
});

test('POST /api/provider/refund/confirm clears the manual refund queue for the matching seller order', async (t) => {
  const app = await startProviderServer();
  t.after(async () => app.close());

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [createService()],
    traces: [createRefundPendingTrace()],
  });

  const confirmed = await fetchJson(app.baseUrl, '/api/provider/refund/confirm', {
    method: 'POST',
    body: { orderId: 'order-refund-1' },
  });

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.ok, true);
  assert.equal(confirmed.payload.data.orderId, 'order-refund-1');
  assert.equal(confirmed.payload.data.traceId, 'trace-provider-refund');
  assert.equal(confirmed.payload.data.state, 'refunded');

  const summary = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summary.payload.ok, true);
  assert.deepEqual(summary.payload.data.manualActions, []);

  const state = await app.runtimeStateStore.readState();
  assert.equal(state.traces[0].order.status, 'refunded');
  assert.equal(typeof state.traces[0].order.refundConfirmedAt, 'number');
  assert.equal(typeof state.traces[0].order.refundedAt, 'number');
});

test('GET /api/provider/refunds/initiated returns local buyer-side initiated refunds', async (t) => {
  const app = await startProviderServer();
  t.after(async () => app.close());

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [createService()],
    traces: [createRefundPendingTrace(), createBuyerRefundTrace()],
  });

  const response = await fetchJson(app.baseUrl, '/api/provider/refunds/initiated');
  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data.totalCount, 1);
  assert.equal(response.payload.data.pendingCount, 1);
  assert.equal(response.payload.data.initiatedByMe.length, 1);
  assert.equal(response.payload.data.initiatedByMe[0].orderId, 'order-buyer-refund-1');
  assert.equal(response.payload.data.initiatedByMe[0].role, 'buyer');
  assert.equal(response.payload.data.initiatedByMe[0].status, 'refund_pending');
  assert.equal(response.payload.data.initiatedByMe[0].counterpartyGlobalMetaId, 'idq1seller');
});
