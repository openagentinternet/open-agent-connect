import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

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
const { createRatingDetailStateStore } = require('../../dist/core/ratings/ratingDetailState.js');
const {
  SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON,
  SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON,
} = require('../../dist/core/orders/orderLifecycle.js');
const { parseDeliveryMessage, parseNeedsRatingMessage } = require('../../dist/core/a2a/protocol/orderProtocol.js');
const { buildA2ASimplemsgInboundDispatcher } = require('../../dist/cli/runtime.js');
const { upsertIdentityProfile, setActiveMetabotHome } = require('../../dist/core/identity/identityProfiles.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');

const MVC_PAYMENT_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const MVC_OTHER_ADDRESS = '1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp';
const IMAGE_REPLY_ARTIFACT = {
  uri: 'metafile://buyer-image-pin.png',
  pinId: 'buyer-image-pin',
  kind: 'image',
  fileName: 'buyer-image.png',
  extension: '.png',
  contentType: 'image/png',
  byteLength: 512,
  sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/buyer-image-pin',
  fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/buyer-image-pin',
  downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/buyer-image-pin',
};

async function waitForCondition(predicate, timeoutMs = 1000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value;
    try {
      value = await predicate();
    } catch (error) {
      if (error instanceof SyntaxError) {
        await delay(intervalMs);
        continue;
      }
      throw error;
    }
    if (value) {
      return value;
    }
    await delay(intervalMs);
  }
  return null;
}

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
  const providerSkill = overrides.providerSkill ?? 'metabot-weather-oracle';
  return {
    id: overrides.currentPinId ?? 'chain-service-pin-1',
    sourceServicePinId: overrides.currentPinId ?? 'chain-service-pin-1',
    currentPinId: overrides.currentPinId ?? 'chain-service-pin-1',
    creatorMetabotId: 2,
    providerGlobalMetaId: overrides.providerGlobalMetaId ?? 'idq1provider',
    providerSkill,
    providerSkills: Array.isArray(overrides.providerSkills) && overrides.providerSkills.length > 0
      ? overrides.providerSkills
      : [providerSkill],
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather.',
    executionReminder: overrides.executionReminder ?? '',
    serviceIcon: null,
    price: overrides.price ?? '0.00001',
    currency: overrides.currency ?? 'SPACE',
    skillDocument: '# Weather Oracle',
    inputType: 'text',
    outputType: overrides.outputType ?? 'text',
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
  const skillNames = Array.isArray(skillName) && skillName.length > 0 ? skillName : [skillName];
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
  for (const name of skillNames) {
    await mkdir(path.join(homeDir, '.codex', 'skills', name), { recursive: true });
    await writeFile(path.join(homeDir, '.codex', 'skills', name, 'SKILL.md'), `# ${name}\n`, 'utf8');
  }
}

async function writeProviderOutputFile(homeDir, fileName, contents = 'provider artifact bytes') {
  const outputDir = path.join(homeDir, 'provider-output');
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, contents);
  return {
    outputDir: await realpath(outputDir),
    filePath: await realpath(filePath),
  };
}

function createAttemptOutputController(fileName, contents = 'provider artifact bytes') {
  let outputDir = '';
  let filePath = '';
  return {
    get outputDir() {
      return outputDir;
    },
    get filePath() {
      return filePath;
    },
    async write(request) {
      const fixture = await writeProviderOutputFile(request.cwd, fileName, contents);
      outputDir = fixture.outputDir;
      filePath = fixture.filePath;
    },
    sessionCwd() {
      return outputDir;
    },
    outputText(prefix) {
      return `${prefix}\nartifactPath: ${path.basename(filePath)}`;
    },
  };
}

function createProviderArtifactUploadMock(uploadCalls = []) {
  return async (input) => {
    uploadCalls.push(input);
    const extension = path.extname(input.filePath).toLowerCase();
    const fileName = path.basename(input.filePath);
    const pinId = `provider-artifact-${uploadCalls.length}${extension}`;
    return {
      pinId: `provider-artifact-${uploadCalls.length}`,
      txids: [`provider-artifact-upload-tx-${uploadCalls.length}`],
      totalCost: 1,
      network: input.network,
      filePath: input.filePath,
      fileName,
      contentType: input.contentType,
      bytes: 24,
      extension,
      metafileUri: `metafile://${pinId}`,
      previewUrl: `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/provider-artifact-${uploadCalls.length}`,
      downloadUrl: `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/provider-artifact-${uploadCalls.length}`,
      globalMetaId: 'idq1provider',
      uploadMode: 'direct',
      verification: {
        ok: true,
        url: `https://file.metaid.io/metafile-indexer/api/v1/files/content/provider-artifact-${uploadCalls.length}`,
        attempts: 1,
      },
    };
  };
}

function assertNoProviderLocalPathLeak(value, localPath) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(serialized.includes(localPath), false, `expected no provider local path leak: ${localPath}`);
}

async function assertProviderSessionNotCompleted(homeDir, traceId) {
  const sessionState = await createSessionStateStore(homeDir).readState();
  const sessions = sessionState.sessions.filter((entry) => entry.traceId === traceId);
  assert.ok(sessions.length > 0, `expected session state for ${traceId}`);
  const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
  const taskRuns = sessionState.taskRuns.filter((entry) => sessionIds.has(entry.sessionId));
  const taskRunIds = new Set(taskRuns.map((entry) => entry.runId));

  assert.equal(sessions.some((entry) => entry.state === 'completed'), false);
  assert.equal(taskRuns.some((entry) => entry.state === 'completed'), false);
  assert.equal(sessionState.publicStatusSnapshots.some((entry) => (
    sessionIds.has(entry.sessionId)
    && (entry.status === 'completed' || entry.rawEvent === 'provider_completed')
  )), false);
  assert.equal(sessionState.transcriptItems.some((entry) => (
    sessionIds.has(entry.sessionId)
    && (!entry.taskRunId || taskRunIds.has(entry.taskRunId))
    && (
      entry.metadata?.event === 'provider_completed'
      || entry.metadata?.publicStatus === 'completed'
    )
  )), false);
}

async function assertProviderSessionCompleted(homeDir, traceId) {
  const sessionState = await createSessionStateStore(homeDir).readState();
  const session = sessionState.sessions.find((entry) => entry.traceId === traceId);
  assert.ok(session, `expected completed session state for ${traceId}`);
  assert.equal(session.state, 'completed');
  const taskRun = sessionState.taskRuns.find((entry) => entry.runId === session.currentTaskRunId);
  assert.ok(taskRun, `expected completed task run for ${traceId}`);
  assert.equal(taskRun.state, 'completed');
  assert.equal(sessionState.publicStatusSnapshots.some((entry) => (
    entry.sessionId === session.sessionId
    && entry.taskRunId === taskRun.runId
    && entry.status === 'completed'
    && entry.rawEvent === 'provider_completed'
  )), true);
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
  await prepareProviderRuntimeSkill(homeDir, service.providerSkills);

  const writes = [];
  const llmCalls = [];
  const rawTxs = new Map(Object.entries(options.rawTxs ?? {}));
  const paymentUtxos = options.paymentUtxos ?? [];
  const fetchRawTxCalls = [];
  const fetchUtxosCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir: options.systemHomeDir ?? deriveSystemHome(homeDir),
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
        if (options.llmExecuteHook) {
          await options.llmExecuteHook(request, { llmCalls });
        }
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
          cwd: typeof options.llmSessionCwd === 'function'
            ? options.llmSessionCwd({ sessionId, llmCalls })
            : options.llmSessionCwd ?? null,
          status: 'completed',
          result: {
            status: 'completed',
            output: typeof options.llmOutput === 'function'
              ? options.llmOutput({ sessionId, llmCalls })
              : options.llmOutput ?? 'Tomorrow weather: bright with light wind.',
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
    providerOrderReplyRunner: options.providerOrderReplyRunner,
    providerOrderTextGenerator: options.providerOrderTextGenerator,
    providerArtifactUploadLargeFile: options.providerArtifactUploadLargeFile,
    providerLargeFileUploader: options.providerLargeFileUploader,
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
    systemHomeDir: options.systemHomeDir ?? deriveSystemHome(homeDir),
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
    adapters: options.adapters,
    createSignerForHome: options.createSignerForHome,
    fetchPeerChatPublicKey: options.fetchPeerChatPublicKey ?? (async () => providerPair.publicKeyHex),
    ratingFollowupRetryDelaysMs: options.ratingFollowupRetryDelaysMs,
    buyerRatingReplyRunner: options.buyerRatingReplyRunner,
    buyerRatingTextGenerator: options.buyerRatingTextGenerator,
    callerOrderTextGenerator: options.callerOrderTextGenerator,
    callerReplyWaiter: options.callerReplyWaiter ?? {
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

async function seedBuyerTraceForRating(harness, overrides = {}) {
  const state = await harness.runtimeStateStore.readState();
  const orderTxid = overrides.orderTxid ?? 'order-tx-1';
  const paymentTxid = overrides.paymentTxid === undefined ? 'payment-tx-1' : overrides.paymentTxid;
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
      orderPinId: overrides.orderPinId ?? 'order-pin-1',
      orderTxid,
      orderTxids: overrides.orderTxids ?? [orderTxid],
      paymentTxid,
      orderReference: overrides.orderReference ?? null,
      paymentCurrency: 'SPACE',
      paymentAmount: overrides.paymentAmount ?? '0.00001',
      paymentChain: overrides.paymentChain ?? 'mvc',
      settlementKind: overrides.settlementKind ?? 'native',
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

test('services call --from pays with the selected profile wallet instead of the active profile executor', async (t) => {
  const transferCalls = [];
  const selectedWrites = [];
  const selectedPaymentTxid = 'c'.repeat(64);
  let selectedPair = null;
  let selectedIdentity = null;
  const adapters = new Map([
    ['mvc', {
      network: 'mvc',
      explorerBaseUrl: 'https://www.mvcscan.com',
      feeRateUnit: 'sat/byte',
      minTransferSatoshis: 600,
      async deriveAddress() { return 'mvc-selected-address'; },
      async fetchUtxos() { return []; },
      async fetchBalance() {
        return {
          chain: 'mvc',
          address: 'mvc-selected-address',
          totalSatoshis: 0,
          confirmedSatoshis: 0,
          unconfirmedSatoshis: 0,
          utxoCount: 0,
        };
      },
      async fetchFeeRate() { return 1; },
      async fetchRawTx() { return ''; },
      async broadcastTx(rawTx) {
        assert.equal(rawTx, 'selected-payment-rawtx');
        return selectedPaymentTxid;
      },
      async buildTransfer(input) {
        transferCalls.push(input);
        return { rawTx: 'selected-payment-rawtx', fee: 42 };
      },
      async buildInscription() { throw new Error('not used'); },
    }],
  ]);
  const harness = await createServiceCallHarness(t, {
    adapters,
    createSignerForHome: () => ({
      async getIdentity() {
        return selectedIdentity;
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: selectedIdentity.globalMetaId,
          chatPublicKey: selectedPair.publicKeyHex,
          privateKeyHex: selectedPair.privateKeyHex,
        };
      },
      async writePin(input) {
        selectedWrites.push(input);
        return {
          txids: [`selected-order-tx-${selectedWrites.length}`],
          pinId: `selected-order-pin-${selectedWrites.length}`,
          totalCost: 1,
          network: input.network,
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: selectedIdentity.globalMetaId,
          mvcAddress: selectedIdentity.mvcAddress,
        };
      },
    }),
    servicePaymentExecutor: {
      async execute() {
        throw new Error('active payment executor must not be used for --from buyer-bot');
      },
    },
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
  });
  const systemHomeDir = deriveSystemHome(harness.homeDir);
  const selectedHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'buyer-bot');
  selectedPair = createIdentityPair();
  selectedIdentity = {
    ...createIdentity(selectedPair.publicKeyHex),
    name: 'Buyer Bot',
    publicKey: 'buyer-public-key',
    mvcAddress: 'mvc-selected-address',
    globalMetaId: 'idq1buyer',
  };

  await mkdir(selectedHomeDir, { recursive: true });
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Active Bot',
    homeDir: harness.homeDir,
    globalMetaId: 'idq1active',
    mvcAddress: 'mvc-active-address',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Buyer Bot',
    homeDir: selectedHomeDir,
    globalMetaId: selectedIdentity.globalMetaId,
    mvcAddress: selectedIdentity.mvcAddress,
  });
  await setActiveMetabotHome({ systemHomeDir, homeDir: harness.homeDir });
  await createFileSecretStore(selectedHomeDir).writeIdentitySecrets({
    mnemonic: 'selected buyer seed phrase',
    path: "m/44'/10001'/0'/0/0",
  });
  await createRuntimeStateStore(selectedHomeDir).writeState({
    identity: selectedIdentity,
    services: [createService()],
    traces: [],
  });

  const called = await harness.handlers.services.call({
    from: 'buyer-bot',
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

  assert.equal(called.state, 'waiting', JSON.stringify(called));
  assert.equal(transferCalls.length, 1);
  assert.equal(transferCalls[0].mnemonic, 'selected buyer seed phrase');
  assert.equal(transferCalls[0].toAddress, MVC_PAYMENT_ADDRESS);
  const selectedState = await createRuntimeStateStore(selectedHomeDir).readState();
  assert.equal(selectedState.traces.at(-1).order.paymentTxid, selectedPaymentTxid);
});

test('free simplemsg service orders use skill-service-order pin id instead of a payment txid', async (t) => {
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
  assert.equal(called.data.serviceOrderPinId, '/protocols/skill-service-order-pin-1');
  assert.equal(called.data.orderReference, called.data.serviceOrderPinId);

  const serviceOrderWrite = harness.writes.find((entry) => entry.path === '/protocols/skill-service-order');
  assert.ok(serviceOrderWrite, 'expected a skill-service-order write');
  const serviceOrderPayload = JSON.parse(serviceOrderWrite.payload);
  assert.deepEqual(serviceOrderPayload, {
    servicePinId: 'chain-service-pin-1',
    paymentTxid: '',
    price: '0',
    currency: 'SPACE',
    settlementKind: 'native',
    metadata: '',
  });
  assert.equal(Object.hasOwn(serviceOrderPayload, 'orderId'), false);

  const simplemsgWrite = harness.writes.find((entry) => entry.path === '/protocols/simplemsg');
  assert.ok(simplemsgWrite, 'expected a simplemsg order write');
  const plaintext = decryptSimplemsgOrder(simplemsgWrite, harness);
  assert.match(plaintext, /^\[ORDER\]/);
  assert.match(plaintext, /\n支付金额 0 SPACE/i);
  assert.doesNotMatch(plaintext, /\ntxid:/i);
  assert.doesNotMatch(plaintext, /free-order-/i);
  assert.ok(plaintext.includes(`\norder id: ${called.data.serviceOrderPinId}`));
  assert.match(plaintext, /\nsettlement kind:\s*native/i);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.traceId === called.data.traceId);
  assert.ok(trace, 'expected caller trace to be persisted');
  assert.equal(trace.order.paymentTxid, null);
  assert.equal(trace.order.orderReference, called.data.serviceOrderPinId);
});

test('simplemsg service orders use caller-generated natural request copy', async (t) => {
  const generatedOrderText = '我来请你查一下上海明天的天气，按天气预报结果返回就好。';
  const generatorCalls = [];
  const harness = await createServiceCallHarness(t, {
    callerOrderTextGenerator: async (input) => {
      generatorCalls.push(input);
      return generatedOrderText;
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

  assert.equal(called.state, 'waiting', JSON.stringify(called));
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].userTask, 'Tell me tomorrow weather');
  assert.equal(generatorCalls[0].taskContext, 'User is in Shanghai');

  const simplemsgWrite = harness.writes.find((entry) => entry.path === '/protocols/simplemsg');
  assert.ok(simplemsgWrite, 'expected a simplemsg order write');
  const plaintext = decryptSimplemsgOrder(simplemsgWrite, harness);
  assert.match(plaintext, /^\[ORDER\] 我来请你查一下上海明天的天气，按天气预报结果返回就好/);
  assert.match(plaintext, new RegExp(`<raw_request>\\n${generatedOrderText}\\n</raw_request>`));
  assert.doesNotMatch(plaintext, /用户请求 Weather Oracle|Weather Oracle 的用户/);
  assert.equal(called.data.serviceOrderPinId, '/protocols/skill-service-order-pin-1');
  assert.equal(called.data.orderReference, called.data.serviceOrderPinId);
  const serviceOrderWrite = harness.writes.find((entry) => entry.path === '/protocols/skill-service-order');
  assert.ok(serviceOrderWrite, 'expected a skill-service-order write');
  const serviceOrderPayload = JSON.parse(serviceOrderWrite.payload);
  assert.deepEqual(serviceOrderPayload, {
    servicePinId: 'chain-service-pin-1',
    paymentTxid: 'b'.repeat(64),
    price: '0.00001',
    currency: 'SPACE',
    settlementKind: 'native',
    metadata: '',
  });
  assert.ok(plaintext.includes(`\norder id: ${called.data.serviceOrderPinId}`));
  assert.match(plaintext, /\ntxid:\s*b{64}/i);
  assert.match(plaintext, /\nservice id:\s*chain-service-pin-1/i);
  assert.match(plaintext, /\nskill name:\s*metabot-weather-oracle/i);
});

test('inbound free provider ORDER rejects replayed order reference with a different simplemsg tx', async (t) => {
  const firstMessageTxid = '1'.repeat(64);
  const replayMessageTxid = '2'.repeat(64);
  const orderReference = 'a'.repeat(64);
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
  const orderReference = 'c'.repeat(64);
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

test('free service rating uses the order reference as the service paid tx', async (t) => {
  const orderTxid = '1'.repeat(64);
  const orderReference = 'a'.repeat(64);
  const harness = await createServiceCallHarness(t);
  const sessionStateStore = await seedBuyerTraceForRating(harness, {
    orderPinId: `${orderTxid}i0`,
    orderTxid,
    orderTxids: [orderTxid],
    paymentTxid: null,
    orderReference,
    paymentAmount: '0',
  });

  const result = await harness.handlers.services.rate({
    traceId: 'trace-rating-retry',
    rate: 5,
    comment: 'Helpful free weather report.',
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.servicePaidTx, orderReference);
  assert.equal(result.data.ratingMessageSent, true);

  const ratingWrite = harness.writes.find((entry) => entry.path === '/protocols/skill-service-rate');
  assert.ok(ratingWrite, 'expected a skill-service-rate write');
  const payload = JSON.parse(ratingWrite.payload);
  assert.equal(payload.servicePaidTx, orderReference);
  assert.equal(payload.servicePrice, '0');

  const sessionState = await sessionStateStore.readState();
  const published = sessionState.transcriptItems.find(
    (item) => item.metadata?.event === 'service_rating_published',
  );
  assert.ok(published, 'expected rating transcript item');
  assert.match(published.metadata.ratingPinId, /\/protocols\/skill-service-rate-pin-/);
});

test('free service trace rating detail sync matches by order reference', async (t) => {
  const orderTxid = '3'.repeat(64);
  const orderReference = 'c'.repeat(64);
  const harness = await createServiceCallHarness(t);
  await seedBuyerTraceForRating(harness, {
    orderPinId: `${orderTxid}i0`,
    orderTxid,
    orderTxids: [orderTxid],
    paymentTxid: null,
    orderReference,
    paymentAmount: '0',
  });
  const ratingStore = createRatingDetailStateStore(harness.homeDir);
  await ratingStore.write({
    items: [
      {
        pinId: 'free-rating-pin-1',
        serviceId: 'chain-service-pin-1',
        servicePaidTx: orderReference,
        rate: 5,
        comment: 'Helpful free weather report.',
        raterGlobalMetaId: 'idq1caller',
        raterMetaId: 'metaid-caller',
        createdAt: 1_775_000_003_000,
      },
    ],
    latestPinId: 'free-rating-pin-1',
    backfillCursor: null,
    lastSyncedAt: Date.now(),
  });

  const traceResult = await harness.handlers.trace.getTrace({ traceId: 'trace-rating-retry' });

  assert.equal(traceResult.ok, true);
  assert.equal(traceResult.data.ratingPublished, true);
  assert.equal(traceResult.data.ratingPinId, 'free-rating-pin-1');
  assert.equal(traceResult.data.ratingValue, 5);
  assert.equal(traceResult.data.ratingComment, 'Helpful free weather report.');
});

test('inbound free NeedsRating auto-rates the buyer trace with the order reference', async (t) => {
  const orderTxid = '2'.repeat(64);
  const orderReference = 'b'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    buyerRatingReplyRunner: async () => ({
      state: 'reply',
      content: '评分：5分。免费天气结果清楚完整。',
    }),
  });
  await seedBuyerTraceForRating(harness, {
    orderPinId: `${orderTxid}i0`,
    orderTxid,
    orderTxids: [orderTxid],
    paymentTxid: null,
    orderReference,
    paymentAmount: '0',
  });

  const handled = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: 'idq1provider',
    content: `[NeedsRating:${orderTxid}] Please rate this free service.`,
    messagePinId: 'free-needs-rating-pin',
    timestamp: 1_775_000_003_000,
  });

  assert.equal(handled.ok, true, JSON.stringify(handled));
  assert.equal(handled.data.rated, true);

  const ratingWrite = harness.writes.find((entry) => entry.path === '/protocols/skill-service-rate');
  assert.ok(ratingWrite, 'expected an auto-published skill-service-rate write');
  const payload = JSON.parse(ratingWrite.payload);
  assert.equal(payload.servicePaidTx, orderReference);

  const traceResult = await harness.handlers.trace.getTrace({ traceId: 'trace-rating-retry' });
  assert.equal(traceResult.ok, true);
  assert.equal(traceResult.data.ratingPublished, true);
  assert.equal(traceResult.data.ratingValue, 5);
  assert.equal(traceResult.data.ratingComment, '评分：5分。免费天气结果清楚完整。');
  assert.equal(traceResult.data.ratingMessageSent, true);

  const ratingMessageWrite = harness.writes.find((entry) => entry.path === '/protocols/simplemsg');
  assert.ok(ratingMessageWrite, 'expected an ORDER_END rating follow-up write');
  const ratingMessage = decryptSimplemsgOrder(ratingMessageWrite, harness);
  assert.equal(ratingMessage, `[ORDER_END:${orderTxid} rated] 评分：5分。免费天气结果清楚完整。`);
  assert.doesNotMatch(ratingMessage, /我的评分已记录在链上/);
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
    'write:/protocols/skill-service-order',
    'write:/protocols/simplemsg',
  ]);
});

test('paid simplemsg service payment retries after MVC missing-input stale funding rejection', async (t) => {
  let paymentAttempts = 0;
  const harness = await createServiceCallHarness(t, {
    servicePaymentExecutor: {
      async execute(input) {
        paymentAttempts += 1;
        harness.events.push(`payment_attempt_${paymentAttempts}`);
        if (paymentAttempts === 1) {
          throw new Error('[-26] missing inputs');
        }
        return {
          paymentTxid: 'e'.repeat(64),
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
  assert.equal(paymentAttempts, 2);
  assert.deepEqual(harness.events, [
    'payment_attempt_1',
    'payment_attempt_2',
    'write:/protocols/skill-service-order',
    'write:/protocols/simplemsg',
  ]);
});

test('paid simplemsg order write retries after MVC missingorspent stale funding rejection', async (t) => {
  let orderAttempts = 0;
  const harness = await createServiceCallHarness(t, {
    writePin(input, { writes, identity }) {
      if (input.path === '/protocols/simplemsg') {
        orderAttempts += 1;
        if (orderAttempts === 1) {
          throw new Error('mandatory-script-verify-flag-failed (Inputs missing/spent)');
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
  assert.equal(orderAttempts, 2);
  assert.equal(harness.writes.filter((entry) => entry.path === '/protocols/simplemsg').length, 2);
});

test('buyer-side timeout creates a service refund request for paid simplemsg orders', async (t) => {
  const paymentTxid = '1'.repeat(64);
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
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

  const refundWrite = await waitForCondition(() => (
    harness.writes.find((entry) => entry.path === '/protocols/service-refund-request') ?? null
  ));
  assert.ok(refundWrite, 'expected timeout to publish a refund request pin');
  const payload = JSON.parse(refundWrite.payload);
  assert.equal(payload.paymentTxid, paymentTxid);
  assert.equal(payload.servicePinId, 'chain-service-pin-1');
  assert.equal(payload.serviceName, 'Weather Oracle');
  assert.equal(payload.refundAmount, '0.00001');
  assert.equal(payload.refundCurrency, 'SPACE');
  assert.equal(payload.paymentChain, 'mvc');
  assert.equal(payload.settlementKind, 'native');
  assert.equal(payload.buyerGlobalMetaId, harness.identity.globalMetaId);
  assert.equal(payload.sellerGlobalMetaId, 'idq1provider');
  assert.equal(payload.failureReason, 'delivery_timeout');
  assert.equal(Number.isFinite(Number(payload.failureDetectedAt)), true);
  assert.ok(Array.isArray(payload.evidencePinIds));
  assert.ok(payload.evidencePinIds.includes(called.data.orderPinId));

  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.order?.status === 'refund_pending'
      && entry.order?.failureReason === 'delivery_timeout'
      && entry.order?.refundRequestPinId
    )) ?? null;
  });
  assert.ok(trace, 'expected caller trace for timed-out paid order');
  assert.equal(trace.order.status, 'refund_pending');
  assert.match(trace.order.refundRequestPinId, /^\/protocols\/service-refund-request-pin-/);
  assert.equal(trace.order.failureReason, 'delivery_timeout');
});

test('buyer-side timeout does not duplicate refund requests for the same paid payment', async (t) => {
  const paymentTxid = '2'.repeat(64);
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
  });

  const first = await harness.handlers.services.call({
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
  const second = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather again',
      taskContext: 'User is still in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(first.state, 'waiting');
  assert.equal(second.state, 'waiting');
  await waitForCondition(() => (
    harness.writes.filter((entry) => entry.path === '/protocols/service-refund-request').length > 0
  ));
  await delay(50);
  const refundWrites = harness.writes.filter((entry) => entry.path === '/protocols/service-refund-request');
  assert.equal(refundWrites.length, 1);
});

test('buyer-side timeout marks zero-price service orders refunded without a chain refund request', async (t) => {
  const harness = await createServiceCallHarness(t, {
    service: { price: '0', currency: 'SPACE' },
    servicePaymentExecutor: {
      async execute() {
        throw new Error('payment executor must not run for free services');
      },
    },
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
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

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => entry.traceId === called.data.traceId && entry.order?.status === 'refunded') ?? null;
  });
  assert.ok(trace, 'expected free timed-out order to be resolved locally');
  assert.equal(trace.order.failureReason, SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);
});

test('buyer-side timeout resolves self-directed paid orders without an external refund request', async (t) => {
  const paymentTxid = '3'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: { providerGlobalMetaId: 'idq1caller' },
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: harness.identity.globalMetaId,
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => entry.traceId === called.data.traceId && entry.order?.status === 'refunded') ?? null;
  });
  assert.ok(trace, 'expected self-directed timed-out order to be resolved locally');
  assert.equal(trace.order.failureReason, SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON);
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);
});

test('buyer-side refund request write failure leaves a retry marker for paid timeout', async (t) => {
  const paymentTxid = '4'.repeat(64);
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
    writePin(input, { writes }) {
      if (input.path === '/protocols/service-refund-request') {
        throw new Error('simulated refund request outage');
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
        globalMetaId: harness.identity.globalMetaId,
        mvcAddress: harness.identity.mvcAddress,
      };
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

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.order?.status === 'failed'
      && Number.isFinite(Number(entry.order?.nextRetryAt))
    )) ?? null;
  });
  assert.ok(trace, 'expected retryable refund marker after refund request write failure');
  assert.equal(trace.order.refundRequestPinId, null);
  assert.equal(trace.order.failureReason, 'delivery_timeout');
  assert.equal(trace.order.refundApplyRetryCount, 1);
});

test('buyer-side non-text deliverable accepts artifact-only structured replies and preserves trace metadata', async (t) => {
  const paymentTxid = '5'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: { outputType: 'image' },
    writePin(input, { writes, identity }) {
      if (input.path === '/protocols/skill-service-rate') {
        throw new Error('simulated rating publish outage');
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return {
          state: 'completed',
          responseText: '',
          artifacts: [IMAGE_REPLY_ARTIFACT],
          deliveryPinId: 'delivery-pin-with-structured-artifact',
          observedAt: 1_775_000_010_000,
          rawMessage: {
            pinId: 'delivery-pin-with-structured-artifact',
            txId: 'delivery-tx-with-structured-artifact',
            timestamp: 1_775_000_010_000,
          },
          ratingRequestText: 'Please rate this completed weather image.',
          ratingRequestPinId: 'rating-pin-with-structured-artifact',
          ratingRequestObservedAt: 1_775_000_010_250,
          ratingRawMessage: {
            pinId: 'rating-pin-with-structured-artifact',
            txId: 'rating-tx-with-structured-artifact',
            timestamp: 1_775_000_010_250,
          },
        };
      },
    },
    buyerRatingTextGenerator: async () => 'Rating: 5/5. The weather image satisfied the request.',
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Create a weather image',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.a2a?.taskRunState === 'completed'
    )) ?? null;
  });
  assert.ok(trace, 'expected structured artifact delivery to complete');
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);

  const sessionStore = createSessionStateStore(harness.homeDir);
  const sessionState = await sessionStore.readState();
  const deliveryItem = sessionState.transcriptItems.find((item) => item.id === `${trace.traceId}-provider-delivery`);
  assert.ok(deliveryItem);
  assert.equal(deliveryItem.content, '');
  assert.deepEqual(deliveryItem.artifacts.map((artifact) => artifact.uri), [
    'metafile://buyer-image-pin.png',
  ]);
  assert.deepEqual(deliveryItem.metadata.deliveryArtifacts.map((artifact) => artifact.uri), [
    'metafile://buyer-image-pin.png',
  ]);

  const traceResult = await harness.handlers.trace.getTrace({ traceId: trace.traceId });
  assert.equal(traceResult.ok, true);
  const projectedDelivery = traceResult.data.inspector.transcriptItems.find((item) => item.id === `${trace.traceId}-provider-delivery`);
  assert.ok(projectedDelivery);
  assert.equal(projectedDelivery.content, '');
  assert.deepEqual(projectedDelivery.artifacts.map((artifact) => artifact.uri), [
    'metafile://buyer-image-pin.png',
  ]);
  assert.deepEqual(projectedDelivery.metadata.deliveryArtifacts.map((artifact) => artifact.uri), [
    'metafile://buyer-image-pin.png',
  ]);

  const conversation = await createA2AConversationStore({
    homeDir: harness.homeDir,
    local: {
      globalMetaId: harness.identity.globalMetaId,
      name: harness.identity.name,
      chatPublicKey: harness.identity.chatPublicKey,
    },
    peer: {
      globalMetaId: 'idq1provider',
      name: 'Weather Oracle',
      chatPublicKey: harness.providerPair.publicKeyHex,
    },
  }).readConversation();
  const orderSession = conversation.sessions.find((entry) => entry.sessionId === `a2a-order-${trace.order.orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.type, 'service_order');
  assert.equal(orderSession.role, 'caller');
  assert.equal(orderSession.state, 'rating_pending');
  assert.equal(orderSession.paymentTxid, paymentTxid);
  assert.equal(orderSession.servicePinId, 'chain-service-pin-1');
  assert.equal(orderSession.serviceName, 'Weather Oracle');
  assert.equal(orderSession.outputType, 'image');
  assert.equal(orderSession.deliveredAt, 1_775_000_010_000);
  assert.equal(orderSession.ratingRequestedAt, 1_775_000_010_250);

  const persistedDelivery = conversation.messages.find((entry) => (
    entry.orderTxid === trace.order.orderTxid
    && entry.direction === 'incoming'
    && entry.protocolTag === 'DELIVERY'
  ));
  assert.ok(persistedDelivery, 'expected caller-side DELIVERY in unified A2A store');
  assert.equal(persistedDelivery.pinId, 'delivery-pin-with-structured-artifact');
  assert.equal(persistedDelivery.txid, 'delivery-tx-with-structured-artifact');
  assert.equal(persistedDelivery.paymentTxid, paymentTxid);
  assert.deepEqual(persistedDelivery.artifacts.map((artifact) => [artifact.uri, artifact.kind]), [
    ['metafile://buyer-image-pin.png', 'image'],
  ]);

  const persistedNeedsRating = conversation.messages.find((entry) => (
    entry.orderTxid === trace.order.orderTxid
    && entry.direction === 'incoming'
    && entry.protocolTag === 'NeedsRating'
  ));
  assert.ok(persistedNeedsRating, 'expected caller-side NeedsRating in unified A2A store');
  assert.equal(persistedNeedsRating.messageId, 'rating-pin-with-structured-artifact');
  assert.equal(persistedNeedsRating.pinId, 'rating-pin-with-structured-artifact');
  assert.equal(persistedNeedsRating.txid, 'rating-tx-with-structured-artifact');
  assert.deepEqual(persistedNeedsRating.txids, ['rating-tx-with-structured-artifact']);
  assert.equal(persistedNeedsRating.replyPinId, 'delivery-pin-with-structured-artifact');
  assert.equal(persistedNeedsRating.timestamp, 1_775_000_010_250);
  assert.equal(persistedNeedsRating.raw.synthetic, undefined);
  assert.equal(persistedNeedsRating.content.includes('Please rate this completed weather image.'), true);

  await upsertIdentityProfile({
    systemHomeDir: deriveSystemHome(harness.homeDir),
    name: harness.identity.name,
    homeDir: harness.homeDir,
    globalMetaId: harness.identity.globalMetaId,
    mvcAddress: harness.identity.mvcAddress,
  });
  const unifiedSession = await harness.handlers.trace.getSession({ sessionId: orderSession.sessionId });
  assert.equal(unifiedSession.ok, true);
  const unifiedDelivery = unifiedSession.data.inspector.transcriptItems.find((item) => item.type === 'delivery');
  assert.ok(unifiedDelivery, 'expected unified projection delivery item');
  assert.deepEqual(unifiedDelivery.artifacts.map((artifact) => [artifact.uri, artifact.kind]), [
    ['metafile://buyer-image-pin.png', 'image'],
  ]);
});

test('buyer-side completed reply ignores unified persistence failures and still auto-rates', async (t) => {
  const paymentTxid = 'e'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: { outputType: 'image' },
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return {
          state: 'completed',
          responseText: '',
          artifacts: [IMAGE_REPLY_ARTIFACT],
          deliveryPinId: 'delivery-pin-with-persister-failure',
          observedAt: 1_775_000_011_000,
          rawMessage: {
            pinId: 'delivery-pin-with-persister-failure',
            txId: 'delivery-tx-with-persister-failure',
            timestamp: 1_775_000_011_000,
          },
          ratingRequestText: 'Please rate this completed weather image.',
          ratingRequestPinId: 'rating-pin-with-persister-failure',
          ratingRequestObservedAt: 1_775_000_011_250,
          ratingRawMessage: {
            pinId: 'rating-pin-with-persister-failure',
            txId: 'rating-tx-with-persister-failure',
            timestamp: 1_775_000_011_250,
          },
        };
      },
    },
    buyerRatingTextGenerator: async () => 'Rating: 5/5. The weather image satisfied the request.',
    a2aConversationPersister: async () => {
      throw new Error('simulated unified store outage');
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Create a weather image',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.a2a?.taskRunState === 'completed'
    )) ?? null;
  });
  assert.ok(trace, 'expected caller reply completion despite unified persistence failure');
  const ratingWrite = await waitForCondition(() => (
    harness.writes.find((entry) => entry.path === '/protocols/skill-service-rate') ?? null
  ));
  assert.ok(ratingWrite, 'expected completed reply to publish an auto-rating pin');
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);
});

test('buyer-side non-text deliverable accepts fallback metafile references', async (t) => {
  const paymentTxid = '6'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: { outputType: 'image' },
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return {
          state: 'completed',
          responseText: 'Image generation finished successfully: metafile://fallback-buyer-image.png',
          artifacts: [],
          deliveryPinId: 'delivery-pin-with-fallback-artifact',
          observedAt: Date.now(),
          rawMessage: null,
          ratingRequestText: null,
        };
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Create a weather image',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.a2a?.taskRunState === 'completed'
    )) ?? null;
  });
  assert.ok(trace, 'expected fallback metafile delivery to complete');
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);
});

test('buyer-side non-text deliverable rejects http-only media references for paid orders', async (t) => {
  const scenarios = [
    {
      outputType: 'image',
      paymentTxid: 'a'.repeat(64),
      responseText: 'Image generation finished: https://cdn.example.test/result.png',
    },
    {
      outputType: 'video',
      paymentTxid: 'b'.repeat(64),
      responseText: 'Video generation finished: https://cdn.example.test/result.mp4?download=1',
    },
    {
      outputType: 'audio',
      paymentTxid: 'c'.repeat(64),
      responseText: 'Audio generation finished: https://cdn.example.test/result.mp3',
    },
    {
      outputType: 'file',
      paymentTxid: 'd'.repeat(64),
      responseText: 'File uploaded: https://file.metaid.io/metafile-indexer/api/v1/files/content/http-only-file-pin',
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.outputType, async (t) => {
      const harness = await createServiceCallHarness(t, {
        service: { outputType: scenario.outputType },
        servicePaymentExecutor: {
          async execute(input) {
            return {
              paymentTxid: scenario.paymentTxid,
              paymentChain: input.paymentChain,
              paymentAmount: input.amount,
              paymentCurrency: input.currency,
              settlementKind: input.settlementKind,
              network: input.paymentChain,
            };
          },
        },
        callerReplyWaiter: {
          async awaitServiceReply() {
            return {
              state: 'completed',
              responseText: scenario.responseText,
              artifacts: [],
              deliveryPinId: `delivery-pin-http-only-${scenario.outputType}`,
              observedAt: Date.now(),
              rawMessage: null,
              ratingRequestText: null,
            };
          },
        },
      });

      const called = await harness.handlers.services.call({
        request: {
          servicePinId: 'chain-service-pin-1',
          providerGlobalMetaId: 'idq1provider',
          userTask: `Create a weather ${scenario.outputType}`,
          taskContext: 'User is in Shanghai',
          spendCap: {
            amount: '0.00002',
            currency: 'SPACE',
          },
        },
      });

      assert.equal(called.state, 'waiting');
      const refundWrite = await waitForCondition(() => (
        harness.writes.find((entry) => entry.path === '/protocols/service-refund-request') ?? null
      ));
      assert.ok(refundWrite, `expected ${scenario.outputType} http-only delivery to publish a refund request`);
      const payload = JSON.parse(refundWrite.payload);
      assert.equal(payload.paymentTxid, scenario.paymentTxid);
      assert.equal(payload.failureReason, 'invalid_deliverable');

      const trace = await waitForCondition(async () => {
        const state = await harness.runtimeStateStore.readState();
        return state.traces.find((entry) => (
          entry.order?.paymentTxid === scenario.paymentTxid
          && entry.order?.status === 'refund_pending'
          && entry.order?.failureReason === 'invalid_deliverable'
          && entry.a2a?.publicStatus === 'remote_failed'
        )) ?? null;
      });
      assert.ok(trace, `expected ${scenario.outputType} invalid deliverable trace`);
      assert.equal(trace.order.status, 'refund_pending');
      assert.equal(trace.order.failureReason, 'invalid_deliverable');
      assert.equal(trace.a2a.publicStatus, 'remote_failed');
    });
  }
});

test('buyer-side invalid non-text deliverable creates a refund request for paid orders', async (t) => {
  const paymentTxid = '7'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: { outputType: 'image' },
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return {
          state: 'completed',
          responseText: 'Image generation finished successfully.',
          artifacts: [],
          deliveryPinId: 'delivery-pin-without-artifact',
          observedAt: Date.now(),
          rawMessage: null,
          ratingRequestText: null,
        };
      },
    },
  });

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Create a weather image',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const refundWrite = await waitForCondition(() => (
    harness.writes.find((entry) => entry.path === '/protocols/service-refund-request') ?? null
  ));
  assert.ok(refundWrite, 'expected invalid non-text delivery to publish a refund request');
  const payload = JSON.parse(refundWrite.payload);
  assert.equal(payload.paymentTxid, paymentTxid);
  assert.equal(payload.failureReason, 'invalid_deliverable');

  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.order?.status === 'refund_pending'
      && entry.order?.failureReason === 'invalid_deliverable'
      && entry.a2a?.publicStatus === 'remote_failed'
    )) ?? null;
  });
  assert.ok(trace, 'expected invalid deliverable trace');
  assert.equal(trace.order.status, 'refund_pending');
  assert.equal(trace.order.failureReason, 'invalid_deliverable');
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
});

test('buyer-side provider daemon execution failure creates a refund request after paid execution dispatch', async (t) => {
  const paymentTxid = '8'.repeat(64);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
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
  });
  const executeRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/network/services')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          services: [{
            servicePinId: 'chain-service-pin-1',
            sourceServicePinId: 'chain-service-pin-1',
            currentPinId: 'chain-service-pin-1',
            providerGlobalMetaId: 'idq1provider',
            providerSkill: 'metabot-weather-oracle',
            serviceName: 'weather-oracle',
            displayName: 'Weather Oracle',
            price: '0.00001',
            currency: 'SPACE',
            outputType: 'text',
            endpoint: 'simplemsg',
            paymentAddress: MVC_PAYMENT_ADDRESS,
            online: true,
            providerDaemonBaseUrl: 'http://127.0.0.1:27272',
          }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    executeRequests.push(JSON.parse(String(options.body || '{}')));
    return new Response(JSON.stringify({
      ok: false,
      state: 'failed',
      code: 'provider_execution_failed',
      message: 'remote runtime refused execution',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      providerDaemonBaseUrl: 'http://127.0.0.1:27272',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  });

  assert.equal(called.ok, false);
  assert.equal(called.code, 'provider_execution_failed');
  const serviceOrderWrite = harness.writes.find((entry) => entry.path === '/protocols/skill-service-order');
  assert.ok(serviceOrderWrite, 'expected provider daemon execution to publish a skill-service-order');
  const serviceOrderPayload = JSON.parse(serviceOrderWrite.payload);
  assert.deepEqual(serviceOrderPayload, {
    servicePinId: 'chain-service-pin-1',
    paymentTxid,
    price: '0.00001',
    currency: 'SPACE',
    settlementKind: 'native',
    metadata: '',
  });
  assert.equal(executeRequests[0].payment.serviceOrderPinId, '/protocols/skill-service-order-pin-1');
  assert.equal(executeRequests[0].payment.orderReference, executeRequests[0].payment.serviceOrderPinId);

  const refundWrite = harness.writes.find((entry) => entry.path === '/protocols/service-refund-request');
  assert.ok(refundWrite, 'expected provider daemon execution failure to publish a refund request');
  const payload = JSON.parse(refundWrite.payload);
  assert.equal(payload.paymentTxid, paymentTxid);
  assert.equal(payload.failureReason, 'provider_execution_failed');

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.paymentTxid === paymentTxid);
  assert.ok(trace, 'expected caller trace after failed provider daemon execution');
  assert.equal(trace.order.status, 'refund_pending');
  assert.match(trace.order.refundRequestPinId, /^\/protocols\/service-refund-request-pin-/);
});

test('buyer-side BTC refund request is scheduled instead of publishing an MVC refund address fallback', async (t) => {
  const paymentTxid = '7'.repeat(64);
  const harness = await createServiceCallHarness(t, {
    service: {
      price: '0.00001',
      currency: 'BTC',
      paymentAddress: 'btc-provider-address',
    },
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
    callerReplyWaiter: {
      async awaitServiceReply() {
        return { state: 'timeout' };
      },
    },
  });
  await harness.runtimeStateStore.updateState((current) => ({
    ...current,
    identity: {
      ...current.identity,
      btcAddress: '',
      addresses: {
        mvc: current.identity.mvcAddress,
      },
    },
  }));

  const called = await harness.handlers.services.call({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'BTC',
      },
    },
  });

  assert.equal(called.state, 'waiting');
  const trace = await waitForCondition(async () => {
    const state = await harness.runtimeStateStore.readState();
    return state.traces.find((entry) => (
      entry.order?.paymentTxid === paymentTxid
      && entry.order?.status === 'failed'
      && Number.isFinite(Number(entry.order?.nextRetryAt))
    )) ?? null;
  });
  assert.ok(trace, 'expected missing BTC refund address to schedule retry instead of publishing invalid payload');
  assert.equal(trace.order.failureReason, 'refund_address_missing');
  assert.equal(harness.writes.some((entry) => entry.path === '/protocols/service-refund-request'), false);
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
    writePin: async (input, { writes, identity }) => {
      if (input.path === '/protocols/simplemsg') {
        throw new Error('simulated chain outage');
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
  const providerSkills = ['metabot-weather-oracle', 'metabot-post-buzz'];
  const executionReminder = 'Check weather first, then post the concise forecast to buzz.';
  const protocolReplyCalls = [];
  const customAcknowledgement = 'Weather Oracle here: I have your Shanghai forecast order and will read the sky now.';
  const customRatingRequest = 'The forecast is delivered in my Weather Oracle voice; rate it if it helped.';
  const harness = await createInboundProviderOrderHarness(t, {
    service: {
      providerSkills,
      executionReminder,
    },
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerOrderReplyRunner: async (input) => {
      protocolReplyCalls.push(input);
      return {
        state: 'reply',
        content: protocolReplyCalls.length === 1 ? customAcknowledgement : customRatingRequest,
      };
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
  assert.deepEqual(harness.llmCalls[0].skills, providerSkills);
  assert.equal(
    harness.llmCalls[0].skillSourcePaths['metabot-post-buzz'],
    path.join(harness.homeDir, '.codex', 'skills', 'metabot-post-buzz'),
  );
  assert.match(harness.llmCalls[0].systemPrompt, /Check weather first/);

  const simplemsgWrites = harness.writes.filter((entry) => entry.path === '/protocols/simplemsg');
  assert.equal(simplemsgWrites.length, 3);
  const contents = simplemsgWrites.map((entry) => harness.decryptProviderWrite(entry));
  const acknowledgementMessages = contents.filter((entry) => entry.startsWith(`[ORDER_STATUS:${orderTxid}]`));
  const deliveryMessages = contents.filter((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`));
  const ratingMessages = contents.filter((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`));
  assert.equal(acknowledgementMessages.length, 1);
  assert.equal(deliveryMessages.length, 1);
  assert.equal(ratingMessages.length, 1);
  assert.equal(acknowledgementMessages[0], `[ORDER_STATUS:${orderTxid}] ${customAcknowledgement}`);
  assert.equal(ratingMessages[0], `[NeedsRating:${orderTxid}] ${customRatingRequest}`);
  assert.doesNotMatch(contents.join('\n'), /I received the order and started processing\.|Please rate this service\./);
  assert.equal(protocolReplyCalls.length, 2);
  assert.match(protocolReplyCalls[0].inboundMessage.content, /Stage: acknowledgement/);
  assert.match(protocolReplyCalls[0].inboundMessage.content, /Weather Oracle/);
  assert.match(protocolReplyCalls[0].inboundMessage.content, /Tell me tomorrow weather/);
  assert.match(protocolReplyCalls[1].inboundMessage.content, /Stage: rating_request/);
  assert.match(protocolReplyCalls[1].inboundMessage.content, /Tomorrow weather: bright with light wind/);
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
  assert.equal(trace.providerRuntime.runtimeId, 'runtime-codex');
  assert.equal(trace.providerRuntime.sessionId, 'provider-llm-session-1');
  assert.equal(trace.providerRuntime.providerSkill, harness.service.providerSkill);

  const sellerOrder = state.sellerOrders.find((entry) => entry.orderTxid === orderTxid);
  assert.ok(sellerOrder, 'expected durable seller order state for inbound order');
  assert.equal(sellerOrder.state, 'rating_pending');
  assert.equal(sellerOrder.localMetabotId, harness.identity.metabotId);
  assert.equal(sellerOrder.localMetabotSlug, path.basename(harness.homeDir));
  assert.equal(sellerOrder.providerGlobalMetaId, harness.identity.globalMetaId);
  assert.equal(sellerOrder.buyerGlobalMetaId, harness.buyerGlobalMetaId);
  assert.equal(sellerOrder.servicePinId, harness.service.currentPinId);
  assert.equal(sellerOrder.currentServicePinId, harness.service.currentPinId);
  assert.equal(sellerOrder.providerSkill, harness.service.providerSkill);
  assert.equal(sellerOrder.orderMessageId, `${orderTxid}i0`);
  assert.equal(sellerOrder.paymentTxid, paymentTxid);
  assert.equal(sellerOrder.traceId, trace.traceId);
  assert.equal(sellerOrder.a2aSessionId, trace.a2a.sessionId);
  assert.equal(sellerOrder.llmSessionId, 'provider-llm-session-1');
  assert.equal(sellerOrder.runtimeId, 'runtime-codex');

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

async function runProviderArtifactDeliveryCase(t, { outputType, fileName, expectedKind }) {
  const orderTxid = `${expectedKind === 'image' ? '1' : expectedKind === 'video' ? '2' : expectedKind === 'audio' ? '3' : '4'}`.repeat(64);
  const paymentTxid = `${expectedKind === 'image' ? '5' : expectedKind === 'video' ? '6' : expectedKind === 'audio' ? '7' : '8'}`.repeat(64);
  const uploadCalls = [];
  const output = createAttemptOutputController(fileName);
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText(`Created the requested ${expectedKind} deliverable.`),
    llmSessionCwd: () => output.sessionCwd(),
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerArtifactUploadLargeFile: createProviderArtifactUploadMock(uploadCalls),
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  assert.equal(uploadCalls.length, 1);
  assert.notEqual(uploadCalls[0].filePath, output.filePath);
  assert.equal(path.basename(uploadCalls[0].filePath), path.basename(output.filePath));
  assert.equal(uploadCalls[0].network, 'mvc');
  assert.equal(uploadCalls[0].verify, true);

  const simplemsgWrites = harness.writes.filter((entry) => entry.path === '/protocols/simplemsg');
  const contents = simplemsgWrites.map((entry) => harness.decryptProviderWrite(entry));
  const deliveryMessages = contents.filter((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`));
  const ratingMessages = contents.filter((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`));
  assert.equal(deliveryMessages.length, 1);
  assert.equal(ratingMessages.length, 1);
  assert.equal(contents.indexOf(deliveryMessages[0]) < contents.indexOf(ratingMessages[0]), true);

  const delivery = parseDeliveryMessage(deliveryMessages[0]);
  assert.ok(delivery);
  assert.match(delivery.result, /metafile:\/\/provider-artifact-1/);
  assert.equal(delivery.result.includes(output.filePath), false);
  assert.equal(Array.isArray(delivery.artifacts), true);
  assert.equal(delivery.artifacts.length, 1);
  assert.equal(delivery.artifacts[0].kind, expectedKind);
  assert.match(delivery.artifacts[0].uri, /^metafile:\/\/provider-artifact-1/);
  assertNoProviderLocalPathLeak(deliveryMessages[0], output.filePath);
  assertNoProviderLocalPathLeak(delivery, output.filePath);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected seller trace for artifact delivery');
  const sessionState = await createSessionStateStore(harness.homeDir).readState();
  const runnerItem = sessionState.transcriptItems.find((item) => item.id === `${trace.traceId}-provider-runner-result`);
  const deliveryItem = sessionState.transcriptItems.find((item) => (
    item.type === 'delivery' && item.metadata?.orderTxid === orderTxid
  ));
  assert.ok(runnerItem);
  assert.ok(deliveryItem);
  assert.match(runnerItem.content, /metafile:\/\/provider-artifact-1/);
  assert.match(deliveryItem.content, /metafile:\/\/provider-artifact-1/);
  assert.deepEqual(runnerItem.metadata.deliveryArtifacts.map((artifact) => artifact.kind), [expectedKind]);
  assert.deepEqual(deliveryItem.metadata.deliveryArtifacts.map((artifact) => artifact.kind), [expectedKind]);
  assert.deepEqual(deliveryItem.artifacts.map((artifact) => artifact.kind), [expectedKind]);
  assertNoProviderLocalPathLeak(runnerItem, output.filePath);
  assertNoProviderLocalPathLeak(deliveryItem, output.filePath);

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
  const persistedDelivery = conversation.messages.find((entry) => (
    entry.protocolTag === 'DELIVERY' && entry.orderTxid === orderTxid
  ));
  assert.ok(persistedDelivery);
  assert.deepEqual(persistedDelivery.artifacts.map((artifact) => artifact.kind), [expectedKind]);
  assertNoProviderLocalPathLeak(persistedDelivery, output.filePath);
}

test('inbound provider ORDER image output uploads artifact and sends delivery before NeedsRating', async (t) => {
  await runProviderArtifactDeliveryCase(t, {
    outputType: 'image',
    fileName: 'weather-image.png',
    expectedKind: 'image',
  });
});

test('inbound provider ORDER image output does not complete session while artifact upload is pending', async (t) => {
  const orderTxid = '4'.repeat(64);
  const paymentTxid = '5'.repeat(64);
  const traceId = 'trace-provider-4444444444444444';
  const uploadCalls = [];
  const uploadMock = createProviderArtifactUploadMock(uploadCalls);
  let uploadWindowError = null;
  const output = createAttemptOutputController('pending-window-image.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Created pending-window image.'),
    llmSessionCwd: () => output.sessionCwd(),
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerArtifactUploadLargeFile: async (input) => {
      try {
        await assertProviderSessionNotCompleted(harness.homeDir, traceId);
      } catch (error) {
        uploadWindowError = error;
      }
      return uploadMock(input);
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  assert.equal(uploadWindowError, null, uploadWindowError?.message);
  assert.equal(uploadCalls.length, 1);
  await assertProviderSessionCompleted(harness.homeDir, traceId);
});

test('inbound provider ORDER video output uploads artifact as video', async (t) => {
  await runProviderArtifactDeliveryCase(t, {
    outputType: 'video',
    fileName: 'weather-video.mp4',
    expectedKind: 'video',
  });
});

test('inbound provider ORDER audio output uploads artifact as audio', async (t) => {
  await runProviderArtifactDeliveryCase(t, {
    outputType: 'audio',
    fileName: 'weather-audio.mp3',
    expectedKind: 'audio',
  });
});

test('inbound provider ORDER file output uploads generic artifact as file', async (t) => {
  await runProviderArtifactDeliveryCase(t, {
    outputType: 'other',
    fileName: 'weather-data.bin',
    expectedKind: 'file',
  });
});

test('inbound provider ORDER preserves public https and metafile artifact references', async (t) => {
  const orderTxid = '9'.repeat(64);
  const paymentTxid = 'a'.repeat(64);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: {
      async cancel() {},
    },
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'file' },
    llmOutput: 'Download mirror: https://example.test/public.bin and canonical metafile://existing-provider-file.bin',
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerArtifactUploadLargeFile: async () => {
      throw new Error('public metafile references should not be re-uploaded');
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  const deliveryMessage = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry))
    .find((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`));
  assert.ok(deliveryMessage);
  const delivery = parseDeliveryMessage(deliveryMessage);
  assert.ok(delivery);
  assert.match(delivery.result, /https:\/\/example\.test\/public\.bin/);
  assert.match(delivery.result, /metafile:\/\/existing-provider-file\.bin/);
  assert.equal(delivery.artifacts.length, 1);
  assert.equal(delivery.artifacts[0].kind, 'file');
  assert.equal(delivery.artifacts[0].uri, 'metafile://existing-provider-file.bin');
});

test('inbound provider ORDER upload failure marks seller order failed without delivery or NeedsRating', async (t) => {
  const orderTxid = 'b'.repeat(64);
  const paymentTxid = 'c'.repeat(64);
  const uploadCalls = [];
  const output = createAttemptOutputController('upload-fails.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Here is the image.'),
    llmSessionCwd: () => output.sessionCwd(),
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerArtifactUploadLargeFile: async (input) => {
      uploadCalls.push(input);
      const error = new Error('simulated provider artifact upload failure');
      error.code = 'provider_artifact_upload_failed';
      throw error;
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_artifact_upload_failed');
  assert.equal(uploadCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), false);
  assert.equal(contents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);
  assert.equal(contents.some((entry) => entry.startsWith(`[ORDER_END:${orderTxid} failed]`)), true);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.order?.orderTxid === orderTxid);
  assert.ok(trace, 'expected failed provider artifact trace');
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
  assert.equal(trace.a2a.latestEvent, 'provider_failed');

  const sellerOrder = state.sellerOrders.find((entry) => entry.orderTxid === orderTxid);
  assert.ok(sellerOrder);
  assert.equal(sellerOrder.state, 'failed');
  assert.equal(sellerOrder.failureReason, 'simulated provider artifact upload failure');
  assert.equal(sellerOrder.endReason, 'provider_artifact_upload_failed');
  assertNoProviderLocalPathLeak(trace, output.filePath);
});

test('inbound provider ORDER preserves large_file_upload_unavailable when no large uploader exists', async (t) => {
  const orderTxid = 'd'.repeat(64);
  const paymentTxid = 'e'.repeat(64);
  const output = createAttemptOutputController('large-image.png', Buffer.alloc((2 * 1024 * 1024) + 1));
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Large image complete.'),
    llmSessionCwd: () => output.sessionCwd(),
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'large_file_upload_unavailable');
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), false);
  assert.equal(contents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);
  const state = await harness.runtimeStateStore.readState();
  const sellerOrder = state.sellerOrders.find((entry) => entry.orderTxid === orderTxid);
  assert.ok(sellerOrder);
  assert.equal(sellerOrder.endReason, 'large_file_upload_unavailable');
});

test('inbound provider ORDER delivery send failure after upload sends no NeedsRating', async (t) => {
  const orderTxid = 'f'.repeat(64);
  const paymentTxid = '1'.repeat(64);
  const uploadCalls = [];
  const output = createAttemptOutputController('delivery-fails.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Image complete.'),
    llmSessionCwd: () => output.sessionCwd(),
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerArtifactUploadLargeFile: createProviderArtifactUploadMock(uploadCalls),
    writePinHook: async (_input, writes) => {
      if (writes.filter((entry) => entry.path === '/protocols/simplemsg').length === 1) {
        throw new Error('simulated artifact delivery write failure');
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
  assert.equal(uploadCalls.length, 1);
  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(contents.some((entry) => entry.startsWith(`[DELIVERY:${orderTxid}]`)), false);
  assert.equal(contents.some((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`)), false);
});

test('inbound provider ORDER uses dedicated provider-generated protocol copy', async (t) => {
  const orderTxid = 'e'.repeat(64);
  const paymentTxid = 'f'.repeat(64);
  const generatedAcknowledgement = '我已经收到这单天气查询，会马上处理；可能需要一点时间，请稍等。';
  const generatedRatingRequest = '天气结果已经交付了，如果这次信息有帮助，请给我 1-5 分评价，你的反馈很重要。';
  const generatorCalls = [];
  const harness = await createInboundProviderOrderHarness(t, {
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
    providerOrderTextGenerator: async (input) => {
      generatorCalls.push(input);
      return input.stage === 'acknowledgement'
        ? generatedAcknowledgement
        : generatedRatingRequest;
    },
  });
  const content = harness.makeOrderContent({ paymentTxid });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  assert.equal(generatorCalls.length, 2);
  assert.equal(generatorCalls[0].stage, 'acknowledgement');
  assert.equal(generatorCalls[1].stage, 'rating_request');
  assert.match(generatorCalls[1].responseText, /bright with light wind/);

  const contents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(
    contents.includes(`[ORDER_STATUS:${orderTxid}] ${generatedAcknowledgement}`),
    true,
  );
  assert.equal(
    contents.includes(`[NeedsRating:${orderTxid}] ${generatedRatingRequest}`),
    true,
  );
  assert.doesNotMatch(contents.join('\n'), /I received the order and started processing\.|Please rate this service\./);
});

test('inbound provider ORDER fallback protocol copy stays concise and service-oriented', async (t) => {
  const orderTxid = 'c'.repeat(64);
  const paymentTxid = 'd'.repeat(64);
  const longWeiboResult = [
    '微博热搜 TOP 50 更新时间： 2026/5/20 08:24:10',
    '| 排名 | 话题 | 标签 | 热度(万) | 链接 |',
    '| 1 | 普京到达北京 | 热 | 164 | https://s.weibo.com/weibo?q=example |',
    '| 2 | 另一条很长的热搜 | 热 | 120 | https://s.weibo.com/weibo?q=long |',
  ].join('\n');
  const harness = await createInboundProviderOrderHarness(t, {
    service: {
      displayName: '微博热搜',
      serviceName: 'weibo-hot-trend',
      providerSkill: 'weibo-hot-trend',
    },
    llmOutput: longWeiboResult,
    rawTxs: {
      [paymentTxid]: buildMvcPaymentRawTx(MVC_PAYMENT_ADDRESS, 1000),
    },
  });
  const content = harness.makeOrderContent({
    paymentTxid,
    rawRequest: '查询微博热搜',
    userTask: '查询微博热搜',
  });

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content,
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, true);
  const simplemsgWrites = harness.writes.filter((entry) => entry.path === '/protocols/simplemsg');
  assert.equal(simplemsgWrites.length, 3);
  const contents = simplemsgWrites.map((entry) => harness.decryptProviderWrite(entry));
  const acknowledgement = contents.find((entry) => entry.startsWith(`[ORDER_STATUS:${orderTxid}]`));
  const ratingRequest = contents.find((entry) => entry.startsWith(`[NeedsRating:${orderTxid}]`));
  assert.ok(acknowledgement);
  assert.ok(ratingRequest);
  assert.match(acknowledgement, /收到|接到|received/i);
  assert.match(acknowledgement, /耐心|稍等|时间|wait|working/i);
  assert.doesNotMatch(acknowledgement, /has accepted|In my role as|I am Eric|friendly coding assistant/i);
  assert.match(ratingRequest, /评价|评分|rate|rating/i);
  assert.match(ratingRequest, /1-5|1 到 5|1 至 5|one to five/i);
  assert.doesNotMatch(ratingRequest, /Result summary|https:\/\/|微博热搜 TOP 50|\| 排名 \|/);
});

test('/api services.execute persists seller lifecycle state and provider runtime diagnostics', async (t) => {
  const harness = await createInboundProviderOrderHarness(t);
  const paymentTxid = '9'.repeat(64);
  const serviceOrderPinId = 'skill-service-order-direct-pin-1';

  const result = await harness.handlers.services.execute({
    traceId: 'trace-provider-direct-execute',
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      globalMetaId: harness.buyerGlobalMetaId,
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid,
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
      orderReference: serviceOrderPinId,
      serviceOrderPinId,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(harness.llmCalls.length, 1);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.traceId === 'trace-provider-direct-execute');
  assert.ok(trace, 'expected direct provider execution trace');
  assert.equal(trace.providerRuntime.runtimeId, 'runtime-codex');
  assert.equal(trace.providerRuntime.sessionId, 'provider-llm-session-1');
  assert.equal(trace.providerRuntime.providerSkill, harness.service.providerSkill);

  const sellerOrder = state.sellerOrders.find((entry) => entry.paymentTxid === paymentTxid);
  assert.ok(sellerOrder, 'expected direct execution seller order');
  assert.equal(sellerOrder.state, 'completed');
  assert.equal(sellerOrder.providerGlobalMetaId, harness.identity.globalMetaId);
  assert.equal(sellerOrder.buyerGlobalMetaId, harness.buyerGlobalMetaId);
  assert.equal(sellerOrder.currentServicePinId, harness.service.currentPinId);
  assert.equal(sellerOrder.traceId, 'trace-provider-direct-execute');
  assert.equal(sellerOrder.a2aSessionId, trace.a2a.sessionId);
  assert.equal(sellerOrder.llmSessionId, 'provider-llm-session-1');
  assert.equal(sellerOrder.id, `seller-order-${serviceOrderPinId}`);
  const inspected = await harness.handlers.provider.inspectOrder({
    orderId: sellerOrder.id,
  });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.data.order.orderId, sellerOrder.id);
});

test('/api services.execute resolves non-text provider artifacts into direct traces', async (t) => {
  const paymentTxid = '2'.repeat(64);
  const uploadCalls = [];
  const output = createAttemptOutputController('direct-image.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Direct image complete.'),
    llmSessionCwd: () => output.sessionCwd(),
    providerArtifactUploadLargeFile: createProviderArtifactUploadMock(uploadCalls),
  });

  const result = await harness.handlers.services.execute({
    traceId: 'trace-provider-direct-artifact',
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      globalMetaId: harness.buyerGlobalMetaId,
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Create a weather image',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid,
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(uploadCalls.length, 1);
  assert.match(result.data.responseText, /metafile:\/\/provider-artifact-1\.png/);
  assertNoProviderLocalPathLeak(result.data.responseText, output.filePath);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.traceId === 'trace-provider-direct-artifact');
  assert.ok(trace, 'expected direct provider artifact trace');
  assertNoProviderLocalPathLeak(trace, output.filePath);

  const sessionState = await createSessionStateStore(harness.homeDir).readState();
  const runnerItem = sessionState.transcriptItems.find((item) => item.id === 'trace-provider-direct-artifact-provider-runner-result');
  assert.ok(runnerItem);
  assert.match(runnerItem.content, /metafile:\/\/provider-artifact-1\.png/);
  assert.deepEqual(runnerItem.metadata.deliveryArtifacts.map((artifact) => artifact.kind), ['image']);
  assertNoProviderLocalPathLeak(runnerItem, output.filePath);

  const traceResult = await harness.handlers.trace.getTrace({ traceId: 'trace-provider-direct-artifact' });
  assert.equal(traceResult.ok, true);
  const projectedDelivery = traceResult.data.inspector.transcriptItems.find((item) => (
    item.type === 'delivery'
    && item.id === 'trace-provider-direct-artifact-provider-delivery'
  ));
  assert.ok(projectedDelivery);
  assert.match(projectedDelivery.content, /metafile:\/\/provider-artifact-1\.png/);
  assert.deepEqual(projectedDelivery.artifacts.map((artifact) => artifact.kind), ['image']);
  assert.deepEqual(projectedDelivery.metadata.deliveryArtifacts.map((artifact) => artifact.kind), ['image']);
  assertNoProviderLocalPathLeak(projectedDelivery, output.filePath);
});

test('/api services.execute image output does not complete session while artifact upload is pending', async (t) => {
  const paymentTxid = '6'.repeat(64);
  const traceId = 'trace-provider-direct-artifact-pending-state';
  const uploadCalls = [];
  const uploadMock = createProviderArtifactUploadMock(uploadCalls);
  let uploadWindowError = null;
  const output = createAttemptOutputController('direct-pending-window-image.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Direct pending-window image complete.'),
    llmSessionCwd: () => output.sessionCwd(),
    providerArtifactUploadLargeFile: async (input) => {
      try {
        await assertProviderSessionNotCompleted(harness.homeDir, traceId);
      } catch (error) {
        uploadWindowError = error;
      }
      return uploadMock(input);
    },
  });

  const result = await harness.handlers.services.execute({
    traceId,
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      globalMetaId: harness.buyerGlobalMetaId,
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Create a weather image',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid,
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(uploadWindowError, null, uploadWindowError?.message);
  assert.equal(uploadCalls.length, 1);
  await assertProviderSessionCompleted(harness.homeDir, traceId);
});

test('/api services.execute upload failure marks direct seller order and trace failed', async (t) => {
  const paymentTxid = '3'.repeat(64);
  const uploadCalls = [];
  const output = createAttemptOutputController('direct-upload-fails.png');
  const harness = await createInboundProviderOrderHarness(t, {
    service: { outputType: 'image' },
    llmExecuteHook: (request) => output.write(request),
    llmOutput: () => output.outputText('Direct image complete.'),
    llmSessionCwd: () => output.sessionCwd(),
    providerArtifactUploadLargeFile: async (input) => {
      uploadCalls.push(input);
      const error = new Error(`simulated direct artifact upload failure at ${output.filePath}`);
      error.code = 'provider_artifact_upload_failed';
      throw error;
    },
  });

  const result = await harness.handlers.services.execute({
    traceId: 'trace-provider-direct-artifact-failure',
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      globalMetaId: harness.buyerGlobalMetaId,
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Create a weather image',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid,
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_artifact_upload_failed');
  assert.match(result.message, /simulated direct artifact upload failure/);
  assertNoProviderLocalPathLeak(result.message, output.filePath);
  assert.equal(uploadCalls.length, 1);

  const state = await harness.runtimeStateStore.readState();
  const sellerOrder = state.sellerOrders.find((entry) => entry.paymentTxid === paymentTxid);
  assert.ok(sellerOrder, 'expected direct execution seller order');
  assert.equal(sellerOrder.state, 'failed');
  assert.equal(sellerOrder.endReason, 'provider_artifact_upload_failed');
  assert.match(sellerOrder.failureReason, /simulated direct artifact upload failure/);
  assertNoProviderLocalPathLeak(sellerOrder, output.filePath);

  const trace = state.traces.find((entry) => entry.traceId === 'trace-provider-direct-artifact-failure');
  assert.ok(trace, 'expected failed direct provider artifact trace');
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
  assert.equal(trace.a2a.latestEvent, 'provider_failed');
  assert.equal(trace.a2a.taskRunState, 'failed');
  assertNoProviderLocalPathLeak(trace, output.filePath);

  const sessionState = await createSessionStateStore(harness.homeDir).readState();
  const taskRun = sessionState.taskRuns.find((entry) => entry.runId === trace.a2a.taskRunId);
  assert.ok(taskRun);
  assert.equal(taskRun.state, 'failed');
  const failureItem = sessionState.transcriptItems.find((item) => item.id === 'trace-provider-direct-artifact-failure-provider-artifact-failure');
  assert.ok(failureItem);
  assert.equal(failureItem.type, 'failure');
  assert.match(failureItem.content, /simulated direct artifact upload failure/);
  assertNoProviderLocalPathLeak(failureItem, output.filePath);

  const traceResult = await harness.handlers.trace.getTrace({ traceId: 'trace-provider-direct-artifact-failure' });
  assert.equal(traceResult.ok, true);
  assert.equal(traceResult.data.a2a.publicStatus, 'remote_failed');
  assert.equal(traceResult.data.a2a.taskRunState, 'failed');
  const projectedFailure = traceResult.data.inspector.transcriptItems.find((item) => item.id === failureItem.id);
  assert.ok(projectedFailure);
  assertNoProviderLocalPathLeak(traceResult.data, output.filePath);
});

test('/api services.execute rejects missing buyer globalMetaId before seller order persistence', async (t) => {
  const harness = await createInboundProviderOrderHarness(t);

  const result = await harness.handlers.services.execute({
    traceId: 'trace-provider-direct-missing-buyer',
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid: '7'.repeat(64),
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_service_execution_request');
  assert.match(result.message, /buyer\.globalMetaId/);
  assert.equal(harness.llmCalls.length, 0);

  const state = await harness.runtimeStateStore.readState();
  assert.equal(state.traces.length, 0);
  assert.equal(state.sellerOrders.length, 0);
});

test('/api services.execute persists failed seller lifecycle state with provider runtime diagnostics', async (t) => {
  const harness = await createInboundProviderOrderHarness(t, {
    llmSession: (sessionId) => ({
      sessionId,
      status: 'failed',
      error: 'runtime refused direct execution',
    }),
  });
  const paymentTxid = '8'.repeat(64);

  const result = await harness.handlers.services.execute({
    traceId: 'trace-provider-direct-failed',
    externalConversationId: 'direct:buyer:provider',
    servicePinId: harness.service.currentPinId,
    providerGlobalMetaId: harness.identity.globalMetaId,
    buyer: {
      host: 'codex',
      globalMetaId: harness.buyerGlobalMetaId,
      name: 'Buyer Bot',
    },
    request: {
      userTask: 'Tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
    payment: {
      paymentTxid,
      paymentChain: 'mvc',
      paymentAmount: harness.service.price,
      paymentCurrency: harness.service.currency,
      settlementKind: 'native',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_execution_failed');
  assert.equal(harness.llmCalls.length, 1);

  const state = await harness.runtimeStateStore.readState();
  const trace = state.traces.find((entry) => entry.traceId === 'trace-provider-direct-failed');
  assert.ok(trace, 'expected direct provider failure trace');
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
  assert.equal(trace.providerRuntime.runtimeId, 'runtime-codex');
  assert.equal(trace.providerRuntime.sessionId, 'provider-llm-session-1');

  const sellerOrder = state.sellerOrders.find((entry) => entry.paymentTxid === paymentTxid);
  assert.ok(sellerOrder, 'expected failed direct execution seller order');
  assert.equal(sellerOrder.state, 'failed');
  assert.equal(sellerOrder.failureReason, 'runtime refused direct execution');
  assert.equal(sellerOrder.traceId, 'trace-provider-direct-failed');

  const summary = await harness.handlers.provider.getSummary();
  assert.equal(summary.ok, true);
  const manualAction = summary.data.manualActions.find((entry) => entry.orderId === sellerOrder.id);
  assert.ok(manualAction, 'expected failed paid seller order to expose a manual refund marker');
  assert.equal(manualAction.kind, 'refund');
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

test('inbound provider ORDER records and reports payment verification failure without executing', async (t) => {
  const orderTxid = '8'.repeat(64);
  const paymentTxid = '9'.repeat(64);
  const harness = await createInboundProviderOrderHarness(t);

  const result = await harness.handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: harness.buyerGlobalMetaId,
    content: harness.makeOrderContent({ paymentTxid }),
    messagePinId: `${orderTxid}i0`,
    timestamp: 1_775_000_001_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'order_payment_unverified');
  assert.deepEqual(harness.fetchRawTxCalls, [paymentTxid]);
  assert.deepEqual(harness.fetchUtxosCalls, [MVC_PAYMENT_ADDRESS]);
  assert.equal(harness.llmCalls.length, 0);

  const simplemsgContents = harness.writes
    .filter((entry) => entry.path === '/protocols/simplemsg')
    .map((entry) => harness.decryptProviderWrite(entry));
  assert.equal(simplemsgContents.some((entry) => entry.startsWith(`[ORDER_STATUS:${orderTxid}]`)), false);
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
  assert.equal(orderSession.paymentTxid, paymentTxid);
  assert.match(orderSession.failureReason, /payment could not be verified/i);

  const state = await harness.runtimeStateStore.readState();
  const sellerOrder = state.sellerOrders.find((entry) => entry.paymentTxid === paymentTxid);
  assert.ok(sellerOrder, 'expected seller order for payment verification failure');
  assert.equal(sellerOrder.state, 'failed');
  assert.equal(sellerOrder.orderTxid, orderTxid);
  assert.match(sellerOrder.failureReason, /payment could not be verified/i);

  const trace = state.traces.find((entry) => entry.order?.paymentTxid === paymentTxid);
  assert.ok(trace, 'expected seller failure trace for payment verification failure');
  assert.equal(trace.order.role, 'seller');
  assert.equal(trace.order.orderTxid, orderTxid);
  assert.equal(trace.a2a.publicStatus, 'remote_failed');
  assert.equal(trace.providerRuntime.providerSkill, harness.service.providerSkill);
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
  assert.equal(trace.providerRuntime.runtimeId, 'runtime-codex');
  assert.equal(trace.providerRuntime.sessionId, 'provider-llm-session-1');
  assert.equal(trace.providerRuntime.providerSkill, harness.service.providerSkill);
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
