import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildChatPrompt,
  createHostLlmChatReplyRunner,
  parseRunnerOutput,
} = require('../../dist/core/chat/hostLlmChatReplyRunner.js');
const {
  emptyPrivateChatAllowedSkillScope,
} = require('../../dist/core/chat/privateChatAllowedSkills.js');

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
    operatorGuidanceText: null,
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

test('buildChatPrompt includes chain write actor rules when metaBotSlug is provided', () => {
  const prompt = buildChatPrompt(makeInput(), emptyPrivateChatAllowedSkillScope(), {
    metaBotSlug: 'mb-75fe8aaf',
  });
  assert.match(prompt, /## Chain Write Actor \(critical\)/);
  assert.match(prompt, /local MetaBot profile `mb-75fe8aaf`/);
  assert.match(prompt, /--from mb-75fe8aaf/);
  assert.match(prompt, /Never omit `--from`/);
});

test('buildChatPrompt omits chain write actor rules without metaBotSlug', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.doesNotMatch(prompt, /## Chain Write Actor/);
});

test('host LLM chat runner injects chain write actor rules from metaBotSlug', async () => {
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
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'llm-session-actor';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Reply with correct actor context.',
          durationMs: 12,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor,
    metaBotSlug: 'mb-75fe8aaf',
    pollIntervalMs: 1,
  });

  await runner(makeInput());

  assert.equal(executorCalls.length, 1);
  assert.match(executorCalls[0].prompt, /## Chain Write Actor \(critical\)/);
  assert.match(executorCalls[0].prompt, /--from mb-75fe8aaf/);
});

test('buildChatPrompt ends with Reply now:', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.ok(prompt.endsWith('Reply now:'));
});

test('buildChatPrompt includes a local-only operator guidance section when present', () => {
  const prompt = buildChatPrompt(makeInput({
    operatorGuidanceText: 'Steer the thread back to delivery timing.',
  }));
  assert.match(prompt, /## Operator Guidance/);
  assert.match(prompt, /local-only private guidance/);
  assert.match(prompt, /Do not present it as peer-authored text/);
  assert.match(prompt, /Steer the thread back to delivery timing\./);
});

test('buildChatPrompt remains valid without inboundMessage for operator-triggered turns', () => {
  const prompt = buildChatPrompt(makeInput({
    inboundMessage: null,
    operatorGuidanceText: 'Politely reopen the earlier pricing question.',
  }));
  assert.match(prompt, /## Chat History/);
  assert.ok(prompt.endsWith('Reply now:'));
});

test('parseRunnerOutput strips planning preamble before skill reply', () => {
  const raw = '先读 Karpathy 视角技能，再针对对方关于窄场景与验证方式的追问给出工程向回复。\n你说得对，第三项若只是「再问一个会写代码的 bot」，大概率是伪需求。';
  const result = parseRunnerOutput(raw);
  assert.equal(result.state, 'reply');
  assert.equal(result.content, '你说得对，第三项若只是「再问一个会写代码的 bot」，大概率是伪需求。');
});

test('buildChatPrompt includes persona immersion rules when skills are allowed', () => {
  const prompt = buildChatPrompt(makeInput(), {
    skills: ['andrej-karpathy-perspective'],
    skillSourcePaths: { 'andrej-karpathy-perspective': '/tmp/karpathy' },
    skippedSkills: [],
    warning: null,
  });
  assert.match(prompt, /Persona Immersion \(critical\)/);
  assert.match(prompt, /Never tell the user you are reading/);
  assert.match(prompt, /Do NOT open with a plan sentence/);
});

function createFakeRuntimeResolver(runtime, calls = {}) {
  return {
    async resolveRuntime(input) {
      calls.resolveRuntime = [...(calls.resolveRuntime ?? []), input];
      return { runtime, bindingId: 'binding-1' };
    },
    async selectMetaBot(input) {
      calls.selectMetaBot = [...(calls.selectMetaBot ?? []), input];
      return null;
    },
    async markBindingUsed(bindingId) {
      calls.markBindingUsed = [...(calls.markBindingUsed ?? []), bindingId];
    },
    async markRuntimeUnavailable(runtimeId) {
      calls.markRuntimeUnavailable = [...(calls.markRuntimeUnavailable ?? []), runtimeId];
    },
  };
}

test('host LLM chat runner executes through the injected LLM executor', async () => {
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
  const resolverCalls = {};
  const executorCalls = [];
  let getSessionCalls = 0;
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'llm-session-1';
    },
    async getSession(sessionId) {
      getSessionCalls += 1;
      if (getSessionCalls === 1) {
        return { sessionId, status: 'running' };
      }
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'I can help with TypeScript and Open Agent Connect.',
          durationMs: 12,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 321,
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, {
    state: 'reply',
    content: 'I can help with TypeScript and Open Agent Connect.',
  });
  assert.equal(getSessionCalls, 2);
  assert.equal(executorCalls.length, 1);
  assert.equal(executorCalls[0].runtimeId, 'llm-runtime-1');
  assert.equal(executorCalls[0].runtime, runtime);
  assert.equal(executorCalls[0].timeout, 321);
  assert.equal(executorCalls[0].metaBotSlug, 'alice');
  assert.match(executorCalls[0].prompt, /Reply now:/);
  assert.deepEqual(resolverCalls.resolveRuntime, [{ metaBotSlug: 'alice', excludeRuntimeIds: [] }]);
  assert.deepEqual(resolverCalls.markBindingUsed, ['binding-1']);
});

test('host LLM chat runner injects only resolved allowed chat skills', async () => {
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
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'llm-session-allowed';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'The weather skill is available for this turn.',
          durationMs: 12,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: ['metabot-weather'],
      skillSourcePaths: { 'metabot-weather': '/tmp/metabot-weather' },
      skippedSkills: [],
      warning: null,
    }),
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, {
    state: 'reply',
    content: 'The weather skill is available for this turn.',
  });
  assert.equal(executorCalls.length, 1);
  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.deepEqual(executorCalls[0].skillSourcePaths, { 'metabot-weather': '/tmp/metabot-weather' });
  assert.equal(executorCalls[0].skillIsolation, 'strict');
  assert.match(executorCalls[0].prompt, /only skills available for this private chat turn/);
  assert.match(executorCalls[0].prompt, /metabot-weather/);
});

test('host LLM chat runner does not inject skills when resolver returns none', async () => {
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
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'llm-session-empty-scope';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'No skills were needed.',
          durationMs: 12,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: [],
      skillSourcePaths: {},
      skippedSkills: ['metabot-missing'],
      warning: 'Configured chat skills are not currently available: metabot-missing',
    }),
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, {
    state: 'reply',
    content: 'No skills were needed.',
  });
  assert.equal(executorCalls.length, 1);
  assert.equal(Object.hasOwn(executorCalls[0], 'skills'), false);
  assert.equal(Object.hasOwn(executorCalls[0], 'skillSourcePaths'), false);
  assert.equal(executorCalls[0].skillIsolation, 'strict');
  assert.doesNotMatch(executorCalls[0].prompt, /metabot-missing/);
});

test('host LLM chat runner falls back when the injected executor fails', async () => {
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
  const resolverCalls = {};
  const llmExecutor = {
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
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput());

  assert.equal(result.state, 'reply');
  assert.match(result.content, /Thanks for/);
  assert.deepEqual(resolverCalls.markRuntimeUnavailable, ['llm-runtime-1']);
});

test('host LLM chat runner skips instead of template fallback when disabled', async () => {
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
  const llmExecutor = {
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
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowTemplateFallback: false,
  });

  const result = await runner(makeInput({
    inboundMessage: null,
    operatorGuidanceText: 'Ask the peer for the delivery date.',
  }));

  assert.deepEqual(result, { state: 'skip' });
});

test('host LLM chat runner skips instead of template fallback when operator guidance is present', async () => {
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
  const llmExecutor = {
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
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput({
    operatorGuidanceText: 'Ask the peer for the delivery date.',
  }));

  assert.deepEqual(result, { state: 'skip' });
});

test('host LLM chat runner does not globally mark a strict scoped runtime unavailable', async () => {
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
  const resolverCalls = {};
  const llmExecutor = {
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
          error: 'isolated CODEX_HOME missing auth',
          durationMs: 1,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: [],
      skillSourcePaths: {},
      skippedSkills: [],
      warning: null,
    }),
  });

  const result = await runner(makeInput());

  assert.equal(result.state, 'reply');
  assert.match(result.content, /Thanks for/);
  assert.deepEqual(resolverCalls.markRuntimeUnavailable ?? [], []);
});

test('host LLM chat runner treats completed empty output as unavailable and tries fallback', async () => {
  const primaryRuntime = {
    id: 'llm-runtime-primary',
    provider: 'codebuddy',
    displayName: 'CodeBuddy',
    binaryPath: '/bin/codebuddy',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
  const fallbackRuntime = {
    id: 'llm-runtime-fallback',
    provider: 'cursor',
    displayName: 'Cursor',
    binaryPath: '/bin/cursor-agent',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
  const resolverCalls = { markRuntimeUnavailable: [], markBindingUsed: [] };
  const runtimeResolver = {
    async resolveRuntime(input) {
      if ((input.excludeRuntimeIds ?? []).includes(primaryRuntime.id)) {
        return { runtime: fallbackRuntime, bindingId: 'binding-fallback' };
      }
      return { runtime: primaryRuntime, bindingId: 'binding-primary' };
    },
    async selectMetaBot() {
      return null;
    },
    async markBindingUsed(bindingId) {
      resolverCalls.markBindingUsed.push(bindingId);
    },
    async markRuntimeUnavailable(runtimeId) {
      resolverCalls.markRuntimeUnavailable.push(runtimeId);
    },
  };
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return request.runtimeId === primaryRuntime.id ? 'llm-session-empty' : 'llm-session-fallback';
    },
    async getSession(sessionId) {
      if (sessionId === 'llm-session-empty') {
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: '',
            durationMs: 3,
          },
        };
      }
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Fallback reply works.',
          durationMs: 7,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver,
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, { state: 'reply', content: 'Fallback reply works.' });
  assert.deepEqual(executorCalls.map((request) => request.runtimeId), [
    primaryRuntime.id,
    fallbackRuntime.id,
  ]);
  assert.deepEqual(resolverCalls.markRuntimeUnavailable, [primaryRuntime.id]);
  assert.deepEqual(resolverCalls.markBindingUsed, ['binding-fallback']);
});

test('host LLM chat runner skips unavailable runtimes before executing', async () => {
  const runtime = {
    id: 'llm-runtime-unavailable',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    authState: 'authenticated',
    health: 'unavailable',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
  let executeCalls = 0;
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime),
    llmExecutor: {
      async execute() {
        executeCalls += 1;
        throw new Error('unavailable runtime should not execute');
      },
      async getSession() {
        throw new Error('unavailable runtime should not poll');
      },
    },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput());

  assert.equal(executeCalls, 0);
  assert.equal(result.state, 'reply');
  assert.match(result.content, /Thanks for/);
});

test('host LLM chat runner skips degraded runtimes and reaches a healthy fallback', async () => {
  const degradedRuntime = {
    id: 'llm-runtime-degraded',
    provider: 'codex',
    displayName: 'Codex stale',
    binaryPath: '/bin/codex',
    authState: 'authenticated',
    health: 'degraded',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-04T00:00:00.000Z',
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  };
  const healthyRuntime = {
    ...degradedRuntime,
    id: 'llm-runtime-healthy',
    displayName: 'Codex healthy',
    health: 'healthy',
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
  const resolverCalls = [];
  const executorCalls = [];
  const runtimeResolver = {
    async resolveRuntime(input) {
      resolverCalls.push(input);
      if ((input.excludeRuntimeIds ?? []).includes(degradedRuntime.id)) {
        return { runtime: healthyRuntime, bindingId: 'binding-healthy' };
      }
      return { runtime: degradedRuntime, bindingId: 'binding-degraded' };
    },
    async selectMetaBot() {
      return null;
    },
    async markBindingUsed() {},
    async markRuntimeUnavailable() {},
  };
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return 'llm-session-healthy';
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Healthy fallback reply.',
          durationMs: 9,
        },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver,
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const result = await runner(makeInput());

  assert.deepEqual(result, { state: 'reply', content: 'Healthy fallback reply.' });
  assert.equal(executorCalls.length, 1);
  assert.equal(executorCalls[0].runtimeId, healthyRuntime.id);
  assert.deepEqual(resolverCalls, [
    { metaBotSlug: 'alice', excludeRuntimeIds: [] },
    { metaBotSlug: 'alice', excludeRuntimeIds: [degradedRuntime.id] },
  ]);
});
