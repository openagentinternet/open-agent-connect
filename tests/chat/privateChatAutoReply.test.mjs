import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { loadChatPersona } = require('../../dist/core/chat/chatPersonaLoader.js');
const { createDefaultChatReplyRunner } = require('../../dist/core/chat/defaultChatReplyRunner.js');

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
