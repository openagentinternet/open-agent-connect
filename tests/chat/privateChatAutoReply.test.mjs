import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { loadChatPersona } = require('../../dist/core/chat/chatPersonaLoader.js');
const { createDefaultChatReplyRunner } = require('../../dist/core/chat/defaultChatReplyRunner.js');
const { createPrivateChatAutoReplyOrchestrator } = require('../../dist/core/chat/privateChatAutoReply.js');

async function createTempProfileHome() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-autoreply-test-'));
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  const managerRoot = path.join(base, '.metabot', 'manager');
  const skillsRoot = path.join(base, '.metabot', 'skills');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  await fs.mkdir(skillsRoot, { recursive: true });
  return { base, profileRoot };
}

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

test('chatPersonaLoader returns empty strings when files do not exist', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const persona = await loadChatPersona(paths);
  assert.equal(persona.soul, '');
  assert.equal(persona.goal, '');
  assert.equal(persona.role, '');
});

test('chatPersonaLoader reads SOUL.md, GOAL.md, ROLE.md', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  await fs.writeFile(paths.soulMdPath, 'I am friendly and curious.', 'utf8');
  await fs.writeFile(paths.goalMdPath, 'Explore collaboration.', 'utf8');
  await fs.writeFile(paths.roleMdPath, 'I am a coding assistant.', 'utf8');

  const persona = await loadChatPersona(paths);
  assert.equal(persona.soul, 'I am friendly and curious.');
  assert.equal(persona.goal, 'Explore collaboration.');
  assert.equal(persona.role, 'I am a coding assistant.');
});

test('chatStrategyStore reads and writes strategies', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createChatStrategyStore(paths);

  const empty = await store.read();
  assert.deepEqual(empty.strategies, []);

  await store.write({
    strategies: [
      { id: 'test-strategy', maxTurns: 20, maxIdleMs: 60000, exitCriteria: 'done' },
    ],
  });

  const result = await store.read();
  assert.equal(result.strategies.length, 1);
  assert.equal(result.strategies[0].id, 'test-strategy');
  assert.equal(result.strategies[0].maxTurns, 20);

  const found = await store.getStrategy('test-strategy');
  assert.ok(found);
  assert.equal(found.id, 'test-strategy');

  const notFound = await store.getStrategy('nonexistent');
  assert.equal(notFound, null);
});

test('defaultChatReplyRunner returns greeting on first turn', () => {
  const runner = createDefaultChatReplyRunner();
  const result = runner({
    conversation: {
      conversationId: 'c1',
      peerGlobalMetaId: 'peer',
      peerName: null,
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 1,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 2000,
    },
    recentMessages: [],
    persona: { soul: '', goal: 'Learn about AI.', role: 'I am a helpful MetaBot.' },
    strategy: { id: 'test', maxTurns: 30, maxIdleMs: 300000, exitCriteria: '' },
    inboundMessage: {
      conversationId: 'c1',
      messageId: 'm1',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'Hi!',
      messagePinId: null,
      extensions: null,
      timestamp: 1000,
    },
  });

  assert.equal(result.state, 'reply');
  assert.ok(result.content.includes('I am a helpful MetaBot'));
});

test('defaultChatReplyRunner returns end_conversation near max turns', () => {
  const runner = createDefaultChatReplyRunner();
  const result = runner({
    conversation: {
      conversationId: 'c1',
      peerGlobalMetaId: 'peer',
      peerName: null,
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 29,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 2000,
    },
    recentMessages: [],
    persona: { soul: '', goal: '', role: '' },
    strategy: { id: 'test', maxTurns: 30, maxIdleMs: 300000, exitCriteria: '' },
    inboundMessage: {
      conversationId: 'c1',
      messageId: 'm29',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'Still here?',
      messagePinId: null,
      extensions: null,
      timestamp: 29000,
    },
  });

  assert.equal(result.state, 'end_conversation');
});

test('auto-reply persists inbound and outbound private chat messages to the unified A2A store', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const writes = [];
  const runnerInputs = [];

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: createPrivateChatStateStore(paths),
    strategyStore: createChatStrategyStore(paths),
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['reply-tx-1'],
          pinId: 'reply-pin-1',
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: 'utf-8',
          globalMetaId: localGlobalMetaId,
          mvcAddress: 'mvc-local',
        };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => peerKeys.publicKeyHex,
    replyRunner: async (input) => {
      runnerInputs.push(input);
      return {
        state: 'reply',
        content: 'reply from LLM',
      };
    },
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  await orchestrator.handleInboundMessage({
    fromGlobalMetaId: peerGlobalMetaId,
    content: 'hello local bot',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: peerKeys.publicKeyHex,
    timestamp: 1_770_000_000_000,
    rawMessage: {
      pinId: 'incoming-pin-1',
      txid: 'incoming-tx-1',
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(runnerInputs.length, 1);
  assert.equal(runnerInputs[0].inboundMessage.content, 'hello local bot');

  const legacyMessages = await createPrivateChatStateStore(paths)
    .getRecentMessages(`pc-${localGlobalMetaId}-${peerGlobalMetaId}`, 10);
  assert.equal(legacyMessages.length, 2);
  assert.equal(legacyMessages[0].content, 'hello local bot');
  assert.equal(legacyMessages[1].content, 'reply from LLM');

  const conversation = await createA2AConversationStore({
    paths,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  }).readConversation();

  assert.equal(conversation.messages.length, 2);
  const incoming = conversation.messages.find((message) => message.direction === 'incoming');
  const outgoing = conversation.messages.find((message) => message.direction === 'outgoing');
  assert.ok(incoming, 'expected inbound message in unified A2A store');
  assert.ok(outgoing, 'expected outbound reply in unified A2A store');
  assert.equal(incoming.kind, 'private_chat');
  assert.equal(incoming.content, 'hello local bot');
  assert.equal(incoming.pinId, 'incoming-pin-1');
  assert.equal(outgoing.kind, 'private_chat');
  assert.equal(outgoing.content, 'reply from LLM');
  assert.equal(outgoing.pinId, 'reply-pin-1');
  assert.deepEqual(outgoing.txids, ['reply-tx-1']);
  assert.equal(conversation.sessions.some(
    (session) => session.sessionId === incoming.sessionId && session.type === 'peer',
  ), true);
});

test('auto-reply persists order protocol messages without sending ordinary private-chat replies', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const orderTxid = 'a'.repeat(64);
  const writes = [];
  const runnerInputs = [];

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: createPrivateChatStateStore(paths),
    strategyStore: createChatStrategyStore(paths),
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['unexpected-reply-tx'],
          pinId: 'unexpected-reply-pin',
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: 'utf-8',
          globalMetaId: localGlobalMetaId,
          mvcAddress: 'mvc-local',
        };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => peerKeys.publicKeyHex,
    replyRunner: async (input) => {
      runnerInputs.push(input);
      return {
        state: 'reply',
        content: 'ordinary reply should not be sent',
      };
    },
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  await orchestrator.handleInboundMessage({
    fromGlobalMetaId: peerGlobalMetaId,
    content: `[DELIVERY:${orderTxid}] ${JSON.stringify({
      paymentTxid: 'payment-tx-1',
      servicePinId: 'service-pin-1',
      result: '# Weather\n\nSunny.',
    })}`,
    messagePinId: 'delivery-pin-1',
    fromChatPublicKey: peerKeys.publicKeyHex,
    timestamp: 1_770_000_000_000,
    rawMessage: {
      pinId: 'delivery-pin-1',
      txid: 'delivery-tx-1',
    },
  });

  assert.equal(writes.length, 0);
  assert.equal(runnerInputs.length, 0);

  const legacyMessages = await createPrivateChatStateStore(paths)
    .getRecentMessages(`pc-${localGlobalMetaId}-${peerGlobalMetaId}`, 10);
  assert.equal(legacyMessages.length, 1);
  assert.equal(legacyMessages[0].messagePinId, 'delivery-pin-1');

  const conversation = await createA2AConversationStore({
    paths,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  }).readConversation();

  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].kind, 'order_protocol');
  assert.equal(conversation.messages[0].protocolTag, 'DELIVERY');
  assert.equal(conversation.messages[0].orderTxid, orderTxid);
  const orderSession = conversation.sessions.find((session) => session.sessionId === `a2a-order-${orderTxid}`);
  assert.ok(orderSession);
  assert.equal(orderSession.state, 'completed');
});

test('auto-reply unified A2A persistence is best-effort and does not block replies', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const blockedPath = path.join(paths.runtimeRoot, 'a2a-blocker');
  await fs.mkdir(paths.runtimeRoot, { recursive: true });
  await fs.writeFile(blockedPath, 'not a directory', 'utf8');
  const brokenA2APaths = {
    ...paths,
    a2aRoot: path.join(blockedPath, 'A2A'),
  };
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const writes = [];
  const runnerInputs = [];

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: createPrivateChatStateStore(paths),
    strategyStore: createChatStrategyStore(paths),
    paths: brokenA2APaths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['reply-tx-1'],
          pinId: 'reply-pin-1',
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: 'utf-8',
          globalMetaId: localGlobalMetaId,
          mvcAddress: 'mvc-local',
        };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => peerKeys.publicKeyHex,
    replyRunner: async (input) => {
      runnerInputs.push(input);
      return {
        state: 'reply',
        content: 'reply survived local store failure',
      };
    },
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  await orchestrator.handleInboundMessage({
    fromGlobalMetaId: peerGlobalMetaId,
    content: 'hello despite broken A2A store',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: peerKeys.publicKeyHex,
    timestamp: 1_770_000_000_000,
    rawMessage: {
      pinId: 'incoming-pin-1',
      content: 'encrypted-simplemsg-ciphertext',
    },
  });

  assert.equal(runnerInputs.length, 1);
  assert.equal(writes.length, 1);

  const legacyMessages = await createPrivateChatStateStore(paths)
    .getRecentMessages(`pc-${localGlobalMetaId}-${peerGlobalMetaId}`, 10);
  assert.equal(legacyMessages.length, 2);
  assert.equal(legacyMessages[0].content, 'hello despite broken A2A store');
  assert.equal(legacyMessages[1].content, 'reply survived local store failure');
});

test('auto-reply unified A2A persistence removes encrypted socket payload fields from raw metadata', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: createPrivateChatStateStore(paths),
    strategyStore: createChatStrategyStore(paths),
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        return {
          txids: ['reply-tx-1'],
          pinId: 'reply-pin-1',
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: 'utf-8',
          globalMetaId: localGlobalMetaId,
          mvcAddress: 'mvc-local',
        };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => peerKeys.publicKeyHex,
    replyRunner: async () => ({
      state: 'reply',
      content: 'reply from LLM',
    }),
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  await orchestrator.handleInboundMessage({
    fromGlobalMetaId: peerGlobalMetaId,
    content: 'decrypted hello',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: peerKeys.publicKeyHex,
    timestamp: 1_770_000_000_000,
    rawMessage: {
      pinId: 'incoming-pin-1',
      txid: 'incoming-tx-1',
      content: 'encrypted-simplemsg-ciphertext',
      rawData: '{"content":"encrypted-simplemsg-ciphertext"}',
      nested: {
        payload: 'nested encrypted payload',
        blockHeight: 123,
      },
    },
  });

  const conversation = await createA2AConversationStore({
    paths,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  }).readConversation();

  const incoming = conversation.messages.find((message) => message.direction === 'incoming');
  assert.ok(incoming, 'expected inbound message in unified A2A store');
  assert.equal(incoming.content, 'decrypted hello');
  assert.equal(incoming.raw.pinId, 'incoming-pin-1');
  assert.equal(incoming.raw.txid, 'incoming-tx-1');
  assert.equal(incoming.raw.nested.blockHeight, 123);
  assert.equal(Object.hasOwn(incoming.raw, 'content'), false);
  assert.equal(Object.hasOwn(incoming.raw, 'rawData'), false);
  assert.equal(Object.hasOwn(incoming.raw.nested, 'payload'), false);
  assert.doesNotMatch(JSON.stringify(conversation), /encrypted-simplemsg-ciphertext|nested encrypted payload/);
});
