import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeResolver } = require('../../dist/core/llm/llmRuntimeResolver.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

async function createTempProfileHome(slug = 'test-slug') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-resolver-'));
  const profileRoot = path.join(base, '.metabot', 'profiles', slug);
  await fs.mkdir(path.join(base, '.metabot', 'LLM'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'skills'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  return profileRoot;
}

function makeRuntime(id, provider, health = 'healthy') {
  const now = new Date().toISOString();
  return { id, provider, displayName: provider, binaryPath: `/usr/bin/${provider}`, version: '1.0', authState: 'authenticated', health, capabilities: ['tool-use'], lastSeenAt: now, createdAt: now, updatedAt: now };
}

function makeBinding(id, metaBotSlug, llmRuntimeId, role = 'primary', priority = 0, enabled = true, lastUsedAt) {
  const now = new Date().toISOString();
  return { id, metaBotSlug, llmRuntimeId, role, priority, enabled, lastUsedAt, createdAt: now, updatedAt: now };
}

test('resolveRuntime returns null when no runtimes exist', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime, null);
});

test('resolveRuntime returns explicit runtime by id', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ explicitRuntimeId: 'r_codex' });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('resolveRuntime skips explicit runtime when unavailable', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code', 'unavailable'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ explicitRuntimeId: 'r_claude' });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('resolveRuntime skips explicit and preferred runtimes in excludeRuntimeIds', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  await bindingStore.upsertBinding(makeBinding('b1', 'test-slug', 'r_claude', 'primary', 0, true));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => 'r_claude',
  });
  const resolved = await resolver.resolveRuntime({
    metaBotSlug: 'test-slug',
    explicitRuntimeId: 'r_claude',
    excludeRuntimeIds: ['r_claude'],
  });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('resolveRuntime uses preferred runtime when available', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => 'r_codex',
  });
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('resolveRuntime follows priority order in bindings', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  await bindingStore.upsertBinding(makeBinding('b1', 'test-slug', 'r_codex', 'primary', 5, true));
  await bindingStore.upsertBinding(makeBinding('b2', 'test-slug', 'r_claude', 'primary', 1, true));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime.id, 'r_claude');
});

test('resolveRuntime skips disabled bindings', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  await bindingStore.upsertBinding(makeBinding('b1', 'test-slug', 'r_claude', 'primary', 0, false));
  await bindingStore.upsertBinding(makeBinding('b2', 'test-slug', 'r_codex', 'fallback', 1, true));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('resolveRuntime falls back to healthy runtime when no binding matches', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code', 'unavailable'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex', 'healthy'));
  await bindingStore.upsertBinding(makeBinding('b1', 'test-slug', 'r_claude', 'primary', 0, true));
  const resolver = createLlmRuntimeResolver({
    runtimeStore,
    bindingStore,
    getPreferredRuntimeId: async () => null,
  });
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime.id, 'r_codex');
});

test('selectMetaBot finds best match by provider and lastUsedAt', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex'));
  await bindingStore.upsertBinding(makeBinding('b1', 'bob', 'r_codex', 'primary', 0, true, '2026-05-01T00:00:00Z'));
  await bindingStore.upsertBinding(makeBinding('b2', 'alice', 'r_codex', 'primary', 0, true, '2026-05-02T00:00:00Z'));
  const resolver = createLlmRuntimeResolver({ runtimeStore, bindingStore, getPreferredRuntimeId: async () => null });
  const result = await resolver.selectMetaBot({ targetProvider: 'codex' });
  assert.equal(result.metaBotSlug, 'alice');
});

test('selectMetaBot returns null for unmatched provider', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code'));
  await bindingStore.upsertBinding(makeBinding('b1', 'bob', 'r_claude', 'primary', 0, true));
  const resolver = createLlmRuntimeResolver({ runtimeStore, bindingStore, getPreferredRuntimeId: async () => null });
  const result = await resolver.selectMetaBot({ targetProvider: 'codex' });
  assert.equal(result, null);
});

test('markBindingUsed updates lastUsedAt', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await bindingStore.upsertBinding(makeBinding('b1', 'test-slug', 'r_claude', 'primary', 0, true));
  const resolver = createLlmRuntimeResolver({ runtimeStore, bindingStore, getPreferredRuntimeId: async () => null });
  await resolver.markBindingUsed('b1');
  const state = await bindingStore.read();
  assert.equal(typeof state.bindings[0].lastUsedAt, 'string');
});

test('markRuntimeUnavailable sets health to unavailable', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.upsertRuntime(makeRuntime('r_claude', 'claude-code', 'healthy'));
  const resolver = createLlmRuntimeResolver({ runtimeStore, bindingStore, getPreferredRuntimeId: async () => null });
  await resolver.markRuntimeUnavailable('r_claude');
  const state = await runtimeStore.read();
  assert.equal(state.runtimes[0].health, 'unavailable');

  // Verify the unavailable runtime is now skipped by resolution.
  await runtimeStore.upsertRuntime(makeRuntime('r_codex', 'codex', 'healthy'));
  const resolved = await resolver.resolveRuntime({ metaBotSlug: 'test-slug' });
  assert.equal(resolved.runtime.id, 'r_codex');
});
