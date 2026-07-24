import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const {
  createPrivateChatAutoReplyBackfillLoop,
  createPrivateChatAutoReplyBackfillProfileManager,
} = require('../../dist/core/chat/privateChatAutoReplyBackfill.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-autoreply-backfill-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return { base, profileRoot };
}

test('auto-reply backfill discovers and processes a first message from a directory peer', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1newpeer000000000000000000000000000';
  const handledMessages = [];
  const listedFor = [];

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async (message) => {
      handledMessages.push(message);
    },
    listPeerGlobalMetaIds: async (requestedSelf) => {
      listedFor.push(requestedSelf);
      return [peerGlobalMetaId];
    },
    historyClient: {
      async fetchRecent() {
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 1,
          serverTime: 1_770_008_000_000,
          messages: [{
            id: 'first-incoming-pin',
            pinId: 'first-incoming-pin',
            protocol: '/protocols/simplemsg',
            content: 'first hello',
            timestamp: 1_770_007_000,
            index: 1,
            fromGlobalMetaId: peerGlobalMetaId,
            toGlobalMetaId: selfGlobalMetaId,
          }],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used for a first peer');
      },
    },
    now: () => 1_770_008_000_000,
  });

  const result = await loop.syncOnce();

  assert.deepEqual(listedFor, [selfGlobalMetaId]);
  assert.equal(result.peers, 1);
  assert.equal(result.processed, 1);
  assert.equal(handledMessages.length, 1);
  assert.equal(handledMessages[0].fromGlobalMetaId, peerGlobalMetaId);
  assert.equal(handledMessages[0].content, 'first hello');
});

test('auto-reply backfill keeps known-peer recovery running when peer discovery fails', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1knownpeer0000000000000000000000000';
  const errors = [];
  let historyCalls = 0;

  await stateStore.upsertConversation({
    conversationId: `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`,
    peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 0,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async () => {},
    listPeerGlobalMetaIds: async () => {
      throw new Error('directory unavailable');
    },
    historyClient: {
      async fetchRecent() {
        historyCalls += 1;
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 0,
          serverTime: 1_770_008_000_000,
          messages: [],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without a cursor');
      },
    },
    onError: (error) => errors.push(error.message),
  });

  const result = await loop.syncOnce();

  assert.equal(result.peers, 1);
  assert.equal(historyCalls, 1);
  assert.deepEqual(errors, ['directory unavailable']);
});

test('auto-reply backfill does not let a blocked peer delay a newly discovered peer', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const knownPeerGlobalMetaId = 'idq1knownpeer0000000000000000000000000';
  const discoveredPeerGlobalMetaId = 'idq1newpeer000000000000000000000000000';

  await stateStore.upsertConversation({
    conversationId: `pc-${selfGlobalMetaId}-${knownPeerGlobalMetaId}`,
    peerGlobalMetaId: knownPeerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 0,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });

  let releaseKnownHistory = () => {};
  const knownHistoryBlocked = new Promise(resolve => {
    releaseKnownHistory = resolve;
  });
  let markDiscoveredHandled = () => {};
  const discoveredHandled = new Promise(resolve => {
    markDiscoveredHandled = resolve;
  });

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async (message) => {
      if (message.fromGlobalMetaId === discoveredPeerGlobalMetaId) {
        markDiscoveredHandled();
      }
    },
    listPeerGlobalMetaIds: async () => [discoveredPeerGlobalMetaId],
    historyClient: {
      async fetchRecent(input) {
        if (input.peerGlobalMetaId === knownPeerGlobalMetaId) {
          await knownHistoryBlocked;
          return {
            ok: true,
            selfGlobalMetaId,
            peerGlobalMetaId: knownPeerGlobalMetaId,
            nextPollAfterIndex: 0,
            serverTime: 1_770_008_000_000,
            messages: [],
          };
        }
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId: discoveredPeerGlobalMetaId,
          nextPollAfterIndex: 1,
          serverTime: 1_770_008_000_000,
          messages: [{
            id: 'discovered-incoming-pin',
            pinId: 'discovered-incoming-pin',
            protocol: '/protocols/simplemsg',
            content: 'hello from the new peer',
            timestamp: 1_770_007_000,
            index: 1,
            fromGlobalMetaId: discoveredPeerGlobalMetaId,
            toGlobalMetaId: selfGlobalMetaId,
          }],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without a cursor');
      },
    },
    now: () => 1_770_008_000_000,
  });

  const syncing = loop.syncOnce();
  await discoveredHandled;
  releaseKnownHistory();
  const result = await syncing;

  assert.equal(result.processed, 1);
});

test('auto-reply backfill processes missed incoming private messages for known peers', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const handledMessages = [];
  const historyCalls = [];

  await stateStore.upsertConversation({
    conversationId: `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`,
    peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });
  await stateStore.appendMessages([{
    conversationId: `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`,
    messageId: 'old-incoming-pin',
    direction: 'inbound',
    senderGlobalMetaId: peerGlobalMetaId,
    content: 'old message',
    messagePinId: 'old-incoming-pin',
    extensions: null,
    timestamp: 1_770_000_000,
  }]);

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
      chatPublicKey: 'local-chat-public-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async (message) => {
      handledMessages.push(message);
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent(input) {
        historyCalls.push({ type: 'recent', input });
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 77,
          serverTime: 1_770_008_000_000,
          messages: [
            {
              id: 'old-incoming-pin',
              pinId: 'old-incoming-pin',
              protocol: '/protocols/simplemsg',
              content: 'old message',
              timestamp: 1_770_000_000,
              index: 75,
              fromGlobalMetaId: peerGlobalMetaId,
              toGlobalMetaId: selfGlobalMetaId,
            },
            {
              id: 'missed-incoming-pin',
              pinId: 'missed-incoming-pin',
              txId: 'missed-incoming-tx',
              protocol: '/protocols/simplemsg',
              content: 'missed hello',
              timestamp: 1_770_004_000,
              index: 76,
              fromGlobalMetaId: peerGlobalMetaId,
              toGlobalMetaId: selfGlobalMetaId,
            },
            {
              id: 'local-outbound-pin',
              pinId: 'local-outbound-pin',
              protocol: '/protocols/simplemsg',
              content: 'local outbound',
              timestamp: 1_770_004_100,
              index: 77,
              fromGlobalMetaId: selfGlobalMetaId,
              toGlobalMetaId: peerGlobalMetaId,
            },
          ],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without an existing cursor');
      },
    },
    now: () => 1_770_008_000_000,
  }, {
    intervalMs: 60_000,
    startupCatchUpMs: 6 * 60 * 60 * 1000,
  });

  const result = await loop.syncOnce();

  assert.equal(result.processed, 1);
  assert.equal(historyCalls.length, 1);
  assert.equal(handledMessages.length, 1);
  assert.equal(handledMessages[0].fromGlobalMetaId, peerGlobalMetaId);
  assert.equal(handledMessages[0].content, 'missed hello');
  assert.equal(handledMessages[0].messagePinId, 'missed-incoming-pin');
  assert.equal(handledMessages[0].fromChatPublicKey, 'peer-chat-public-key');
  assert.equal(handledMessages[0].rawMessage.source, 'private-chat-history-backfill');
});

test('auto-reply backfill re-reads the cursor index when opposite directions share it', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const handledMessages = [];
  const historyCalls = [];

  await fs.mkdir(paths.stateRoot, { recursive: true });
  await fs.writeFile(
    path.join(paths.stateRoot, 'private-chat-auto-reply-backfill.json'),
    `${JSON.stringify({
      version: 1,
      peers: {
        [peerGlobalMetaId]: {
          afterIndex: 16,
          updatedAt: 1_770_000_000_000,
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async (message) => {
      handledMessages.push(message);
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent() {
        throw new Error('fetchRecent should not be used with an existing cursor');
      },
      async fetchAfter(input) {
        historyCalls.push(input);
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 16,
          serverTime: 1_770_000_001_000,
          messages: [{
            id: 'missed-incoming-at-duplicate-index',
            pinId: 'missed-incoming-at-duplicate-index',
            protocol: '/protocols/simplemsg',
            content: 'message from the opposite direction',
            timestamp: 1_770_000_001,
            index: 16,
            fromGlobalMetaId: peerGlobalMetaId,
            toGlobalMetaId: selfGlobalMetaId,
          }],
        };
      },
    },
    now: () => 1_770_000_001_000,
  });

  const result = await loop.syncOnce();

  assert.equal(result.processed, 1);
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].afterIndex, 15);
  assert.equal(handledMessages.length, 1);
  assert.equal(handledMessages[0].messagePinId, 'missed-incoming-at-duplicate-index');
});

test('auto-reply backfill holds the cursor on undecryptable history rows and retries them on the next tick', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const handledMessages = [];
  const errors = [];
  let rowDecrypts = false;

  const cursorPath = path.join(paths.stateRoot, 'private-chat-auto-reply-backfill.json');
  await fs.mkdir(paths.stateRoot, { recursive: true });
  await fs.writeFile(
    cursorPath,
    `${JSON.stringify({
      version: 1,
      peers: {
        [peerGlobalMetaId]: {
          afterIndex: 10,
          updatedAt: 1_770_000_000_000,
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async (message) => {
      handledMessages.push(message);
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent() {
        throw new Error('fetchRecent should not be used with an existing cursor');
      },
      async fetchAfter() {
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 16,
          serverTime: 1_770_000_001_000,
          messages: [{
            id: 'transient-undecryptable-pin',
            pinId: 'transient-undecryptable-pin',
            protocol: '/protocols/simplemsg',
            content: rowDecrypts ? 'recovered hello' : '[Unable to decrypt message]',
            timestamp: 1_770_000_001,
            index: 16,
            fromGlobalMetaId: peerGlobalMetaId,
            toGlobalMetaId: selfGlobalMetaId,
          }],
        };
      },
    },
    now: () => 1_770_000_001_000,
    onError: (error) => errors.push(error),
  });

  const failedResult = await loop.syncOnce();

  assert.equal(failedResult.processed, 0);
  assert.equal(failedResult.failed, 1);
  assert.equal(handledMessages.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /undecryptable simplemsg/);
  const heldCursor = JSON.parse(await fs.readFile(cursorPath, 'utf8'));
  assert.equal(heldCursor.peers[peerGlobalMetaId].afterIndex, 10);

  // The next tick re-reads the same row; once it decrypts, it is processed
  // and the cursor finally advances past it.
  rowDecrypts = true;
  const recoveredResult = await loop.syncOnce();

  assert.equal(recoveredResult.processed, 1);
  assert.equal(recoveredResult.failed, 0);
  assert.equal(handledMessages.length, 1);
  assert.equal(handledMessages[0].content, 'recovered hello');
  assert.equal(handledMessages[0].messagePinId, 'transient-undecryptable-pin');
  const advancedCursor = JSON.parse(await fs.readFile(cursorPath, 'utf8'));
  assert.equal(advancedCursor.peers[peerGlobalMetaId].afterIndex, 16);
});

test('auto-reply backfill recovers an unanswered outbound message missing from durable history', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const conversationId = `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`;
  const recoveryCalls = [];
  await stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });
  await stateStore.appendMessages([{
    conversationId,
    messageId: 'logical-outbound-1',
    direction: 'outbound',
    senderGlobalMetaId: selfGlobalMetaId,
    content: 'message that disappeared after broadcast',
    messagePinId: `${'a'.repeat(64)}i0`,
    extensions: null,
    timestamp: 1_770_000_000_000,
  }]);

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async () => {},
    recoverOutboundMessage: async (peer, message) => {
      recoveryCalls.push({ peer, message });
      return true;
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent() {
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 20,
          serverTime: 1_770_000_002_000,
          messages: [],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without an existing cursor');
      },
    },
    now: () => 1_770_000_002_000,
  }, {
    outboundRecoveryDelayMs: 1_000,
  });

  const result = await loop.syncOnce();

  assert.equal(result.recovered, 1);
  assert.equal(recoveryCalls.length, 1);
  assert.equal(recoveryCalls[0].peer, peerGlobalMetaId);
  assert.equal(recoveryCalls[0].message.messageId, 'logical-outbound-1');
});

test('auto-reply backfill does not recover an outbound pin already visible by transaction id', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const conversationId = `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`;
  const txid = 'b'.repeat(64);
  let recoveryCalls = 0;
  await stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });
  await stateStore.appendMessages([{
    conversationId,
    messageId: 'logical-outbound-1',
    direction: 'outbound',
    senderGlobalMetaId: selfGlobalMetaId,
    content: 'durably indexed message',
    messagePinId: `${txid}i0`,
    extensions: null,
    timestamp: 1_770_000_000_000,
  }]);

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async () => {},
    recoverOutboundMessage: async () => {
      recoveryCalls += 1;
      return true;
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent() {
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 20,
          serverTime: 1_770_000_002_000,
          messages: [{
            id: `${txid}i0`,
            pinId: `${txid}i0`,
            txId: txid,
            protocol: '/protocols/simplemsg',
            content: 'durably indexed message',
            timestamp: 1_770_000_000,
            index: 20,
            fromGlobalMetaId: selfGlobalMetaId,
            toGlobalMetaId: peerGlobalMetaId,
          }],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without an existing cursor');
      },
    },
    now: () => 1_770_000_002_000,
  }, {
    outboundRecoveryDelayMs: 1_000,
  });

  const result = await loop.syncOnce();

  assert.equal(result.recovered, 0);
  assert.equal(recoveryCalls, 0);
});

test('auto-reply backfill retries the latest unanswered inbound message', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const stateStore = createPrivateChatStateStore(paths);
  const selfGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const conversationId = `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`;
  const recoveryCalls = [];
  await stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  });
  await stateStore.appendMessages([{
    conversationId,
    messageId: 'unanswered-inbound-1',
    direction: 'inbound',
    senderGlobalMetaId: peerGlobalMetaId,
    content: 'This still needs a reply.',
    messagePinId: 'unanswered-inbound-1',
    extensions: null,
    timestamp: 1_770_000_000_000,
  }]);

  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore,
    selfGlobalMetaId: async () => selfGlobalMetaId,
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: selfGlobalMetaId,
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async () => {},
    recoverInboundReply: async (peer) => {
      recoveryCalls.push(peer);
      return true;
    },
    listPeerGlobalMetaIds: async () => [peerGlobalMetaId],
    historyClient: {
      async fetchRecent() {
        return {
          ok: true,
          selfGlobalMetaId,
          peerGlobalMetaId,
          nextPollAfterIndex: 20,
          serverTime: 1_770_000_030_000,
          messages: [],
        };
      },
      async fetchAfter() {
        throw new Error('fetchAfter should not be used without an existing cursor');
      },
    },
    now: () => 1_770_000_030_000,
  }, {
    inboundRecoveryDelayMs: 1_000,
  });

  const result = await loop.syncOnce();

  assert.equal(result.recovered, 1);
  assert.deepEqual(recoveryCalls, [peerGlobalMetaId]);
});

test('auto-reply backfill reads history from the currently configured chat API base URL', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const requestedUrls = [];
  const loop = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore: createPrivateChatStateStore(paths),
    selfGlobalMetaId: async () => 'idq1localbot0000000000000000000000000',
    getLocalPrivateChatIdentity: async () => ({
      globalMetaId: 'idq1localbot0000000000000000000000000',
      privateKeyHex: 'local-private-key',
    }),
    resolvePeerChatPublicKey: async () => 'peer-chat-public-key',
    handleInboundMessage: async () => {},
    listPeerGlobalMetaIds: async () => ['idq1peerbot00000000000000000000000000'],
    resolveChatApiBaseUrl: async () => 'http://metaso.test/custom/chat-api/group-chat',
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({
        code: 0,
        data: {
          total: 0,
          list: [],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await loop.syncOnce();

  assert.equal(result.peers, 1);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls.every((url) => url.startsWith(
    'http://metaso.test/custom/chat-api/group-chat/private-chat-list-by-index?',
  )), true);
});

test('auto-reply backfill profile manager starts and stops an isolated loop for every profile', async () => {
  const profiles = ['alpha', 'beta'].map((slug, index) => ({
    name: `${slug} bot`,
    slug,
    aliases: [slug],
    homeDir: `/tmp/${slug}`,
    globalMetaId: `idq1${slug}`,
    mvcAddress: `mvc-${slug}`,
    createdAt: index + 1,
    updatedAt: index + 1,
  }));
  const events = [];
  const manager = createPrivateChatAutoReplyBackfillProfileManager({
    systemHomeDir: '/tmp/system-home',
    listProfiles: async () => profiles,
    createLoop: (profile) => ({
      syncOnce: async () => ({ peers: 0, processed: 0, skipped: 0, failed: 0 }),
      start: () => events.push(`start:${profile.slug}`),
      stop: () => events.push(`stop:${profile.slug}`),
      isRunning: () => true,
    }),
  });

  const report = await manager.start();
  assert.deepEqual(report.started.map((profile) => profile.slug), ['alpha', 'beta']);
  assert.equal(manager.isRunning(), true);
  assert.deepEqual(events, ['start:alpha', 'start:beta']);

  manager.stop();
  assert.equal(manager.isRunning(), false);
  assert.deepEqual(events, ['start:alpha', 'start:beta', 'stop:alpha', 'stop:beta']);
});
