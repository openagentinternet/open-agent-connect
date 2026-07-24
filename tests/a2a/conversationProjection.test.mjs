import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const {
  listPeerConversationSummaries,
  readPeerConversationMessages,
} = require('../../dist/core/a2a/conversationProjection.js');
const {
  persistA2AConversationMessage,
} = require('../../dist/core/a2a/conversationPersistence.js');

const LOCAL_GLOBAL_META_ID = 'idq1localconversation0000000000000000000';
const PEER_GLOBAL_META_ID = 'idq1peerconversation00000000000000000000';
const OTHER_LOCAL_GLOBAL_META_ID = 'idq1otherconversation0000000000000000000';
const BASE_TIME = 1_777_400_000_000;

function actor(globalMetaId, name) {
  return {
    globalMetaId,
    name,
    avatar: `https://example.test/${name.toLowerCase().replace(/\s+/g, '-')}.png`,
    chatPublicKey: `${name.toLowerCase().replace(/\s+/g, '-')}-chat-public-key`,
  };
}

function message(index, overrides = {}) {
  const direction = overrides.direction ?? 'outgoing';
  const local = actor(LOCAL_GLOBAL_META_ID, 'Eric');
  const peer = actor(PEER_GLOBAL_META_ID, 'Weather Bot');
  return {
    messageId: `msg-${index}`,
    sessionId: 'a2a-peer-idq1loca-idq1peer',
    orderSessionId: null,
    direction,
    kind: 'private_chat',
    protocolTag: null,
    orderTxid: null,
    serviceOrderPinId: null,
    orderPinId: null,
    paymentTxid: null,
    content: `message ${index}`,
    contentType: overrides.contentType ?? 'text/plain',
    chain: 'mvc',
    pinId: `${String(index).padStart(64, 'a')}i0`,
    txid: `${String(index).padStart(64, 'b')}`,
    txids: [`${String(index).padStart(64, 'b')}`],
    replyPinId: null,
    timestamp: BASE_TIME + index,
    chainTimestamp: Math.floor((BASE_TIME + index) / 1000),
    sender: direction === 'outgoing' ? local : peer,
    recipient: direction === 'outgoing' ? peer : local,
    raw: null,
    ...overrides,
  };
}

async function writeConversation(homeDir, options = {}) {
  const local = actor(options.localGlobalMetaId ?? LOCAL_GLOBAL_META_ID, options.localName ?? 'Eric');
  const peer = actor(options.peerGlobalMetaId ?? PEER_GLOBAL_META_ID, options.peerName ?? 'Weather Bot');
  const messages = options.messages ?? [
    message(1, { direction: 'incoming', content: 'hi Eric' }),
    message(2, { content: 'create a weather order' }),
    message(3, {
      direction: 'incoming',
      kind: 'order_protocol',
      protocolTag: 'DELIVERY',
      orderTxid: 'a'.repeat(64),
      orderSessionId: `a2a-order-${'a'.repeat(64)}`,
      content: 'DELIVERY: forecast result',
    }),
  ];
  const store = createA2AConversationStore({ homeDir, local, peer });
  await store.writeConversation({
    version: 1,
    local,
    peer,
    messages,
    sessions: [
      {
        sessionId: 'a2a-peer-idq1loca-idq1peer',
        type: 'peer',
        state: 'active',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME + 3,
        latestMessageId: 'msg-3',
      },
      {
        sessionId: `a2a-order-${'a'.repeat(64)}`,
        type: 'service_order',
        role: 'caller',
        state: 'completed',
        orderTxid: 'a'.repeat(64),
        serviceName: 'Weather forecast',
        createdAt: BASE_TIME + 2,
        updatedAt: BASE_TIME + 3,
        deliveredAt: BASE_TIME + 3,
      },
    ],
    indexes: {
      messageIds: messages.map((entry) => entry.messageId),
      orderTxidToSessionId: {},
      paymentTxidToSessionId: {},
    },
    updatedAt: BASE_TIME + 3,
  });
}

test('listPeerConversationSummaries groups all simplemsg kinds by local and remote Bot pair', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-projection-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  await writeConversation(homeDir);
  await writeConversation(homeDir, {
    localGlobalMetaId: OTHER_LOCAL_GLOBAL_META_ID,
    localName: 'Other Bot',
    peerGlobalMetaId: 'idq1outsideconversation000000000000000',
    peerName: 'Outside Bot',
  });

  const result = await listPeerConversationSummaries({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
  });

  assert.equal(result.localBot.globalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].localGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(result.conversations[0].peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(result.conversations[0].peerName, 'Weather Bot');
  assert.equal(result.conversations[0].latestText, 'DELIVERY: forecast result');
  assert.deepEqual(result.conversations[0].kinds, ['private_chat', 'order_protocol']);
  assert.equal(result.conversations[0].messageCount, 3);
});

test('readPeerConversationMessages returns the latest peer timeline and older pages', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-messages-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  await writeConversation(homeDir, {
    messages: [
      message(1, { direction: 'incoming', content: 'oldest' }),
      message(2, { content: 'middle' }),
      message(3, { direction: 'incoming', content: 'latest', contentType: 'text/markdown' }),
    ],
  });

  const latest = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    limit: 2,
  });
  const older = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    before: latest.pagination.beforeCursor,
    limit: 2,
  });

  assert.deepEqual(latest.messages.map((entry) => entry.content), ['middle', 'latest']);
  assert.deepEqual(latest.messages.map((entry) => entry.contentType), ['text/plain', 'text/markdown']);
  assert.deepEqual(latest.messages.map((entry) => entry.txid), [
    `${String(2).padStart(64, 'b')}`,
    `${String(3).padStart(64, 'b')}`,
  ]);
  assert.deepEqual(latest.messages.map((entry) => entry.txids), [
    [`${String(2).padStart(64, 'b')}`],
    [`${String(3).padStart(64, 'b')}`],
  ]);
  assert.equal(latest.pagination.hasMoreBefore, true);
  assert.equal(latest.pagination.beforeCursor, BASE_TIME + 2);
  assert.deepEqual(older.messages.map((entry) => entry.content), ['oldest']);
  assert.equal(older.pagination.hasMoreBefore, false);
});

test('conversation projections keep mixed second and millisecond timestamps in one normalized timeline', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-mixed-timestamps-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  await writeConversation(homeDir, {
    messages: [
      message(1, {
        content: 'older local',
        timestamp: 1_783_325_772_242,
      }),
      message(2, {
        content: 'local 08:19',
        timestamp: 1_783_325_963_021,
      }),
      message(3, {
        direction: 'incoming',
        content: 'remote 08:20',
        timestamp: 1_783_326_031,
      }),
    ],
  });

  const latest = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    limit: 2,
  });
  const older = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    before: latest.pagination.beforeCursor,
    limit: 2,
  });
  const summaries = await listPeerConversationSummaries({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
  });

  assert.deepEqual(latest.messages.map((entry) => entry.content), [
    'local 08:19',
    'remote 08:20',
  ]);
  assert.equal(latest.messages[1].direction, 'incoming');
  assert.equal(latest.messages[1].timestamp, 1_783_326_031_000);
  assert.equal(latest.pagination.beforeCursor, 1_783_325_963_021);
  assert.equal(latest.pagination.hasMoreBefore, true);
  assert.deepEqual(older.messages.map((entry) => entry.content), ['older local']);
  assert.equal(summaries.conversations[0].latestText, 'remote 08:20');
  assert.equal(summaries.conversations[0].latestAt, 1_783_326_031_000);
});

test('readPeerConversationMessages unwraps simplemsg JSON content payloads for Markdown display', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-markdown-payload-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  await writeConversation(homeDir, {
    messages: [
      message(1, {
        direction: 'incoming',
        content: JSON.stringify({
          content: '# Markdown reply\n\n**done**',
          contentType: 'text/markdown',
        }),
        contentType: 'text/plain',
      }),
    ],
  });

  const result = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
  });
  const summaries = await listPeerConversationSummaries({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].content, '# Markdown reply\n\n**done**');
  assert.equal(result.messages[0].contentType, 'text/markdown');
  assert.equal(summaries.conversations[0].latestText, '# Markdown reply\n\n**done**');
});

test('readPeerConversationMessages uses raw simplemsg contentType for already decrypted Markdown text', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-markdown-raw-type-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  await writeConversation(homeDir, {
    messages: [
      message(1, {
        direction: 'incoming',
        content: 'Understood\n\n**Markdown body**\n\n1. First',
        contentType: 'text/plain',
        raw: {
          protocol: '/protocols/simplemsg',
          contentType: 'text/markdown',
        },
      }),
    ],
  });

  const result = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].content, 'Understood\n\n**Markdown body**\n\n1. First');
  assert.equal(result.messages[0].contentType, 'text/markdown');
});

test('persistA2AConversationMessage stores simplemsg JSON payload contentType for Markdown display', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-markdown-persist-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));

  const persisted = await persistA2AConversationMessage({
    homeDir,
    local: actor(LOCAL_GLOBAL_META_ID, 'Eric'),
    peer: actor(PEER_GLOBAL_META_ID, 'Weather Bot'),
    message: {
      direction: 'incoming',
      content: JSON.stringify({
        content: '## Fresh Markdown',
        contentType: 'text/markdown',
      }),
      contentType: 'application/json',
      timestamp: BASE_TIME + 4,
    },
  });

  const result = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
  });

  assert.equal(persisted.content, '## Fresh Markdown');
  assert.equal(persisted.contentType, 'text/markdown');
  assert.equal(result.messages[0].content, '## Fresh Markdown');
  assert.equal(result.messages[0].contentType, 'text/markdown');
});

test('persistA2AConversationMessage normalizes Unix-second message timestamps to milliseconds', async (t) => {
  const homeDir = await createProfileHome('metabot-a2a-conversation-seconds-persist-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));

  const persisted = await persistA2AConversationMessage({
    homeDir,
    local: actor(LOCAL_GLOBAL_META_ID, 'Eric'),
    peer: actor(PEER_GLOBAL_META_ID, 'Weather Bot'),
    message: {
      direction: 'incoming',
      content: 'seconds timestamp from the socket stream',
      timestamp: 1_784_910_335,
    },
  });

  assert.equal(persisted.timestamp, 1_784_910_335_000);

  const result = await readPeerConversationMessages({
    homeDir,
    localGlobalMetaId: LOCAL_GLOBAL_META_ID,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].timestamp, 1_784_910_335_000);
});
