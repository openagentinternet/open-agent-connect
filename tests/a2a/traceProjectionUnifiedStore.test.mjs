import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { persistA2AConversationMessage } = require('../../dist/core/a2a/conversationPersistence.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const {
  getUnifiedA2ATraceSessionForProfile,
  listUnifiedA2ATraceSessionsForProfile,
} = require('../../dist/core/a2a/traceProjection.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const {
  setActiveMetabotHome,
  upsertIdentityProfile,
} = require('../../dist/core/identity/identityProfiles.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');

const LOCAL_GLOBAL_META_ID = 'idq14hmvlocal000000000000000000000000';
const PEER_GLOBAL_META_ID = 'idq1g35dpeer0000000000000000000000000';
const PEER_SESSION_ID = 'a2a-peer-idq14hmv-idq1g35d';
const ORDER_TXID = 'a'.repeat(64);
const PAYMENT_TXID = 'payment-tx-1';
const ORDER_SESSION_ID = `a2a-order-${ORDER_TXID}`;
const BASE_TIME = 1_777_000_000_000;
const LOCAL_AVATAR = '/content/f77ba5db20c19242f9a5e5025357d29ad83f897f3700d2b1972f6ce1485098d7i0';
const PEER_AVATAR = '/content/607b2da84bbd01e01397bb6ea8cd09e4f9b0e87552dd0d0e24b828f18884dd30i0';

async function createProfileFixture() {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-a2a-trace-projection-'));
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'alice');
  await mkdir(homeDir, { recursive: true });
  const profile = await upsertIdentityProfile({
    systemHomeDir,
    name: 'Alice',
    homeDir,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: 'mvc-alice',
    now: () => BASE_TIME,
  });
  await setActiveMetabotHome({
    systemHomeDir,
    homeDir: profile.homeDir,
    now: () => BASE_TIME,
  });
  return { systemHomeDir, homeDir: profile.homeDir, profile };
}

function actor(globalMetaId, name, avatar) {
  return {
    globalMetaId,
    name,
    avatar,
    chatPublicKey: `${name.toLowerCase().replace(/\s+/g, '-')}-chat-public-key`,
  };
}

function createMessage(index, overrides = {}) {
  const direction = overrides.direction ?? 'outgoing';
  const sender = direction === 'outgoing'
    ? actor(LOCAL_GLOBAL_META_ID, 'Alice', 'https://example.test/alice.png')
    : actor(PEER_GLOBAL_META_ID, 'Remote Bot', 'https://example.test/remote.png');
  const recipient = direction === 'outgoing'
    ? actor(PEER_GLOBAL_META_ID, 'Remote Bot', 'https://example.test/remote.png')
    : actor(LOCAL_GLOBAL_META_ID, 'Alice', 'https://example.test/alice.png');

  return {
    messageId: `msg-${index}`,
    sessionId: PEER_SESSION_ID,
    orderSessionId: null,
    direction,
    kind: 'private_chat',
    protocolTag: null,
    orderTxid: null,
    paymentTxid: null,
    content: `message ${index}`,
    contentType: 'text/plain',
    chain: 'mvc',
    pinId: `pin-${index}`,
    txid: `tx-${index}`,
    txids: [`tx-${index}`],
    replyPinId: null,
    timestamp: BASE_TIME + index,
    chainTimestamp: Math.floor((BASE_TIME + index) / 1000),
    sender,
    recipient,
    raw: {
      socket: {
        sequence: index,
      },
    },
    ...overrides,
  };
}

function privateHistoryRow({ index, from, content, txid, timestamp = BASE_TIME + index }) {
  const outgoing = from === 'local';
  const fromInfo = outgoing
    ? { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Alice', avatar: LOCAL_AVATAR }
    : { globalMetaId: PEER_GLOBAL_META_ID, name: 'Remote Bot', avatar: PEER_AVATAR };
  const toInfo = outgoing
    ? { globalMetaId: PEER_GLOBAL_META_ID, name: 'Remote Bot', avatar: PEER_AVATAR }
    : { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Alice', avatar: LOCAL_AVATAR };
  return {
    index,
    timestamp: Math.floor(timestamp / 1000),
    protocol: '/protocols/simplemsg',
    chain: 'mvc',
    pinId: `${txid}i0`,
    txId: txid,
    content,
    fromGlobalMetaId: fromInfo.globalMetaId,
    toGlobalMetaId: toInfo.globalMetaId,
    fromUserInfo: fromInfo,
    toUserInfo: toInfo,
  };
}

async function seedUnifiedConversation(homeDir) {
  const store = createA2AConversationStore({
    homeDir,
    local: {
      profileSlug: 'alice',
      globalMetaId: LOCAL_GLOBAL_META_ID,
      name: 'Alice',
      avatar: 'https://example.test/alice.png',
    },
    peer: {
      globalMetaId: PEER_GLOBAL_META_ID,
      name: 'Remote Bot',
      avatar: 'https://example.test/remote.png',
      chatPublicKey: 'remote-chat-public-key',
    },
  });

  await store.upsertSession({
    sessionId: PEER_SESSION_ID,
    type: 'peer',
    state: 'active',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME + 90,
    latestMessageId: 'msg-5',
  });
  await store.upsertSession({
    sessionId: ORDER_SESSION_ID,
    type: 'service_order',
    role: 'caller',
    state: 'completed',
    orderTxid: ORDER_TXID,
    paymentTxid: PAYMENT_TXID,
    servicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    outputType: 'markdown',
    createdAt: BASE_TIME + 10,
    updatedAt: BASE_TIME + 80,
    firstResponseAt: BASE_TIME + 30,
    deliveredAt: BASE_TIME + 60,
    ratingRequestedAt: BASE_TIME + 70,
    endedAt: BASE_TIME + 80,
    endReason: 'completed',
    failureReason: null,
  });

  await store.appendMessages([
    createMessage(1, {
      content: 'hello remote bot',
    }),
    createMessage(2, {
      kind: 'order_protocol',
      protocolTag: 'ORDER',
      orderSessionId: ORDER_SESSION_ID,
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      pinId: `${ORDER_TXID}i0`,
      txid: ORDER_TXID,
      txids: [ORDER_TXID],
      content: `[ORDER] Tell me tomorrow weather\n<raw_request>\nTell me tomorrow weather\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
    }),
    createMessage(3, {
      direction: 'incoming',
      kind: 'order_protocol',
      protocolTag: 'ORDER_STATUS',
      orderSessionId: ORDER_SESSION_ID,
      orderTxid: ORDER_TXID,
      content: `[ORDER_STATUS:${ORDER_TXID}] I received the order and started processing.`,
    }),
    createMessage(4, {
      direction: 'incoming',
      kind: 'order_protocol',
      protocolTag: 'DELIVERY',
      orderSessionId: ORDER_SESSION_ID,
      orderTxid: ORDER_TXID,
      content: `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
        paymentTxid: PAYMENT_TXID,
        servicePinId: 'service-pin-1',
        serviceName: 'Weather Oracle',
        result: '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1',
        deliveredAt: BASE_TIME + 60,
      })}`,
    }),
    createMessage(5, {
      direction: 'incoming',
      kind: 'order_protocol',
      protocolTag: 'NeedsRating',
      orderSessionId: ORDER_SESSION_ID,
      orderTxid: ORDER_TXID,
      content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
    }),
  ]);

  return store;
}

test('listUnifiedA2ATraceSessionsForProfile lists one peer window per remote MetaBot', async () => {
  const { homeDir, profile } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);

  const sessions = await listUnifiedA2ATraceSessionsForProfile({
    profile,
    daemon: { baseUrl: 'http://127.0.0.1:38245' },
  });

  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions.map((session) => session.sessionId), [
    PEER_SESSION_ID,
  ]);
  assert.equal(sessions[0].traceId, PEER_SESSION_ID);
  assert.equal(sessions[0].role, 'caller');
  assert.equal(sessions[0].state, 'active');
  assert.equal(sessions[0].localMetabotName, 'Alice');
  assert.equal(sessions[0].localMetabotGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(sessions[0].peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(sessions[0].peerName, 'Remote Bot');
  assert.equal(sessions[0].source, 'unified_a2a');
});

test('getUnifiedA2ATraceSessionForProfile shows all messages for the peer conversation session', async () => {
  const { homeDir, profile } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: PEER_SESSION_ID,
    daemon: { baseUrl: 'http://127.0.0.1:38245' },
  });

  assert.ok(detail);
  assert.equal(detail.sessionId, PEER_SESSION_ID);
  assert.equal(detail.traceId, PEER_SESSION_ID);
  assert.equal(detail.session.sessionId, PEER_SESSION_ID);
  assert.equal(detail.session.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(detail.localMetabotName, 'Alice');
  assert.equal(detail.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(detail.transcriptItems.length, 5);
  assert.deepEqual(detail.transcriptItems.map((item) => item.id), [
    'msg-1',
    'msg-2',
    'msg-3',
    'msg-4',
    'msg-5',
  ]);
  assert.equal(detail.transcriptItems[0].sender, 'caller');
  assert.equal(detail.transcriptItems[2].sender, 'provider');
  assert.equal(detail.transcriptItems[3].content, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');

  const localUiUrl = new URL(detail.localUiUrl);
  assert.equal(localUiUrl.pathname, '/ui/trace');
  assert.equal(localUiUrl.searchParams.get('traceId'), PEER_SESSION_ID);
  assert.equal(localUiUrl.searchParams.get('sessionId'), PEER_SESSION_ID);
});

test('getUnifiedA2ATraceSessionForProfile maps service-order ids back to the peer window', async () => {
  const { homeDir, profile } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: ORDER_SESSION_ID,
    daemon: { baseUrl: 'http://127.0.0.1:38245' },
  });

  assert.ok(detail);
  assert.equal(detail.sessionId, PEER_SESSION_ID);
  assert.equal(detail.traceId, PEER_SESSION_ID);
  assert.equal(detail.session.sessionId, PEER_SESSION_ID);
  assert.equal(detail.session.role, 'caller');
  assert.equal(detail.session.state, 'active');
  assert.equal(detail.orderTxid, ORDER_TXID);
  assert.equal(detail.paymentTxid, PAYMENT_TXID);
  assert.equal(detail.order.serviceId, 'service-pin-1');
  assert.equal(detail.order.serviceName, 'Weather Oracle');
  assert.equal(detail.a2a.publicStatus, 'completed');
  assert.equal(detail.transcriptItems.length, 5);
  assert.deepEqual(detail.transcriptItems.map((item) => item.id), [
    'msg-1',
    'msg-2',
    'msg-3',
    'msg-4',
    'msg-5',
  ]);
  const order = detail.transcriptItems.find((item) => item.type === 'order');
  assert.ok(order);
  assert.equal(order.sender, 'caller');
  assert.match(order.content, /Tell me tomorrow weather/);
  assert.match(order.content, /<raw_request>/);
  assert.match(order.content, new RegExp(`txid: ${PAYMENT_TXID}`));
  assert.match(order.content, /service id: service-pin-1/);

  const delivery = detail.transcriptItems.find((item) => item.type === 'delivery');
  assert.ok(delivery);
  assert.equal(delivery.sender, 'provider');
  assert.equal(delivery.content, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');
  assert.equal(delivery.metadata.protocolTag, 'DELIVERY');
  assert.equal(delivery.metadata.deliveryPinId, 'pin-4');
  assert.equal(detail.resultText, delivery.content);
  assert.equal(detail.responseText, delivery.content);
  assert.equal(detail.ratingRequestText, 'Please rate this service.');
  assert.equal(detail.inspector.transcriptItems.length, 5);
});

test('default trace handlers read unified A2A sessions before legacy session-state fallback', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const listResult = await handlers.trace.listSessions();
  assert.equal(listResult.ok, true);
  assert.equal(listResult.data.sessions.length, 1);
  assert.deepEqual(listResult.data.sessions.map((session) => session.sessionId), [
    PEER_SESSION_ID,
  ]);
  assert.equal(listResult.data.stats.totalCount, 1);
  assert.equal(listResult.data.stats.callerCount, 1);

  const detailResult = await handlers.trace.getSession({ sessionId: ORDER_SESSION_ID });
  assert.equal(detailResult.ok, true);
  assert.equal(detailResult.data.sessionId, PEER_SESSION_ID);
  assert.equal(detailResult.data.responseText, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');
  assert.equal(detailResult.data.inspector.transcriptItems.length, 5);
});

test('default trace handlers enrich unified peer windows with full on-chain private history', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const chatTxid = '1'.repeat(64);
  const statusTxid = '2'.repeat(64);
  const deliveryTxid = '3'.repeat(64);
  const needsRatingTxid = '4'.repeat(64);
  const orderEndTxid = '5'.repeat(64);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
    fetchPeerChatPublicKey: async () => 'peer-chat-public-key',
    signer: {
      getPrivateChatIdentity: async () => ({
        globalMetaId: LOCAL_GLOBAL_META_ID,
        privateKeyHex: '1'.repeat(64),
        chatPublicKey: 'local-chat-public-key',
      }),
    },
    fetchPrivateChatHistory: async () => [
      privateHistoryRow({
        index: 1,
        from: 'peer',
        txid: chatTxid,
        content: 'Can you call my weather service?',
      }),
      privateHistoryRow({
        index: 2,
        from: 'local',
        txid: ORDER_TXID,
        content: `[ORDER] Tell me tomorrow weather\n<raw_request>\nTell me tomorrow weather\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
      }),
      privateHistoryRow({
        index: 3,
        from: 'peer',
        txid: statusTxid,
        content: `[ORDER_STATUS:${ORDER_TXID}] I received the order and started processing.`,
      }),
      privateHistoryRow({
        index: 4,
        from: 'peer',
        txid: deliveryTxid,
        content: `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
          paymentTxid: PAYMENT_TXID,
          servicePinId: 'service-pin-1',
          serviceName: 'Weather Oracle',
          result: '# Chain Forecast\n\nRain clearing later.',
          deliveredAt: BASE_TIME + 400,
        })}`,
      }),
      privateHistoryRow({
        index: 5,
        from: 'peer',
        txid: needsRatingTxid,
        content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
      }),
      privateHistoryRow({
        index: 6,
        from: 'local',
        txid: orderEndTxid,
        content: `[ORDER_END:${ORDER_TXID} rated] ${JSON.stringify({
          rate: 5,
          comment: 'Accurate result.',
        })}`,
      }),
    ],
  });

  const detailResult = await handlers.trace.getSession({ sessionId: PEER_SESSION_ID });

  assert.equal(detailResult.ok, true);
  assert.equal(detailResult.data.sessionId, PEER_SESSION_ID);
  const items = detailResult.data.inspector.transcriptItems;
  assert.deepEqual(items.map((item) => item.metadata.txid), [
    chatTxid,
    ORDER_TXID,
    statusTxid,
    deliveryTxid,
    needsRatingTxid,
    orderEndTxid,
  ]);
  assert.deepEqual(items.map((item) => item.type), [
    'message',
    'order',
    'order_status',
    'delivery',
    'needs_rating',
    'order_end',
  ]);
  assert.equal(items[0].sender, 'provider');
  assert.equal(items[1].sender, 'caller');
  assert.equal(items[2].content, 'I received the order and started processing.');
  assert.equal(items[3].content, '# Chain Forecast\n\nRain clearing later.');
  assert.equal(items[5].sender, 'caller');
  assert.equal(detailResult.data.resultText, '# Chain Forecast\n\nRain clearing later.');
  assert.equal(detailResult.data.responseText, '# Chain Forecast\n\nRain clearing later.');
  assert.equal(detailResult.data.ratingRequestText, 'Please rate this service.');
  assert.equal(detailResult.data.localMetabotAvatar, LOCAL_AVATAR);
  assert.equal(detailResult.data.peerAvatar, PEER_AVATAR);
});

test('default trace handlers hide legacy duplicate windows when a unified peer window exists', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-duplicate-session-1',
        traceId: 'trace-duplicate-1',
        role: 'caller',
        state: 'completed',
        createdAt: BASE_TIME + 1,
        updatedAt: BASE_TIME + 200,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'legacy-service-pin',
        currentTaskRunId: 'legacy-run-1',
        latestTaskRunState: 'completed',
      },
      {
        sessionId: 'legacy-duplicate-session-2',
        traceId: 'trace-duplicate-2',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME + 2,
        updatedAt: BASE_TIME + 300,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'legacy-service-pin-2',
        currentTaskRunId: 'legacy-run-2',
        latestTaskRunState: 'running',
      },
    ],
    taskRuns: [],
    transcriptItems: [],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const listResult = await handlers.trace.listSessions();
  assert.equal(listResult.ok, true);
  assert.deepEqual(listResult.data.sessions.map((session) => session.sessionId), [PEER_SESSION_ID]);
  assert.equal(listResult.data.stats.totalCount, 1);
  assert.equal(listResult.data.stats.callerCount, 1);
});

test('default trace handlers still return legacy-only session-state records when no unified session exists', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-1',
        traceId: 'legacy-trace-1',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 1,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'legacy-service-pin',
        currentTaskRunId: 'legacy-run-1',
        latestTaskRunState: 'running',
      },
    ],
    taskRuns: [],
    transcriptItems: [
      {
        id: 'legacy-message-1',
        sessionId: 'legacy-session-1',
        taskRunId: 'legacy-run-1',
        timestamp: BASE_TIME + 1,
        type: 'message',
        sender: 'caller',
        content: 'legacy trace hello',
        metadata: null,
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const listResult = await handlers.trace.listSessions();
  assert.equal(listResult.ok, true);
  assert.deepEqual(listResult.data.sessions.map((session) => session.sessionId), ['legacy-session-1']);

  const detailResult = await handlers.trace.getSession({ sessionId: 'legacy-session-1' });
  assert.equal(detailResult.ok, true);
  assert.equal(detailResult.data.source, undefined);
  assert.equal(detailResult.data.sessionId, 'legacy-session-1');
  assert.equal(detailResult.data.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(detailResult.data.inspector.transcriptItems[0].content, 'legacy trace hello');
});

test('legacy trace detail uses unified A2A chain order content when the trace only stored a user summary', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-with-chain-order',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: BASE_TIME,
    session: {
      id: 'session-legacy-chain-order',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-legacy-chain-order',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: `${ORDER_TXID}i0`,
      orderTxid: ORDER_TXID,
      orderTxids: [ORDER_TXID],
      paymentTxid: PAYMENT_TXID,
      orderReference: null,
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00005',
    },
    a2a: {
      sessionId: 'legacy-session-chain-order',
      taskRunId: 'legacy-run-chain-order',
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'queued',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'service-pin-1',
    },
  });
  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces: [trace],
  });
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-chain-order',
        traceId: 'legacy-trace-with-chain-order',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'legacy-run-chain-order',
        latestTaskRunState: 'queued',
      },
    ],
    taskRuns: [],
    transcriptItems: [
      {
        id: 'legacy-user-summary',
        sessionId: 'legacy-session-chain-order',
        taskRunId: 'legacy-run-chain-order',
        timestamp: BASE_TIME,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather',
        metadata: {
          paymentTxid: PAYMENT_TXID,
        },
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const detailResult = await handlers.trace.getSession({ sessionId: 'legacy-session-chain-order' });

  assert.equal(detailResult.ok, true);
  const [first] = detailResult.data.inspector.transcriptItems;
  assert.equal(first.type, 'order');
  assert.equal(first.sender, 'caller');
  assert.match(first.content, /Tell me tomorrow weather/);
  assert.match(first.content, /<raw_request>/);
  assert.match(first.content, new RegExp(`txid: ${PAYMENT_TXID}`));
  assert.equal(first.metadata.orderTxid, ORDER_TXID);
  assert.deepEqual(first.metadata.txids, [ORDER_TXID]);
});

test('trace get by trace id recovers completed unified A2A order results', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-id-unified-order',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: BASE_TIME,
    session: {
      id: 'session-trace-id-unified-order',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-trace-id-unified-order',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: `${ORDER_TXID}i0`,
      orderTxid: ORDER_TXID,
      orderTxids: [ORDER_TXID],
      paymentTxid: PAYMENT_TXID,
      orderReference: null,
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00005',
    },
    a2a: {
      sessionId: 'legacy-session-trace-id-unified-order',
      taskRunId: 'legacy-run-trace-id-unified-order',
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'queued',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'service-pin-1',
    },
  });
  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces: [trace],
  });
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-trace-id-unified-order',
        traceId: 'legacy-trace-id-unified-order',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'legacy-run-trace-id-unified-order',
        latestTaskRunState: 'queued',
      },
    ],
    taskRuns: [],
    transcriptItems: [
      {
        id: 'legacy-user-summary-trace-id',
        sessionId: 'legacy-session-trace-id-unified-order',
        taskRunId: 'legacy-run-trace-id-unified-order',
        timestamp: BASE_TIME,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather',
        metadata: {
          paymentTxid: PAYMENT_TXID,
        },
      },
    ],
    cursors: { caller: null, provider: null },
    publicStatusSnapshots: [
      {
        sessionId: 'legacy-session-trace-id-unified-order',
        taskRunId: 'legacy-run-trace-id-unified-order',
        status: 'requesting_remote',
        mapped: true,
        rawEvent: 'request_sent',
        resolvedAt: BASE_TIME + 1,
      },
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const traceResult = await handlers.trace.getTrace({ traceId: 'legacy-trace-id-unified-order' });
  const watchOutput = await handlers.trace.watchTrace({ traceId: 'legacy-trace-id-unified-order' });

  assert.equal(traceResult.ok, true);
  assert.equal(traceResult.data.resultText, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');
  assert.equal(traceResult.data.ratingRequestText, 'Please rate this service.');
  assert.equal(traceResult.data.a2a.publicStatus, 'completed');
  assert.equal(traceResult.data.a2a.latestEvent, 'provider_completed');
  assert.equal(traceResult.data.a2a.taskRunState, 'completed');
  assert.equal(traceResult.data.inspector.publicStatusSnapshots.at(-1).status, 'completed');
  assert.match(watchOutput, /"status":"completed"/);
});

test('inbound NeedsRating order protocol auto-rates the matching buyer trace', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-inbound-needs-rating',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: BASE_TIME,
    session: {
      id: 'session-inbound-needs-rating',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-inbound-needs-rating',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: `${ORDER_TXID}i0`,
      orderTxid: ORDER_TXID,
      orderTxids: [ORDER_TXID],
      paymentTxid: PAYMENT_TXID,
      orderReference: null,
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00005',
    },
    a2a: {
      sessionId: 'legacy-session-inbound-needs-rating',
      taskRunId: 'legacy-run-inbound-needs-rating',
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'queued',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'service-pin-1',
    },
  });
  await runtimeStateStore.writeState({
    identity: {
      metabotId: 1,
      name: 'Alice',
      createdAt: BASE_TIME,
      path: '/MetaBot/Alice',
      publicKey: 'alice-public-key',
      chatPublicKey: 'local-chat-public-key',
      mvcAddress: 'mvc-alice',
      btcAddress: 'btc-alice',
      dogeAddress: 'doge-alice',
      metaId: 'metaid-alice',
      globalMetaId: LOCAL_GLOBAL_META_ID,
    },
    services: [],
    traces: [trace],
  });
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-inbound-needs-rating',
        traceId: 'legacy-trace-inbound-needs-rating',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'legacy-run-inbound-needs-rating',
        latestTaskRunState: 'queued',
      },
    ],
    taskRuns: [
      {
        runId: 'legacy-run-inbound-needs-rating',
        sessionId: 'legacy-session-inbound-needs-rating',
        state: 'queued',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
        clarificationRounds: [],
      },
    ],
    transcriptItems: [
      {
        id: 'legacy-user-summary-inbound-rating',
        sessionId: 'legacy-session-inbound-needs-rating',
        taskRunId: 'legacy-run-inbound-needs-rating',
        timestamp: BASE_TIME,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather',
        metadata: {
          paymentTxid: PAYMENT_TXID,
        },
      },
    ],
    cursors: { caller: null, provider: null },
    publicStatusSnapshots: [
      {
        sessionId: 'legacy-session-inbound-needs-rating',
        taskRunId: 'legacy-run-inbound-needs-rating',
        status: 'requesting_remote',
        mapped: true,
        rawEvent: 'request_sent',
        resolvedAt: BASE_TIME + 1,
      },
    ],
  });
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
    chainApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceFailureMode: 'assume_service_providers_online',
    fetchPeerChatPublicKey: async () => '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    buyerRatingReplyRunner: async () => ({
      state: 'reply',
      content: '评分：5分。结果清晰，响应可靠，谢谢你的天气服务。',
    }),
    signer: {
      async getIdentity() {
        return {
          name: 'Alice',
          publicKey: 'alice-public-key',
          mvcAddress: 'mvc-alice',
          btcAddress: 'btc-alice',
          dogeAddress: 'doge-alice',
          metaId: 'metaid-alice',
          globalMetaId: LOCAL_GLOBAL_META_ID,
        };
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: LOCAL_GLOBAL_META_ID,
          privateKeyHex: '1'.repeat(64),
          chatPublicKey: 'local-chat-public-key',
        };
      },
      async writePin(input) {
        writes.push(input);
        const index = writes.length;
        const pathPart = String(input.path || '').includes('skill-service-rate')
          ? 'skill-service-rate'
          : 'simplemsg';
        return {
          txids: [`${pathPart}-tx-${index}`],
          pinId: `${pathPart}-pin-${index}`,
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding || 'utf-8',
          globalMetaId: LOCAL_GLOBAL_META_ID,
          mvcAddress: 'mvc-alice',
        };
      },
    },
  });

  const handled = await handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: PEER_GLOBAL_META_ID,
    content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
    messagePinId: 'needs-rating-pin-inbound',
    timestamp: BASE_TIME + 80,
  });
  const traceResult = await handlers.trace.getTrace({ traceId: 'legacy-trace-inbound-needs-rating' });

  assert.equal(handled.ok, true);
  assert.equal(handled.data.rated, true);
  assert.equal(writes.filter((entry) => entry.path === '/protocols/skill-service-rate').length, 1);
  assert.equal(writes.filter((entry) => entry.path === '/protocols/simplemsg').length, 1);
  assert.equal(traceResult.ok, true);
  assert.equal(traceResult.data.ratingPublished, true);
  assert.equal(traceResult.data.ratingValue, 5);
  assert.equal(traceResult.data.ratingComment, '评分：5分。结果清晰，响应可靠，谢谢你的天气服务。');
  assert.equal(traceResult.data.ratingMessageSent, true);
});

test('parallel inbound NeedsRating handlers publish only one skill-service-rate pin', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-parallel-needs-rating',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: BASE_TIME,
    session: {
      id: 'session-parallel-needs-rating',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-parallel-needs-rating',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: `${ORDER_TXID}i0`,
      orderTxid: ORDER_TXID,
      orderTxids: [ORDER_TXID],
      paymentTxid: PAYMENT_TXID,
      orderReference: null,
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00005',
    },
    a2a: {
      sessionId: 'legacy-session-parallel-needs-rating',
      taskRunId: 'legacy-run-parallel-needs-rating',
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'queued',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'service-pin-1',
    },
  });
  await runtimeStateStore.writeState({
    identity: {
      metabotId: 1,
      name: 'Alice',
      createdAt: BASE_TIME,
      path: '/MetaBot/Alice',
      publicKey: 'alice-public-key',
      chatPublicKey: 'local-chat-public-key',
      mvcAddress: 'mvc-alice',
      btcAddress: 'btc-alice',
      dogeAddress: 'doge-alice',
      metaId: 'metaid-alice',
      globalMetaId: LOCAL_GLOBAL_META_ID,
    },
    services: [],
    traces: [trace],
  });
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-parallel-needs-rating',
        traceId: 'legacy-trace-parallel-needs-rating',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'legacy-run-parallel-needs-rating',
        latestTaskRunState: 'queued',
      },
    ],
    taskRuns: [
      {
        runId: 'legacy-run-parallel-needs-rating',
        sessionId: 'legacy-session-parallel-needs-rating',
        state: 'queued',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 10,
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureReason: null,
        clarificationRounds: [],
      },
    ],
    transcriptItems: [
      {
        id: 'legacy-user-parallel-rating',
        sessionId: 'legacy-session-parallel-needs-rating',
        taskRunId: 'legacy-run-parallel-needs-rating',
        timestamp: BASE_TIME,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather',
        metadata: {
          paymentTxid: PAYMENT_TXID,
        },
      },
    ],
    cursors: { caller: null, provider: null },
    publicStatusSnapshots: [
      {
        sessionId: 'legacy-session-parallel-needs-rating',
        taskRunId: 'legacy-run-parallel-needs-rating',
        status: 'requesting_remote',
        mapped: true,
        rawEvent: 'request_sent',
        resolvedAt: BASE_TIME + 1,
      },
    ],
  });
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
    chainApiBaseUrl: 'http://127.0.0.1:9',
    socketPresenceFailureMode: 'assume_service_providers_online',
    fetchPeerChatPublicKey: async () => '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    buyerRatingReplyRunner: async () => ({
      state: 'reply',
      content: '评分：5分。并行请求只应落一条链上评价。',
    }),
    signer: {
      async getIdentity() {
        return {
          name: 'Alice',
          publicKey: 'alice-public-key',
          mvcAddress: 'mvc-alice',
          btcAddress: 'btc-alice',
          dogeAddress: 'doge-alice',
          metaId: 'metaid-alice',
          globalMetaId: LOCAL_GLOBAL_META_ID,
        };
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: LOCAL_GLOBAL_META_ID,
          privateKeyHex: '1'.repeat(64),
          chatPublicKey: 'local-chat-public-key',
        };
      },
      async writePin(input) {
        writes.push(input);
        const index = writes.length;
        const pathPart = String(input.path || '').includes('skill-service-rate')
          ? 'skill-service-rate'
          : 'simplemsg';
        return {
          txids: [`${pathPart}-tx-${index}`],
          pinId: `${pathPart}-pin-${index}`,
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding || 'utf-8',
          globalMetaId: LOCAL_GLOBAL_META_ID,
          mvcAddress: 'mvc-alice',
        };
      },
    },
  });

  const ratingBody = `[NeedsRating:${ORDER_TXID}] Please rate this service.`;
  await Promise.all([
    handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: PEER_GLOBAL_META_ID,
      content: ratingBody,
      messagePinId: 'needs-rating-parallel-a',
      timestamp: BASE_TIME + 80,
    }),
    handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: PEER_GLOBAL_META_ID,
      content: ratingBody,
      messagePinId: 'needs-rating-parallel-b',
      timestamp: BASE_TIME + 81,
    }),
    handlers.services.handleInboundOrderProtocolMessage({
      fromGlobalMetaId: PEER_GLOBAL_META_ID,
      content: ratingBody,
      messagePinId: 'needs-rating-parallel-c',
      timestamp: BASE_TIME + 82,
    }),
  ]);

  assert.equal(writes.filter((entry) => entry.path === '/protocols/skill-service-rate').length, 1);
  assert.equal(writes.filter((entry) => entry.path === '/protocols/simplemsg').length, 1);
});

test('legacy trace detail prefers scoped on-chain simplemsg history over local synthetic bubbles', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const statusTxid = 'b'.repeat(64);
  const deliveryTxid = 'c'.repeat(64);
  const needsRatingTxid = 'd'.repeat(64);
  const orderEndTxid = 'e'.repeat(64);
  const localRatingTxid = 'f'.repeat(64);
  const unrelatedOrderTxid = '1'.repeat(64);
  const unrelatedDeliveryTxid = '2'.repeat(64);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-chain-history',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: BASE_TIME,
    session: {
      id: 'session-legacy-chain-history',
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: {
      id: 'order-legacy-chain-history',
      role: 'buyer',
      serviceId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      orderPinId: `${ORDER_TXID}i0`,
      orderTxid: ORDER_TXID,
      orderTxids: [ORDER_TXID],
      paymentTxid: PAYMENT_TXID,
      orderReference: null,
      paymentCurrency: 'SPACE',
      paymentAmount: '0.00005',
    },
    a2a: {
      sessionId: 'legacy-session-chain-history',
      taskRunId: 'legacy-run-chain-history',
      role: 'caller',
      publicStatus: 'completed',
      latestEvent: 'provider_completed',
      taskRunState: 'completed',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'service-pin-1',
    },
  });
  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces: [trace],
  });
  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-chain-history',
        traceId: 'legacy-trace-chain-history',
        role: 'caller',
        state: 'completed',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 500,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'legacy-run-chain-history',
        latestTaskRunState: 'completed',
      },
    ],
    taskRuns: [],
    transcriptItems: [
      {
        id: 'legacy-user-summary',
        sessionId: 'legacy-session-chain-history',
        taskRunId: 'legacy-run-chain-history',
        timestamp: BASE_TIME,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather',
        metadata: { paymentTxid: PAYMENT_TXID },
      },
      {
        id: 'local-rating-detail',
        sessionId: 'legacy-session-chain-history',
        taskRunId: 'legacy-run-chain-history',
        timestamp: BASE_TIME + 400,
        type: 'rating',
        sender: 'caller',
        content: 'Five stars',
        metadata: {
          event: 'service_rating_published',
          ratingPinId: `${localRatingTxid}i0`,
          ratingMessageSent: false,
          ratingMessageError: '[-26] txn-mempool-conflict',
        },
      },
    ],
    cursors: { caller: null, provider: null },
    publicStatusSnapshots: [],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
    fetchPeerChatPublicKey: async () => 'peer-chat-public-key',
    signer: {
      getPrivateChatIdentity: async () => ({
        globalMetaId: LOCAL_GLOBAL_META_ID,
        privateKeyHex: '1'.repeat(64),
        chatPublicKey: 'local-chat-public-key',
      }),
    },
    fetchPrivateChatHistory: async () => [
      privateHistoryRow({
        index: 0,
        from: 'local',
        txid: unrelatedOrderTxid,
        content: `[ORDER] Earlier order for the same service\n<raw_request>\nEarlier order\n</raw_request>\ntxid: other-payment-tx\nservice id: service-pin-1\nskill name: Weather Oracle`,
      }),
      privateHistoryRow({
        index: 0.5,
        from: 'peer',
        txid: unrelatedDeliveryTxid,
        content: `[DELIVERY:${unrelatedOrderTxid}] ${JSON.stringify({
          paymentTxid: 'other-payment-tx',
          servicePinId: 'service-pin-1',
          result: '# Earlier Forecast',
        })}`,
      }),
      privateHistoryRow({
        index: 1,
        from: 'local',
        txid: ORDER_TXID,
        content: `[ORDER] Tell me tomorrow weather\n<raw_request>\nTell me tomorrow weather\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
      }),
      privateHistoryRow({
        index: 2,
        from: 'peer',
        txid: statusTxid,
        content: `[ORDER_STATUS:${ORDER_TXID}] I received the order and started processing.`,
      }),
      privateHistoryRow({
        index: 3,
        from: 'peer',
        txid: deliveryTxid,
        content: `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
          paymentTxid: PAYMENT_TXID,
          servicePinId: 'service-pin-1',
          serviceName: 'Weather Oracle',
          result: '# Forecast\n\nSunny with light wind.',
          deliveredAt: BASE_TIME + 300,
        })}`,
      }),
      privateHistoryRow({
        index: 4,
        from: 'peer',
        txid: needsRatingTxid,
        content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
      }),
      privateHistoryRow({
        index: 5,
        from: 'peer',
        txid: orderEndTxid,
        content: `[ORDER_END:${ORDER_TXID} rating_timeout] Rating timed out; the order is closed.`,
      }),
    ],
  });

  const detailResult = await handlers.trace.getSession({ sessionId: 'legacy-session-chain-history' });

  assert.equal(detailResult.ok, true);
  const items = detailResult.data.inspector.transcriptItems;
  assert.deepEqual(items.map((item) => item.metadata.txid), [
    ORDER_TXID,
    statusTxid,
    deliveryTxid,
    needsRatingTxid,
    orderEndTxid,
  ]);
  assert.deepEqual(items.map((item) => item.type), [
    'order',
    'order_status',
    'delivery',
    'needs_rating',
    'order_end',
  ]);
  assert.equal(items[0].sender, 'caller');
  assert.equal(items[1].sender, 'provider');
  assert.equal(items[2].content, '# Forecast\n\nSunny with light wind.');
  assert.equal(items[3].content, 'Please rate this service.');
  assert.equal(items[4].content, 'Rating timed out; the order is closed.');
  assert.equal(items.some((item) => item.metadata.ratingPinId === `${localRatingTxid}i0`), false);
  assert.equal(detailResult.data.resultText, '# Forecast\n\nSunny with light wind.');
  assert.equal(detailResult.data.ratingRequestText, 'Please rate this service.');
  assert.equal(detailResult.data.localMetabotAvatar, LOCAL_AVATAR);
  assert.equal(detailResult.data.peerAvatar, PEER_AVATAR);
});

test('default trace handlers sort legacy transcript items with mixed seconds and milliseconds timestamps', async () => {
  const { systemHomeDir, homeDir } = await createProfileFixture();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const trace = buildSessionTrace({
    traceId: 'legacy-trace-mixed-timestamps',
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: 1_777_658_751_699,
    session: {
      id: 'session-legacy-mixed-timestamps',
      title: 'Mixed Timestamp Trace',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      peerName: 'Remote Bot',
      externalConversationId: null,
    },
    order: null,
    a2a: {
      sessionId: 'legacy-session-mixed-timestamps',
      taskRunId: 'legacy-run-mixed-timestamps',
      role: 'caller',
      publicStatus: 'completed',
      latestEvent: 'provider_completed',
      taskRunState: 'completed',
      callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
      providerGlobalMetaId: PEER_GLOBAL_META_ID,
      providerName: 'Remote Bot',
      servicePinId: 'legacy-service-pin',
    },
  });
  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces: [trace],
  });

  const store = createSessionStateStore(homeDir);
  await store.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'legacy-session-mixed-timestamps',
        traceId: 'legacy-trace-mixed-timestamps',
        role: 'caller',
        state: 'completed',
        createdAt: 1_777_658_751_699,
        updatedAt: 1_777_658_848_557,
        callerGlobalMetaId: LOCAL_GLOBAL_META_ID,
        providerGlobalMetaId: PEER_GLOBAL_META_ID,
        servicePinId: 'legacy-service-pin',
        currentTaskRunId: 'legacy-run-mixed-timestamps',
        latestTaskRunState: 'completed',
      },
    ],
    taskRuns: [],
    transcriptItems: [
      {
        id: 'provider-delivery-seconds',
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        timestamp: 1_777_658_847,
        type: 'assistant',
        sender: 'provider',
        content: 'legacy weather result',
        metadata: {
          deliveryPinId: 'delivery-pin-seconds',
          publicStatus: 'completed',
        },
      },
      {
        id: 'provider-needs-rating-seconds',
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        timestamp: 1_777_658_848,
        type: 'rating_request',
        sender: 'provider',
        content: 'Please rate this service.',
        metadata: { needsRating: true },
      },
      {
        id: 'caller-rating-seconds',
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        timestamp: 1_777_658_849,
        type: 'rating',
        sender: 'caller',
        content: 'Great service.',
        metadata: {
          ratingPinId: 'rating-pin-seconds',
          rate: '5',
        },
      },
      {
        id: 'caller-request-millis',
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        timestamp: 1_777_658_751_699,
        type: 'user_task',
        sender: 'caller',
        content: 'query weather',
        metadata: null,
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [
      {
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        status: 'completed',
        mapped: true,
        rawEvent: 'provider_completed',
        resolvedAt: 1_777_658_848,
      },
      {
        sessionId: 'legacy-session-mixed-timestamps',
        taskRunId: 'legacy-run-mixed-timestamps',
        status: 'requesting_remote',
        mapped: true,
        rawEvent: 'request_sent',
        resolvedAt: 1_777_658_751_699,
      },
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });

  const detailResult = await handlers.trace.getSession({ sessionId: 'legacy-session-mixed-timestamps' });

  assert.equal(detailResult.ok, true);
  assert.deepEqual(detailResult.data.inspector.transcriptItems.map((item) => item.id), [
    'caller-request-millis',
    'provider-delivery-seconds',
    'provider-needs-rating-seconds',
    'caller-rating-seconds',
  ]);
  assert.deepEqual(detailResult.data.inspector.publicStatusSnapshots.map((item) => item.rawEvent), [
    'request_sent',
    'provider_completed',
  ]);
  assert.equal(detailResult.data.resultObservedAt, 1_777_658_847_000);
  assert.equal(detailResult.data.ratingRequestedAt, 1_777_658_848_000);
  assert.equal(detailResult.data.ratingCreatedAt, 1_777_658_849_000);
});

test('caller-side projection hides provider-side service-order sessions for this phase', async () => {
  const { homeDir, profile } = await createProfileFixture();
  const store = createA2AConversationStore({
    homeDir,
    local: {
      profileSlug: 'alice',
      globalMetaId: LOCAL_GLOBAL_META_ID,
      name: 'Alice',
    },
    peer: {
      globalMetaId: PEER_GLOBAL_META_ID,
      name: 'Remote Bot',
    },
  });

  await store.upsertSession({
    sessionId: PEER_SESSION_ID,
    type: 'peer',
    state: 'active',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    latestMessageId: null,
  });
  await store.upsertSession({
    sessionId: 'a2a-order-provider-side',
    type: 'service_order',
    role: 'seller',
    state: 'remote_executing',
    orderTxid: 'b'.repeat(64),
    paymentTxid: 'provider-payment-tx',
    servicePinId: 'seller-service-pin',
    serviceName: 'Seller Flow',
    outputType: 'markdown',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 1,
  });

  const sessions = await listUnifiedA2ATraceSessionsForProfile({ profile });
  assert.deepEqual(sessions.map((session) => session.sessionId), [PEER_SESSION_ID]);
  assert.equal(
    await getUnifiedA2ATraceSessionForProfile({
      profile,
      sessionId: 'a2a-order-provider-side',
    }),
    null,
  );
});

test('projection derives completed state from delivery messages written by the real persistence path', async () => {
  const { homeDir, profile } = await createProfileFixture();
  const local = {
    profileSlug: 'alice',
    globalMetaId: LOCAL_GLOBAL_META_ID,
    name: 'Alice',
    chatPublicKey: 'alice-chat-public-key',
  };
  const peer = {
    globalMetaId: PEER_GLOBAL_META_ID,
    name: 'Remote Bot',
    chatPublicKey: 'remote-chat-public-key',
  };

  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      direction: 'outgoing',
      content: `[ORDER] Do the work\n<raw_request>\nDo the work\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
      pinId: 'order-pin-real-path',
      txid: ORDER_TXID,
      txids: [ORDER_TXID],
      chain: 'mvc',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      timestamp: BASE_TIME,
    },
    orderSession: {
      role: 'caller',
      state: 'awaiting_delivery',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      servicePinId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      outputType: 'markdown',
    },
  });
  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      messageId: 'delivery-pin-real-path',
      direction: 'incoming',
      content: `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
        result: '# Done',
        servicePinId: 'service-pin-1',
        serviceName: 'Weather Oracle',
      })}`,
      pinId: 'delivery-pin-real-path',
      txid: 'delivery-tx-real-path',
      chain: 'mvc',
      timestamp: BASE_TIME + 10,
    },
  });

  const sessions = await listUnifiedA2ATraceSessionsForProfile({ profile });
  assert.deepEqual(sessions.map((session) => session.sessionId), [PEER_SESSION_ID]);

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: ORDER_SESSION_ID,
  });
  assert.ok(detail);
  assert.equal(detail.resultText, '# Done');
  assert.equal(detail.responseText, '# Done');
  assert.equal(detail.a2a.publicStatus, 'completed');
  assert.equal(detail.publicStatusSnapshots[0].status, 'completed');
  assert.equal(detail.order.serviceId, 'service-pin-1');
  assert.equal(detail.session.serviceName, 'Weather Oracle');
});

test('projection derives completed state from NeedsRating messages written by the real persistence path', async () => {
  const { homeDir, profile } = await createProfileFixture();
  const local = {
    profileSlug: 'alice',
    globalMetaId: LOCAL_GLOBAL_META_ID,
    name: 'Alice',
    chatPublicKey: 'alice-chat-public-key',
  };
  const peer = {
    globalMetaId: PEER_GLOBAL_META_ID,
    name: 'Remote Bot',
    chatPublicKey: 'remote-chat-public-key',
  };

  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      direction: 'outgoing',
      content: `[ORDER] Do the work\n<raw_request>\nDo the work\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
      pinId: 'order-pin-rating-path',
      txid: ORDER_TXID,
      txids: [ORDER_TXID],
      chain: 'mvc',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      timestamp: BASE_TIME,
    },
    orderSession: {
      role: 'caller',
      state: 'awaiting_delivery',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      servicePinId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      outputType: 'markdown',
    },
  });
  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      messageId: 'needs-rating-pin-real-path',
      direction: 'incoming',
      content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
      pinId: 'needs-rating-pin-real-path',
      txid: 'needs-rating-tx-real-path',
      chain: 'mvc',
      timestamp: BASE_TIME + 10,
    },
  });

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: ORDER_SESSION_ID,
  });
  assert.ok(detail);
  assert.equal(detail.session.state, 'active');
  assert.equal(detail.a2a.publicStatus, 'completed');
  assert.equal(detail.ratingRequestText, 'Please rate this service.');
  assert.equal(detail.order.serviceId, 'service-pin-1');
});

test('projection derives failed state from ORDER_END failure messages written by the real persistence path', async () => {
  const { homeDir, profile } = await createProfileFixture();
  const local = {
    profileSlug: 'alice',
    globalMetaId: LOCAL_GLOBAL_META_ID,
    name: 'Alice',
    chatPublicKey: 'alice-chat-public-key',
  };
  const peer = {
    globalMetaId: PEER_GLOBAL_META_ID,
    name: 'Remote Bot',
    chatPublicKey: 'remote-chat-public-key',
  };

  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      direction: 'outgoing',
      content: `[ORDER] Do the work\n<raw_request>\nDo the work\n</raw_request>\ntxid: ${PAYMENT_TXID}\nservice id: service-pin-1\nskill name: Weather Oracle`,
      pinId: 'order-pin-failure-path',
      txid: ORDER_TXID,
      txids: [ORDER_TXID],
      chain: 'mvc',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      timestamp: BASE_TIME,
    },
    orderSession: {
      role: 'caller',
      state: 'awaiting_delivery',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      servicePinId: 'service-pin-1',
      serviceName: 'Weather Oracle',
      outputType: 'markdown',
    },
  });
  await persistA2AConversationMessage({
    homeDir,
    local,
    peer,
    message: {
      messageId: 'order-end-pin-real-path',
      direction: 'incoming',
      content: `[ORDER_END:${ORDER_TXID} failed] Could not complete this order.`,
      pinId: 'order-end-pin-real-path',
      txid: 'order-end-tx-real-path',
      chain: 'mvc',
      timestamp: BASE_TIME + 10,
    },
  });

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: ORDER_SESSION_ID,
  });
  assert.ok(detail);
  assert.equal(detail.session.state, 'active');
  assert.equal(detail.a2a.publicStatus, 'remote_failed');
  assert.equal(detail.order.serviceId, 'service-pin-1');
  const orderEnd = detail.transcriptItems.find((item) => item.type === 'order_end');
  assert.ok(orderEnd);
  assert.equal(orderEnd.metadata.endReason, 'failed');
});
