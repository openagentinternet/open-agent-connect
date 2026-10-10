import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { createPrivateChatAutoReplyOrchestrator } = require('../../dist/core/chat/privateChatAutoReply.js');
const { CHAT_EXTERNAL_RELAY_EXTENSION } = require('../../dist/core/chat/privateChatLoopGuards.js');

async function createHarness() {
  const base = await mkdtempTempRoot('metabot-external-relay-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'skills'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createECDH('prime256v1');
  localKeys.generateKeys();
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const stateStore = createPrivateChatStateStore(paths);
  const strategyStore = createChatStrategyStore(paths);
  const writes = [];

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore,
    strategyStore,
    paths,
    signer: {
      async getIdentity() { throw new Error('not used'); },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.getPublicKey('hex', 'uncompressed'),
          privateKeyHex: localKeys.getPrivateKey('hex'),
        };
      },
      async writePin(input) {
        writes.push(input);
        return { txids: ['tx'], pinId: `reply-pin-${writes.length}`, totalCost: 0, network: 'mvc', operation: 'create', path: input.path, contentType: input.contentType, encoding: 'utf-8', globalMetaId: localGlobalMetaId, mvcAddress: 'mvc-local' };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => 'peer-key',
    replyRunner: async () => ({ state: 'reply', content: 'reply from LLM' }),
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  return { orchestrator, stateStore, localGlobalMetaId, peerGlobalMetaId, writes };
}

function inboundMessage(peerGlobalMetaId, overrides = {}) {
  return {
    fromGlobalMetaId: peerGlobalMetaId,
    content: '回头见！bye',
    contentType: 'text',
    messagePinId: 'pin-bye-1',
    fromChatPublicKey: null,
    timestamp: 1_786_000_000,
    rawMessage: null,
    ...overrides,
  };
}

test('externally relayed inbound is recorded once and never re-driven', async () => {
  const { orchestrator, stateStore, peerGlobalMetaId, writes } = await createHarness();

  const recorded = await orchestrator.recordExternallyRelayedInbound(inboundMessage(peerGlobalMetaId), 'grok-bot-webhook');
  assert.equal(recorded, true);

  // The inbound message is in the store (this is what the backfill dedupe reads).
  const conversation = await stateStore.getConversationByPeer(peerGlobalMetaId);
  assert.ok(conversation);
  const messages = await stateStore.getRecentMessages(conversation.conversationId, 10);
  const inbound = messages.find((message) => message.messagePinId === 'pin-bye-1');
  assert.ok(inbound);
  assert.equal(inbound.direction, 'inbound');
  assert.equal(inbound.content, '回头见！bye');

  // A local relay marker flips the tail to handled.
  const marker = messages.find((message) => message.extensions?.[CHAT_EXTERNAL_RELAY_EXTENSION]);
  assert.ok(marker);
  assert.equal(marker.direction, 'outbound');
  assert.equal(marker.extensions[CHAT_EXTERNAL_RELAY_EXTENSION], 'grok-bot-webhook');
  assert.equal(marker.extensions.chatSilentTailForMessageId, inbound.messageId);

  // Duplicate delivery of the same pin is a no-op.
  const again = await orchestrator.recordExternallyRelayedInbound(inboundMessage(peerGlobalMetaId), 'grok-bot-webhook');
  assert.equal(again, false);
  const afterDup = await stateStore.getRecentMessages(conversation.conversationId, 20);
  assert.equal(afterDup.filter((message) => message.messagePinId === 'pin-bye-1').length, 1);

  // Unanswered-tail recovery must not fire: the relay owns the reply.
  const recovered = await orchestrator.retryPendingInboundMessage(peerGlobalMetaId);
  assert.equal(recovered, false);
  assert.equal(writes.length, 0);
});

test('a follow-up inbound after the relay still gets relayed once, then deduped', async () => {
  const { orchestrator, stateStore, peerGlobalMetaId } = await createHarness();

  await orchestrator.recordExternallyRelayedInbound(inboundMessage(peerGlobalMetaId), 'grok-bot-webhook');
  const second = await orchestrator.recordExternallyRelayedInbound(
    inboundMessage(peerGlobalMetaId, { content: '还有一件事', messagePinId: 'pin-2', timestamp: 1_786_000_100 }),
    'grok-bot-webhook',
  );
  assert.equal(second, true);
  const again = await orchestrator.recordExternallyRelayedInbound(
    inboundMessage(peerGlobalMetaId, { content: '还有一件事', messagePinId: 'pin-2', timestamp: 1_786_000_100 }),
    'grok-bot-webhook',
  );
  assert.equal(again, false);
  const conversation = await stateStore.getConversationByPeer(peerGlobalMetaId);
  const messages = await stateStore.getRecentMessages(conversation.conversationId, 20);
  assert.equal(messages.filter((message) => message.direction === 'inbound').length, 2);
});
