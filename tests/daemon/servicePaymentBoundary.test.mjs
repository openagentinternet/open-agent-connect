import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { TxComposer, mvc } = require('meta-contract');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { buildDelegationOrderPayload } = require('../../dist/core/orders/delegationOrderMessage.js');
const { parseDeliveryMessage, parseNeedsRatingMessage } = require('../../dist/core/a2a/protocol/orderProtocol.js');
const { buildA2ASimplemsgInboundDispatcher } = require('../../dist/cli/runtime.js');

const MVC_PAYMENT_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const MVC_OTHER_ADDRESS = '1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp';

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
    paymentAddress: overrides.paymentAddress ?? MVC_PAYMENT_ADDRESS,
    payloadJson: '{}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_775_000_000_000,
  };
}

function createRuntime(overrides = {}) {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id: 'runtime-codex',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function prepareProviderRuntimeSkill(homeDir, skillName = 'metabot-weather-oracle') {
  const runtimeStore = createLlmRuntimeStore(homeDir);
  const bindingStore = createLlmBindingStore(homeDir);
  await runtimeStore.write({
    version: 1,
    runtimes: [createRuntime()],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      {
        id: 'binding-codex-primary',
        metaBotSlug: path.basename(homeDir),
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ],
  });
  await mkdir(path.join(homeDir, '.codex', 'skills', skillName), { recursive: true });
  await writeFile(path.join(homeDir, '.codex', 'skills', skillName, 'SKILL.md'), '# Weather Oracle\n', 'utf8');
}

function buildMvcPaymentRawTx(address, satoshis) {
  const txComposer = new TxComposer();
  txComposer.appendP2PKHOutput({
    address: new mvc.Address(address, mvc.Networks.livenet),
    satoshis,
  });
  return txComposer.getRawHex();
}

async function createInboundProviderOrderHarness(t, options = {}) {
  const homeDir = await createProfileHome('metabot-provider-inbound-order-');
  t.after(async () => cleanupProfileHome(homeDir));

  const providerPair = createIdentityPair();
  const buyerPair = createIdentityPair();
  const identity = {
    ...createIdentity(providerPair.publicKeyHex),
    name: 'Provider Bot',
    publicKey: 'provider-public-key',
    mvcAddress: 'mvc-provider-address',
    addresses: {
      mvc: 'mvc-provider-address',
      btc: 'btc-provider-address',
      doge: 'doge-provider-address',
    },
    metaId: 'metaid-provider',
    globalMetaId: 'idq1provider',
  };
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const service = createService({
    providerGlobalMetaId: identity.globalMetaId,
    ...(options.service ?? {}),
  });
  await runtimeStateStore.writeState({
    identity,
    services: [service],
    traces: [],
  });
  await prepareProviderRuntimeSkill(homeDir, service.providerSkill);

  const writes = [];
  const llmCalls = [];
  const rawTxs = new Map(Object.entries(options.rawTxs ?? {}));
  const paymentUtxos = options.paymentUtxos ?? [];
  const fetchRawTxCalls = [];
  const fetchUtxosCalls = [];
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
        return {
          mnemonic: '',
          path: identity.path,
          publicKey: identity.publicKey,
          chatPublicKey: identity.chatPublicKey,
          addresses: identity.addresses,
          mvcAddress: identity.mvcAddress,
          metaId: identity.metaId,
          globalMetaId: identity.globalMetaId,
        };
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: identity.globalMetaId,
          chatPublicKey: providerPair.publicKeyHex,
          privateKeyHex: providerPair.privateKeyHex,
        };
      },
      async writePin(input) {
        if (options.writePinHook) {
          await options.writePinHook(input, writes);
        }
        writes.push(input);
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
    adapters: new Map([
      ['mvc', {
        network: 'mvc',
        explorerBaseUrl: 'https://www.mvcscan.com',
        feeRateUnit: 'sat/byte',
        minTransferSatoshis: 600,
        async deriveAddress() { return identity.mvcAddress; },
        async fetchUtxos(address) {
          fetchUtxosCalls.push(address);
          return paymentUtxos;
        },
        async fetchBalance() {
          return {
            chain: 'mvc',
            address: identity.mvcAddress,
            totalSatoshis: 0,
            confirmedSatoshis: 0,
            unconfirmedSatoshis: 0,
            utxoCount: 0,
          };
        },
        async fetchFeeRate() { return 1; },
        async fetchRawTx(txid) {
          fetchRawTxCalls.push(txid);
          const rawTx = rawTxs.get(txid);
          if (!rawTx) {
            throw new Error(`missing raw tx fixture for ${txid}`);
          }
          return rawTx;
        },
        async broadcastTx() { throw new Error('not used'); },
        async buildTransfer() { throw new Error('not used'); },
        async buildInscription() { throw new Error('not used'); },
      }],
    ]),
    fetchPeerChatPublicKey: options.fetchPeerChatPublicKey ?? (async (globalMetaId) => (
      options.peerChatPublicKeys?.[globalMetaId] ?? buyerPair.publicKeyHex
    )),
    llmExecutor: {
      async execute(request) {
        llmCalls.push(request);
        if (options.llmDelayMs) {
          await delay(options.llmDelayMs);
        }
        if (options.llmExecuteError) {
          throw options.llmExecuteError;
        }
        return 'provider-llm-session-1';
      },
      async getSession(sessionId) {
        if (options.llmSession) {
          return options.llmSession(sessionId);
        }
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: options.llmOutput ?? 'Tomorrow weather: bright with light wind.',
            durationMs: 1,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    providerRuntimeCanStart: async () => true,
    a2aConversationPersister: options.a2aConversationPersister,
  });

  function makeOrderContent(overrides = {}) {
    return buildDelegationOrderPayload({
      rawRequest: overrides.rawRequest ?? 'Tell me tomorrow weather',
      userTask: overrides.userTask ?? 'Tell me tomorrow weather',
      taskContext: overrides.taskContext ?? 'Shanghai tomorrow',
      serviceName: service.displayName,
      providerSkill: service.providerSkill,
      servicePinId: service.currentPinId,
      paymentTxid: overrides.paymentTxid ?? 'b'.repeat(64),
      paymentCommitTxid: overrides.paymentCommitTxid ?? null,
      paymentChain: 'mvc',
      settlementKind: 'native',
      orderReference: overrides.orderReference ?? null,
      price: service.price,
      currency: service.currency,
      outputType: service.outputType,
    });
  }

  function decryptProviderWrite(write) {
    const payload = JSON.parse(write.payload);
    return receivePrivateChat({
      localIdentity: {
        globalMetaId: 'idq1caller',
        privateKeyHex: buyerPair.privateKeyHex,
      },
      peerChatPublicKey: providerPair.publicKeyHex,
      payload: {
        content: payload.content,
        rawData: write.payload,
      },
    }).plaintext;
  }

  return {
    homeDir,
    identity,
    service,
    buyerGlobalMetaId: 'idq1caller',
    buyerPair,
    runtimeStateStore,
    handlers,
    writes,
    llmCalls,
    rawTxs,
    fetchRawTxCalls,
    fetchUtxosCalls,
    makeOrderContent,
    decryptProviderWrite,
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
    ratingFollowupRetryDelaysMs: options.ratingFollowupRetryDelaysMs,
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
    a2aConversationPersister: options.a2aConversationPersister,
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
    homeDir,
    callerPair,
    providerPair,
    identity,
    runtimeStateStore,
    handlers,
    writes,
    events,
  };
}

async function seedBuyerTraceForRating(harness) {
  const state = await harness.runtimeStateStore.readState();
  const trace = buildSessionTrace({
    traceId: 'trace-rating-retry',
    channel: 'a2a',
    exportRoot: harness.runtimeStateStore.paths.exportsRoot,
    createdAt: 1_775_000_001_000,
    session: {
      id: 'session-trace-rating-retry',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Weather Oracle',
      externalConversationId: 'a2a-session:idq1provider:trace-rating-retry',
    },
    order: {
      id: 'order-trace-rating-retry',
      role: 'buyer',
      serviceId: 'chain-service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: 'order-pin-1',
      orderTxid: 'order-tx-1',
      orderTxids: ['order-tx-1'],
      paymentTxid: 'payment-tx-1',
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00001',
    },
    a2a: {
      sessionId: 'session-rating-retry-1',
      taskRunId: 'run-rating-retry-1',
      role: 'caller',
      publicStatus: 'completed',
      latestEvent: 'provider_completed',
      taskRunState: 'completed',
      callerGlobalMetaId: 'idq1caller',
      providerGlobalMetaId: 'idq1provider',
      providerName: 'Weather Oracle',
      servicePinId: 'chain-service-pin-1',
    },
  });

  await harness.runtimeStateStore.writeState({
    ...state,
    traces: [trace],
  });

  const sessionStateStore = createSessionStateStore(harness.homeDir);
  await sessionStateStore.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'session-rating-retry-1',
        traceId: 'trace-rating-retry',
        role: 'caller',
        state: 'completed',
        createdAt: 1_775_000_001_000,
        updatedAt: 1_775_000_002_000,
        callerGlobalMetaId: 'idq1caller',
        providerGlobalMetaId: 'idq1provider',
        servicePinId: 'chain-service-pin-1',
        currentTaskRunId: 'run-rating-retry-1',
        latestTaskRunState: 'completed',
      },
    ],
    taskRuns: [
      {
        runId: 'run-rating-retry-1',
        sessionId: 'session-rating-retry-1',
        state: 'completed',
        input: 'weather',
        output: 'sunny',
        error: null,
        createdAt: 1_775_000_001_000,
        updatedAt: 1_775_000_002_000,
      },
    ],
    transcriptItems: [],
    publicStatusSnapshots: [
      {
        sessionId: 'session-rating-retry-1',
        taskRunId: 'run-rating-retry-1',
        status: 'completed',
        mapped: true,
        rawEvent: 'provider_completed',
        resolvedAt: 1_775_000_002_000,
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
  });

  return sessionStateStore;
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

function decryptSimplemsgFromProviderToBuyer(write, input) {
  const payload = JSON.parse(write.payload);
  return receivePrivateChat({
    localIdentity: {
      globalMetaId: input.buyerGlobalMetaId,
      privateKeyHex: input.buyerPrivateKeyHex,
    },
    peerChatPublicKey: input.providerChatPublicKeyHex,
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

test('inbound free provider ORDER rejects replayed order reference with a different simplemsg tx', async (t) => {
  const firstMessageTxid = '1'.repeat(64);
  const replayMessageTxid = '2'.repeat(64);
  const orderReference = 'free-order-phase4-replay';
  const harness = await createInboundProviderOrderHarness(t, {
    service: { price: '0', currency: 'SPACE' },
  });
  const content = harness.makeOrderContent({
    paymentTxid: '',
    orderReference,
  }).replace(/\ntxid:\s*[^\n]+/i, '');

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${firstMessageTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const replay = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${replayMessageTxid}i0`,
    timestamp: 1_775_000_002_000,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.orderTxid, firstMessageTxid);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.filter((entry) => entry.startsWith(`[DELIVERY:${firstMessageTxid}]`)).length, 1);
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${replayMessageTxid}]`)), false);
});

test('concurrent inbound free provider ORDER replay with same order reference does not execute twice', async (t) => {
  const firstMessageTxid = '3'.repeat(64);
  const replayMessageTxid = '4'.repeat(64);
  const orderReference = 'free-order-phase4-concurrent-replay';
  const harness = await createInboundProviderOrderHarness(t, {
    service: { price: '0', currency: 'SPACE' },
    llmDelayMs: 50,
  });
  const content = harness.makeOrderContent({
    paymentTxid: '',
    orderReference,
  }).replace(/\ntxid:\s*[^\n]+/i, '');

  const [first, replay] = await Promise.all([
    harness.handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: harness.buyerGlobalMetaId,
      content,
      messagePinId: `${firstMessageTxid}i0`,
      timestamp: 1_775_000_001_000,
    }),
    harness.handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: harness.buyerGlobalMetaId,
      content,
      messagePinId: `${replayMessageTxid}i0`,
      timestamp: 1_775_000_002_000,
    }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  const deliveryCount = contents.filter((entry) => (
    entry.startsWith(`[DELIVERY:${firstMessageTxid}]`)
    || entry.startsWith(`[DELIVERY:${replayMessageTxid}]`)
  )).length;
  assert.equal(deliveryCount, 1);
});

test('service rating retries provider follow-up simplemsg after a mempool conflict', async (t) => {
  let simplemsgAttempts = 0;
  const harness = await createServiceCallHarness(t, {
    ratingFollowupRetryDelaysMs: [0],
    writePin(input, { writes, identity }) {
      if (input.path === '/protocols/simplemsg') {
        simplemsgAttempts += 1;
        if (simplemsgAttempts === 1) {
          throw new Error('[-26]258: txn-mempool-conflict');
        }
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
  });
  const sessionStateStore = await seedBuyerTraceForRating(harness);

  const result = await harness.handlers.services.rate({
    traceId: 'trace-rating-retry',
    rate: 5,
    comment: 'Great weather report.',
  });

  assert.equal(result.ok, true);
  assert.equal(simplemsgAttempts, 2);
  assert.equal(result.data.ratingMessageSent, true);
  assert.equal(result.data.ratingMessageError, null);
  assert.match(result.data.ratingMessagePinId, /\/protocols\/simplemsg-pin-/);

  const sessionState = await sessionStateStore.readState();
  const followup = sessionState.transcriptItems.find(
    (item) => item.metadata?.event === 'service_rating_message_sent',
  );
  assert.ok(followup);
  assert.equal(followup.sender, 'caller');
  assert.match(followup.content, /Great weather report/);
});

test('service rating retries skill-service-rate publish after a mempool conflict', async (t) => {
  let ratingAttempts = 0;
  const harness = await createServiceCallHarness(t, {
    ratingFollowupRetryDelaysMs: [0],
    writePin(input, { writes, identity }) {
      if (input.path === '/protocols/skill-service-rate') {
        ratingAttempts += 1;
        if (ratingAttempts === 1) {
          throw new Error('[-26]258: txn-mempool-conflict');
        }
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
  });
  const sessionStateStore = await seedBuyerTraceForRating(harness);

  const result = await harness.handlers.services.rate({
    traceId: 'trace-rating-retry',
    rate: 5,
    comment: 'Great weather report.',
  });

  assert.equal(result.ok, true);
  assert.equal(ratingAttempts, 2);
  assert.match(result.data.pinId, /\/protocols\/skill-service-rate-pin-/);
  assert.equal(result.data.ratingMessageSent, true);

  const sessionState = await sessionStateStore.readState();
  const published = sessionState.transcriptItems.find(
    (item) => item.metadata?.event === 'service_rating_published',
  );
  assert.ok(published);
  assert.match(published.metadata.ratingPinId, /\/protocols\/skill-service-rate-pin-/);
});

test('service rating does not retry provider follow-up simplemsg for non-conflict tx rejection', async (t) => {
  let simplemsgAttempts = 0;
  const harness = await createServiceCallHarness(t, {
    ratingFollowupRetryDelaysMs: [0, 0],
    writePin(input, { writes, identity }) {
      if (input.path === '/protocols/simplemsg') {
        simplemsgAttempts += 1;
        throw new Error('[-26] mandatory-script-verify-flag-failed');
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
  });
  const sessionStateStore = await seedBuyerTraceForRating(harness);

  const result = await harness.handlers.services.rate({
    traceId: 'trace-rating-retry',
    rate: 5,
    comment: 'Great weather report.',
  });

  assert.equal(result.ok, true);
  assert.equal(simplemsgAttempts, 1);
  assert.equal(result.data.ratingMessageSent, false);
  assert.equal(result.data.ratingMessagePinId, null);
  assert.match(result.data.ratingMessageError, /mandatory-script-verify-flag-failed/);

  const sessionState = await sessionStateStore.readState();
  const failedFollowup = sessionState.transcriptItems.find(
    (item) => item.metadata?.event === 'service_rating_message_failed',
  );
  assert.ok(failedFollowup);
  assert.match(failedFollowup.metadata.ratingMessageError, /mandatory-script-verify-flag-failed/);
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

test('paid simplemsg service local A2A store failure does not mask successful order broadcast', async (t) => {
  const paymentTxid = 'f'.repeat(64);
  const persistenceCalls = [];
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
    a2aConversationPersister: async (input) => {
      persistenceCalls.push(input);
      throw new Error('simulated local A2A store failure');
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
  assert.equal(called.code, 'order_sent_awaiting_provider');
  assert.equal(called.data.paymentTxid, paymentTxid);
  assert.match(called.data.orderTxid, /^\/protocols\/simplemsg-tx-/);
  assert.equal(called.data.a2aStorePersisted, false);
  assert.match(called.data.a2aStoreError, /simulated local A2A store failure/);
  assert.equal(persistenceCalls.length, 1);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), true);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.session?.peerGlobalMetaId === 'idq1provider');
  assert.ok(trace, 'expected caller trace to remain persisted after order broadcast');
  assert.notEqual(trace.a2a.latestEvent, 'remote_order_broadcast_failed');
});

test('private chat local A2A store failure does not mask successful chain broadcast', async (t) => {
  const persistenceCalls = [];
  const harness = await createServiceCallHarness(t, {
    a2aConversationPersister: async (input) => {
      persistenceCalls.push(input);
      throw new Error('simulated local A2A chat store failure');
    },
  });

  const sent = await harness.handlers.chat.private({
    to: 'idq1provider',
    content: 'hello provider',
    peerChatPublicKey: harness.providerPair.publicKeyHex,
  });

  assert.equal(sent.ok, true);
  assert.equal(sent.state, 'success');
  assert.equal(sent.data.deliveryMode, 'onchain_simplemsg');
  assert.match(sent.data.pinId, /^\/protocols\/simplemsg-pin-/);
  assert.deepEqual(sent.data.txids, ['/protocols/simplemsg-tx-1']);
  assert.equal(sent.data.a2aStorePersisted, false);
  assert.match(sent.data.a2aStoreError, /simulated local A2A chat store failure/);
  assert.equal(persistenceCalls.length, 1);
  assert.equal(persistenceCalls[0].message.content, 'hello provider');
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), true);
});

test('inbound provider ORDER executes through runner and sends delivery plus rating request once', async (t) => {
  const orderTxid = 'a'.repeat(64);
  const paymentTxid = 'b'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });
  const content = harness.makeOrderContent({ paymentTxid });

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const second = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(first.ok, true);
  assert.equal(first.data.handled, true);
  assert.equal(first.data.delivered, true);
  assert.equal(second.ok, true);
  assert.equal(second.data.duplicate, true);
  assert.equal(harness.llmCalls.length, 1);
  assert.deepEqual(harness.fetchRawTxCalls, [paymentTxid]);
  assert.deepEqual(harness.llmCalls[0].skills, [harness.service.providerSkill]);

  const simplemsgWrites = harness.writes.filter((entry) => entry.path === '/protocols/simplemsg');
  assert.equal(simplemsgWrites.length, 3);
  const contents = simplemsgWrites.map((entry) => harness.decryptProviderWrite(entry));
  const deliveryMessages = contents.filter((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`));
  const ratingMessages = contents.filter((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`));
  assert.equal(deliveryMessages.length, 1);
  assert.equal(ratingMessages.length, 1);
  const delivery = parseDeliveryMessage(deliveryMessages[0]);
  const rating = parseNeedsRatingMessage(ratingMessages[0]);
  assert.equal(delivery.paymentTxid, paymentTxid);
  assert.equal(delivery.servicePinId, harness.service.currentPinId);
  assert.match(delivery.result, /bright with light wind/);
  assert.equal(rating.orderTxid, orderTxid);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller trace for inbound order');
  assert.equal(trace.order.role, 'seller');
  assert.equal(trace.order.serviceId, harness.service.currentPinId);
  assert.equal(trace.order.paymentTxid, paymentTxid);
  assert.equal(trace.order.providerSkill, harness.service.providerSkill);
  assert.equal(trace.order.orderTxid, orderTxid);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.role, 'provider');
  assert.equal(orderSession.paymentTxid, paymentTxid);
  assert.equal(orderSession.servicePinId, harness.service.currentPinId);
});

test('inbound provider ORDER without payment metadata does not execute or deliver', async (t) => {
  const harness = await createInboundProviderOrderHarness(t);
  const orderTxid = 'c'.repeat(64);
  const content = harness.makeOrderContent({ paymentTxid: '' }).replace(/\ntxid:\s*[^\n]+/i, '');

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'order_payment_unverified');
  assert.equal(harness.llmCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);
});

test('inbound provider ORDER with mismatched payment terms does not execute or deliver', async (t) => {
  const orderTxid = 'd'.repeat(64);
  const paymentTxid = 'e'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });
  const content = harness.makeOrderContent({ paymentTxid })
    .replace(/支付金额\s+0\.00001\s+SPACE/u, '支付金额 0.00002 SPACE');

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'order_payment_unverified');
  assert.equal(harness.llmCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);
});

test('inbound provider ORDER with forged txid does not execute or deliver before chain payment verification', async (t) => {
  const orderTxid = '1'.repeat(64);
  const paymentTxid = '2'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_OTHER_ADDRESS, 1000),
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'order_payment_unverified');
  assert.deepEqual(harness.fetchRawTxCalls, [paymentTxid]);
  assert.equal(harness.llmCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);
});

test('inbound provider ORDER accepts MVC payment when raw tx lookup falls back to provider UTXO evidence', async (t) => {
  const orderTxid = '4'.repeat(64);
  const paymentTxid = '5'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    paymentUtxos: [{
      txId: paymentTxid,
      outputIndex: 0,
      satoshis: 1000,
      address: MVC_PAYMENT_ADDRESS,
      height: -1,
    }],
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.delivered, true);
  assert.deepEqual(harness.fetchRawTxCalls, [paymentTxid]);
  assert.deepEqual(harness.fetchUtxosCalls, [MVC_PAYMENT_ADDRESS]);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.filter((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)).length, 1);
  assert.equal(contents.filter((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)).length, 1);
});

test('inbound provider ORDER without payment chain metadata does not execute or fetch payment tx', async (t) => {
  const orderTxid = '7'.repeat(64);
  const paymentTxid = '1'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });
  const content = harness.makeOrderContent({ paymentTxid })
    .replace(/\npayment chain:\s*[^\n]+/i, '');

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'order_payment_unverified');
  assert.deepEqual(harness.fetchRawTxCalls, []);
  assert.equal(harness.llmCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);
});

test('inbound provider ORDER persists manual-action state when buyer chat public key is missing', async (t) => {
  const orderTxid = '3'.repeat(64);
  const paymentTxid = '4'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    peerChatPublicKeys: {
      idq1caller: '',
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'peer_chat_public_key_missing');
  assert.equal(harness.llmCalls.length, 0);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/simplemsg'), false);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: null,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.equal(orderSession.endReason, 'peer_chat_public_key_missing');

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller failure trace when buyer chat public key is missing');
  assert.equal(trace.order.paymentTxid, paymentTxid);
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
});

test('inbound provider ORDER persists manual-action state when buyer chat public key lookup throws', async (t) => {
  const orderTxid = '5'.repeat(64);
  const paymentTxid = '6'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    fetchPeerChatPublicKey: async () => {
      throw new Error('simulated chat key lookup failure');
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'peer_chat_public_key_missing');
  assert.equal(harness.llmCalls.length, 0);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: null,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.match(orderSession.failureReason, /simulated chat key lookup failure/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller failure trace when buyer chat key lookup throws');
  assert.equal(trace.order.paymentTxid, paymentTxid);
});

test('inbound provider ORDER rejects same payment replayed with a different order txid', async (t) => {
  const firstOrderTxid = '8'.repeat(64);
  const replayOrderTxid = '9'.repeat(64);
  const paymentTxid = '0'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${firstOrderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const replay = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${replayOrderTxid}i0`,
    timestamp: 1_775_000_002_000,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.orderTxid, firstOrderTxid);
  assert.equal(replay.data.paymentTxid, paymentTxid);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.filter((entry) => entry.startsWith(`[DELIVERY:${firstOrderTxid}]`)).length, 1);
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${replayOrderTxid}]`)), false);
});

test('inbound provider ORDER dedupes replay from seller trace when local conversation persistence fails', async (t) => {
  const firstOrderTxid = '2'.repeat(64);
  const replayOrderTxid = '3'.repeat(64);
  const paymentTxid = '4'.repeat(64);
  const persistenceCalls = [];
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    a2aConversationPersister: async (input) => {
      persistenceCalls.push(input);
      throw new Error('simulated provider A2A store failure');
    },
  });

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${firstOrderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const replay = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${replayOrderTxid}i0`,
    timestamp: 1_775_000_002_000,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.orderTxid, firstOrderTxid);
  assert.equal(replay.data.paymentTxid, paymentTxid);
  assert.equal(harness.llmCalls.length, 1);
  assert.ok(persistenceCalls.length >= 1);

  const state = await harness.runtimeStateStore.readState();
  const traces = state.traces.filter((entry) => entry.order?.paymentTxid === paymentTxid);
  assert.equal(traces.length, 1);
});

test('inbound provider ORDER dedupes cross-buyer same-payment replay from seller trace when local conversation persistence fails', async (t) => {
  const firstOrderTxid = '6'.repeat(64);
  const replayOrderTxid = '7'.repeat(64);
  const paymentTxid = '8'.repeat(64);
  const secondBuyerPair = createIdentityPair();
  const secondBuyerGlobalMetaId = 'idq1buyer2';
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    peerChatPublicKeys: {
      [secondBuyerGlobalMetaId]: secondBuyerPair.publicKeyHex,
    },
    a2aConversationPersister: async () => {
      throw new Error('simulated provider A2A store failure');
    },
  });

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${firstOrderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const replay = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: secondBuyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${replayOrderTxid}i0`,
    timestamp: 1_775_000_002_000,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.orderTxid, firstOrderTxid);
  assert.equal(replay.data.paymentTxid, paymentTxid);
  assert.equal(harness.llmCalls.length, 1);

  const state = await harness.runtimeStateStore.readState();
  const traces = state.traces.filter((entry) => entry.order?.paymentTxid === paymentTxid);
  assert.equal(traces.length, 1);
});

test('inbound provider ORDER rejects same payment replayed by a different buyer', async (t) => {
  const firstOrderTxid = 'b'.repeat(64);
  const replayOrderTxid = 'c'.repeat(64);
  const paymentTxid = 'd'.repeat(64);
  const secondBuyerPair = createIdentityPair();
  const secondBuyerGlobalMetaId = 'idq1buyer2';
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    peerChatPublicKeys: {
      [secondBuyerGlobalMetaId]: secondBuyerPair.publicKeyHex,
    },
  });

  const first = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${firstOrderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });
  const replay = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: secondBuyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${replayOrderTxid}i0`,
    timestamp: 1_775_000_002_000,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.orderTxid, firstOrderTxid);
  assert.equal(replay.data.paymentTxid, paymentTxid);
  assert.equal(harness.llmCalls.length, 1);
  const secondBuyerConversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: secondBuyerGlobalMetaId,
      chatPublicKey: secondBuyerPair.publicKeyHex,
    },
  }).readConversation();
  assert.equal(secondBuyerConversation.sessions.filter((entry) => entry.type === 'service_order').length, 0);
});

test('concurrent inbound provider ORDER replay with same payment and different order txid does not execute twice', async (t) => {
  const firstOrderTxid = '7'.repeat(64);
  const replayOrderTxid = 'a'.repeat(64);
  const paymentTxid = '3'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    llmDelayMs: 50,
  });

  const [first, replay] = await Promise.all([
    harness.handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: harness.buyerGlobalMetaId,
      content: harness.makeOrderContent({ paymentTxid }),
      messagePinId: `${firstOrderTxid}i0`,
      timestamp: 1_775_000_001_000,
    }),
    harness.handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: harness.buyerGlobalMetaId,
      content: harness.makeOrderContent({ paymentTxid }),
      messagePinId: `${replayOrderTxid}i0`,
      timestamp: 1_775_000_002_000,
    }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.paymentTxid, paymentTxid);
  assert.equal(harness.llmCalls.length, 1);
  assert.deepEqual(harness.fetchRawTxCalls, [paymentTxid]);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  const deliveryCount = contents.filter((entry) => (
    entry.startsWith(`[DELIVERY:${firstOrderTxid}]`)
    || entry.startsWith(`[DELIVERY:${replayOrderTxid}]`)
  )).length;
  const ratingCount = contents.filter((entry) => (
    entry.startsWith(`[NeedsRating:${firstOrderTxid}]`)
    || entry.startsWith(`[NeedsRating:${replayOrderTxid}]`)
  )).length;
  assert.equal(deliveryCount, 1);
  assert.equal(ratingCount, 1);
});

test('inbound provider ORDER execution failure marks seller order failed without delivery or rating', async (t) => {
  const orderTxid = '3'.repeat(64);
  const paymentTxid = '4'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    llmSession: (sessionId) => ({
      sessionId,
      status: 'failed',
      error: 'runtime refused the request',
    }),
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_execution_failed');
  assert.equal(harness.llmCalls.length, 1);

  const simplemsgContents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(simplemsgContents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), false);
  assert.equal(simplemsgContents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);
  assert.equal(simplemsgContents.some((entry) => entry.startsWith(`[ORDER_END:${orderTxid} failed]`)), true);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.match(orderSession.failureReason, /runtime refused/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller failure trace for inbound paid order');
  assert.equal(trace.order.role, 'seller');
  assert.equal(trace.order.paymentTxid, paymentTxid);
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
});

test('inbound provider ORDER marks failed when acknowledgement send fails before execution', async (t) => {
  const orderTxid = '4'.repeat(64);
  const paymentTxid = '5'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    writePinHook: async (_input, writes) => {
      if (writes.filter((entry) => entry.path === '/protocols/simplemsg').length === 0) {
        throw new Error('simulated acknowledgement write failure');
      }
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_acknowledgement_failed');
  assert.equal(harness.llmCalls.length, 0);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.match(orderSession.failureReason, /simulated acknowledgement write failure/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller failure trace for acknowledgement failure');
  assert.equal(trace.order.paymentTxid, paymentTxid);
});

test('inbound provider ORDER persists failed state when terminal failure notice send fails', async (t) => {
  const orderTxid = '6'.repeat(64);
  const paymentTxid = '7'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    llmSession: (sessionId) => ({
      sessionId,
      status: 'failed',
      error: 'runtime refused the request',
    }),
    writePinHook: async (_input, writes) => {
      if (writes.filter((entry) => entry.path === '/protocols/simplemsg').length === 1) {
        throw new Error('simulated order end write failure');
      }
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_execution_failed');
  assert.equal(harness.llmCalls.length, 1);

  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[ORDER_STATUS:${orderTxid}]`)), true);
  assert.equal(contents.some((entry) => entry.startsWith(`[ORDER_END:${orderTxid} failed]`)), false);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.match(orderSession.failureReason, /runtime refused/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller failure trace even when ORDER_END write fails');
  assert.equal(trace.order.paymentTxid, paymentTxid);
});

test('inbound provider ORDER marks failed when delivery send fails after acknowledgement', async (t) => {
  const orderTxid = '7'.repeat(64);
  const paymentTxid = 'a'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    writePinHook: async (_input, writes) => {
      if (writes.filter((entry) => entry.path === '/protocols/simplemsg').length === 1) {
        throw new Error('simulated delivery write failure');
      }
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_delivery_failed');
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[ORDER_STATUS:${orderTxid}]`)), true);
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), false);
  assert.equal(contents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'failed');
  assert.match(orderSession.failureReason, /simulated delivery write failure/i);
});

test('inbound provider ORDER remains delivered when only rating request send fails', async (t) => {
  const orderTxid = 'e'.repeat(64);
  const paymentTxid = 'f'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    writePinHook: async (_input, writes) => {
      if (writes.filter((entry) => entry.path === '/protocols/simplemsg').length === 2) {
        throw new Error('simulated rating write failure');
      }
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.delivered, true);
  assert.equal(result.data.ratingMessagePinId, null);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), true);
  assert.equal(contents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: harness.buyerGlobalMetaId,
      chatPublicKey: harness.buyerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'completed');
  assert.ok(orderSession.deliveredAt);
  assert.equal(orderSession.ratingRequestedAt, null);
  assert.equal(orderSession.failureReason, null);

  const sessionState = await createSessionStateStore(harness.homeDir).readState();
  assert.equal(sessionState.transcriptItems.some((item) => item.type === 'needs_rating'), false);
});

test('concurrent duplicate inbound provider ORDER sends only one delivery and rating request', async (t) => {
  const orderTxid = '5'.repeat(64);
  const paymentTxid = '6'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    llmDelayMs: 50,
  });
  const order = {
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  };

  const [first, second] = await Promise.all([
    harness.handlers.services.handleInboundOrderProtocolMessage(order),
    harness.handlers.services.handleInboundOrderProtocolMessage(order),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(harness.llmCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.filter((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)).length, 1);
  assert.equal(contents.filter((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)).length, 1);
});

test('simplemsg inbound dispatcher does not route ORDER messages to generic auto reply', async () => {
  const calls = [];
  const dispatcher = buildA2ASimplemsgInboundDispatcher({
    handleOrderProtocolMessage: async (message) => {
      calls.push(['order', message.content]);
      return { ok: false, code: 'order_payment_unverified', message: 'unverified' };
    },
    handleGenericPrivateChatMessage: async (message) => {
      calls.push(['generic', message.content]);
    },
    logWarning: () => {},
  });

  await dispatcher({
    fromGlobalMetaId: 'idq1buyer',
    content: '[ORDER] forged paid order',
    messagePinId: `${'7'.repeat(64)}i0`,
    timestamp: 1_775_000_001_000,
  });
  await dispatcher({
    fromGlobalMetaId: 'idq1buyer',
    content: 'ordinary hello',
    messagePinId: 'ordinary-pin-1',
    timestamp: 1_775_000_001_001,
  });

  assert.deepEqual(calls, [
    ['order', '[ORDER] forged paid order'],
    ['order', 'ordinary hello'],
    ['generic', 'ordinary hello'],
  ]);
});
