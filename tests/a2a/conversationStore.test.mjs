import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';
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
  const systemHome = mkdtempTempRootSync(prefix);
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

test('conversation store replaces a logical message while preserving its index', async () => {
  const store = createStore();
  await store.appendMessages([createMessage(1)]);

  const replaced = await store.replaceMessage('msg-1', createMessage(1, {
    pinId: 'retry-pin-1',
    txid: 'retry-tx-1',
    txids: ['retry-tx-1'],
    raw: {
      deliveryRecovery: {
        failedPinIds: ['pin-1'],
        retryCount: 1,
      },
    },
  }));

  const state = await store.readConversation();
  assert.equal(replaced.messageId, 'msg-1');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].pinId, 'retry-pin-1');
  assert.equal(state.messages[0].txid, 'retry-tx-1');
  assert.deepEqual(state.indexes.messageIds, ['msg-1']);
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

test('conversation store reclaims a stale lock whose recorded pid is still alive', async () => {
  const store = createStore(createProfileHome('metabot-a2a-live-pid-stale-lock-'));
  await store.readConversation();

  const staleTimestamp = (Date.now() - (10 * 60 * 1000)) / 1000;
  writeFileSync(
    store.lockPath,
    JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - (10 * 60 * 1000) }),
    'utf8',
  );
  utimesSync(store.lockPath, staleTimestamp, staleTimestamp);

  await store.appendMessages([createMessage(1)]);

  const state = await store.readConversation();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].messageId, 'msg-1');
});

test('conversation store releases its lock when an update fails', async () => {
  const store = createStore(createProfileHome('metabot-a2a-failed-update-lock-'));

  await assert.rejects(
    store.updateConversation(async () => {
      throw new Error('simulated update failure');
    }),
    /simulated update failure/,
  );

  assert.equal(existsSync(store.lockPath), false);
  await store.appendMessages([createMessage(1)]);
  assert.equal((await store.readConversation()).messages.length, 1);
});

test('conversation store reads a manual disk repair before its next update', async () => {
  const store = createStore(createProfileHome('metabot-a2a-disk-repair-'));
  await store.appendMessages([createMessage(1)]);

  const repaired = JSON.parse(readFileSync(store.conversationPath, 'utf8'));
  repaired.messages[0].content = 'manually repaired content';
  writeFileSync(store.conversationPath, `${JSON.stringify(repaired, null, 2)}\n`, 'utf8');

  await store.appendMessages([createMessage(2)]);

  const state = await store.readConversation();
  assert.equal(state.messages[0].content, 'manually repaired content');
  assert.equal(state.messages[1].messageId, 'msg-2');
});
