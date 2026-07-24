import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-chat-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  const managerRoot = path.join(base, '.metabot', 'manager');
  const skillsRoot = path.join(base, '.metabot', 'skills');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  await fs.mkdir(skillsRoot, { recursive: true });
  return { base, profileRoot };
}

test('readState returns empty state on fresh directory', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));
  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.deepEqual(state.conversations, []);
  assert.deepEqual(state.messages, []);
});

test('upsertConversation persists and can be retrieved', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  const conv = {
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  };

  await store.upsertConversation(conv);
  const state = await store.readState();
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].conversationId, 'pc-self-peer');
});

test('upsertConversation replaces existing conversation with same id', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  const conv = {
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  };

  await store.upsertConversation(conv);
  await store.upsertConversation({ ...conv, turnCount: 5, state: 'closed' });

  const state = await store.readState();
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].turnCount, 5);
  assert.equal(state.conversations[0].state, 'closed');
});

test('appendMessages deduplicates by messageId', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  const msg = {
    conversationId: 'pc-self-peer',
    messageId: 'msg-1',
    direction: 'inbound',
    senderGlobalMetaId: 'peer-gm-1',
    content: 'hello',
    messagePinId: null,
    extensions: null,
    timestamp: Date.now(),
  };

  await store.appendMessages([msg]);
  await store.appendMessages([msg]); // duplicate

  const state = await store.readState();
  assert.equal(state.messages.length, 1);
});

test('replaceMessage updates a logical message without adding a duplicate', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));
  const original = {
    conversationId: 'pc-self-peer',
    messageId: 'logical-message-1',
    direction: 'outbound',
    senderGlobalMetaId: 'self',
    content: 'hello',
    messagePinId: 'dropped-pin',
    extensions: null,
    timestamp: 1000,
  };
  await store.appendMessages([original]);

  const replaced = await store.replaceMessage(original.messageId, {
    ...original,
    messagePinId: 'retry-pin',
    timestamp: 2000,
    deliveryRecovery: {
      failedPinIds: ['dropped-pin'],
      retryCount: 1,
    },
  });

  const state = await store.readState();
  assert.equal(replaced.messageId, original.messageId);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].messagePinId, 'retry-pin');
  assert.deepEqual(state.messages[0].deliveryRecovery, {
    failedPinIds: ['dropped-pin'],
    retryCount: 1,
  });
});

test('getConversationByPeer returns the active conversation for a peer', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer-old',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'closed',
    turnCount: 10,
    lastDirection: 'outbound',
    createdAt: 1000,
    updatedAt: 2000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await store.upsertConversation({
    conversationId: 'pc-self-peer-new',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: null,
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 3000,
    updatedAt: 4000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  const found = await store.getConversationByPeer('peer-gm-1');
  assert.ok(found);
  assert.equal(found.conversationId, 'pc-self-peer-new');
  assert.equal(found.state, 'active');
});

test('getRecentMessages returns messages sorted by timestamp', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.appendMessages([
    { conversationId: 'c1', messageId: 'm3', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'third', messagePinId: null, extensions: null, timestamp: 3000 },
    { conversationId: 'c1', messageId: 'm1', direction: 'outbound', senderGlobalMetaId: 'self', content: 'first', messagePinId: null, extensions: null, timestamp: 1000 },
    { conversationId: 'c1', messageId: 'm2', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'second', messagePinId: null, extensions: null, timestamp: 2000 },
  ]);

  const messages = await store.getRecentMessages('c1', 2);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, 'm2');
  assert.equal(messages[1].messageId, 'm3');
});

test('getRecentMessages normalizes second-based timestamps before sorting', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.appendMessages([
    {
      conversationId: 'c1',
      messageId: 'old-outbound-ms',
      direction: 'outbound',
      senderGlobalMetaId: 'self',
      content: 'older outbound',
      messagePinId: null,
      extensions: null,
      timestamp: 1_783_332_314_680,
    },
    {
      conversationId: 'c1',
      messageId: 'new-inbound-seconds',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'new inbound',
      messagePinId: null,
      extensions: null,
      timestamp: 1_783_341_491,
    },
  ]);

  const messages = await store.getRecentMessages('c1', 2);
  assert.equal(messages[0].messageId, 'old-outbound-ms');
  assert.equal(messages[1].messageId, 'new-inbound-seconds');
  assert.equal(messages[1].timestamp, 1_783_341_491_000);
});

test('corrupt JSON file is quarantined and empty state returned', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createPrivateChatStateStore(paths);

  // Ensure runtime layout exists.
  await store.readState();

  // Write corrupt data.
  await fs.writeFile(paths.privateChatStatePath, '{invalid json!!!', 'utf8');

  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.deepEqual(state.conversations, []);
  assert.deepEqual(state.messages, []);
});

test('readState normalizes legacy conversations without pending guidance keys', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createPrivateChatStateStore(paths);

  await store.readState();
  await fs.writeFile(paths.privateChatStatePath, JSON.stringify({
    version: 1,
    conversations: [
      {
        conversationId: 'pc-self-peer',
        peerGlobalMetaId: 'peer-gm-1',
        peerName: 'PeerBot',
        topic: null,
        strategyId: null,
        state: 'active',
        turnCount: 1,
        lastDirection: 'inbound',
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
    messages: [],
  }, null, 2), 'utf8');

  const state = await store.readState();
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].pendingGuidanceText, null);
  assert.equal(state.conversations[0].pendingGuidanceCreatedAt, null);

  const conversation = await store.getConversationByPeer('peer-gm-1');
  assert.equal(conversation?.pendingGuidanceText, null);
  assert.equal(conversation?.pendingGuidanceCreatedAt, null);
});

test('setPendingGuidance stores one-shot guidance on a conversation', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  const updated = await store.setPendingGuidance('pc-self-peer', '  bring it back to pricing  ', 1234);

  assert.equal(updated?.pendingGuidanceText, 'bring it back to pricing');
  assert.equal(updated?.pendingGuidanceCreatedAt, 1234);
  const persisted = await store.getConversationByPeer('peer-gm-1');
  assert.equal(persisted?.pendingGuidanceText, 'bring it back to pricing');
  assert.equal(persisted?.pendingGuidanceCreatedAt, 1234);
});

test('setPendingGuidance replaces older unconsumed guidance', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await store.setPendingGuidance('pc-self-peer', 'older guidance', 1111);
  const replaced = await store.setPendingGuidance('pc-self-peer', 'newer guidance', 2222);

  assert.equal(replaced?.pendingGuidanceText, 'newer guidance');
  assert.equal(replaced?.pendingGuidanceCreatedAt, 2222);
  assert.equal(replaced?.pendingGuidanceLeaseId ?? null, null);
  assert.equal(replaced?.pendingGuidanceLeaseExpiresAt ?? null, null);
});

test('setPendingGuidanceAndClaim atomically replaces guidance with an active lease', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  const claimed = await store.setPendingGuidanceAndClaim(
    'pc-self-peer',
    'newer guidance',
    2222,
    { now: 3000, leaseMs: 4000 },
  );

  assert.ok(claimed);
  assert.equal(claimed.claim.guidanceText, 'newer guidance');
  assert.equal(claimed.claim.createdAt, 2222);
  assert.equal(claimed.claim.leaseExpiresAt, 7000);
  assert.equal(claimed.conversation.pendingGuidanceText, 'newer guidance');
  assert.equal(claimed.conversation.pendingGuidanceCreatedAt, 2222);
  assert.equal(claimed.conversation.pendingGuidanceLeaseId, claimed.claim.leaseId);
  assert.equal(claimed.conversation.pendingGuidanceLeaseExpiresAt, 7000);

  const persisted = await store.getConversationByPeer('peer-gm-1');
  assert.equal(persisted?.pendingGuidanceText, 'newer guidance');
  assert.equal(persisted?.pendingGuidanceCreatedAt, 2222);
  assert.equal(persisted?.pendingGuidanceLeaseId, claimed.claim.leaseId);
  assert.equal(persisted?.pendingGuidanceLeaseExpiresAt, 7000);
});

test('clearPendingGuidanceIfMatches only clears the matching guidance', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await store.setPendingGuidance('pc-self-peer', 'older guidance', 1111);
  await store.setPendingGuidance('pc-self-peer', 'newer guidance', 2222);

  const untouched = await store.clearPendingGuidanceIfMatches('pc-self-peer', 'older guidance', 1111);
  assert.equal(untouched?.pendingGuidanceText, 'newer guidance');
  assert.equal(untouched?.pendingGuidanceCreatedAt, 2222);

  const cleared = await store.clearPendingGuidanceIfMatches('pc-self-peer', 'newer guidance', 2222);
  assert.equal(cleared?.pendingGuidanceText, null);
  assert.equal(cleared?.pendingGuidanceCreatedAt, null);
});

test('claimPendingGuidance grants one active lease at a time and release keeps guidance pending', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await store.setPendingGuidance('pc-self-peer', '  guide the next turn  ', 1234);
  const firstClaim = await store.claimPendingGuidance('pc-self-peer', { now: 2000, leaseMs: 5000 });
  const blockedClaim = await store.claimPendingGuidance('pc-self-peer', { now: 2001, leaseMs: 5000 });

  assert.equal(firstClaim?.guidanceText, 'guide the next turn');
  assert.equal(blockedClaim, null);

  const released = await store.releasePendingGuidanceClaimIfMatches('pc-self-peer', firstClaim);
  assert.equal(released?.pendingGuidanceText, 'guide the next turn');
  assert.equal(released?.pendingGuidanceCreatedAt, 1234);
  assert.equal(released?.pendingGuidanceLeaseId ?? null, null);
  assert.equal(released?.pendingGuidanceLeaseExpiresAt ?? null, null);

  const secondClaim = await store.claimPendingGuidance('pc-self-peer', { now: 2002, leaseMs: 5000 });
  assert.ok(secondClaim);
  assert.notEqual(secondClaim.leaseId, firstClaim.leaseId);
});

test('claimPendingGuidance can replace a stale lease and clearPendingGuidanceIfMatches respects lease ownership', async () => {
  const { profileRoot } = await createTempProfileHome();
  const store = createPrivateChatStateStore(resolveMetabotPaths(profileRoot));

  await store.upsertConversation({
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'peer-gm-1',
    peerName: 'PeerBot',
    topic: null,
    strategyId: null,
    state: 'active',
    turnCount: 1,
    lastDirection: 'inbound',
    createdAt: 1000,
    updatedAt: 1000,
    pendingGuidanceText: null,
    pendingGuidanceCreatedAt: null,
  });

  await store.setPendingGuidance('pc-self-peer', 'guide the next turn', 1234);
  const firstClaim = await store.claimPendingGuidance('pc-self-peer', { now: 2000, leaseMs: 10 });
  const secondClaim = await store.claimPendingGuidance('pc-self-peer', { now: 2011, leaseMs: 5000 });

  assert.ok(firstClaim);
  assert.ok(secondClaim);
  assert.notEqual(secondClaim.leaseId, firstClaim.leaseId);

  const untouched = await store.clearPendingGuidanceIfMatches(
    'pc-self-peer',
    'guide the next turn',
    1234,
    firstClaim.leaseId,
  );
  assert.equal(untouched?.pendingGuidanceText, 'guide the next turn');
  assert.equal(untouched?.pendingGuidanceLeaseId, secondClaim.leaseId);

  const cleared = await store.clearPendingGuidanceIfMatches(
    'pc-self-peer',
    'guide the next turn',
    1234,
    secondClaim.leaseId,
  );
  assert.equal(cleared?.pendingGuidanceText, null);
  assert.equal(cleared?.pendingGuidanceCreatedAt, null);
  assert.equal(cleared?.pendingGuidanceLeaseId ?? null, null);
  assert.equal(cleared?.pendingGuidanceLeaseExpiresAt ?? null, null);
});
