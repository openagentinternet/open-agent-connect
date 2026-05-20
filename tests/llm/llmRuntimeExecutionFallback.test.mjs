import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runLlmPromptWithRuntimeFallback } = require('../../dist/core/llm/llmRuntimeExecution.js');

function makeRuntime(id, provider, health = 'healthy') {
  const now = new Date().toISOString();
  return {
    id,
    provider,
    displayName: provider,
    binaryPath: `/usr/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

test('runLlmPromptWithRuntimeFallback retries a healthy fallback when primary execution fails', async () => {
  const primary = makeRuntime('primary-runtime', 'codex');
  const fallback = makeRuntime('fallback-runtime', 'claude-code');
  const calls = {
    resolve: [],
    execute: [],
    unavailable: [],
    used: [],
  };
  const resolver = {
    async resolveRuntime(input) {
      calls.resolve.push(input);
      const excluded = new Set(input.excludeRuntimeIds ?? []);
      if (!excluded.has(primary.id)) {
        return { runtime: primary, bindingId: 'primary-binding', bindingRole: 'primary' };
      }
      return { runtime: fallback, bindingId: 'fallback-binding', bindingRole: 'fallback' };
    },
    async markBindingUsed(bindingId) {
      calls.used.push(bindingId);
    },
    async markRuntimeUnavailable(runtimeId) {
      calls.unavailable.push(runtimeId);
    },
  };
  const executor = {
    async execute(input) {
      calls.execute.push(input.runtimeId);
      return `session-${input.runtimeId}`;
    },
    async getSession(sessionId) {
      if (sessionId === 'session-primary-runtime') {
        return {
          sessionId,
          runtimeId: primary.id,
          provider: primary.provider,
          status: 'failed',
          prompt: 'prompt',
          createdAt: new Date().toISOString(),
          result: {
            status: 'failed',
            output: '',
            error: 'primary failed',
            durationMs: 1,
          },
        };
      }
      return {
        sessionId,
        runtimeId: fallback.id,
        provider: fallback.provider,
        status: 'completed',
        prompt: 'prompt',
        createdAt: new Date().toISOString(),
        result: {
          status: 'completed',
          output: 'fallback result',
          durationMs: 1,
        },
      };
    },
  };

  const result = await runLlmPromptWithRuntimeFallback({
    runtimeResolver: resolver,
    llmExecutor: executor,
    metaBotSlug: 'eric',
    prompt: 'prompt',
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    sleep: async () => {},
  });

  assert.deepEqual(calls.execute, ['primary-runtime', 'fallback-runtime']);
  assert.deepEqual(calls.unavailable, ['primary-runtime']);
  assert.deepEqual(calls.used, ['fallback-binding']);
  assert.equal(calls.resolve[1].excludeRuntimeIds.includes('primary-runtime'), true);
  assert.deepEqual(result, {
    sessionId: 'session-fallback-runtime',
    status: 'completed',
    output: 'fallback result',
    error: undefined,
  });
});

test('runLlmPromptWithRuntimeFallback fails cleanly when no healthy runtime is available', async () => {
  const result = await runLlmPromptWithRuntimeFallback({
    runtimeResolver: {
      async resolveRuntime() {
        return { runtime: null };
      },
      async markBindingUsed() {},
      async markRuntimeUnavailable() {},
    },
    llmExecutor: {
      async execute() {
        throw new Error('should not execute');
      },
      async getSession() {
        return null;
      },
    },
    metaBotSlug: 'eric',
    prompt: 'prompt',
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    sleep: async () => {},
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.output, '');
  assert.match(result.error, /No healthy LLM runtime/);
});

test('runLlmPromptWithRuntimeFallback can avoid mutating runtime health for non-critical prompts', async () => {
  const primary = makeRuntime('primary-runtime', 'codex');
  const calls = {
    unavailable: [],
  };
  const result = await runLlmPromptWithRuntimeFallback({
    runtimeResolver: {
      async resolveRuntime(input) {
        if ((input.excludeRuntimeIds ?? []).includes(primary.id)) {
          return { runtime: null };
        }
        return { runtime: primary, bindingId: 'primary-binding', bindingRole: 'primary' };
      },
      async markBindingUsed() {},
      async markRuntimeUnavailable(runtimeId) {
        calls.unavailable.push(runtimeId);
      },
    },
    llmExecutor: {
      async execute() {
        return 'session-primary';
      },
      async getSession() {
        return {
          sessionId: 'session-primary',
          runtimeId: primary.id,
          provider: primary.provider,
          status: 'timeout',
          prompt: 'prompt',
          createdAt: new Date().toISOString(),
          result: {
            status: 'timeout',
            output: '',
            error: 'copy prompt timed out',
            durationMs: 1,
          },
        };
      },
    },
    metaBotSlug: 'eric',
    prompt: 'prompt',
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    sleep: async () => {},
    markRuntimeUnavailableOnFailure: false,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'copy prompt timed out');
  assert.deepEqual(calls.unavailable, []);
});
