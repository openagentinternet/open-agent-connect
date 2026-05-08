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
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');

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

async function startProviderServer(options = {}) {
  const homeDir = await createProfileHome('metabot-provider-routes-');
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const presenceChanges = [];

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    chainApiBaseUrl: options.chainApiBaseUrl,
    secretStore: options.secretStore,
    signer: options.signer,
    adapters: options.adapters,
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
    writes: options.writes ?? [],
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

test('POST /api/provider/refund/confirm refuses to locally complete a trace-only refund without settlement proof', async (t) => {
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
  assert.equal(confirmed.payload.ok, false);
  assert.equal(confirmed.payload.state, 'manual_action_required');
  assert.equal(confirmed.payload.code, 'order_not_found');

  const summary = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summary.payload.ok, true);
  assert.equal(summary.payload.data.manualActions.length, 1);

  const state = await app.runtimeStateStore.readState();
  assert.equal(state.traces[0].order.status, 'refund_pending');
  assert.equal(state.traces[0].order.refundTxid ?? null, null);
  assert.equal(state.traces[0].order.refundFinalizePinId ?? null, null);
});

test('POST /api/provider/refund/confirm settles a sellerOrder with transfer and finalization proof', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const writes = [];
  const transferBuilds = [];
  const broadcasts = [];
  const app = await startProviderServer({
    chainApiBaseUrl: 'https://chain.test',
    writes,
    secretStore: {
      async ensureLayout() { return {}; },
      async readIdentitySecrets() {
        return { mnemonic: 'test test test test test test test test test test test junk', path: "m/44'/10001'/0'/0/0" };
      },
      async writeIdentitySecrets(value) { return JSON.stringify(value); },
      async deleteIdentitySecrets() {},
    },
    signer: {
      async getIdentity() { return {}; },
      async getPrivateChatIdentity() { return {}; },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['refund-finalize-txid-1'],
          pinId: 'refund-finalize-pin-1',
          totalCost: 1,
          network: input.network,
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: 'idq1provider',
          mvcAddress: 'mvc-provider-address',
        };
      },
    },
    adapters: new Map([
      ['mvc', {
        network: 'mvc',
        explorerBaseUrl: 'https://www.mvcscan.com',
        feeRateUnit: 'sat/byte',
        minTransferSatoshis: 600,
        async deriveAddress() { return 'mvc-provider-address'; },
        async fetchUtxos() { return []; },
        async fetchBalance() {
          return { chain: 'mvc', address: 'mvc-provider-address', totalSatoshis: 0, confirmedSatoshis: 0, unconfirmedSatoshis: 0, utxoCount: 0 };
        },
        async fetchFeeRate() { return 1; },
        async fetchRawTx() { return ''; },
        async buildTransfer(input) {
          transferBuilds.push(input);
          return { rawTx: 'signed-refund-transfer-rawtx', fee: 42 };
        },
        async buildInscription() { throw new Error('not used'); },
        async broadcastTx(rawTx) {
          broadcasts.push(rawTx);
          return 'refund-transfer-txid-1';
        },
      }],
    ]),
  });
  t.after(async () => app.close());
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href === 'https://chain.test/pin/seller-refund-pin-1') {
      return new Response(JSON.stringify({
        data: {
          path: '/protocols/service-refund-request',
          contentSummary: JSON.stringify({
            version: '1.0.0',
            paymentTxid: 'd'.repeat(64),
            servicePinId: '/protocols/skill-service-pin-1',
            serviceName: 'Tarot Reading',
            refundAmount: '0.00001',
            refundCurrency: 'SPACE',
            amount: '0.00001',
            currency: 'SPACE',
            paymentChain: 'mvc',
            settlementKind: 'native',
            paymentCommitTxid: null,
            refundToAddress: 'mvc-buyer-address',
            buyerGlobalMetaId: 'idq1buyer',
            sellerGlobalMetaId: 'idq1provider',
            orderMessagePinId: 'order-message-pin-1',
            failureReason: 'delivery_timeout',
            failureDetectedAt: 1_775_000_030,
            evidencePinIds: ['order-message-pin-1'],
          }),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(url, init);
  };

  const sellerOrder = createSellerOrderRecord({
    id: 'seller-order-refund-1',
    state: 'refund_pending',
    localMetabotId: 1,
    localMetabotSlug: path.basename(app.homeDir),
    providerGlobalMetaId: 'idq1provider',
    buyerGlobalMetaId: 'idq1buyer',
    servicePinId: '/protocols/skill-service-pin-1',
    currentServicePinId: '/protocols/skill-service-pin-1',
    serviceName: 'Tarot Reading',
    providerSkill: 'tarot-rws',
    orderMessageId: 'order-message-pin-1',
    orderPinId: 'order-message-pin-1',
    orderTxid: 'c'.repeat(64),
    paymentTxid: 'd'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-provider-seller-order-refund',
    a2aSessionId: 'seller-session-1',
    a2aTaskRunId: 'seller-run-1',
    refundRequestPinId: 'seller-refund-pin-1',
    createdAt: 1_775_000_020_000,
    updatedAt: 1_775_000_030_000,
  });

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [createService()],
    traces: [],
    sellerOrders: [sellerOrder],
  });

  const summaryBefore = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summaryBefore.payload.ok, true);
  assert.equal(summaryBefore.payload.data.manualActions.length, 1);
  assert.equal(summaryBefore.payload.data.manualActions[0].orderId, 'seller-order-refund-1');

  const confirmed = await fetchJson(app.baseUrl, '/api/provider/refund/confirm', {
    method: 'POST',
    body: { orderId: 'seller-order-refund-1' },
  });

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.ok, true);
  assert.equal(confirmed.payload.data.orderId, 'seller-order-refund-1');
  assert.equal(confirmed.payload.data.traceId, 'trace-provider-seller-order-refund');
  assert.equal(confirmed.payload.data.state, 'refunded');
  assert.equal(confirmed.payload.data.refundTxid, 'refund-transfer-txid-1');
  assert.equal(confirmed.payload.data.refundFinalizePinId, 'refund-finalize-pin-1');
  assert.equal(transferBuilds.length, 1);
  assert.equal(transferBuilds[0].toAddress, 'mvc-buyer-address');
  assert.equal(transferBuilds[0].amountSatoshis, 1000);
  assert.deepEqual(broadcasts, ['signed-refund-transfer-rawtx']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/service-refund-finalize');
  const finalizePayload = JSON.parse(writes[0].payload);
  assert.equal(finalizePayload.refundRequestPinId, 'seller-refund-pin-1');
  assert.equal(finalizePayload.paymentTxid, 'd'.repeat(64));
  assert.equal(finalizePayload.servicePinId, '/protocols/skill-service-pin-1');
  assert.equal(finalizePayload.refundTxid, 'refund-transfer-txid-1');

  const summaryAfter = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summaryAfter.payload.ok, true);
  assert.deepEqual(summaryAfter.payload.data.manualActions, []);

  const state = await app.runtimeStateStore.readState();
  assert.equal(state.sellerOrders[0].state, 'refunded');
  assert.equal(state.sellerOrders[0].refundTxid, 'refund-transfer-txid-1');
  assert.equal(state.sellerOrders[0].refundFinalizePinId, 'refund-finalize-pin-1');
  assert.equal(typeof state.sellerOrders[0].refundedAt, 'number');
});

test('POST /api/provider/refund/confirm preserves failed paid seller orders without a refund request proof', async (t) => {
  const app = await startProviderServer();
  t.after(async () => app.close());

  const sellerOrder = createSellerOrderRecord({
    id: 'seller-order-failed-without-refund-proof',
    state: 'failed',
    localMetabotId: 1,
    localMetabotSlug: path.basename(app.homeDir),
    providerGlobalMetaId: 'idq1provider',
    buyerGlobalMetaId: 'idq1buyer',
    servicePinId: '/protocols/skill-service-pin-1',
    currentServicePinId: '/protocols/skill-service-pin-1',
    serviceName: 'Tarot Reading',
    providerSkill: 'tarot-rws',
    orderMessageId: 'order-message-pin-2',
    orderPinId: 'order-message-pin-2',
    orderTxid: 'e'.repeat(64),
    paymentTxid: 'f'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-provider-seller-order-failed',
    a2aSessionId: 'seller-session-2',
    a2aTaskRunId: 'seller-run-2',
    failureReason: 'provider_execution_failed',
    refundRequestPinId: null,
    createdAt: 1_775_000_020_000,
    updatedAt: 1_775_000_030_000,
  });

  await app.runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [createService()],
    traces: [],
    sellerOrders: [sellerOrder],
  });

  const summaryBefore = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summaryBefore.payload.ok, true);
  assert.equal(summaryBefore.payload.data.manualActions.length, 1);
  assert.equal(summaryBefore.payload.data.manualActions[0].orderId, 'seller-order-failed-without-refund-proof');

  const confirmed = await fetchJson(app.baseUrl, '/api/provider/refund/confirm', {
    method: 'POST',
    body: { orderId: 'seller-order-failed-without-refund-proof' },
  });

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.ok, false);
  assert.equal(confirmed.payload.state, 'manual_action_required');
  assert.equal(confirmed.payload.code, 'refund_request_missing');

  const summaryAfter = await fetchJson(app.baseUrl, '/api/provider/summary');
  assert.equal(summaryAfter.payload.ok, true);
  assert.equal(summaryAfter.payload.data.manualActions.length, 1);
  assert.equal(summaryAfter.payload.data.manualActions[0].orderId, 'seller-order-failed-without-refund-proof');

  const state = await app.runtimeStateStore.readState();
  assert.equal(state.sellerOrders[0].state, 'failed');
  assert.equal(state.sellerOrders[0].refundBlockingReason, 'refund_request_missing');
  assert.equal(state.sellerOrders[0].refundTxid, null);
  assert.equal(state.sellerOrders[0].refundFinalizePinId, null);
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
