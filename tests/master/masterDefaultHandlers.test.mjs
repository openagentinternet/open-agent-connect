import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { parseMasterResponse } = require('../../dist/core/master/masterMessageSchema.js');

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

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function loadTemplateFixture() {
  return JSON.parse(
    readFileSync(
      path.resolve('templates/master-service/debug-master.template.json'),
      'utf8'
    )
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('default master handlers publish a validated master-service and surface it in master.list', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-default-handlers-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [],
    traces: [],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
  });

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    chainApiBaseUrl: 'https://chain.test',
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:25200' }),
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['master-tx-1'],
          pinId: 'master-pin-1',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/master-service',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'idq1provider',
          mvcAddress: 'mvc-provider-address',
        };
      },
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/chain\.test\/pin\/path\/list\?/);
    return jsonResponse({
      data: {
        list: [],
        nextCursor: null,
      },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const published = await handlers.master.publish(loadTemplateFixture());
  assert.equal(published.ok, true);
  assert.equal(published.data.masterPinId, 'master-pin-1');
  assert.equal(published.data.displayName, 'Official Debug Master');
  assert.equal(published.data.online, true);
  assert.equal(published.data.providerDaemonBaseUrl, 'http://127.0.0.1:25200');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/master-service');

  const listed = await handlers.master.list({});
  assert.equal(listed.ok, true);
  assert.equal(listed.data.masters.length, 1);
  assert.equal(listed.data.masters[0].masterPinId, 'master-pin-1');
  assert.equal(listed.data.masters[0].displayName, 'Official Debug Master');
  assert.equal(listed.data.masters[0].online, true);
});

test('default master handlers receive a provider-side master_request and project it into provider summary', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-provider-handler-'));
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
    traces: [],
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
        updatedAt: 1_776_000_000_000,
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

  const received = await handlers.master.receive({
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-provider-handler-1',
    traceId: 'trace-provider-handler-1',
    callerGlobalMetaId: 'idq1caller',
    target: {
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    host: {
      mode: 'codex',
      client: 'metabot',
      clientVersion: '0.1.0',
    },
    trigger: {
      mode: 'manual',
      reason: 'user_requested_help',
    },
    task: {
      userTask: 'Diagnose empty master discovery.',
      question: 'metabot master list returns an empty masters list. What should I check first?',
      goal: 'Return the shortest fix path.',
    },
    context: {
      workspaceSummary: 'Caller-side Ask Master smoke test.',
      errorSummary: 'Observed local output: {"ok":true,"state":"success","data":{"masters":[]}}',
      relevantFiles: [],
      artifacts: [
        {
          kind: 'text',
          label: 'master-list-output',
          content: '{"ok":true,"state":"success","data":{"masters":[]}}',
        },
      ],
    },
    constraints: ['Keep the answer concrete and minimal.'],
    desiredOutput: {
      mode: 'structured_help',
    },
    sentAt: 1_776_000_100_000,
    deliverResponse: false,
  });
  assert.equal(received.ok, true);
  assert.equal(received.data.traceId, 'trace-provider-handler-1');
  assert.equal(received.data.response.status, 'completed');
  assert.equal(received.data.session.event, 'provider_completed');

  const summary = await handlers.provider.getSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.data.recentMasterRequests.length, 1);
  assert.equal(summary.data.recentMasterRequests[0].traceId, 'trace-provider-handler-1');
  assert.equal(summary.data.recentMasterRequests[0].displayName, 'Official Debug Master');
});

test('default master handlers send the generated master_response over simplemsg when reply delivery metadata is available', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-provider-delivery-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const providerPair = createIdentityPair();
  const callerPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: {
      ...createIdentity(),
      chatPublicKey: providerPair.publicKeyHex,
    },
    services: [],
    traces: [],
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
        updatedAt: 1_776_000_000_000,
      },
    ],
  });

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:25200' }),
    signer: {
      async getPrivateChatIdentity() {
        return {
          globalMetaId: 'idq1provider',
          privateKeyHex: providerPair.privateKeyHex,
        };
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['simplemsg-tx-1'],
          pinId: 'simplemsg-pin-1',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/simplemsg',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'idq1provider',
          mvcAddress: 'mvc-provider-address',
        };
      },
    },
  });

  const result = await handlers.master.receive({
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-provider-delivery-1',
    traceId: 'trace-provider-delivery-1',
    callerGlobalMetaId: 'idq1caller',
    target: {
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    host: {
      mode: 'codex',
      client: 'metabot',
      clientVersion: '0.1.0',
    },
    trigger: {
      mode: 'manual',
      reason: 'user_requested_help',
    },
    task: {
      userTask: 'Diagnose empty master discovery.',
      question: 'metabot master list returns an empty masters list. What should I check first?',
      goal: 'Return the shortest fix path.',
    },
    context: {
      workspaceSummary: 'Caller-side Ask Master smoke test.',
      errorSummary: 'Observed local output: {"ok":true,"state":"success","data":{"masters":[]}}',
      relevantFiles: [],
      artifacts: [
        {
          kind: 'text',
          label: 'master-list-output',
          content: '{"ok":true,"state":"success","data":{"masters":[]}}',
        },
      ],
    },
    constraints: ['Keep the answer concrete and minimal.'],
    desiredOutput: {
      mode: 'structured_help',
    },
    replyPin: 'incoming-master-request-pin-1',
    callerChatPublicKey: callerPair.publicKeyHex,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.messagePinId, 'simplemsg-pin-1');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/simplemsg');

  const outboundPayload = JSON.parse(writes[0].payload);
  const decrypted = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: callerPair.privateKeyHex,
    },
    peerChatPublicKey: providerPair.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1provider',
      rawData: JSON.stringify({ content: outboundPayload.content }),
      replyPinId: outboundPayload.replyPin,
    },
  });
  const parsed = parseMasterResponse(decrypted.plaintextJson);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.requestId, 'request-provider-delivery-1');
  assert.equal(parsed.value.status, 'completed');
});

test('default master handlers regenerate exported trace artifacts when provider response delivery fails', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-provider-delivery-failure-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const providerPair = createIdentityPair();
  const callerPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: {
      ...createIdentity(),
      chatPublicKey: providerPair.publicKeyHex,
    },
    services: [],
    traces: [],
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
        updatedAt: 1_776_000_000_000,
      },
    ],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:25200' }),
    signer: {
      async getPrivateChatIdentity() {
        return {
          globalMetaId: 'idq1provider',
          privateKeyHex: providerPair.privateKeyHex,
        };
      },
      async writePin() {
        throw new Error('simulated simplemsg delivery failure');
      },
    },
  });

  const result = await handlers.master.receive({
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-provider-delivery-failure-1',
    traceId: 'trace-provider-delivery-failure-1',
    callerGlobalMetaId: 'idq1caller',
    target: {
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    host: {
      mode: 'codex',
      client: 'metabot',
      clientVersion: '0.1.0',
    },
    trigger: {
      mode: 'manual',
      reason: 'user_requested_help',
    },
    task: {
      userTask: 'Diagnose empty master discovery.',
      question: 'metabot master list returns an empty masters list. What should I check first?',
      goal: 'Return the shortest fix path.',
    },
    context: {
      workspaceSummary: 'Caller-side Ask Master smoke test.',
      errorSummary: 'Observed local output: {"ok":true,"state":"success","data":{"masters":[]}}',
      relevantFiles: [],
      artifacts: [
        {
          kind: 'text',
          label: 'master-list-output',
          content: '{"ok":true,"state":"success","data":{"masters":[]}}',
        },
      ],
    },
    constraints: ['Keep the answer concrete and minimal.'],
    desiredOutput: {
      mode: 'structured_help',
    },
    replyPin: 'incoming-master-request-pin-failure-1',
    callerChatPublicKey: callerPair.publicKeyHex,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'master_response_delivery_failed');

  const state = await runtimeStateStore.readState();
  assert.equal(state.traces.length, 1);
  const trace = state.traces[0];
  assert.equal(trace.askMaster.canonicalStatus, 'failed');
  assert.equal(trace.askMaster.failure.code, 'master_response_delivery_failed');

  const traceJson = JSON.parse(readFileSync(trace.artifacts.traceJsonPath, 'utf8'));
  const traceMarkdown = readFileSync(trace.artifacts.traceMarkdownPath, 'utf8');
  assert.equal(traceJson.askMaster.canonicalStatus, 'failed');
  assert.equal(traceJson.askMaster.failure.code, 'master_response_delivery_failed');
  assert.equal(traceJson.askMaster.failure.message, 'simulated simplemsg delivery failure');
  assert.match(traceMarkdown, /Ask Master Status: failed/);
  assert.match(traceMarkdown, /Request ID: request-provider-delivery-failure-1/);
});
