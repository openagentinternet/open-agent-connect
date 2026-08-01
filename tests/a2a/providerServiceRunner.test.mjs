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

function isInsideRuntimeArea(homeDir, candidatePath) {
  const relative = path.relative(path.join(homeDir, '.runtime'), candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
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
  assert.match(prompt, /provider-side service executor/i);
  assert.match(prompt, /local skill/i);
  assert.match(prompt, /do not call.*remote service/i);
  assert.match(prompt, /final answer.*only.*deliverable/i);
  assert.match(prompt, /do not include.*daemon/i);
});

test('buildProviderServiceOrderPrompt describes multiple provider skills as an allow list', () => {
  const prompt = buildProviderServiceOrderPrompt({
    serviceName: 'Weather Buzz',
    displayName: 'Weather Buzz',
    userTask: 'Forecast tomorrow and post the result.',
    taskContext: 'Focus on Shanghai.',
    providerSkill: 'weather.oracle',
    providerSkills: ['weather.oracle', 'metabot-post-buzz'],
    executionReminder: 'Use weather.oracle first, then use metabot-post-buzz only after the forecast is ready.',
    outputType: 'text',
  });

  assert.match(prompt, /Allowed provider skills: weather\.oracle, metabot-post-buzz/);
  assert.match(prompt, /Choose the allowed skills needed for the buyer request/i);
  assert.match(prompt, /not every allowed skill is required/i);
  assert.match(prompt, /Use weather\.oracle first, then use metabot-post-buzz/);
  assert.doesNotMatch(prompt, /only the injected local skill/i);
  assert.doesNotMatch(prompt, /Required provider skills in order/i);
  assert.doesNotMatch(prompt, /listed order/i);
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

test('createProviderServiceRunner injects allowed provider skills and execution reminder', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
    ],
  });
  await fs.mkdir(path.join(systemHomeDir, '.codex', 'skills', 'metabot-post-buzz'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.codex', 'skills', 'metabot-post-buzz', 'SKILL.md'), '# Post Buzz\n', 'utf8');
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Forecast posted to buzz.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({
    providerSkills: ['weather.oracle', 'metabot-post-buzz'],
    executionReminder: 'Query weather first. Post the final forecast only after weather is known.',
  }));

  assert.equal(result.state, 'completed');
  assert.deepEqual(calls[0].skills, ['weather.oracle', 'metabot-post-buzz']);
  assert.equal(
    calls[0].skillSourcePaths['weather.oracle'],
    path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'),
  );
  assert.equal(
    calls[0].skillSourcePaths['metabot-post-buzz'],
    path.join(systemHomeDir, '.codex', 'skills', 'metabot-post-buzz'),
  );
  assert.match(calls[0].systemPrompt, /Query weather first/);
  assert.match(calls[0].systemPrompt, /Allowed provider skills: weather\.oracle, metabot-post-buzz/);
  assert.match(calls[0].systemPrompt, /not every allowed skill is required/i);
  assert.doesNotMatch(calls[0].systemPrompt, /only the injected local skill/i);
  assert.doesNotMatch(calls[0].systemPrompt, /Required provider skills in order/i);
  assert.doesNotMatch(calls[0].systemPrompt, /listed order/i);
  assert.deepEqual(result.metadata.providerSkills, ['weather.oracle', 'metabot-post-buzz']);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner injects shared MetaBot skills when host roots are not bound', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'cursor', health: 'healthy' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
    ],
  });
  await fs.mkdir(path.join(systemHomeDir, '.cursor', 'skills', 'weather.oracle'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.cursor', 'skills', 'weather.oracle', 'SKILL.md'), '# Weather Oracle\n', 'utf8');
  await fs.mkdir(path.join(systemHomeDir, '.metabot', 'skills', 'metabot-post-buzz'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.metabot', 'skills', 'metabot-post-buzz', 'SKILL.md'), '# Post Buzz\n', 'utf8');
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Forecast posted to buzz.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({
    providerSkills: ['weather.oracle', 'metabot-post-buzz'],
  }));

  assert.equal(result.state, 'completed');
  assert.deepEqual(calls[0].skills, ['weather.oracle', 'metabot-post-buzz']);
  assert.equal(
    calls[0].skillSourcePaths['metabot-post-buzz'],
    path.join(systemHomeDir, '.metabot', 'skills', 'metabot-post-buzz'),
  );
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner falls back when primary session fails after start', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
    ],
  });
  let fallbackCalls = 0;
  const executeCalls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        executeCalls.push(request);
        return request.runtimeId === 'runtime-primary' ? 'session-primary' : 'session-fallback';
      },
      async getSession(sessionId) {
        if (sessionId === 'session-fallback') {
          return {
            sessionId,
            status: 'completed',
            result: {
              status: 'completed',
              output: 'Fallback handled the order.',
              durationMs: 10,
            },
          };
        }
        return {
          sessionId,
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

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(executeCalls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-fallback']);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner reuses selected primary skill source for fallback runtime', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await fs.rm(path.join(systemHomeDir, '.claude'), { recursive: true, force: true });
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

  const executeCalls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        executeCalls.push(request);
        return request.runtimeId === 'runtime-primary' ? 'session-primary' : 'session-fallback';
      },
      async getSession(sessionId) {
        if (sessionId === 'session-primary') {
          return {
            sessionId,
            status: 'failed',
            result: {
              status: 'failed',
              output: '',
              error: 'codex vendor binary missing',
              durationMs: 10,
            },
          };
        }
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'Fallback reused the Codex skill source.',
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
  assert.deepEqual(executeCalls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-fallback']);
  assert.equal(
    executeCalls[1].skillSourcePaths['weather.oracle'],
    path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'),
  );
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner executes non-text orders in a dedicated runtime workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  const calls = [];
  let cwdExistedDuringExecute = false;
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        cwdExistedDuringExecute = Boolean(await fs.stat(request.cwd).catch(() => null));
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'out/provider-image.png',
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

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].cwd, homeDir);
  assert.equal(isInsideRuntimeArea(homeDir, calls[0].cwd), true);
  assert.equal(cwdExistedDuringExecute, true);
  assert.equal(result.metadata.sessionCwd, calls[0].cwd);
  assert.equal(result.metadata.attemptWorkspaceCwd, await fs.realpath(calls[0].cwd));
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner reports the attempt workspace on terminal failures so the daemon can clean it up', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
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
      status: 'failed',
      output: '',
      error: 'runtime failed',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_execution_failed');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.attemptWorkspaceCwd, await fs.realpath(calls[0].cwd));
  assert.equal(isInsideRuntimeArea(homeDir, result.metadata.attemptWorkspaceCwd), true);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner rejects session cwd symlinks that escape the dedicated workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  const calls = [];
  let reportedSessionCwd = '';
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        reportedSessionCwd = path.join(request.cwd, 'escape');
        await fs.symlink(homeDir, reportedSessionCwd, 'dir');
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          cwd: reportedSessionCwd,
          result: {
            status: 'completed',
            output: 'out/provider-image.png',
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

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.sessionCwd, calls[0].cwd);
  assert.equal(result.metadata.attemptWorkspaceCwd, await fs.realpath(calls[0].cwd));
  assert.notEqual(result.metadata.sessionCwd, reportedSessionCwd);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner rejects session cwd files inside the dedicated workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  const calls = [];
  let reportedSessionCwd = '';
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        reportedSessionCwd = path.join(request.cwd, 'not-a-directory.txt');
        await fs.writeFile(reportedSessionCwd, 'not a cwd', 'utf8');
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          cwd: reportedSessionCwd,
          result: {
            status: 'completed',
            output: 'out/provider-image.png',
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

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.sessionCwd, calls[0].cwd);
  assert.notEqual(result.metadata.sessionCwd, reportedSessionCwd);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner rejects nonexistent session cwd inside the dedicated workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  const calls = [];
  let reportedSessionCwd = '';
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        reportedSessionCwd = path.join(request.cwd, 'missing-cwd');
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          cwd: reportedSessionCwd,
          result: {
            status: 'completed',
            output: 'out/provider-image.png',
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

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.sessionCwd, calls[0].cwd);
  assert.notEqual(result.metadata.sessionCwd, reportedSessionCwd);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner preserves legitimate nested session cwd inside the dedicated workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
    ],
  });
  const calls = [];
  let reportedSessionCwd = '';
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        reportedSessionCwd = path.join(request.cwd, 'nested');
        await fs.mkdir(reportedSessionCwd, { recursive: true });
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'completed',
          cwd: reportedSessionCwd,
          result: {
            status: 'completed',
            output: 'out/provider-image.png',
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

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(result.metadata.sessionCwd, reportedSessionCwd);
  assert.equal(result.metadata.attemptWorkspaceCwd, await fs.realpath(calls[0].cwd));
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner uses distinct dedicated workspaces for fallback attempts', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'codex', health: 'healthy' }),
      runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
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
        return request.runtimeId === 'runtime-primary' ? 'session-primary' : 'session-fallback';
      },
      async getSession(sessionId) {
        if (sessionId === 'session-primary') {
          return {
            sessionId,
            status: 'failed',
            result: {
              status: 'failed',
              output: '',
              error: 'primary failed after writing partial artifacts',
              durationMs: 10,
            },
          };
        }
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'out/fallback-image.png',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
    getFallbackRuntime: async () => runtime({ id: 'runtime-fallback', provider: 'claude-code' }),
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.deepEqual(calls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-fallback']);
  assert.equal(isInsideRuntimeArea(homeDir, calls[0].cwd), true);
  assert.equal(isInsideRuntimeArea(homeDir, calls[1].cwd), true);
  assert.notEqual(calls[0].cwd, calls[1].cwd);
  assert.equal(result.metadata.sessionCwd, calls[1].cwd);
  assert.equal(result.metadata.attemptWorkspaceCwd, await fs.realpath(calls[1].cwd));
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

test('createProviderServiceRunner passes selected global skill source path to executor', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
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
      output: 'Global-root skill executed.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].cwd, homeDir);
  assert.equal(isInsideRuntimeArea(homeDir, calls[0].cwd), true);
  assert.equal(
    calls[0].skillSourcePaths['weather.oracle'],
    path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'),
  );
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner strips leading process narration from provider deliverables', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
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
      output: 'Reading the weather.oracle skill to fetch the latest data.\n\nWeather Oracle Result\nSunny, 25C',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.responseText, 'Weather Oracle Result\nSunny, 25C');
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

test('createProviderServiceRunner uses a healthy unbound runtime when the configured primary is unavailable', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await fs.rm(path.join(systemHomeDir, '.claude'), { recursive: true, force: true });
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'cursor', health: 'unavailable', binaryPath: '/bin/cursor-agent' }),
      runtime({ id: 'runtime-unbound', provider: 'claude-code', health: 'healthy', binaryPath: '/bin/claude' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
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
      output: 'Unbound runtime used the portable skill source.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-unbound');
  assert.equal(result.metadata.fallbackSelected, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtimeId, 'runtime-unbound');
  assert.equal(
    calls[0].skillSourcePaths['weather.oracle'],
    path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'),
  );
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner retries a healthy unbound runtime after primary execution timeout', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await fs.rm(path.join(systemHomeDir, '.claude'), { recursive: true, force: true });
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'cursor', health: 'healthy', binaryPath: '/bin/cursor-agent' }),
      runtime({ id: 'runtime-unbound', provider: 'claude-code', health: 'healthy', binaryPath: '/bin/claude' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
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
        return request.runtimeId === 'runtime-primary' ? 'session-primary' : 'session-unbound';
      },
      async getSession(sessionId) {
        if (sessionId === 'session-primary') {
          return {
            sessionId,
            status: 'timeout',
            result: {
              status: 'timeout',
              output: '',
              error: 'primary timed out',
              durationMs: 10,
            },
          };
        }
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: 'Unbound runtime completed after primary timeout.',
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
  assert.equal(result.runtimeId, 'runtime-unbound');
  assert.deepEqual(calls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-unbound']);
  assert.equal(
    calls[1].skillSourcePaths['weather.oracle'],
    path.join(systemHomeDir, '.codex', 'skills', 'weather.oracle'),
  );
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

test('createProviderServiceRunner injects a locally installed skill into a healthy primary runtime', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime({ id: 'runtime-primary', provider: 'cursor', health: 'healthy', binaryPath: '/bin/cursor-agent' }),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-primary', 'alice', 'runtime-primary', 'primary'),
    ],
  });
  await fs.mkdir(path.join(systemHomeDir, '.codex', 'skills', 'codex.only'), { recursive: true });
  await fs.writeFile(path.join(systemHomeDir, '.codex', 'skills', 'codex.only', 'SKILL.md'), '# Codex Only\n', 'utf8');
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Primary runtime used injected local skill.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({ providerSkill: 'codex.only' }));

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-primary');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runtimeId, 'runtime-primary');
  assert.equal(
    calls[0].skillSourcePaths['codex.only'],
    path.join(systemHomeDir, '.codex', 'skills', 'codex.only'),
  );
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner retries fallback on started terminal runtime failures', async () => {
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
    assert.equal(calls.length, 2);
    assert.equal(fallbackCalls, 1);
    await cleanupProfileHome(homeDir);
  }
});

test('createProviderServiceRunner retries fallback when primary completes with empty output', async () => {
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
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        return request.runtimeId === 'runtime-primary' ? 'session-primary' : 'session-fallback';
      },
      async getSession(sessionId) {
        if (sessionId === 'session-fallback') {
          return {
            sessionId,
            status: 'completed',
            result: {
              status: 'completed',
              output: 'Fallback handled the empty primary result.',
              durationMs: 10,
            },
          };
        }
        return {
          sessionId,
          status: 'completed',
          result: {
            status: 'completed',
            output: '   ',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
    getFallbackRuntime: async () => {
      fallbackCalls += 1;
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(result.runtimeId, 'runtime-fallback');
  assert.equal(result.responseText, 'Fallback handled the empty primary result.');
  assert.equal(result.metadata.fallbackSelected, true);
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(calls.map((call) => call.runtimeId), ['runtime-primary', 'runtime-fallback']);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner allows non-text deliverables after session start without fallback retry', async () => {
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
    llmExecutor: {
      async execute(request) {
        calls.push(request);
        return 'session-primary';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          runtimeId: 'runtime-primary',
          provider: 'codex',
          status: 'completed',
          prompt: 'Forecast tomorrow',
          cwd: homeDir,
          createdAt: '2026-05-07T00:00:00.000Z',
          result: {
            status: 'completed',
            output: 'Reading the weather.oracle skill to render the image.\n\n/tmp/provider-image.png',
            durationMs: 10,
          },
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
    getFallbackRuntime: async () => {
      fallbackCalls += 1;
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.equal(result.responseText, '/tmp/provider-image.png');
  assert.equal(result.runtimeId, 'runtime-primary');
  assert.equal(result.sessionId, 'session-primary');
  assert.equal(result.metadata.outputType, 'image');
  assert.equal(result.metadata.runtimeId, 'runtime-primary');
  assert.equal(result.metadata.sessionId, 'session-primary');
  assert.equal(result.metadata.sessionCwd, calls[0].cwd);
  assert.equal(isInsideRuntimeArea(homeDir, calls[0].cwd), true);
  assert.equal(result.metadata.providerSkill, 'weather.oracle');
  assert.equal(calls.length, 1);
  assert.equal(fallbackCalls, 0);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner treats markdown deliverables as text-like output', async () => {
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
      output: '# Weather Oracle\n\nSunny, 25C',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
    getFallbackRuntime: async () => {
      fallbackCalls += 1;
      return runtime({ id: 'runtime-fallback', provider: 'claude-code' });
    },
  });

  const result = await runner.execute(baseOrder({ outputType: 'markdown' }));

  assert.equal(result.state, 'completed');
  assert.equal(result.responseText, '# Weather Oracle\n\nSunny, 25C');
  assert.equal(result.metadata.outputType, 'markdown');
  assert.equal(result.runtimeId, 'runtime-primary');
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

test('resolveProviderOrderExecutionTimeoutMs gives video 20 minutes and other output types 5 minutes', async () => {
  const {
    resolveProviderOrderExecutionTimeoutMs,
    DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS,
    VIDEO_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS,
  } = require('../../dist/core/a2a/provider/providerServiceRunner.js');

  assert.equal(DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS, 5 * 60_000);
  assert.equal(VIDEO_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS, 20 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'video' }), 20 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'video/mp4' }), 20 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'text' }), 5 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'image' }), 5 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'audio' }), 5 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: null }), 5 * 60_000);
});

test('resolveProviderOrderExecutionTimeoutMs honors a service timeout override with clamps', async () => {
  const {
    resolveProviderOrderExecutionTimeoutMs,
  } = require('../../dist/core/a2a/provider/providerServiceRunner.js');

  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'video', executionTimeoutMs: 10 * 60_000 }), 10 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'text', executionTimeoutMs: 5_000 }), 30_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'text', executionTimeoutMs: 60 * 60_000 }), 30 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'video', executionTimeoutMs: 0 }), 20 * 60_000);
  assert.equal(resolveProviderOrderExecutionTimeoutMs({ outputType: 'video', executionTimeoutMs: Number.NaN }), 20 * 60_000);
});

test('createProviderServiceRunner passes the 5 minute default session timeout to the executor', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'It will rain tomorrow.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder());

  assert.equal(result.state, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeout, 5 * 60_000);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner delivers an existing workspace artifact as a partial result on execution timeout', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
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
        await fs.writeFile(path.join(request.cwd, 'forecast.png'), 'png bytes', 'utf8');
        return 'session-timeout-partial';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'timeout',
          error: 'provider execution timed out',
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'completed');
  assert.match(result.responseText, /timed out/i);
  assert.match(result.responseText, /may be incomplete/i);
  assert.match(result.responseText, /artifactPath: forecast\.png/);
  assert.equal(result.metadata.executionTimedOut, true);
  assert.equal(typeof result.metadata.attemptWorkspaceCwd, 'string');
  // The partial delivery takes precedence over the fallback-runtime retry.
  assert.equal(calls.length, 1);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner keeps the failure path when a timeout produced no artifact', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
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
        return `session-${calls.length}`;
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'timeout',
          error: 'provider execution timed out',
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_execution_timeout');
  // The selected runtime was already the fallback, so no further retry happens.
  assert.equal(calls.length, 1);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner does not partial-deliver an ambiguous workspace on timeout', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: {
      async execute(request) {
        await fs.writeFile(path.join(request.cwd, 'first.png'), 'png bytes', 'utf8');
        await fs.writeFile(path.join(request.cwd, 'second.png'), 'png bytes', 'utf8');
        return 'session-timeout-ambiguous';
      },
      async getSession(sessionId) {
        return {
          sessionId,
          status: 'timeout',
          error: 'provider execution timed out',
        };
      },
      async cancel() {},
      async listSessions() { return []; },
      async streamEvents() { return (async function* () {})(); },
    },
    canStartRuntime: () => true,
  });

  const result = await runner.execute(baseOrder({ outputType: 'image' }));

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_execution_timeout');
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner executeContinuation reruns in the same workspace with a MUST-generate prompt', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Created the image.\nartifactPath: forecast.png',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });
  const order = baseOrder({
    outputType: 'image',
    metadata: { orderTxid: 'order-txid-123' },
  });

  const initial = await runner.execute(order);
  assert.equal(initial.state, 'completed');
  const continuation = await runner.executeContinuation(order, initial);

  assert.equal(continuation.state, 'completed');
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /not complete yet because no image file exists for delivery/);
  assert.match(calls[1].prompt, /Order txid: order-txid-123\./);
  assert.match(calls[1].prompt, /Original buyer request: Forecast tomorrow/);
  assert.match(calls[1].prompt, /MUST generate a real image file/);
  assert.equal(calls[1].systemPrompt, calls[0].systemPrompt);
  assert.deepEqual(calls[1].skills, ['weather.oracle']);
  // The continuation reuses the initial attempt workspace instead of creating
  // a new one (macOS /var symlink requires the realpath comparison).
  assert.equal(await fs.realpath(calls[0].cwd), calls[1].cwd);
  assert.equal(continuation.metadata.missingArtifactContinuation, true);
  assert.equal(continuation.metadata.attemptWorkspaceCwd, calls[1].cwd);
  assert.equal(continuation.runtimeId, initial.runtimeId);
  await cleanupProfileHome(homeDir);
});

test('createProviderServiceRunner executeContinuation requires the previous selection and workspace', async () => {
  const { homeDir, systemHomeDir, runtimeStore, bindingStore } = await createRunnerDeps();
  const calls = [];
  const runner = createProviderServiceRunner({
    metaBotSlug: 'alice',
    systemHomeDir,
    projectRoot: homeDir,
    runtimeStore,
    bindingStore,
    llmExecutor: llmExecutorForTerminalResult({
      status: 'completed',
      output: 'Done.',
      durationMs: 10,
    }, calls),
    canStartRuntime: () => true,
  });

  const continuation = await runner.executeContinuation(baseOrder({ outputType: 'image' }), {
    state: 'failed',
    code: 'provider_execution_failed',
    message: 'no workspace metadata here',
  });

  assert.equal(continuation.state, 'failed');
  assert.equal(continuation.code, 'provider_artifact_continuation_unavailable');
  assert.equal(calls.length, 0);
  await cleanupProfileHome(homeDir);
});
