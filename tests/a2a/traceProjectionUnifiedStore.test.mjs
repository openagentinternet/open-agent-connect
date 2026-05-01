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
const {
  getUnifiedA2ATraceSessionForProfile,
  listUnifiedA2ATraceSessionsForProfile,
} = require('../../dist/core/a2a/traceProjection.js');
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

test('listUnifiedA2ATraceSessionsForProfile lists peer and service-order sessions from per-peer JSON', async () => {
  const { homeDir, profile } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);

  const sessions = await listUnifiedA2ATraceSessionsForProfile({
    profile,
    daemon: { baseUrl: 'http://127.0.0.1:38245' },
  });

  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((session) => session.sessionId), [
    PEER_SESSION_ID,
    ORDER_SESSION_ID,
  ]);
  assert.equal(sessions[0].traceId, PEER_SESSION_ID);
  assert.equal(sessions[0].role, 'caller');
  assert.equal(sessions[0].state, 'active');
  assert.equal(sessions[0].localMetabotName, 'Alice');
  assert.equal(sessions[0].localMetabotGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(sessions[0].peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(sessions[0].peerName, 'Remote Bot');
  assert.equal(sessions[0].source, 'unified_a2a');

  assert.equal(sessions[1].traceId, ORDER_SESSION_ID);
  assert.equal(sessions[1].role, 'caller');
  assert.equal(sessions[1].state, 'completed');
  assert.equal(sessions[1].servicePinId, 'service-pin-1');
  assert.equal(sessions[1].serviceName, 'Weather Oracle');
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

test('getUnifiedA2ATraceSessionForProfile scopes service-order details and exposes delivery markdown result', async () => {
  const { homeDir, profile } = await createProfileFixture();
  await seedUnifiedConversation(homeDir);

  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile,
    sessionId: ORDER_SESSION_ID,
    daemon: { baseUrl: 'http://127.0.0.1:38245' },
  });

  assert.ok(detail);
  assert.equal(detail.sessionId, ORDER_SESSION_ID);
  assert.equal(detail.traceId, ORDER_SESSION_ID);
  assert.equal(detail.session.sessionId, ORDER_SESSION_ID);
  assert.equal(detail.session.role, 'caller');
  assert.equal(detail.session.state, 'completed');
  assert.equal(detail.orderTxid, ORDER_TXID);
  assert.equal(detail.paymentTxid, PAYMENT_TXID);
  assert.equal(detail.order.serviceId, 'service-pin-1');
  assert.equal(detail.order.serviceName, 'Weather Oracle');
  assert.equal(detail.a2a.publicStatus, 'completed');
  assert.equal(detail.transcriptItems.length, 4);
  assert.deepEqual(detail.transcriptItems.map((item) => item.id), [
    'msg-2',
    'msg-3',
    'msg-4',
    'msg-5',
  ]);

  const delivery = detail.transcriptItems.find((item) => item.type === 'delivery');
  assert.ok(delivery);
  assert.equal(delivery.sender, 'provider');
  assert.equal(delivery.content, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');
  assert.equal(delivery.metadata.protocolTag, 'DELIVERY');
  assert.equal(delivery.metadata.deliveryPinId, 'pin-4');
  assert.equal(detail.resultText, delivery.content);
  assert.equal(detail.responseText, delivery.content);
  assert.equal(detail.ratingRequestText, 'Please rate this service.');
  assert.equal(detail.inspector.transcriptItems.length, 4);
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
  assert.equal(listResult.data.sessions.length, 2);
  assert.deepEqual(listResult.data.sessions.map((session) => session.sessionId), [
    PEER_SESSION_ID,
    ORDER_SESSION_ID,
  ]);
  assert.equal(listResult.data.stats.totalCount, 2);
  assert.equal(listResult.data.stats.callerCount, 2);

  const detailResult = await handlers.trace.getSession({ sessionId: ORDER_SESSION_ID });
  assert.equal(detailResult.ok, true);
  assert.equal(detailResult.data.sessionId, ORDER_SESSION_ID);
  assert.equal(detailResult.data.responseText, '# Forecast\n\nSunny with light wind.\n\nmetafile://weather-chart-1');
  assert.equal(detailResult.data.inspector.transcriptItems.length, 4);
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
  const orderSession = sessions.find((session) => session.sessionId === ORDER_SESSION_ID);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'completed');
  assert.equal(orderSession.servicePinId, 'service-pin-1');
  assert.equal(orderSession.serviceName, 'Weather Oracle');

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
  assert.equal(detail.session.state, 'completed');
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
  assert.equal(detail.session.state, 'remote_failed');
  assert.equal(detail.a2a.publicStatus, 'remote_failed');
  assert.equal(detail.order.serviceId, 'service-pin-1');
  const orderEnd = detail.transcriptItems.find((item) => item.type === 'order_end');
  assert.ok(orderEnd);
  assert.equal(orderEnd.metadata.endReason, 'failed');
});
