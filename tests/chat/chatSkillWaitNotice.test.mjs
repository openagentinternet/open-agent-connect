import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_CHAT_SKILL_WAIT_NOTICE,
  createChatSkillWaitNoticeGenerator,
  normalizeChatSkillWaitNoticeText,
} = require('../../dist/core/chat/chatSkillWaitNotice.js');

function makeNoticeInput(overrides = {}) {
  return {
    conversation: {
      conversationId: 'pc-self-peer',
      peerGlobalMetaId: 'peer-gm-1',
      peerName: 'AliceBot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 3,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 5000,
    },
    inboundMessage: {
      conversationId: 'pc-self-peer',
      messageId: 'm3',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: '帮我查一下这个地址的余额',
      messagePinId: 'pin-1',
      extensions: null,
      timestamp: 3000,
    },
    persona: {
      soul: 'I am curious and friendly.',
      goal: 'Explore collaboration opportunities.',
      role: 'I am a coding assistant MetaBot.',
      identity: {
        name: '火舞',
        globalMetaId: 'idq1u3y952nxuypavlh23zzzqhvqm07me3ecgv58s5',
      },
    },
    ...overrides,
  };
}

function makeHealthyRuntime(id = 'llm-runtime-1') {
  return {
    id,
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
}

function makeResolver(runtime) {
  return {
    async resolveRuntime() {
      return { runtime, bindingId: 'binding-1' };
    },
    async markBindingUsed() {},
    async markRuntimeUnavailable() {},
  };
}

test('normalizeChatSkillWaitNoticeText strips quotes and collapses newlines', () => {
  assert.equal(
    normalizeChatSkillWaitNoticeText('"我先查一下,稍等。"\n'),
    '我先查一下,稍等。',
  );
  assert.equal(
    normalizeChatSkillWaitNoticeText('One moment,\nplease wait.'),
    'One moment, please wait.',
  );
  assert.equal(normalizeChatSkillWaitNoticeText('   '), '');
  assert.equal(normalizeChatSkillWaitNoticeText(null), '');
});

test('normalizeChatSkillWaitNoticeText caps overly long notices', () => {
  const long = 'x'.repeat(500);
  const normalized = normalizeChatSkillWaitNoticeText(long);
  assert.ok(normalized.length <= 181);
  assert.ok(normalized.endsWith('…'));
});

test('createChatSkillWaitNoticeGenerator returns null without a resolver or executor', () => {
  assert.equal(createChatSkillWaitNoticeGenerator(), null);
  assert.equal(createChatSkillWaitNoticeGenerator({ runtimeResolver: makeResolver(makeHealthyRuntime()) }), null);
});

test('chat skill wait notice generator asks the persona LLM and returns its text', async () => {
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'notice-session-1';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: { status: 'completed', output: '"我先去查一下,马上告诉你。"', durationMs: 5 },
      };
    },
  };
  const generator = createChatSkillWaitNoticeGenerator({
    runtimeResolver: makeResolver(makeHealthyRuntime()),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const notice = await generator(makeNoticeInput());

  assert.equal(notice, '我先去查一下,马上告诉你。');
  assert.equal(executorCalls.length, 1);
  assert.match(executorCalls[0].systemPrompt, /wait notice/);
  assert.match(executorCalls[0].systemPrompt, /same language the peer used/);
  assert.match(executorCalls[0].systemPrompt, /火舞/);
  assert.match(executorCalls[0].prompt, /帮我查一下这个地址的余额/);
});

test('chat skill wait notice generator falls back on runtime failure', async () => {
  const llmExecutor = {
    async execute() {
      throw new Error('runtime gone');
    },
    async getSession() {
      return null;
    },
  };
  const generator = createChatSkillWaitNoticeGenerator({
    runtimeResolver: makeResolver(makeHealthyRuntime()),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const notice = await generator(makeNoticeInput());

  assert.equal(notice, DEFAULT_CHAT_SKILL_WAIT_NOTICE);
});

test('chat skill wait notice generator falls back on empty LLM output', async () => {
  const llmExecutor = {
    async execute() {
      return 'notice-session-empty';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: { status: 'completed', output: '   ', durationMs: 3 },
      };
    },
  };
  const generator = createChatSkillWaitNoticeGenerator({
    runtimeResolver: makeResolver(makeHealthyRuntime()),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const notice = await generator(makeNoticeInput());

  assert.equal(notice, DEFAULT_CHAT_SKILL_WAIT_NOTICE);
});

test('chat skill wait notice generator falls back when the session times out', async () => {
  const llmExecutor = {
    async execute() {
      return 'notice-session-hung';
    },
    async getSession(sessionId) {
      return { sessionId, status: 'running' };
    },
  };
  const generator = createChatSkillWaitNoticeGenerator({
    runtimeResolver: makeResolver(makeHealthyRuntime()),
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 5,
    pollIntervalMs: 1,
  });

  const notice = await generator(makeNoticeInput());

  assert.equal(notice, DEFAULT_CHAT_SKILL_WAIT_NOTICE);
});

test('chat skill wait notice generator falls back without a healthy runtime', async () => {
  const generator = createChatSkillWaitNoticeGenerator({
    runtimeResolver: {
      async resolveRuntime() {
        return { runtime: null, bindingId: null };
      },
    },
    llmExecutor: {
      async execute() {
        throw new Error('must not be called');
      },
      async getSession() {
        return null;
      },
    },
    metaBotSlug: 'alice',
  });

  const notice = await generator(makeNoticeInput());

  assert.equal(notice, DEFAULT_CHAT_SKILL_WAIT_NOTICE);
});
