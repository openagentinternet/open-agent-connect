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
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { loadChatPersona } = require('../../dist/core/chat/chatPersonaLoader.js');
const { createDefaultChatReplyRunner } = require('../../dist/core/chat/defaultChatReplyRunner.js');
const { createHostLlmChatReplyRunner } = require('../../dist/core/chat/hostLlmChatReplyRunner.js');
const { createPrivateChatAutoReplyOrchestrator } = require('../../dist/core/chat/privateChatAutoReply.js');
const {
  createPrivateChatSendFailureFileLogger,
  privateChatSendFailureLogPath,
} = require('../../dist/core/chat/privateChatSendFailureLog.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-autoreply-test-');
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

async function withImmediateTimers(fn) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, _ms, ...args) => {
    if (typeof callback === 'function') {
      callback(...args);
    }
    return {
      ref() { return this; },
      unref() { return this; },
      [Symbol.toPrimitive]() { return 0; },
    };
  };
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

async function withCapturedImmediateTimers(fn) {
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    if (typeof callback === 'function') {
      callback(...args);
    }
    return {
      ref() { return this; },
      unref() { return this; },
      [Symbol.toPrimitive]() { return 0; },
    };
  };
  try {
    await fn();
    return delays;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

async function createAutoReplyHarness(options = {}) {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = options.localGlobalMetaId ?? 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = options.peerGlobalMetaId ?? 'idq1peerbot00000000000000000000000000';
  const writes = [];
  const runnerInputs = [];
  const sendFailureEvents = [];
  const stateStore = createPrivateChatStateStore(paths);
  const strategyStore = createChatStrategyStore(paths);
  const hasResolvePeerChatPublicKeyOverride = Object.prototype.hasOwnProperty.call(
    options,
    'resolvePeerChatPublicKey',
  );
  const nowFn = typeof options.now === 'function'
    ? options.now
    : () => options.now ?? 1_770_000_000_000;

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore,
    strategyStore,
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        if (options.privateChatIdentityError) {
          throw options.privateChatIdentityError;
        }
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        if (options.writePinError) {
          throw options.writePinError;
        }
        writes.push(input);
        return {
          txids: ['reply-tx-1'],
          pinId: `reply-pin-${writes.length}`,
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
    resolvePeerChatPublicKey: async () => {
      if (!hasResolvePeerChatPublicKeyOverride) return peerKeys.publicKeyHex;
      return typeof options.resolvePeerChatPublicKey === 'function'
        ? options.resolvePeerChatPublicKey()
        : options.resolvePeerChatPublicKey;
    },
    a2aConversationPersister: options.a2aConversationPersister,
    logSendFailure: options.logSendFailure === undefined
      ? (event) => sendFailureEvents.push(event)
      : options.logSendFailure ?? undefined,
    replyRunner: async (input) => {
      runnerInputs.push(input);
      if (options.replyRunner) {
        return options.replyRunner(input);
      }
      return options.replyResult ?? {
        state: 'reply',
        content: 'reply from LLM',
      };
    },
    now: nowFn,
  }, {
    enabled: options.enabled ?? true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: options.defaultStrategyId ?? null,
    maxTurns: options.maxTurns,
    cooldownMs: options.cooldownMs,
  });

  return {
    orchestrator,
    paths,
    localKeys,
    peerKeys,
    localGlobalMetaId,
    peerGlobalMetaId,
    writes,
    runnerInputs,
    sendFailureEvents,
    stateStore,
    strategyStore,
    async handleInbound(overrides = {}) {
      return orchestrator.handleInboundMessage({
        fromGlobalMetaId: peerGlobalMetaId,
        content: 'hello local bot',
        messagePinId: 'incoming-pin-1',
        fromChatPublicKey: peerKeys.publicKeyHex,
        timestamp: nowFn(),
        rawMessage: {
          pinId: 'incoming-pin-1',
          txid: 'incoming-tx-1',
        },
        ...overrides,
      });
    },
    async handleLocalGuidedTurn(targetPeerGlobalMetaId = peerGlobalMetaId) {
      return orchestrator.handleLocalGuidedTurn(targetPeerGlobalMetaId);
    },
  };
}

test('chatPersonaLoader returns runtime fallback persona when files do not exist', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const persona = await loadChatPersona(paths);
  assert.equal(persona.soul, 'You are friendly and professional.');
  assert.equal(persona.goal, 'Your goal is to help users accomplish their tasks effectively.');
  assert.equal(persona.role, 'You are a helpful AI assistant.');
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
  assert.match(result.content, /\nBye$/);
});

test('defaultChatReplyRunner keeps operator-triggered turns without an inbound message on a continuation path', () => {
  const runner = createDefaultChatReplyRunner();
  const result = runner({
    conversation: {
      conversationId: 'c1',
      peerGlobalMetaId: 'peer',
      peerName: null,
      topic: null,
      strategyId: null,
      state: 'closed',
      turnCount: 29,
      lastDirection: 'outbound',
      createdAt: 1000,
      updatedAt: 2000,
      pendingGuidanceText: 'Reopen the thread and ask for the missing delivery date.',
      pendingGuidanceCreatedAt: 1500,
    },
    recentMessages: [{
      conversationId: 'c1',
      messageId: 'm28',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'Could you follow up with the exact delivery date when you can?',
      messagePinId: null,
      extensions: null,
      timestamp: 1800,
    }],
    persona: { soul: '', goal: '', role: '' },
    strategy: { id: 'test', maxTurns: 30, maxIdleMs: 300000, exitCriteria: '' },
    inboundMessage: null,
    operatorGuidanceText: 'Reopen the thread and ask for the missing delivery date.',
  });

  assert.equal(result.state, 'reply');
  assert.doesNotMatch(result.content, /\nBye$/);
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

  const privateChatConversation = await createPrivateChatStateStore(paths)
    .getConversationByPeer(peerGlobalMetaId);
  assert.equal(privateChatConversation.turnCount, 1);

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

test('outbound recovery resends the same logical turn and replaces its dropped pin projection', async () => {
  let currentNow = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now: () => currentNow });
  await harness.handleInbound();
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;
  const initialMessages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const initialOutbound = initialMessages.at(-1);
  const conversationBeforeRetry = await harness.stateStore.getConversationByPeer(
    harness.peerGlobalMetaId,
  );

  currentNow += 10 * 60 * 1000;
  const recovered = await harness.orchestrator.retryOutboundMessage(
    harness.peerGlobalMetaId,
    initialOutbound,
  );

  const recoveredMessages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const recoveredOutbound = recoveredMessages.at(-1);
  const conversationAfterRetry = await harness.stateStore.getConversationByPeer(
    harness.peerGlobalMetaId,
  );
  const unified = await createA2AConversationStore({
    paths: harness.paths,
    local: { globalMetaId: harness.localGlobalMetaId },
    peer: { globalMetaId: harness.peerGlobalMetaId },
  }).readConversation();
  const unifiedOutbound = unified.messages.find(message => message.direction === 'outgoing');

  assert.equal(recovered, true);
  assert.equal(harness.writes.length, 2);
  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(recoveredMessages.length, 2);
  assert.equal(recoveredOutbound.messageId, initialOutbound.messageId);
  assert.equal(recoveredOutbound.messagePinId, 'reply-pin-2');
  assert.deepEqual(recoveredOutbound.deliveryRecovery, {
    failedPinIds: ['reply-pin-1'],
    retryCount: 1,
  });
  assert.equal(conversationAfterRetry.turnCount, conversationBeforeRetry.turnCount);
  assert.equal(unified.messages.length, 2);
  assert.equal(unifiedOutbound.messageId, initialOutbound.messageId);
  assert.equal(unifiedOutbound.pinId, 'reply-pin-2');
  assert.deepEqual(unifiedOutbound.raw.deliveryRecovery, {
    failedPinIds: ['reply-pin-1'],
    retryCount: 1,
  });
});

test('auto-reply ignores a duplicate inbound private chat message that reuses the same messagePinId', async () => {
  const harness = await createAutoReplyHarness();

  await harness.handleInbound({
    messagePinId: 'incoming-pin-duplicate',
    rawMessage: {
      pinId: 'incoming-pin-duplicate',
      txid: 'incoming-tx-duplicate',
    },
  });
  await harness.handleInbound({
    messagePinId: 'incoming-pin-duplicate',
    rawMessage: {
      pinId: 'incoming-pin-duplicate',
      txid: 'incoming-tx-duplicate',
    },
  });

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.runnerInputs.length, 1);

  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].messagePinId, 'incoming-pin-duplicate');
  assert.equal(messages[1].messagePinId, 'reply-pin-1');

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply skips a stale inbound-triggered turn when a newer local outbound already exists', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    replyRunner: async (input) => {
      const latestInbound = input.recentMessages.at(-1);
      assert.equal(latestInbound?.messageId, 'incoming-pin-stale-turn');
      await harness.stateStore.appendMessages([{
        conversationId: input.conversation.conversationId,
        messageId: 'newer-local-outbound',
        direction: 'outbound',
        senderGlobalMetaId: harness.localGlobalMetaId,
        content: 'another turn already replied',
        messagePinId: 'newer-local-outbound',
        extensions: null,
        timestamp: now + 1,
      }]);
      return {
        state: 'reply',
        content: 'stale reply should not send',
      };
    },
  });

  await harness.handleInbound({
    content: 'latest inbound',
    messagePinId: 'incoming-pin-stale-turn',
  });

  assert.equal(harness.writes.length, 0);
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.filter((message) => message.direction === 'outbound').length, 1);
  assert.equal(messages.at(-1)?.messageId, 'newer-local-outbound');
});

test('auto-reply injects the latest 60 private chat messages into the runner', async () => {
  const harness = await createAutoReplyHarness({ now: 1_770_000_060_000 });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_059_000,
  });
  await harness.stateStore.appendMessages(Array.from({ length: 59 }, (_, index) => ({
    conversationId,
    messageId: `history-${index + 1}`,
    direction: index % 2 === 0 ? 'inbound' : 'outbound',
    senderGlobalMetaId: index % 2 === 0 ? harness.peerGlobalMetaId : harness.localGlobalMetaId,
    content: `history-${index + 1}`,
    messagePinId: null,
    extensions: null,
    timestamp: 1_770_000_000_000 + index,
  })));

  await harness.handleInbound({
    content: 'latest inbound',
    messagePinId: 'incoming-pin-latest',
  });

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].recentMessages.length, 60);
  assert.equal(harness.runnerInputs[0].recentMessages[0].content, 'history-1');
  assert.equal(harness.runnerInputs[0].recentMessages.at(-1).content, 'latest inbound');
});

test('auto-reply resets inbound turn count after five idle minutes from the latest stored message on either side', async () => {
  const now = 1_770_000_600_001;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.strategyStore.write({
    strategies: [
      { id: 'default', maxTurns: 30, maxIdleMs: 300_000, exitCriteria: '' },
    ],
  });
  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: 'default',
    state: 'active',
    turnCount: 12,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 300_001,
  });
  await harness.stateStore.appendMessages([{
    conversationId,
    messageId: 'old-outbound',
    direction: 'outbound',
    senderGlobalMetaId: harness.localGlobalMetaId,
    content: 'old outbound',
    messagePinId: null,
    extensions: null,
    timestamp: now - 300_001,
  }]);

  await withImmediateTimers(() => harness.handleInbound({
    content: 'new topic after idle',
    messagePinId: 'incoming-pin-idle',
  }));

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].conversation.turnCount, 1);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply closes on inbound Bye final line without using legacy close extensions', async () => {
  const harness = await createAutoReplyHarness();

  await harness.handleInbound({
    content: 'Thanks for the chat.\nbye',
    messagePinId: 'incoming-pin-bye',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply records inbound messages for closed conversations without reopening or replying', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 30,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
  });

  await harness.handleInbound({
    content: 'Are you still there?',
    messagePinId: 'incoming-pin-after-closed',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 30);
  assert.equal(conversation.lastDirection, 'inbound');

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.ok(messages.find((message) => message.messagePinId === 'incoming-pin-after-closed'));
});

test('auto-reply consumes matching pending guidance only after a successful inbound-triggered outbound reply', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(
    conversationId,
    'Bring the topic back to the delivery date.',
    now - 500,
  );

  await harness.handleInbound({
    content: 'Can you tell me more?',
    messagePinId: 'incoming-pin-guided-inbound',
  });

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(
    harness.runnerInputs[0].operatorGuidanceText,
    'Bring the topic back to the delivery date.',
  );

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
});

test('auto-reply keeps pending guidance when the runner throws before a reply is generated', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    replyRunner: async () => {
      throw new Error('runner failed');
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(conversationId, 'Ask for the missing txid.', now - 500);

  await harness.handleInbound({
    content: 'I think I already sent it.',
    messagePinId: 'incoming-pin-runner-throws',
  });

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'Ask for the missing txid.');
  assert.equal(conversation.pendingGuidanceCreatedAt, now - 500);
  assert.equal(harness.writes.length, 0);
});

test('auto-reply keeps pending guidance when the runner skips the turn', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    replyResult: { state: 'skip' },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(conversationId, 'Ask whether they want a refund.', now - 500);

  await harness.handleInbound({
    content: 'Actually I have one more question.',
    messagePinId: 'incoming-pin-runner-skip',
  });

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'Ask whether they want a refund.');
  assert.equal(conversation.pendingGuidanceCreatedAt, now - 500);
  assert.equal(harness.writes.length, 0);
});

test('auto-reply keeps pending guidance when a guided inbound turn hits host LLM template fallback', async () => {
  const now = 1_770_000_000_000;
  const runtime = {
    id: 'llm-runtime-1',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
  const harness = await createAutoReplyHarness({
    now,
    replyRunner: createHostLlmChatReplyRunner({
      runtimeResolver: {
        async resolveRuntime() {
          return { runtime, bindingId: 'binding-1' };
        },
        async selectMetaBot() {
          return null;
        },
        async markBindingUsed() {},
        async markRuntimeUnavailable() {},
      },
      llmExecutor: {
        async execute() {
          return 'llm-session-failed';
        },
        async getSession(sessionId) {
          return {
            sessionId,
            status: 'failed',
            result: {
              status: 'failed',
              output: '',
              error: 'backend failed',
              durationMs: 1,
            },
          };
        },
      },
      metaBotSlug: 'test-slug',
      pollIntervalMs: 1,
    }),
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(
    conversationId,
    'Ask for the delivery date.',
    now - 500,
  );

  await harness.handleInbound({
    content: 'Can you follow up now?',
    messagePinId: 'incoming-pin-guided-host-fallback',
  });

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'Ask for the delivery date.');
  assert.equal(conversation.pendingGuidanceCreatedAt, now - 500);
  assert.equal(harness.writes.length, 0);
});

test('auto-reply keeps pending guidance when the outbound send fails', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    resolvePeerChatPublicKey: null,
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(
    conversationId,
    'Bring them back to the payment reference.',
    now - 500,
  );

  await harness.handleInbound({
    content: 'Can we continue?',
    messagePinId: 'incoming-pin-send-fails',
  });

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'Bring them back to the payment reference.');
  assert.equal(conversation.pendingGuidanceCreatedAt, now - 500);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.filter((message) => message.direction === 'outbound').length, 0);
});

test('auto-reply logs pin_write_failed when the chain write rejects', async () => {
  const harness = await createAutoReplyHarness({
    writePinError: new Error('mvc broadcast failed: 502'),
  });

  await harness.handleInbound({ messagePinId: 'incoming-pin-log-pin-failure' });

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.sendFailureEvents.length, 1);
  assert.equal(harness.sendFailureEvents[0].kind, 'pin_write_failed');
  assert.equal(harness.sendFailureEvents[0].peerGlobalMetaId, harness.peerGlobalMetaId);
  assert.ok(harness.sendFailureEvents[0].error.includes('mvc broadcast failed: 502'));
});

test('auto-reply retries a stored inbound turn after the original send fails', async () => {
  let keyAvailable = false;
  let runnerCalls = 0;
  const peerPublicKey = createIdentityPair().publicKeyHex;
  const harness = await createAutoReplyHarness({
    resolvePeerChatPublicKey: () => keyAvailable ? peerPublicKey : null,
    replyRunner: async () => {
      runnerCalls += 1;
      return { state: 'reply', content: 'recovered reply' };
    },
  });

  await harness.handleInbound({ messagePinId: 'incoming-pin-retry-after-send-failure' });
  assert.equal(harness.writes.length, 0);
  assert.equal(runnerCalls, 1);

  keyAvailable = true;
  assert.equal(await harness.orchestrator.retryPendingInboundMessage(harness.peerGlobalMetaId), true);
  assert.equal(harness.writes.length, 1);
  assert.equal(runnerCalls, 2);
  assert.equal(await harness.orchestrator.retryPendingInboundMessage(harness.peerGlobalMetaId), false);
});

test('auto-reply does not start a recovery reply while the live inbound reply is still running', async () => {
  let releaseRunner;
  let runnerCalls = 0;
  const runnerStarted = new Promise((resolve) => {
    releaseRunner = resolve;
  });
  let finishRunner;
  const runnerFinished = new Promise((resolve) => {
    finishRunner = resolve;
  });
  const harness = await createAutoReplyHarness({
    replyRunner: async () => {
      runnerCalls += 1;
      releaseRunner();
      await runnerFinished;
      return { state: 'reply', content: 'single reply' };
    },
  });

  const liveReply = harness.handleInbound({ messagePinId: 'incoming-pin-live-reply' });
  await runnerStarted;
  assert.equal(
    await harness.orchestrator.retryPendingInboundMessage(harness.peerGlobalMetaId),
    false,
  );
  assert.equal(runnerCalls, 1);

  finishRunner();
  await liveReply;
  assert.equal(harness.writes.length, 1);
  assert.equal(runnerCalls, 1);
});

test('auto-reply logs identity_unavailable when the chat identity cannot be loaded', async () => {
  const harness = await createAutoReplyHarness({
    privateChatIdentityError: new Error('wallet is locked'),
  });

  await harness.handleInbound({ messagePinId: 'incoming-pin-log-identity-failure' });

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.sendFailureEvents.length, 1);
  assert.equal(harness.sendFailureEvents[0].kind, 'identity_unavailable');
  assert.equal(harness.sendFailureEvents[0].peerGlobalMetaId, harness.peerGlobalMetaId);
  assert.ok(harness.sendFailureEvents[0].error.includes('wallet is locked'));
});

test('auto-reply logs peer_chat_key_unavailable when the peer chat key is missing', async () => {
  const harness = await createAutoReplyHarness({
    resolvePeerChatPublicKey: null,
  });

  await harness.handleInbound({ messagePinId: 'incoming-pin-log-key-failure' });

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.sendFailureEvents.length, 1);
  assert.equal(harness.sendFailureEvents[0].kind, 'peer_chat_key_unavailable');
  assert.equal(harness.sendFailureEvents[0].peerGlobalMetaId, harness.peerGlobalMetaId);
  assert.equal(harness.sendFailureEvents[0].error, null);
});

test('auto-reply send failure path works without a send failure logger', async () => {
  const harness = await createAutoReplyHarness({
    writePinError: new Error('mvc broadcast failed: 502'),
    logSendFailure: null,
  });

  await harness.handleInbound({ messagePinId: 'incoming-pin-no-logger' });

  assert.equal(harness.writes.length, 0);
  assert.equal(harness.sendFailureEvents.length, 0);
});

test('auto-reply does not log send failures for successful sends', async () => {
  const harness = await createAutoReplyHarness({});

  await harness.handleInbound({ messagePinId: 'incoming-pin-log-success' });

  assert.equal(harness.writes.length, 1);
  assert.equal(harness.sendFailureEvents.length, 0);
});

test('private chat send failure file logger appends JSONL under the profile runtime logs', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const logEvent = createPrivateChatSendFailureFileLogger(paths);

  await logEvent({
    kind: 'pin_write_failed',
    peerGlobalMetaId: 'idq1peerbot00000000000000000000000000',
    error: 'mvc broadcast failed: 502',
  });
  await logEvent({
    kind: 'peer_chat_key_unavailable',
    peerGlobalMetaId: 'idq1peerbot00000000000000000000000000',
    error: null,
  });

  const logPath = privateChatSendFailureLogPath(paths);
  assert.ok(logPath.includes(path.join('.runtime', 'logs')));
  const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.kind, 'pin_write_failed');
  assert.equal(first.peerGlobalMetaId, 'idq1peerbot00000000000000000000000000');
  assert.equal(first.error, 'mvc broadcast failed: 502');
  assert.ok(typeof first.timestamp === 'string' && first.timestamp.length > 0);
  const second = JSON.parse(lines[1]);
  assert.equal(second.kind, 'peer_chat_key_unavailable');
  assert.equal(second.error, null);
});

test('auto-reply consumes pending guidance when send succeeds but outbound conversation persistence fails', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(
    conversationId,
    'Ask them to confirm the destination address.',
    now - 500,
  );

  const originalUpsertConversation = harness.stateStore.upsertConversation.bind(harness.stateStore);
  harness.stateStore.upsertConversation = async (conversation) => {
    if (conversation.conversationId === conversationId && conversation.lastDirection === 'outbound') {
      throw new Error('persist failed after send');
    }
    return originalUpsertConversation(conversation);
  };

  await harness.handleInbound({
    content: 'Please continue.',
    messagePinId: 'incoming-pin-persist-fails-after-send',
  });

  assert.equal(harness.writes.length, 1);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
  assert.equal(conversation.pendingGuidanceLeaseId, null);
  assert.equal(conversation.pendingGuidanceLeaseExpiresAt, null);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.filter((message) => message.direction === 'outbound').length, 1);
});

test('guided local turns consume pending guidance when send succeeds but outbound conversation persistence fails', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Bring the topic back to the delivery timeline.',
    pendingGuidanceCreatedAt: now - 500,
  });

  const originalUpsertConversation = harness.stateStore.upsertConversation.bind(harness.stateStore);
  harness.stateStore.upsertConversation = async (conversation) => {
    if (conversation.conversationId === conversationId && conversation.lastDirection === 'outbound') {
      throw new Error('persist failed after send');
    }
    return originalUpsertConversation(conversation);
  };

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.writes.length, 1);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
  assert.equal(conversation.pendingGuidanceLeaseId, null);
  assert.equal(conversation.pendingGuidanceLeaseExpiresAt, null);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.filter((message) => message.direction === 'outbound').length, 1);
});

test('auto-reply backs off while another initiator holds the active guidance claim', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });
  await harness.stateStore.setPendingGuidance(conversationId, 'Only one local turn may use this.', now - 500);
  const activeClaim = await harness.stateStore.claimPendingGuidance(conversationId, { now, leaseMs: 5_000 });
  assert.ok(activeClaim);

  await harness.handleInbound({
    content: 'Can you follow up now?',
    messagePinId: 'incoming-pin-guidance-claimed',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'Only one local turn may use this.');
  assert.equal(conversation.pendingGuidanceLeaseId, activeClaim.leaseId);
});

test('guided local turns can reopen a closed conversation when pending guidance exists', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 30,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Reopen the thread and ask for the exact delivery date.',
    pendingGuidanceCreatedAt: now - 500,
  });
  await harness.stateStore.appendMessages([{
    conversationId,
    messageId: 'history-inbound-1',
    direction: 'inbound',
    senderGlobalMetaId: harness.peerGlobalMetaId,
    content: 'Let us stop here for now.',
    messagePinId: 'history-pin-1',
    extensions: null,
    timestamp: now - 2_000,
  }]);

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].inboundMessage, null);
  assert.equal(
    harness.runnerInputs[0].operatorGuidanceText,
    'Reopen the thread and ask for the exact delivery date.',
  );
  assert.equal(harness.writes.length, 1);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 1);
  assert.equal(conversation.lastDirection, 'outbound');
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);

  await harness.handleInbound({
    content: 'Thanks, can you confirm the exact time too?',
    messagePinId: 'incoming-pin-after-guided-reopen',
  });

  assert.equal(harness.runnerInputs.length, 2);
  assert.equal(harness.runnerInputs[1].conversation.turnCount, 2);
});

test('guided session-opening turns strip the close marker and keep the conversation active', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    replyResult: {
      state: 'end_conversation',
      content: 'Picking up right where we left off — let us ship the walkthrough next.\nBye',
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 30,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Reopen the thread.',
    pendingGuidanceCreatedAt: now - 500,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].conversationCloseAllowed, false);
  assert.equal(harness.writes.length, 1);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const outbound = messages.filter((message) => message.direction === 'outbound').at(-1);
  assert.equal(
    outbound?.content,
    'Picking up right where we left off — let us ship the walkthrough next.',
  );

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 1);
});

test('guided follow-up turns may still close the conversation', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({
    now,
    replyResult: {
      state: 'end_conversation',
      content: 'That wraps it up, thanks!\nBye',
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 3,
    lastDirection: 'inbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Wrap it up politely.',
    pendingGuidanceCreatedAt: now - 500,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].conversationCloseAllowed, true);
  assert.equal(harness.writes.length, 1);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const outbound = messages.filter((message) => message.direction === 'outbound').at(-1);
  assert.equal(outbound?.content, 'That wraps it up, thanks!\nBye');

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
});

test('guided local turns do not send a stale claimed guidance after a newer guidance replaces it', async () => {
  const now = 1_770_000_000_000;
  let harness;
  harness = await createAutoReplyHarness({
    now,
    replyRunner: async (input) => {
      if (input.operatorGuidanceText === 'older guidance') {
        await harness.stateStore.setPendingGuidance(
          `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`,
          'newer guidance',
          now + 1,
        );
      }
      return {
        state: 'reply',
        content: `guided:${input.operatorGuidanceText}`,
      };
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'older guidance',
    pendingGuidanceCreatedAt: now - 500,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.writes.length, 0);
  let conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, 'newer guidance');
  assert.equal(conversation.pendingGuidanceCreatedAt, now + 1);

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.writes.length, 1);
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(
    messages.filter((message) => message.direction === 'outbound').at(-1)?.content,
    'guided:newer guidance',
  );
  conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
});

test('guided local turns use injected A2A persister for the outbound message', async () => {
  const now = 1_770_000_000_000;
  const persistedInputs = [];
  const harness = await createAutoReplyHarness({
    now,
    a2aConversationPersister: async (input) => {
      persistedInputs.push(input);
      return {
        messageId: input.message.messageId ?? input.message.pinId ?? 'persisted-guided-message',
        sessionId: 'a2a-peer-local-peer',
        orderSessionId: null,
        direction: input.message.direction,
        kind: 'private_chat',
        protocolTag: null,
        orderTxid: null,
        serviceOrderPinId: null,
        orderPinId: null,
        paymentTxid: null,
        content: input.message.content,
        contentType: 'text/plain',
        chain: input.message.chain ?? null,
        pinId: input.message.pinId ?? null,
        txid: input.message.txid ?? null,
        txids: input.message.txids ?? [],
        replyPinId: null,
        timestamp: input.message.timestamp ?? now,
        chainTimestamp: null,
        sender: { globalMetaId: input.local.globalMetaId, name: null, avatar: null, chatPublicKey: null },
        recipient: { globalMetaId: input.peer.globalMetaId, name: null, avatar: null, chatPublicKey: null },
        raw: null,
      };
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: now - 1000,
    updatedAt: now - 500,
    pendingGuidanceText: 'Keep the response visible immediately.',
    pendingGuidanceCreatedAt: now - 100,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(persistedInputs.length, 1);
  assert.equal(persistedInputs[0].local.globalMetaId, harness.localGlobalMetaId);
  assert.equal(persistedInputs[0].peer.globalMetaId, harness.peerGlobalMetaId);
  assert.equal(persistedInputs[0].message.direction, 'outgoing');
  assert.equal(persistedInputs[0].message.content, 'reply from LLM');
  assert.equal(persistedInputs[0].message.pinId, 'reply-pin-1');
  assert.deepEqual(persistedInputs[0].message.txids, ['reply-tx-1']);
});

test('guided local turns are a no-op for closed conversations without pending guidance', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 30,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 30);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
});

test('guided local turns clear stale guidance after a newer local outbound already happened', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'This guidance is already stale.',
    pendingGuidanceCreatedAt: now - 500,
  });
  await harness.stateStore.appendMessages([{
    conversationId,
    messageId: 'already-replied-outbound',
    direction: 'outbound',
    senderGlobalMetaId: harness.localGlobalMetaId,
    content: 'reply already sent after guidance',
    messagePinId: 'already-replied-outbound',
    extensions: null,
    timestamp: now - 100,
  }]);

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
  assert.equal(conversation.pendingGuidanceLeaseId, null);
  assert.equal(conversation.pendingGuidanceLeaseExpiresAt, null);
});

test('guided local turns still run when inbound auto-reply is disabled', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now, enabled: false });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 100_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Steer the thread back to delivery timing.',
    pendingGuidanceCreatedAt: now - 500,
  });

  await harness.handleLocalGuidedTurn();

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.writes.length, 1);
});

test('disabled auto-reply does not run the LLM or send a private-chat response', async () => {
  const harness = await createAutoReplyHarness({ enabled: false });

  await harness.handleInbound();

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
});

test('disabled auto-reply still persists the inbound message without invoking the reply runner', async () => {
  const now = 1_770_000_000_000;
  const persistedInputs = [];
  const harness = await createAutoReplyHarness({
    now,
    enabled: false,
    a2aConversationPersister: async (input) => {
      persistedInputs.push(input);
      return {
        messageId: input.message.messageId ?? 'persisted-inbound-message',
        sessionId: 'a2a-peer-local-peer',
        orderSessionId: null,
        direction: input.message.direction,
        kind: 'private_chat',
        protocolTag: null,
        orderTxid: null,
        serviceOrderPinId: null,
        orderPinId: null,
        paymentTxid: null,
        content: input.message.content,
        contentType: 'text/plain',
        chain: input.message.chain ?? null,
        pinId: input.message.pinId ?? null,
        txid: input.message.txid ?? null,
        txids: input.message.txids ?? [],
        replyPinId: null,
        timestamp: input.message.timestamp ?? now,
        chainTimestamp: null,
        sender: { globalMetaId: input.peer.globalMetaId, name: null, avatar: null, chatPublicKey: null },
        recipient: { globalMetaId: input.local.globalMetaId, name: null, avatar: null, chatPublicKey: null },
        raw: null,
      };
    },
  });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 4,
    lastDirection: 'outbound',
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
  });

  await harness.handleInbound({
    content: 'persist me even though replies are off',
    messagePinId: 'incoming-pin-disabled-persist',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);

  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].direction, 'inbound');
  assert.equal(messages[0].content, 'persist me even though replies are off');
  assert.equal(messages[0].messagePinId, 'incoming-pin-disabled-persist');

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.turnCount, 4);

  assert.equal(persistedInputs.length, 1);
  assert.equal(persistedInputs[0].message.direction, 'incoming');
  assert.equal(persistedInputs[0].message.content, 'persist me even though replies are off');
  assert.equal(persistedInputs[0].message.pinId, 'incoming-pin-disabled-persist');
});

test('auto-reply reopens closed conversations after the idle window elapses', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 30,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 300_001,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'New topic after the cooldown window.',
    messagePinId: 'incoming-pin-after-closed-cooldown',
  }));

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.runnerInputs[0].conversation.turnCount, 1);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply reopens closed conversations earlier when config cooldownMs shortens the window', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now, cooldownMs: 60_000 });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 5,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 120_000,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'New topic after the configured cooldown window.',
    messagePinId: 'incoming-pin-after-config-cooldown',
  }));

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.runnerInputs[0].conversation.turnCount, 1);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply keeps closed conversations closed longer when config cooldownMs lengthens the window', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now, cooldownMs: 3_600_000 });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 5,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 300_001,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'Still inside the configured cooldown window.',
    messagePinId: 'incoming-pin-inside-config-cooldown',
  }));

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 5);
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.ok(messages.some((message) => message.messagePinId === 'incoming-pin-inside-config-cooldown'));
});

test('auto-reply treats final Goodbye with punctuation as an inbound close signal', async () => {
  const harness = await createAutoReplyHarness();

  await harness.handleInbound({
    content: 'All set for now.\nGoodbye.',
    messagePinId: 'incoming-pin-goodbye',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply treats final Bye with emphatic or CJK punctuation as an inbound close signal', async () => {
  const harness = await createAutoReplyHarness();

  await harness.handleInbound({
    content: '下次再聊\nBye！',
    messagePinId: 'incoming-pin-bye-cjk-punctuation',
  });

  assert.equal(harness.runnerInputs.length, 0);
  assert.equal(harness.writes.length, 0);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply does not treat extensions.conversationSignal closing as the close signal', async () => {
  const harness = await createAutoReplyHarness();

  await harness.handleInbound({
    content: JSON.stringify({
      content: 'I am wrapping up.',
      extensions: { conversationSignal: 'closing' },
    }),
    messagePinId: 'incoming-pin-extension',
  });

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.writes.length, 1);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply persists visible outbound Bye and no close extension when the runner ends', async () => {
  const harness = await createAutoReplyHarness({
    replyResult: {
      state: 'reply',
      content: 'Thanks for the conversation.\nBye',
    },
  });

  await harness.handleInbound({
    content: 'That answers my question.',
    messagePinId: 'incoming-pin-runner-bye',
  });

  const messages = await harness.stateStore.getRecentMessages(
    `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`,
    10,
  );
  const outbound = messages.find((message) => message.direction === 'outbound');
  assert.ok(outbound);
  assert.equal(outbound.content, 'Thanks for the conversation.\nBye');
  assert.equal(outbound.extensions, null);

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 1);
});

test('auto-reply hard limit emits canonical visible Bye without close extensions', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 29,
    lastDirection: 'inbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'one more question',
    messagePinId: 'incoming-pin-limit',
  }));

  assert.equal(harness.runnerInputs.length, 0);
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const outbound = messages.find((message) => message.direction === 'outbound');
  assert.ok(outbound);
  assert.match(outbound.content, /\nBye$/);
  assert.equal(outbound.extensions, null);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 30);
});

test('auto-reply force-closes on the configured maxTurns without a strategy', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now, maxTurns: 2 });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'one more question',
    messagePinId: 'incoming-pin-config-limit',
  }));

  assert.equal(harness.runnerInputs.length, 0);
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const outbound = messages.find((message) => message.direction === 'outbound');
  assert.ok(outbound);
  assert.match(outbound.content, /\nBye$/);
  assert.equal(outbound.extensions, null);
  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'closed');
  assert.equal(conversation.turnCount, 2);
});

test('auto-reply applies pending guidance before falling back to the hard turn limit close', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 29,
    lastDirection: 'inbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
    pendingGuidanceText: 'Answer the question directly instead of closing the thread.',
    pendingGuidanceCreatedAt: now - 500,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'one more question',
    messagePinId: 'incoming-pin-limit-guided',
  }));

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(
    harness.runnerInputs[0].operatorGuidanceText,
    'Answer the question directly instead of closing the thread.',
  );
  const messages = await harness.stateStore.getRecentMessages(conversationId, 10);
  const outbound = messages.find((message) => message.direction === 'outbound');
  assert.ok(outbound);
  assert.equal(outbound.content, 'reply from LLM');

  const conversation = await harness.stateStore.getConversationByPeer(harness.peerGlobalMetaId);
  assert.equal(conversation.state, 'active');
  assert.equal(conversation.turnCount, 30);
  assert.equal(conversation.pendingGuidanceText, null);
  assert.equal(conversation.pendingGuidanceCreatedAt, null);
});

test('auto-reply passes inbound turn count above 20 through to the runner', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 20,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
  });

  await withImmediateTimers(() => harness.handleInbound({
    content: 'continue',
    messagePinId: 'incoming-pin-21',
  }));

  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].conversation.turnCount, 21);
});

test('auto-reply does not delay high-turn private chat replies', async () => {
  const now = 1_770_000_000_000;
  const harness = await createAutoReplyHarness({ now });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 20,
    lastDirection: 'outbound',
    createdAt: now - 1_000_000,
    updatedAt: now - 1_000,
  });

  const delays = await withCapturedImmediateTimers(() => harness.handleInbound({
    content: 'continue without delay',
    messagePinId: 'incoming-pin-no-delay',
  }));

  assert.deepEqual(delays, []);
  assert.equal(harness.runnerInputs.length, 1);
  assert.equal(harness.runnerInputs[0].conversation.turnCount, 21);
  assert.equal(harness.writes.length, 1);
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

test('auto-reply keeps order-protocol traffic out of the runner chat context', async () => {
  const harness = await createAutoReplyHarness({ now: 1_770_000_060_000 });
  const conversationId = `pc-${harness.localGlobalMetaId}-${harness.peerGlobalMetaId}`;
  const orderTxid = 'a'.repeat(64);

  await harness.stateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: harness.peerGlobalMetaId,
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'outbound',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_059_000,
  });
  await harness.stateStore.appendMessages([
    {
      conversationId,
      messageId: 'proto-1',
      direction: 'inbound',
      senderGlobalMetaId: harness.peerGlobalMetaId,
      content: `[ORDER_STATUS:${orderTxid}] I received the order and started processing.`,
      messagePinId: null,
      extensions: null,
      timestamp: 1_770_000_000_100,
    },
    {
      conversationId,
      messageId: 'proto-2',
      direction: 'inbound',
      senderGlobalMetaId: harness.peerGlobalMetaId,
      content: `[DELIVERY:${orderTxid}] {"paymentTxid":"bbbb","result":"done"}`,
      messagePinId: null,
      extensions: null,
      timestamp: 1_770_000_000_200,
    },
    {
      conversationId,
      messageId: 'proto-3',
      direction: 'inbound',
      senderGlobalMetaId: harness.peerGlobalMetaId,
      content: `[NeedsRating:${orderTxid}] Please rate this service.`,
      messagePinId: null,
      extensions: null,
      timestamp: 1_770_000_000_300,
    },
    {
      conversationId,
      messageId: 'chat-1',
      direction: 'inbound',
      senderGlobalMetaId: harness.peerGlobalMetaId,
      content: 'real chat question',
      messagePinId: null,
      extensions: null,
      timestamp: 1_770_000_000_400,
    },
    {
      conversationId,
      messageId: 'chat-2',
      direction: 'outbound',
      senderGlobalMetaId: harness.localGlobalMetaId,
      content: 'real chat answer',
      messagePinId: null,
      extensions: null,
      timestamp: 1_770_000_000_500,
    },
  ]);

  await harness.handleInbound({
    content: 'latest inbound',
    messagePinId: 'incoming-pin-protocol-filter',
  });

  assert.equal(harness.runnerInputs.length, 1);
  const contents = harness.runnerInputs[0].recentMessages.map((message) => message.content);
  assert.deepEqual(contents, ['real chat question', 'real chat answer', 'latest inbound']);

  // The protocol records stay in the state store; only the prompt context is filtered.
  const stored = await harness.stateStore.getRecentMessages(conversationId, 10);
  assert.ok(stored.some((message) => message.content.startsWith(`[ORDER_STATUS:${orderTxid}]`)));
});
