import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');

async function createTempProfileHome() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-chat-test-'));
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
