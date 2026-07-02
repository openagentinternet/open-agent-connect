import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { persistA2AConversationMessageBestEffort } = require('../../dist/core/a2a/conversationPersistence.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

const LOCAL_GLOBAL_META_ID = 'idq1localhandler000000000000000000000000';
const PEER_GLOBAL_META_ID = 'idq1peerhandler0000000000000000000000000';
const BASE_TIME = 1_777_500_000_000;

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function readOnlySigner() {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async () => {
      throw new Error('writePin should not be called by conversation read handlers');
    },
  };
}

function chatSigner(pair, writeCalls = []) {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({
      globalMetaId: LOCAL_GLOBAL_META_ID,
      privateKeyHex: pair.privateKeyHex,
      chatPublicKey: pair.publicKeyHex,
    }),
    writePin: async (input) => {
      writeCalls.push(input);
      return {
        txids: ['chat-live-tx-1'],
        pinId: 'chat-live-pin-1',
        totalCost: 1,
        network: input.network ?? 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
      };
    },
  };
}

function failingChatSigner(pair, message = 'chat write failed') {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({
      globalMetaId: LOCAL_GLOBAL_META_ID,
      privateKeyHex: pair.privateKeyHex,
      chatPublicKey: pair.publicKeyHex,
    }),
    writePin: async () => {
      throw new Error(message);
    },
  };
}

function identity() {
  return {
    metabotId: 1,
    name: 'Eric',
    createdAt: BASE_TIME,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'public-key-eric',
    chatPublicKey: 'chat-public-key-eric',
    addresses: { mvc: 'mvc-eric' },
    mvcAddress: 'mvc-eric',
    metaId: 'metaid-eric',
    globalMetaId: LOCAL_GLOBAL_META_ID,
    subsidyState: 'claimed',
    syncState: 'synced',
  };
}

function actor(globalMetaId, name, overrides = {}) {
  return {
    globalMetaId,
    name,
    avatar: overrides.avatar ?? null,
    chatPublicKey: overrides.chatPublicKey ?? `${String(name).toLowerCase()}-chat-public-key`,
  };
}

function message(index, overrides = {}) {
  const direction = overrides.direction ?? 'outgoing';
  const local = actor(LOCAL_GLOBAL_META_ID, 'Eric');
  const peer = actor(PEER_GLOBAL_META_ID, 'Remote Bot');
  return {
    messageId: `handler-msg-${index}`,
    sessionId: 'a2a-peer-idq1loca-idq1peer',
    orderSessionId: null,
    direction,
    kind: 'private_chat',
    protocolTag: null,
    orderTxid: null,
    serviceOrderPinId: null,
    orderPinId: null,
    paymentTxid: null,
    content: `handler message ${index}`,
    contentType: 'text/plain',
    chain: 'mvc',
    pinId: `handler-pin-${index}`,
    txid: `handler-tx-${index}`,
    txids: [`handler-tx-${index}`],
    replyPinId: null,
    timestamp: BASE_TIME + index,
    chainTimestamp: Math.floor((BASE_TIME + index) / 1000),
    sender: direction === 'outgoing' ? local : peer,
    recipient: direction === 'outgoing' ? peer : local,
    raw: null,
    ...overrides,
  };
}

async function createFixture(t, options = {}) {
  const homeDir = await createProfileHome('metabot-default-conversations-', 'eric');
  const systemHomeDir = deriveSystemHome(homeDir);
  t.after(async () => cleanupProfileHome(homeDir));
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Eric',
    homeDir,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: 'mvc-eric',
    now: () => BASE_TIME,
  });
  if (options.peerProfile) {
    const peerHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'known-remote-bot');
    await mkdir(peerHomeDir, { recursive: true });
    await upsertIdentityProfile({
      systemHomeDir,
      name: options.peerProfile.name,
      homeDir: peerHomeDir,
      globalMetaId: PEER_GLOBAL_META_ID,
      mvcAddress: 'mvc-remote-bot',
      now: () => BASE_TIME + 1,
    });
    await writeFile(path.join(peerHomeDir, 'avatar.txt'), options.peerProfile.avatarDataUrl, 'utf8');
  }
  await createRuntimeStateStore(homeDir).writeState({
    identity: identity(),
    services: [],
    traces: [],
    sellerOrders: [],
  });
  const local = actor(LOCAL_GLOBAL_META_ID, 'Eric');
  const peer = actor(
    PEER_GLOBAL_META_ID,
    options.conversationPeerName ?? 'Remote Bot',
    { avatar: options.conversationPeerAvatar ?? null },
  );
  const messages = [
    message(1, { direction: 'incoming', content: 'remote hello', sender: peer, recipient: local }),
    message(2, { content: 'local asks for service', sender: local, recipient: peer }),
  ];
  await createA2AConversationStore({ homeDir, local, peer }).writeConversation({
    version: 1,
    local,
    peer,
    messages,
    sessions: [
      {
        sessionId: 'a2a-peer-idq1loca-idq1peer',
        type: 'peer',
        state: 'active',
        createdAt: BASE_TIME + 1,
        updatedAt: BASE_TIME + 2,
        latestMessageId: 'handler-msg-2',
      },
    ],
    indexes: {
      messageIds: messages.map((entry) => entry.messageId),
      orderTxidToSessionId: {},
      paymentTxidToSessionId: {},
    },
    updatedAt: BASE_TIME + 2,
  });
  return {
    homeDir,
    systemHomeDir,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      systemHomeDir,
      signer: options.signer ?? readOnlySigner(),
      fetchPeerChatPublicKey: options.fetchPeerChatPublicKey,
      llmExecutor: options.llmExecutor,
      conversationGuidanceReplyRunner: options.conversationGuidanceReplyRunner,
      getDaemonRecord: () => null,
    }),
  };
}

test('default conversation handlers list peer conversations by local Bot GlobalMetaID', async (t) => {
  const { handlers } = await createFixture(t);

  const listed = await handlers.conversations.list({
    local: LOCAL_GLOBAL_META_ID,
    limit: 10,
  });

  assert.equal(listed.ok, true);
  assert.equal(listed.data.localBot.globalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(listed.data.conversations.length, 1);
  assert.equal(listed.data.conversations[0].peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(listed.data.conversations[0].latestText, 'local asks for service');
});

test('default conversation handlers read one peer timeline by local and peer GlobalMetaID', async (t) => {
  const { handlers } = await createFixture(t);

  const messages = await handlers.conversations.messages({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    limit: 50,
  });

  assert.equal(messages.ok, true);
  assert.deepEqual(messages.data.messages.map((entry) => entry.content), [
    'remote hello',
    'local asks for service',
  ]);
  assert.equal(messages.data.messages[0].sender.globalMetaId, PEER_GLOBAL_META_ID);
});

test('default conversation handlers enrich peer name and avatar from local profiles', async (t) => {
  const { handlers } = await createFixture(t, {
    peerProfile: {
      name: 'Known Remote Bot',
      avatarDataUrl: 'data:image/png;base64,remote',
    },
    conversationPeerName: '',
    conversationPeerAvatar: null,
  });

  const listed = await handlers.conversations.list({
    local: LOCAL_GLOBAL_META_ID,
    limit: 10,
  });
  const messages = await handlers.conversations.messages({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    limit: 50,
  });

  assert.equal(listed.ok, true);
  assert.equal(listed.data.conversations[0].peerName, 'Known Remote Bot');
  assert.equal(listed.data.conversations[0].peerAvatar, 'data:image/png;base64,remote');
  assert.equal(messages.ok, true);
  assert.equal(messages.data.peerBot.name, 'Known Remote Bot');
  assert.equal(messages.data.peerBot.avatar, 'data:image/png;base64,remote');
  assert.equal(messages.data.messages[0].sender.name, 'Known Remote Bot');
  assert.equal(messages.data.messages[0].sender.avatar, 'data:image/png;base64,remote');
});

test('default conversation event stream publishes a message event after A2A persistence', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const writeCalls = [];
  const { handlers } = await createFixture(t, {
    signer: chatSigner(localPair, writeCalls),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
  });

  const stream = await handlers.conversations.streamEvents({
    local: LOCAL_GLOBAL_META_ID,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const initial = await iterator.next();
  const nextEvent = iterator.next();
  const sent = await handlers.chat.private({
    from: LOCAL_GLOBAL_META_ID,
    to: PEER_GLOBAL_META_ID,
    content: 'live ping',
    peerChatPublicKey: peerPair.publicKeyHex,
  });
  const event = await Promise.race([
    nextEvent,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for conversation SSE event')), 500);
    }),
  ]);
  await iterator.return?.();

  assert.equal(initial.value.type, 'conversation-update');
  assert.equal(sent.ok, true);
  assert.equal(writeCalls.length, 1);
  assert.equal(event.value.type, 'conversation-message');
  assert.equal(event.value.localGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(event.value.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(event.value.kind, 'private_chat');
});

test('default conversation event stream publishes a message event after external A2A persistence', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  const stream = await handlers.conversations.streamEvents({
    local: LOCAL_GLOBAL_META_ID,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const initial = await iterator.next();
  const nextEvent = iterator.next();

  const persisted = await persistA2AConversationMessageBestEffort({
    paths: resolveMetabotPaths(homeDir),
    local: actor(LOCAL_GLOBAL_META_ID, 'Eric'),
    peer: actor(PEER_GLOBAL_META_ID, 'Remote Bot'),
    message: {
      messageId: 'listener-msg-1',
      direction: 'incoming',
      content: 'remote pushed a new message',
      contentType: 'text/plain',
      pinId: 'listener-pin-1',
      txid: 'listener-tx-1',
      txids: ['listener-tx-1'],
      timestamp: BASE_TIME + 3,
      raw: {
        source: 'simplemsg-listener',
      },
    },
  });

  const event = await Promise.race([
    nextEvent,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for externally persisted conversation SSE event')), 500);
    }),
  ]);
  await iterator.return?.();

  assert.equal(initial.value.type, 'conversation-update');
  assert.equal(persisted.persisted, true);
  assert.equal(event.value.type, 'conversation-message');
  assert.equal(event.value.localGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(event.value.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(event.value.messageId, 'listener-msg-1');
  assert.equal(event.value.kind, 'private_chat');
});

test('default conversation guidance reopens a closed conversation, sends one guided turn, and clears pending guidance', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const writeCalls = [];
  const { homeDir, handlers } = await createFixture(t, {
    signer: chatSigner(localPair, writeCalls),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
    conversationGuidanceReplyRunner: async () => ({
      state: 'reply',
      content: 'Please confirm the delivery date.',
    }),
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  await privateChatStateStore.upsertConversation({
    conversationId: `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 10,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const stream = await handlers.conversations.streamEvents({
    local: LOCAL_GLOBAL_META_ID,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const initial = await iterator.next();
  const nextEvent = iterator.next();

  const guided = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Reopen the thread and ask for the delivery date.',
  });

  const event = await Promise.race([
    nextEvent,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for guided conversation SSE event')), 2000);
    }),
  ]);
  await iterator.return?.();

  assert.equal(initial.value.type, 'conversation-update');
  assert.equal(guided.ok, true);
  assert.equal(guided.data.guidanceApplied, true);
  assert.equal(guided.data.guidanceConsumed, true);
  assert.equal(guided.data.pinId, 'chat-live-pin-1');
  assert.deepEqual(guided.data.txids, ['chat-live-tx-1']);
  assert.equal(writeCalls.length, 1);
  assert.equal(event.value.type, 'conversation-message');
  assert.equal(event.value.localGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(event.value.peerGlobalMetaId, PEER_GLOBAL_META_ID);

  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.state, 'active');
  assert.equal(conversation?.lastDirection, 'outbound');
  assert.equal(conversation?.turnCount, 1);
  assert.equal(conversation?.pendingGuidanceText, null);
  assert.equal(conversation?.pendingGuidanceCreatedAt, null);

  const messages = await handlers.conversations.messages({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    limit: 50,
  });
  assert.equal(messages.ok, true);
  assert.equal(messages.data.messages.at(-1)?.content, 'Please confirm the delivery date.');
});

test('default conversation guidance keeps pending guidance when reply generation fails', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const { homeDir, handlers } = await createFixture(t, {
    signer: chatSigner(localPair, []),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
    conversationGuidanceReplyRunner: async () => {
      throw new Error('runner exploded');
    },
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  await privateChatStateStore.upsertConversation({
    conversationId: `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 2,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const guided = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Ask for the missing txid.',
  });

  assert.equal(guided.ok, false);
  assert.equal(guided.code, 'conversation_guidance_failed');
  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.pendingGuidanceText, 'Ask for the missing txid.');
  assert.ok(typeof conversation?.pendingGuidanceCreatedAt === 'number');
  assert.equal(conversation?.pendingGuidanceLeaseId ?? null, null);
  assert.equal(conversation?.pendingGuidanceLeaseExpiresAt ?? null, null);
});

test('default conversation guidance keeps pending guidance when send fails', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const { homeDir, handlers } = await createFixture(t, {
    signer: failingChatSigner(localPair),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
    conversationGuidanceReplyRunner: async () => ({
      state: 'reply',
      content: 'Bring the topic back to the payment reference.',
    }),
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  await privateChatStateStore.upsertConversation({
    conversationId: `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 2,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const guided = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Bring the topic back to the payment reference.',
  });

  assert.equal(guided.ok, false);
  assert.equal(guided.code, 'conversation_guidance_failed');
  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.pendingGuidanceText, 'Bring the topic back to the payment reference.');
  assert.ok(typeof conversation?.pendingGuidanceCreatedAt === 'number');
  assert.equal(conversation?.pendingGuidanceLeaseId ?? null, null);
  assert.equal(conversation?.pendingGuidanceLeaseExpiresAt ?? null, null);
});

test('default conversation guidance keeps pending guidance when host LLM fallback is disabled', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const writeCalls = [];
  const { homeDir, handlers } = await createFixture(t, {
    signer: chatSigner(localPair, writeCalls),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
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
  });
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      {
        id: 'runtime-codex',
        provider: 'codex',
        displayName: 'Codex',
        binaryPath: '/bin/codex',
        authState: 'authenticated',
        health: 'healthy',
        capabilities: ['streaming'],
        lastSeenAt: '2026-05-05T00:00:00.000Z',
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    ],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-eric-primary',
        metaBotSlug: 'eric',
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    ],
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  await privateChatStateStore.upsertConversation({
    conversationId: `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 2,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const guided = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Ask for the delivery date.',
  });

  assert.equal(guided.ok, false);
  assert.equal(guided.code, 'conversation_guidance_failed');
  assert.equal(writeCalls.length, 0);
  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.pendingGuidanceText, 'Ask for the delivery date.');
  assert.ok(typeof conversation?.pendingGuidanceCreatedAt === 'number');
});

test('default conversation guidance rejects peers without an existing conversation', async (t) => {
  const { handlers } = await createFixture(t);

  const guided = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: 'idq1missingpeer000000000000000000000000000',
    guidance: 'Start a brand new thread.',
  });

  assert.equal(guided.ok, false);
  assert.equal(guided.code, 'conversation_not_found');
});

test('default conversation guidance holds the pending guidance lease until its proactive turn runs', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  const writeCalls = [];
  let releaseRunner;
  const runnerGate = new Promise((resolve) => {
    releaseRunner = resolve;
  });
  const { homeDir, handlers } = await createFixture(t, {
    signer: chatSigner(localPair, writeCalls),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
    conversationGuidanceReplyRunner: async (input) => {
      await runnerGate;
      return {
        state: 'reply',
        content: `guided:${input.operatorGuidanceText}`,
      };
    },
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  const conversationId = `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`;
  await privateChatStateStore.upsertConversation({
    conversationId,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 2,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const guidedPromise = handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Ask for the delivery date right now.',
  });

  let leasedConversation = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    leasedConversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
    if (leasedConversation?.pendingGuidanceLeaseId) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(leasedConversation?.pendingGuidanceLeaseId);
  const competingClaim = await privateChatStateStore.claimPendingGuidance(
    conversationId,
    { now: BASE_TIME + 100 },
  );
  assert.equal(competingClaim, null);

  releaseRunner();
  const guided = await guidedPromise;

  assert.equal(guided.ok, true);
  assert.equal(guided.data.guidanceApplied, true);
  assert.equal(writeCalls.length, 1);
  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.pendingGuidanceText, null);
  assert.equal(conversation?.pendingGuidanceCreatedAt, null);
  assert.equal(conversation?.pendingGuidanceLeaseId, null);
});

test('default conversation guidance replaces older pending guidance before a later successful send', async (t) => {
  const localPair = createIdentityPair();
  const peerPair = createIdentityPair();
  let shouldFail = true;
  const { homeDir, handlers } = await createFixture(t, {
    signer: chatSigner(localPair, []),
    fetchPeerChatPublicKey: async () => peerPair.publicKeyHex,
    conversationGuidanceReplyRunner: async (input) => {
      if (shouldFail) {
        throw new Error('runner exploded');
      }
      return {
        state: 'reply',
        content: `guided:${input.operatorGuidanceText}`,
      };
    },
  });
  const privateChatStateStore = createPrivateChatStateStore(homeDir);
  await privateChatStateStore.upsertConversation({
    conversationId: `pc-${LOCAL_GLOBAL_META_ID}-${PEER_GLOBAL_META_ID}`,
    peerGlobalMetaId: PEER_GLOBAL_META_ID,
    peerName: 'Remote Bot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: BASE_TIME + 1,
    updatedAt: BASE_TIME + 2,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
    pendingGuidanceLeaseId: null,
    pendingGuidanceLeaseExpiresAt: null,
  });

  const firstAttempt = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'older guidance',
  });
  assert.equal(firstAttempt.ok, false);
  const pendingAfterFailure = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(pendingAfterFailure?.pendingGuidanceText, 'older guidance');

  shouldFail = false;
  const secondAttempt = await handlers.conversations.guidance({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'newer guidance',
  });

  assert.equal(secondAttempt.ok, true);
  const messages = await handlers.conversations.messages({
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    limit: 50,
  });
  assert.equal(messages.ok, true);
  assert.equal(messages.data.messages.at(-1)?.content, 'guided:newer guidance');

  const conversation = await privateChatStateStore.getConversationByPeer(PEER_GLOBAL_META_ID);
  assert.equal(conversation?.pendingGuidanceText, null);
  assert.equal(conversation?.pendingGuidanceCreatedAt, null);
});
