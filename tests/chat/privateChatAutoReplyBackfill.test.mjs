import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const {
  createPrivateChatAutoReplyBackfillLoop,
} = require('../../dist/core/chat/privateChatAutoReplyBackfill.js');

async function createTempProfileHome() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-autoreply-backfill-test-'));
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return { base, profileRoot };
}

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
