import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createA2AConversationStore,
  resolveA2AConversationFilePath,
} = require('../../dist/core/a2a/conversationStore.js');
const {
  resolveMetabotPaths,
} = require('../../dist/core/state/paths.js');

const LOCAL_GLOBAL_META_ID = 'idq14hmvlocal000000000000000000000000';
const PEER_GLOBAL_META_ID = 'idq1g35dpeer0000000000000000000000000';

function createProfileHome(prefix, slug = 'alice') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

function createStore(homeDir = createProfileHome('metabot-a2a-conversation-')) {
  return createA2AConversationStore({
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
      chatPublicKey: 'peer-chat-public-key',
    },
  });
}

function createMessage(index, overrides = {}) {
  return {
    messageId: `msg-${index}`,
    sessionId: 'a2a-peer-idq14hmv-idq1g35d',
    orderSessionId: null,
    direction: 'outgoing',
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
    timestamp: 1_770_000_000_000 + index,
    chainTimestamp: 1_770_000_000 + index,
    sender: {
      globalMetaId: LOCAL_GLOBAL_META_ID,
      name: 'Alice',
      avatar: 'https://example.test/alice.png',
      chatPublicKey: 'local-chat-public-key',
    },
    recipient: {
      globalMetaId: PEER_GLOBAL_META_ID,
      name: 'Remote Bot',
      avatar: 'https://example.test/remote.png',
    },
    raw: {
      socket: {
        seq: index,
      },
    },
    ...overrides,
  };
}

function createPeerSession(overrides = {}) {
  return {
    sessionId: 'a2a-peer-idq14hmv-idq1g35d',
    type: 'peer',
    state: 'active',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
    latestMessageId: 'msg-1',
    ...overrides,
  };
}

function createOrderSession(overrides = {}) {
  return {
    sessionId: 'a2a-order-order-tx-1',
    type: 'service_order',
    role: 'caller',
    state: 'awaiting_delivery',
    orderTxid: 'order-tx-1',
    paymentTxid: 'payment-tx-1',
    servicePinId: 'service-pin-1',
    serviceName: 'Weather Oracle',
    outputType: 'text',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
    firstResponseAt: null,
    deliveredAt: null,
    ratingRequestedAt: null,
    endedAt: null,
    endReason: null,
    failureReason: null,
    ...overrides,
  };
}

test('conversation store resolves one per-peer file under .runtime/A2A', async () => {
  const homeDir = createProfileHome('metabot-a2a-conversation-path-');
  const store = createStore(homeDir);

  assert.equal(store.paths.a2aRoot, path.join(homeDir, '.runtime', 'A2A'));
  assert.equal(
    store.conversationPath,
    path.join(homeDir, '.runtime', 'A2A', 'chat-idq14hmv-idq1g35d.json'),
  );
  assert.equal(store.lockPath, `${store.conversationPath}.lock`);

  const state = await store.readConversation();
  assert.equal(state.version, 1);
  assert.equal(state.local.globalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(state.peer.globalMetaId, PEER_GLOBAL_META_ID);
});

test('conversation store rejects missing or too-short globalMetaIds', () => {
  const homeDir = createProfileHome('metabot-a2a-conversation-invalid-');
  const paths = resolveMetabotPaths(homeDir);

  assert.throws(
    () => resolveA2AConversationFilePath(paths, '', PEER_GLOBAL_META_ID),
    /local globalMetaId/i,
  );
  assert.throws(
    () => resolveA2AConversationFilePath(paths, LOCAL_GLOBAL_META_ID, 'idq1'),
    /peer globalMetaId/i,
  );
  assert.throws(
    () => createA2AConversationStore({
      homeDir,
      local: { globalMetaId: 'idq1' },
      peer: { globalMetaId: PEER_GLOBAL_META_ID },
    }),
    /local globalMetaId/i,
  );
});

test('conversation store appends messages once by messageId', async () => {
  const store = createStore();

  const firstAppend = await store.appendMessages([
    createMessage(1),
    createMessage(2),
  ]);
  const duplicateAppend = await store.appendMessages([
    createMessage(1, { content: 'duplicate should not replace original' }),
    createMessage(2),
  ]);

  const state = await store.readConversation();
  assert.equal(firstAppend.length, 2);
  assert.equal(duplicateAppend.length, 0);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].content, 'message 1');
  assert.deepEqual(state.indexes.messageIds, ['msg-1', 'msg-2']);
});

test('conversation store trims messages to the newest 2000 records', async () => {
  const store = createStore();
  const messages = Array.from({ length: 2005 }, (_, index) => createMessage(index));

  await store.appendMessages(messages);

  const state = await store.readConversation();
  assert.equal(state.messages.length, 2000);
  assert.equal(state.messages[0].messageId, 'msg-5');
  assert.equal(state.messages.at(-1).messageId, 'msg-2004');
  assert.equal(state.indexes.messageIds.length, 2000);
  assert.equal(state.indexes.messageIds[0], 'msg-5');
});

test('conversation store looks up sessions by sessionId, orderTxid, and paymentTxid', async () => {
  const store = createStore();

  await store.upsertSession(createPeerSession());
  await store.upsertSession(createOrderSession());

  const bySessionId = await store.findSessionById('a2a-order-order-tx-1');
  const byOrderTxid = await store.findSessionByOrderTxid('order-tx-1');
  const byPaymentTxid = await store.findSessionByPaymentTxid('payment-tx-1');
  const state = await store.readConversation();

  assert.equal(bySessionId.sessionId, 'a2a-order-order-tx-1');
  assert.equal(byOrderTxid.sessionId, 'a2a-order-order-tx-1');
  assert.equal(byPaymentTxid.sessionId, 'a2a-order-order-tx-1');
  assert.equal(state.sessions.length, 2);
  assert.equal(state.indexes.orderTxidToSessionId['order-tx-1'], 'a2a-order-order-tx-1');
  assert.equal(state.indexes.paymentTxidToSessionId['payment-tx-1'], 'a2a-order-order-tx-1');
});

test('conversation store quarantines corrupt JSON and starts a clean conversation', async () => {
  const store = createStore();
  await store.appendMessages([createMessage(1)]);

  writeFileSync(store.conversationPath, '{"broken":', 'utf8');

  const state = await store.readConversation();
  assert.equal(state.messages.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(
    readdirSync(path.dirname(store.conversationPath))
      .some(entry => entry.startsWith('chat-idq14hmv-idq1g35d.json.corrupt-')),
    true,
  );

  await store.appendMessages([createMessage(2)]);
  assert.match(readFileSync(store.conversationPath, 'utf8'), /msg-2/);
});
