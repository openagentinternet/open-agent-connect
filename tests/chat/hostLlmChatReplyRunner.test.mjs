import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildChatPrompt,
  parseRunnerOutput,
} = require('../../dist/core/chat/hostLlmChatReplyRunner.js');

function makeInput(overrides = {}) {
  return {
    conversation: {
      conversationId: 'pc-self-peer',
      peerGlobalMetaId: 'peer-gm-1',
      peerName: 'AliceBot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 5,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 5000,
    },
    recentMessages: [
      { conversationId: 'pc-self-peer', messageId: 'm1', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'Hi there!', messagePinId: null, extensions: null, timestamp: 1000 },
      { conversationId: 'pc-self-peer', messageId: 'm2', direction: 'outbound', senderGlobalMetaId: 'self', content: 'Hello! Nice to meet you.', messagePinId: null, extensions: null, timestamp: 2000 },
      { conversationId: 'pc-self-peer', messageId: 'm3', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'What can you do?', messagePinId: null, extensions: null, timestamp: 3000 },
    ],
    persona: {
      soul: 'I am curious and friendly.',
      goal: 'Explore collaboration opportunities.',
      role: 'I am a coding assistant MetaBot specializing in TypeScript.',
    },
    strategy: {
      id: 'friendly-intro',
      maxTurns: 30,
      maxIdleMs: 300000,
      exitCriteria: 'Both parties understand each other capabilities',
    },
    inboundMessage: {
      conversationId: 'pc-self-peer',
      messageId: 'm3',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'What can you do?',
      messagePinId: null,
      extensions: null,
      timestamp: 3000,
    },
    ...overrides,
  };
}

test('buildChatPrompt includes ROLE, SOUL, GOAL sections', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.ok(prompt.includes('## Your Role'));
  assert.ok(prompt.includes('coding assistant MetaBot specializing in TypeScript'));
  assert.ok(prompt.includes('## Your Style'));
  assert.ok(prompt.includes('curious and friendly'));
  assert.ok(prompt.includes('## Your Goal'));
  assert.ok(prompt.includes('Explore collaboration'));
});

test('buildChatPrompt includes conversation strategy with turn count', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.ok(prompt.includes('## Conversation Strategy'));
  assert.ok(prompt.includes('Current turn: 5 / 30'));
  assert.ok(prompt.includes('Both parties understand each other capabilities'));
});

test('buildChatPrompt includes exit mechanism', () => {
  const prompt = buildChatPrompt(makeInput());
  const legacyMarker = '[END' + '_CONVERSATION]';
  assert.ok(prompt.includes('## Exit Mechanism'));
  assert.ok(prompt.includes('Bye'));
  assert.ok(prompt.includes('on its own final line'));
  assert.ok(!prompt.includes(legacyMarker));
  assert.ok(prompt.includes('turn 5 of 30'));
});

test('buildChatPrompt tells long conversations to converge and end naturally after inbound turn 20', () => {
  const prompt = buildChatPrompt(makeInput({
    conversation: {
      ...makeInput().conversation,
      turnCount: 21,
    },
  }));
  assert.ok(prompt.includes('converge'));
  assert.ok(prompt.includes('end naturally'));
});

test('buildChatPrompt includes chat history with names', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.ok(prompt.includes('AliceBot: Hi there!'));
  assert.ok(prompt.includes('Me: Hello! Nice to meet you.'));
  assert.ok(prompt.includes('AliceBot: What can you do?'));
});

test('buildChatPrompt handles empty persona gracefully', () => {
  const prompt = buildChatPrompt(makeInput({
    persona: { soul: '', goal: '', role: '' },
  }));
  assert.ok(!prompt.includes('## Your Role'));
  assert.ok(!prompt.includes('## Your Style'));
  assert.ok(!prompt.includes('## Your Goal'));
  assert.ok(prompt.includes('## Conversation Strategy'));
});

test('buildChatPrompt handles missing strategy', () => {
  const prompt = buildChatPrompt(makeInput({ strategy: null }));
  assert.ok(prompt.includes('Current turn: 5 / 30'));
  assert.ok(!prompt.includes('Conversation objective'));
});

test('buildChatPrompt uses Peer as name when peerName is null', () => {
  const prompt = buildChatPrompt(makeInput({
    conversation: {
      conversationId: 'c1',
      peerGlobalMetaId: 'peer',
      peerName: null,
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 2,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 2000,
    },
  }));
  assert.ok(prompt.includes('Peer: Hi there!'));
});

test('parseRunnerOutput returns reply for normal text', () => {
  const result = parseRunnerOutput('Hello! I am happy to chat with you.');
  assert.equal(result.state, 'reply');
  assert.equal(result.content, 'Hello! I am happy to chat with you.');
});

test('parseRunnerOutput detects Bye only on the final non-empty line', () => {
  const result = parseRunnerOutput('Goodbye! It was nice chatting.\nBye');
  assert.equal(result.state, 'end_conversation');
  assert.equal(result.content, 'Goodbye! It was nice chatting.\nBye');
});

test('parseRunnerOutput returns skip for empty output', () => {
  const result = parseRunnerOutput('');
  assert.equal(result.state, 'skip');
});

test('parseRunnerOutput ignores inline Bye text as a close signal', () => {
  const result = parseRunnerOutput('See you later! Bye');
  assert.equal(result.state, 'reply');
  assert.equal(result.content, 'See you later! Bye');
});

test('parseRunnerOutput canonicalizes case-insensitive final Bye', () => {
  const result = parseRunnerOutput('See you later.\nbye');
  assert.equal(result.state, 'end_conversation');
  assert.equal(result.content, 'See you later.\nBye');
});

test('parseRunnerOutput handles only Bye as visible close content', () => {
  const result = parseRunnerOutput('Bye');
  assert.equal(result.state, 'end_conversation');
  assert.equal(result.content, 'Bye');
});

test('buildChatPrompt ends with Reply now:', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.ok(prompt.endsWith('Reply now:'));
});
