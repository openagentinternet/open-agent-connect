import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createHostLlmExecutorBridge,
  createDshPairHostLlmGenerate,
  DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS,
} = require('../../dist/core/llm/hostLlmExecutorBridge.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('generate resolves null when no executor is connected', async () => {
  const bridge = createHostLlmExecutorBridge();
  const outcome = await bridge.generate({ provider: 'deepseek', model: 'm', system: 's', prompt: 'p' });
  assert.equal(outcome, null);
  assert.equal(bridge.status().connected, 0);
});

test('generate pushes the request and resolves on the first posted result', async () => {
  const bridge = createHostLlmExecutorBridge();
  const received = [];
  bridge.attach((request) => received.push(request));
  const pending = bridge.generate({
    botSlug: 'alice',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: 'low',
    fallback: { provider: 'deepseek', model: 'deepseek-reasoner' },
    system: 'sys',
    prompt: 'prompt',
    timeoutMs: 5_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'generate');
  assert.equal(received[0].botSlug, 'alice');
  assert.equal(received[0].provider, 'deepseek');
  assert.equal(received[0].reasoningEffort, 'low');
  assert.equal(received[0].fallback.model, 'deepseek-reasoner');
  assert.equal(typeof received[0].requestId, 'string');
  assert.ok(received[0].requestId.length > 0);
  assert.equal(bridge.status().connected, 1);
  assert.equal(typeof bridge.status().lastConnectedAt, 'string');

  assert.equal(bridge.submitResult({ requestId: received[0].requestId, ok: true, output: 'hello' }), true);
  assert.deepEqual(await pending, { ok: true, output: 'hello' });
  // A second result for the same request id is rejected.
  assert.equal(bridge.submitResult({ requestId: received[0].requestId, ok: false, error: 'late' }), false);
});

test('submitResult for an unknown request id is rejected', () => {
  const bridge = createHostLlmExecutorBridge();
  assert.equal(bridge.submitResult({ requestId: 'nope', ok: true, output: 'x' }), false);
});

test('generate times out with an error outcome when no result arrives', async () => {
  const bridge = createHostLlmExecutorBridge({ generateTimeoutMs: 20 });
  bridge.attach(() => { /* executor that never answers */ });
  const outcome = await bridge.generate({ provider: 'deepseek', model: 'm', system: 's', prompt: 'p' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /timed out/);
});

test('default generation timeout matches the reply budget', () => {
  assert.equal(DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS, 60_000);
});

test('createDshPairHostLlmGenerate skips when no executor is connected or no pair exists', async () => {
  const root = mkdtempTempRootSync('oac-host-llm-bridge-');
  const dshLlmPath = path.join(root, 'dsh-llm.json');
  const connectedBridge = createHostLlmExecutorBridge();
  const disconnectedBridge = createHostLlmExecutorBridge();

  // Pair file exists, but no executor connected.
  await fs.writeFile(dshLlmPath, JSON.stringify({ dshLlmProvider: 'deepseek', dshLlmModel: 'chat' }), 'utf8');
  const generate = createDshPairHostLlmGenerate({ dshLlmPath, resolveBridge: () => disconnectedBridge });
  assert.equal(await generate({ prompt: 'p', systemPrompt: 's' }), null);

  // Executor connected, but no pair file.
  const noPair = createDshPairHostLlmGenerate({
    dshLlmPath: path.join(root, 'missing.json'),
    resolveBridge: () => connectedBridge,
  });
  assert.equal(await noPair({ prompt: 'p', systemPrompt: 's' }), null);

  // Executor connected and pair present: the request carries the pair.
  connectedBridge.attach((request) => {
    void connectedBridge.submitResult({ requestId: request.requestId, ok: true, output: 'ok' });
  });
  const withPair = createDshPairHostLlmGenerate({ dshLlmPath, resolveBridge: () => connectedBridge });
  const outcome = await withPair({ metaBotSlug: 'alice', prompt: 'p', systemPrompt: 's' });
  assert.deepEqual(outcome, { ok: true, output: 'ok' });
});

test('createDshPairHostLlmGenerate reads a fallback pair when present', async () => {
  const root = mkdtempTempRootSync('oac-host-llm-bridge-');
  const dshLlmPath = path.join(root, 'dsh-llm.json');
  await fs.writeFile(dshLlmPath, JSON.stringify({
    dshLlmProvider: 'deepseek',
    dshLlmModel: 'chat',
    dshLlmReasoningEffort: 'high',
    dshLlmFallbackProvider: 'deepseek',
    dshLlmFallbackModel: 'reasoner',
    dshLlmFallbackReasoningEffort: 'low',
  }), 'utf8');
  const bridge = createHostLlmExecutorBridge();
  const seen = [];
  bridge.attach((request) => {
    seen.push(request);
    void bridge.submitResult({ requestId: request.requestId, ok: true, output: 'ok' });
  });
  const generate = createDshPairHostLlmGenerate({ dshLlmPath, resolveBridge: () => bridge });
  await generate({ prompt: 'p', systemPrompt: 's' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reasoningEffort, 'high');
  assert.deepEqual(seen[0].fallback, { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'low' });
});
