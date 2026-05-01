import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function createIdentity(chatPublicKey) {
  return {
    metabotId: 1,
    name: 'Caller Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'caller-public-key',
    chatPublicKey,
    mvcAddress: 'mvc-caller-address',
    btcAddress: 'btc-caller-address',
    dogeAddress: 'doge-caller-address',
    metaId: 'metaid-caller',
    globalMetaId: 'idq1caller',
  };
}

function createService(overrides = {}) {
  return {
    id: overrides.currentPinId ?? 'chain-service-pin-1',
    sourceServicePinId: overrides.currentPinId ?? 'chain-service-pin-1',
    currentPinId: overrides.currentPinId ?? 'chain-service-pin-1',
    creatorMetabotId: 2,
    providerGlobalMetaId: overrides.providerGlobalMetaId ?? 'idq1provider',
    providerSkill: 'metabot-weather-oracle',
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather.',
    serviceIcon: null,
    price: overrides.price ?? '0.00001',
    currency: overrides.currency ?? 'SPACE',
    skillDocument: '# Weather Oracle',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: overrides.paymentAddress ?? 'mvc-payment-address',
    payloadJson: '{}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_000_000,
  };
}

async function createServiceCallHarness(t, options = {}) {
  const homeDir = await createProfileHome('metabot-service-payment-boundary-');
  t.after(async () => cleanupProfileHome(homeDir));

  const callerPair = createIdentityPair();
  const providerPair = createIdentityPair();
  const identity = createIdentity(callerPair.publicKeyHex);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity,
    services: [createService(options.service)],
    traces: [],
  });

  const writes = [];
  const events = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    chainApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceFailureMode: 'assume_service_providers_online',
    getDaemonRecord: () => ({
      ownerId: 'test',
      pid: 1,
      host: '127.0.0.1',
      port: 25200,
      baseUrl: 'http://127.0.0.1:25200',
      startedAt: 1_775_000_000_000,
    }),
    signer: {
      async getIdentity() {
        return identity;
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: identity.globalMetaId,
          chatPublicKey: callerPair.publicKeyHex,
          privateKeyHex: callerPair.privateKeyHex,
        };
      },
      async writePin(input) {
        events.push(`write:${input.path}`);
        writes.push(input);
        if (options.writePin) {
          return options.writePin(input, { events, writes, identity });
        }
        return {
          txids: [`${input.path}-tx-${writes.length}`],
          pinId: `${input.path}-pin-${writes.length}`,
          totalCost: 1,
          network: input.network,
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: identity.globalMetaId,
          mvcAddress: identity.mvcAddress,
        };
      },
    },
    fetchPeerChatPublicKey: options.fetchPeerChatPublicKey ?? (async () => providerPair.publicKeyHex),
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
    servicePaymentExecutor: options.servicePaymentExecutor ?? {
      async execute(input) {
        events.push('payment');
        return {
          paymentTxid: 'b'.repeat(64),
          paymentChain: input.paymentChain,
          paymentAmount: input.amount,
          paymentCurrency: input.currency,
          settlementKind: input.settlementKind,
          network: input.paymentChain,
        };
      },
    },
  });

  return {
    callerPair,
    providerPair,
    runtimeStateStore,
    handlers,
    writes,
    events,
  };
}

function decryptSimplemsgOrder(write, harness) {
  const payload = JSON.parse(write.payload);
  return receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1provider',
      privateKeyHex: harness.providerPair.privateKeyHex,
    },
    peerChatPublicKey: harness.callerPair.publicKeyHex,
    payload: {
      content: payload.content,
      rawData: write.payload,
    },
  }).plaintext;
}

test('free simplemsg service orders use an order reference instead of a payment txid', async (t) => {
  const harness = await createServiceCallHarness(t, {
    service: { price: '0', currency: 'SPACE' },
    servicePaymentExecutor: {
      async execute() {
        throw new Error('payment executor must not run for free services');
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.ok, false);
  assert.equal(called.state, 'waiting');
  assert.equal(called.data.paymentTxid, null);
  assert.match(called.data.orderReference, /^free-order-/);

  const simplemsgWrite = harness.writes.find((entry) => entry.path === '/protocols/simplemsg');
  assert.ok(simplemsgWrite, 'expected a simplemsg order write');
  const plaintext = decryptSimplemsgOrder(simplemsgWrite, harness);
  assert.match(plaintext, /^\[ORDER\]/);
  assert.doesNotMatch(plaintext, /\ntxid:\s*free-order-/i);
  assert.match(plaintext, /\norder id:\s*free-order-/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.traceId === called.data.traceId);
  assert.ok(trace, 'expected caller trace to be persisted');
  assert.equal(trace.order.paymentTxid, null);
  assert.match(trace.order.orderReference, /^free-order-/);
});

test('paid simplemsg service payment is not executed until local dispatch prerequisites pass', async (t) => {
  const paymentCalls = [];
  const harness = await createServiceCallHarness(t, {
    fetchPeerChatPublicKey: async () => null,
    servicePaymentExecutor: {
      async execute(input) {
        paymentCalls.push(input);
        return {
          paymentTxid: 'c'.repeat(64),
          paymentChain: input.paymentChain,
          paymentAmount: input.amount,
          paymentCurrency: input.currency,
          settlementKind: input.settlementKind,
          network: input.paymentChain,
        };
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.ok, false);
  assert.equal(called.state, 'failed');
  assert.equal(called.code, 'peer_chat_public_key_missing');
  assert.equal(paymentCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);
});

test('paid simplemsg service payment finishes before the order is broadcast', async (t) => {
  const harness = await createServiceCallHarness(t, {
    servicePaymentExecutor: {
      async execute(input) {
        harness.events.push('payment_started');
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.events.push('payment_finished');
        return {
          paymentTxid: 'd'.repeat(64),
          paymentChain: input.paymentChain,
          paymentAmount: input.amount,
          paymentCurrency: input.currency,
          settlementKind: input.settlementKind,
          network: input.paymentChain,
        };
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.ok, false);
  assert.equal(called.state, 'waiting');
  assert.deepEqual(harness.events, [
    'payment_started',
    'payment_finished',
    'write:/protocols/simplemsg',
  ]);
});

test('paid simplemsg service broadcast failure keeps a trace with payment provenance', async (t) => {
  const paymentTxid = 'e'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    servicePaymentExecutor: {
      async execute(input) {
        return {
          paymentTxid,
          paymentChain: input.paymentChain,
          paymentAmount: input.amount,
          paymentCurrency: input.currency,
          settlementKind: input.settlementKind,
          network: input.paymentChain,
        };
      },
    },
    writePin: async () => {
      throw new Error('simulated chain outage');
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.ok, false);
  assert.equal(called.state, 'failed');
  assert.equal(called.code, 'remote_order_broadcast_failed');

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.session?.peerGlobalMetaId === 'idq1provider');
  assert.ok(trace, 'expected a failure trace to be persisted after payment');
  assert.equal(trace.order.paymentTxid, paymentTxid);
  assert.equal(trace.order.paymentCurrency, 'SPACE');
  assert.equal(trace.order.paymentAmount, '0.00001');
  assert.equal(trace.a2a.latestEvent, 'remote_order_broadcast_failed');
});
