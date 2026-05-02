import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

async function createTempProfileHome(slug = 'test-slug') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-llm-binding-'));
  const profileRoot = path.join(base, '.metabot', 'profiles', slug);
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'skills'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  return profileRoot;
}

const sampleBinding = {
  id: 'lb_test_llm_claude_primary',
  metaBotSlug: 'test-slug',
  llmRuntimeId: 'llm_claude_code_0',
  role: 'primary',
  priority: 0,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('read returns empty state when file does not exist', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  const state = await store.read();
  assert.equal(state.version, 1);
  assert.deepEqual(state.bindings, []);
});

test('upsertBinding creates a new binding', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  const state = await store.read();
  assert.equal(state.bindings.length, 1);
  assert.equal(state.bindings[0].role, 'primary');
});

test('upsertBinding replaces by composite key (metaBotSlug, llmRuntimeId, role)', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  await store.upsertBinding({ ...sampleBinding, priority: 5, enabled: false });
  const state = await store.read();
  assert.equal(state.bindings.length, 1);
  assert.equal(state.bindings[0].priority, 5);
  assert.equal(state.bindings[0].enabled, false);
});

test('upsertBinding allows different roles for same runtime', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  await store.upsertBinding({ ...sampleBinding, id: 'lb_test_llm_claude_fallback', role: 'fallback' });
  const state = await store.read();
  assert.equal(state.bindings.length, 2);
});

test('removeBinding removes by id', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  await store.removeBinding('lb_test_llm_claude_primary');
  const state = await store.read();
  assert.equal(state.bindings.length, 0);
});

test('updateLastUsed updates timestamp', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  const now = '2026-05-02T12:00:00.000Z';
  await store.updateLastUsed('lb_test_llm_claude_primary', now);
  const state = await store.read();
  assert.equal(state.bindings[0].lastUsedAt, now);
});

test('listByMetaBotSlug filters correctly', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  await store.upsertBinding({
    ...sampleBinding,
    id: 'lb_other_claude_primary',
    metaBotSlug: 'other-slug',
    role: 'primary',
  });
  const bindings = await store.listByMetaBotSlug('test-slug');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].metaBotSlug, 'test-slug');
});

test('listEnabledByMetaBotSlug returns only enabled bindings', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmBindingStore(paths);
  await store.upsertBinding(sampleBinding);
  await store.upsertBinding({
    ...sampleBinding,
    id: 'lb_test_fallback_disabled',
    role: 'fallback',
    enabled: false,
  });
  const bindings = await store.listEnabledByMetaBotSlug('test-slug');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].enabled, true);
});

test('malformed JSON is overwritten with clean state', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  await fs.writeFile(paths.llmBindingsPath, 'garbage', 'utf8');
  const store = createLlmBindingStore(paths);
  const state = await store.read();
  assert.equal(state.version, 1);
  assert.deepEqual(state.bindings, []);
});
