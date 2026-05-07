import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createProviderServiceRunner,
  buildProviderServiceOrderPrompt,
} = require('../../dist/core/a2a/provider/providerServiceRunner.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { promises: fs } = require('node:fs');
const path = require('node:path');
import { createProfileHome, cleanupProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

function runtime(overrides = {}) {
  return {
    id: 'runtime-primary',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: '2026-05-07T00:00:00.000Z',
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

async function createRunnerDeps() {
  const homeDir = await createProfileHome('oac-provider-runner-', 'alice');
  const systemHomeDir = deriveSystemHome(homeDir);
  const runtimeStore = createLlmRuntimeStore(resolveMetabotPaths(homeDir));
  const bindingStore = createLlmBindingStore(resolveMetabotPaths(homeDir));
  await fs.mkdir(path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle', 'SKILL.md'), '# Weather Oracle\n', 'utf8');
  await fs.mkdir(path.join(systemHomeDir, '.claude', 'skills', 'weather.oracle'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.claude', 'skills', 'weather.oracle', 'SKILL.md'), '# Weather Oracle\n', 'utf8');
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'unavailable' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      {
        id: 'binding-primary',
        metaBotSlug: 'alice',
        llmRuntimeId: 'runtime-primary',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ],
  });
  return { homeDir, systemHomeDir, runtimeStore, bindingStore };
}

function binding(id, metaBotSlug, llmRuntimeId, role, overrides = {}) {
  return {
    id,
    metaBotSlug,
    llmRuntimeId,
    role,
    priority: 0,
    enabled: true,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

function llmExecutorForTerminalResult(result, calls = []) {
  return {
    async execute(request) {
      calls.push(request);
      return `session-${calls.length}`;
    },
    async getSession(sessionId) {
      return {
        sessionId,
        status: result.status,
        result,
      };
    },
    async cancel() {},
    async listSessions() { return []; },
    async streamEvents() { return (async function* () {})(); },
  };
}

function baseOrder(overrides = {}) {
  return {
    servicePinId: 'service-pin-1',
    providerSkill: 'weather.oracle',
    providerGlobalMetaId: 'provider-gm',
    userTask: 'Forecast tomorrow',
    taskContext: 'Focus on city weather',
    ...overrides,
  };
}

test('buildProviderServiceOrderPrompt includes paid-order guidance and required skill instructions', () => {
  const prompt = buildProviderServiceOrderPrompt({
    serviceName: 'Weather Oracle',
    displayName: 'Weather Oracle',
    userTask: 'Forecast tomorrow',
    taskContext: 'Focus on city weather',
    providerSkill: 'weather.oracle',
    outputType: 'text',
  });

  assert.match(prompt, /paid service order/i);
  assert.match(prompt, /weather\.oracle/);
  assert.match(prompt, /must use.*weather\.oracle/i);
  assert.match(prompt, /do not repeat payment/i);
  assert.match(prompt, /output type/i);
});

test('createProviderServiceRunner uses fallback only before execution starts', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  const sessionExecutorCalls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        sessionExecutorCalls.push(request);
        return 'session-1';
      },
      async getSession() {
        return {
          sessionId: 'session-1',
          status: 'completed',
          result: {
            status: 'completed',
            output: 'It will rain tomorrow.',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
    getFallbackRuntime: async (primaryRuntime) => {
      assert.equal(primaryRuntime?.id, 'runtime-primary');
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute({
    servicePinId: 'service-pin-1',
    providerSkill: 'weather.oracle',
    providerGlobalMetaId: 'provider-gm',
    userTask: 'Forecast tomorrow',
    taskContext: 'Focus on city weather',
  });

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.equal(sessionExecutorCalls.length, 1);
  assert.deepEqual(sessionExecutorCalls[0].skills, ['weather.oracle']);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner does not fallback after execution has started', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
    ],
  });
  let fallbackCalls = 0;
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        assert.equal(request.runtimeId, 'runtime-primary');
        return 'session-1';
      },
      async getSession() {
        return {
          sessionId: 'session-1',
          status: 'failed',
          result: {
            status: 'failed',
            output: '',
            error: 'runtime exploded',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
    getFallbackRuntime: async (primaryRuntime) => {
      assert.equal(primaryRuntime?.id, 'runtime-primary');
      fallbackCalls += 1;
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute({
    servicePinId: 'service-pin-1',
    providerSkill: 'weather.oracle',
    providerGlobalMetaId: 'provider-gm',
    userTask: 'Forecast tomorrow',
    taskContext: 'Focus on city weather',
  });

  assert.equal(result.state, 'failed');
  assert.equal(fallbackCalls, 0);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner reads provider skills from project roots', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await fs.rm(path.join(systemHomeDir, '.codex'), { recursive: true, force: true });
  await fs.rm(path.join(systemHomeDir, '.claude'), { recursive: true, force: true });
  await fs.mkdir(path.join(homeDir, '.codex', 'skills', 'weather.oracle'), { recursive: true });
  await fs.writeFile(path.join(homeDir, '.codex', 'skills', 'weather.oracle', 'SKILL.md'), '# Project Weather Oracle\n', 'utf8');
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });

  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Project-root skill executed.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-primary');
  assert.equal(result.selection.skill.rootKind, 'project');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].skills, ['weather.oracle']);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner resolves fallback runtime from fallback binding before execution', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
      binding('binding-fallback', 'alice', 'runtime-fallback', 'fallback'),
    ],
  });

  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Fallback binding handled the order.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtimeId, 'runtime-fallback');
  assert.equal(result.metadata.fallbackSelected, true);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner returns structured failure without a session when neither runtime can serve', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code', health: 'healthy' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
      binding('binding-fallback', 'alice', 'runtime-fallback', 'fallback'),
    ],
  });
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'unused',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({ providerSkill: 'missing.skill' }));

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_skill_missing');
  assert.equal(calls.length, 0);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner maps started terminal failures without fallback retry', async () => {
  const terminalCases = [
    {
      result: { status: 'failed', output: '', error: 'runtime failed', durationMs: 10 },
      code: 'provider_execution_failed',
    },
    {
      result: { status: 'timeout', output: '', error: 'runtime timed out', durationMs: 10 },
      code: 'provider_execution_timeout',
    },
    {
      result: { status: 'cancelled', output: '', error: 'runtime cancelled', durationMs: 10 },
      code: 'provider_execution_cancelled',
    },
    {
      result: { status: 'completed', output: '   ', durationMs: 10 },
      code: 'provider_execution_empty',
    },
  ];

  for (const testCase of terminalCases) {
    const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
    await runtimeStore.write({
      version: 1,
      runtimes: [
        runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
        runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
      ],
    });
    let fallbackCalls = 0;
    const calls = [];
    const runner = createProviderServiceRunner({
      metaBotSlug: 'alice',
      systemHomeDir,
      projectRoot: homeDir,
      runtimeStore,
      bindingStore,
      llmExecutor: llmExecutorForTerminalResult(testCase.result, calls),
      canStartRuntime: () => true,
      getFallbackRuntime: async () => {
        fallbackCalls += 1;
        return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
      },
    });

    const result = await runner.execute(baseOrder());

    assert.equal(result.state, 'failed');
    assert.equal(result.code, testCase.code);
    assert.equal(calls.length, 1);
    assert.equal(fallbackCalls, 0);
    await cleanupProfileHome(homeDir);
  }
});

test('createProviderServiceRunner rejects non-text deliverables after session start without fallback retry', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
    ],
  });
  let fallbackCalls = 0;
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: '/tmp/provider-image.png',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
    getFallbackRuntime: async () => {
      fallbackCalls += 1;
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_deliverable_invalid');
  assert.equal(calls.length, 1);
  assert.equal(fallbackCalls, 0);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner falls back when primary cannot start before session creation', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code', health: 'healthy' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
      binding('binding-fallback', 'alice', 'runtime-fallback', 'fallback'),
    ],
  });

  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        if (request.runtimeId === 'runtime-primary') {
          throw new Error('binary could not start');
        }
        return 'session-fallback';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'Fallback started successfully.',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.deepEqual(calls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-fallback']);
  assert.equal(result.metadata.fallbackSelected, true);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner falls back before session creation when primary binary is not startable', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy', binaryPath: '/missing/codex' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code', health: 'healthy', binaryPath: '/bin/claude' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
      binding('binding-fallback', 'alice', 'runtime-fallback', 'fallback'),
    ],
  });
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Fallback handled missing primary binary.',
      durationMs: 10,
    }, calls),
    canStartRuntime: (candidate) => candidate.id !== 'runtime-primary',
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtimeId, 'runtime-fallback');
  assert.equal(result.metadata.fallbackSelected, true);
  await cleanupProfileHome(homeDir);
});
