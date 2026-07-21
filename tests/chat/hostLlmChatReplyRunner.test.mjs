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

test('buildChatPrompt omits private chat skill actor hints when no skills are allowed', () => {
  const prompt = buildChatPrompt(makeInput(), emptyPrivateChatAllowedSkillScope(), {
    metaBotSlug: 'mb-75fe8aaf',
  });
  assert.doesNotMatch(prompt, /private chat skill performs uploads or config reads/);
  assert.match(prompt, /Persona Immersion \(critical\)/);
  assert.match(prompt, /Never say you are reading skills, checking context, or preparing to send a reply/);
  assert.match(prompt, /No private chat skills are available for this turn/);
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

test('parseRunnerOutput strips invisible private-chat execution narration before the real reply', () => {
  const raw = '正在读取私聊技能并查找会话上下文，以便以 `agent-internet` 身份发送回复。\n正在以 `agent-internet` 身份发送私聊回复。\n感谢你帮查地址，确认是全新起点反而更清晰了。';
  const result = parseRunnerOutput(raw);
  assert.equal(result.state, 'reply');
  assert.equal(result.content, '感谢你帮查地址，确认是全新起点反而更清晰了。');
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

test('buildChatPrompt strips local execution narration from outbound history before reuse', () => {
  const prompt = buildChatPrompt(makeInput({
    recentMessages: [
      {
        conversationId: 'pc-self-peer',
        messageId: 'm1',
        direction: 'outbound',
        senderGlobalMetaId: 'self',
        content: '正在读取私聊技能，以便以 `agent-internet` 身份发送回复。\n正在以 `agent-internet` 身份发送私聊回复。\n这是干净回复。',
        messagePinId: null,
        extensions: null,
        timestamp: 1000,
      },
    ],
  }));
  assert.match(prompt, /Me: 这是干净回复。/);
  assert.doesNotMatch(prompt, /Me: 正在读取私聊技能/);
  assert.doesNotMatch(prompt, /Me: 正在以 `agent-internet` 身份发送私聊回复/);
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

function makeHealthyRuntime(id, provider = 'codex') {
  return {
    id,
    provider,
    displayName: id,
    binaryPath: `/bin/${provider}`,
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['streaming'],
    lastSeenAt: '2026-05-05T00:00:00.000Z',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
}

test('host LLM chat runner marks a timed-out runtime unavailable even with strict skill scope', async () => {
  const runtime = makeHealthyRuntime('llm-runtime-hung');
  const resolverCalls = {};
  const llmExecutor = {
    async execute() {
      return 'llm-session-hung';
    },
    async getSession(sessionId) {
      return { sessionId, status: 'running' };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 10,
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
  assert.deepEqual(resolverCalls.markRuntimeUnavailable, ['llm-runtime-hung']);
});

test('host LLM chat runner prefers the last successful runtime on the next turn', async () => {
  const runtimeA = makeHealthyRuntime('llm-runtime-a');
  const resolveInputs = [];
  const runtimeResolver = {
    async resolveRuntime(input) {
      resolveInputs.push(input);
      return { runtime: runtimeA, bindingId: 'binding-a' };
    },
    async selectMetaBot() {
      return null;
    },
    async markBindingUsed() {},
    async markRuntimeUnavailable() {},
  };
  const executorCalls = [];
  const llmExecutor = {
    async execute(request) {
      executorCalls.push(request);
      return `llm-session-${executorCalls.length}`;
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: 'completed',
        result: { status: 'completed', output: 'Sticky reply.', durationMs: 5 },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver,
    llmExecutor,
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });

  const first = await runner(makeInput());
  const second = await runner(makeInput());

  assert.equal(first.state, 'reply');
  assert.equal(second.state, 'reply');
  assert.deepEqual(resolveInputs[0], { metaBotSlug: 'alice', excludeRuntimeIds: [] });
  assert.deepEqual(resolveInputs[1], {
    metaBotSlug: 'alice',
    excludeRuntimeIds: [],
    explicitRuntimeId: runtimeA.id,
  });
  assert.deepEqual(executorCalls.map((request) => request.runtimeId), [runtimeA.id, runtimeA.id]);
});

test('host LLM chat runner drops a sticky runtime after it times out and sticks to the recovery', async () => {
  const runtimeA = makeHealthyRuntime('llm-runtime-sticky');
  const runtimeB = makeHealthyRuntime('llm-runtime-recovery', 'cursor');
  const resolveInputs = [];
  const markedUnavailable = [];
  const runtimeResolver = {
    async resolveRuntime(input) {
      resolveInputs.push(input);
      const excluded = input.excludeRuntimeIds ?? [];
      if (input.explicitRuntimeId === runtimeB.id && !excluded.includes(runtimeB.id)) {
        return { runtime: runtimeB, bindingId: 'binding-b' };
      }
      if (excluded.includes(runtimeA.id)) {
        return { runtime: runtimeB, bindingId: 'binding-b' };
      }
      return { runtime: runtimeA, bindingId: 'binding-a' };
    },
    async selectMetaBot() {
      return null;
    },
    async markBindingUsed() {},
    async markRuntimeUnavailable(runtimeId) {
      markedUnavailable.push(runtimeId);
    },
  };
  let hangRuntimeA = false;
  const llmExecutor = {
    async execute(request) {
      return request.runtimeId === runtimeA.id && hangRuntimeA ? 'llm-session-hung' : 'llm-session-ok';
    },
    async getSession(sessionId) {
      if (sessionId === 'llm-session-hung') {
        return { sessionId, status: 'running' };
      }
      return {
        sessionId,
        status: 'completed',
        result: { status: 'completed', output: 'Recovery reply.', durationMs: 5 },
      };
    },
  };

  const runner = createHostLlmChatReplyRunner({
    runtimeResolver,
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 10,
    pollIntervalMs: 1,
  });

  const first = await runner(makeInput());
  assert.equal(first.state, 'reply');

  hangRuntimeA = true;
  const second = await runner(makeInput());
  assert.deepEqual(second, { state: 'reply', content: 'Recovery reply.' });
  assert.deepEqual(markedUnavailable, [runtimeA.id]);

  const third = await runner(makeInput());
  assert.equal(third.state, 'reply');

  const turnTwoFirstResolve = resolveInputs[1];
  assert.equal(turnTwoFirstResolve.explicitRuntimeId, runtimeA.id);
  const turnThreeFirstResolve = resolveInputs[3];
  assert.equal(turnThreeFirstResolve.explicitRuntimeId, runtimeB.id);
});

test('buildChatPrompt strips the close marker from outbound history but keeps the farewell text', () => {
  const prompt = buildChatPrompt(makeInput({
    recentMessages: [
      {
        conversationId: 'pc-self-peer',
        messageId: 'm1',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: '我们聊得很开心！',
        messagePinId: null,
        extensions: null,
        timestamp: 1000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm2',
        direction: 'outbound',
        senderGlobalMetaId: 'self',
        content: '我也很开心，下次继续聊。\n\nBye',
        messagePinId: null,
        extensions: null,
        timestamp: 2000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm3',
        direction: 'outbound',
        senderGlobalMetaId: 'self',
        content: 'Bye',
        messagePinId: null,
        extensions: null,
        timestamp: 3000,
      },
    ],
  }));
  assert.match(prompt, /Me: 我也很开心，下次继续聊。/);
  assert.doesNotMatch(prompt, /Me: .*\n+\s*Bye\s*\n/u);
  assert.doesNotMatch(prompt, /Me: Bye/);
  assert.match(prompt, /AliceBot: 我们聊得很开心！/);
});

test('buildChatPrompt exit mechanism forbids ending over a single low-value turn', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.match(prompt, /clearly finished/);
  assert.match(prompt, /explicitly says goodbye or signals the end/);
  assert.match(prompt, /Do NOT end the conversation just because one reply was short, generic, or low-value/);
  assert.match(prompt, /Greetings and capability introductions are openings, not a reason to end/);
  assert.doesNotMatch(prompt, /no more valuable topics to discuss/);
});

test('buildChatPrompt marks a session boundary after a closed session but keeps both sessions visible', () => {
  const prompt = buildChatPrompt(makeInput({
    recentMessages: [
      {
        conversationId: 'pc-self-peer',
        messageId: 'm1',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: '上一轮我们聊了很多架构设计。',
        messagePinId: null,
        extensions: null,
        timestamp: 1000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm2',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: '今天就到这里，回头聊。\n\nBye',
        messagePinId: null,
        extensions: null,
        timestamp: 2000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm3',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'hi, are you there?',
        messagePinId: null,
        extensions: null,
        timestamp: 3000,
      },
    ],
  }));
  assert.match(prompt, /AliceBot: 上一轮我们聊了很多架构设计。/);
  assert.match(prompt, /Earlier conversation session ended\. A new session starts below/);
  assert.match(prompt, /AliceBot: hi, are you there\?/);
  const oldIndex = prompt.indexOf('上一轮我们聊了很多架构设计。');
  const boundaryIndex = prompt.indexOf('Earlier conversation session ended.');
  const newIndex = prompt.indexOf('hi, are you there?');
  assert.ok(oldIndex >= 0 && boundaryIndex > oldIndex && newIndex > boundaryIndex);
});

test('buildChatPrompt marks a session boundary after an idle gap beyond maxIdleMs', () => {
  const prompt = buildChatPrompt(makeInput({
    recentMessages: [
      {
        conversationId: 'pc-self-peer',
        messageId: 'm1',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'morning topic',
        messagePinId: null,
        extensions: null,
        timestamp: 1_000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm2',
        direction: 'outbound',
        senderGlobalMetaId: 'self',
        content: 'morning reply',
        messagePinId: null,
        extensions: null,
        timestamp: 2_000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm3',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'evening follow-up',
        messagePinId: null,
        extensions: null,
        timestamp: 2_000 + 300_001,
      },
    ],
  }));
  assert.equal((prompt.match(/Earlier conversation session ended\./g) ?? []).length, 1);
  assert.match(prompt, /evening follow-up/);
});

test('buildChatPrompt does not mark a session boundary in a continuous conversation', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.doesNotMatch(prompt, /Earlier conversation session ended\./);
});

test('buildChatPrompt still marks the boundary when the closing outbound message is stripped from history', () => {
  const prompt = buildChatPrompt(makeInput({
    recentMessages: [
      {
        conversationId: 'pc-self-peer',
        messageId: 'm1',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'old session topic',
        messagePinId: null,
        extensions: null,
        timestamp: 1000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm2',
        direction: 'outbound',
        senderGlobalMetaId: 'self',
        content: 'Bye',
        messagePinId: null,
        extensions: null,
        timestamp: 2000,
      },
      {
        conversationId: 'pc-self-peer',
        messageId: 'm3',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'fresh hello after the break',
        messagePinId: null,
        extensions: null,
        timestamp: 3000,
      },
    ],
  }));
  assert.doesNotMatch(prompt, /Me: Bye/);
  assert.match(prompt, /Earlier conversation session ended\./);
  assert.match(prompt, /fresh hello after the break/);
});

test('buildChatPrompt exit mechanism binds goodbye to the current session', () => {
  const prompt = buildChatPrompt(makeInput());
  assert.match(prompt, /explicitly says goodbye or signals the end in the CURRENT session/);
});
