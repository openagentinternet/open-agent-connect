import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

async function createTempProfileHome(slug = 'test-slug') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-llm-store-'));
  const profileRoot = path.join(base, '.metabot', 'profiles', slug);
  await fs.mkdir(path.join(base, '.metabot', 'LLM'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'skills'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  return profileRoot;
}

const sampleRuntime = {
  id: 'llm_claude_code_0',
  provider: 'claude-code',
  displayName: 'Claude Code',
  binaryPath: '/usr/local/bin/claude',
  version: '1.0.0',
  authState: 'authenticated',
  health: 'healthy',
  capabilities: ['tool-use'],
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('read returns empty state when file does not exist', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  const state = await store.read();
  assert.equal(state.version, 1);
  assert.deepEqual(state.runtimes, []);
});

test('upsertRuntime creates a new runtime', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  const state = await store.read();
  assert.equal(state.runtimes.length, 1);
  assert.equal(state.runtimes[0].id, 'llm_claude_code_0');
  assert.equal(state.runtimes[0].provider, 'claude-code');
});

test('upsertRuntime replaces existing runtime by id', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  await store.upsertRuntime({ ...sampleRuntime, health: 'degraded', version: '2.0.0' });
  const state = await store.read();
  assert.equal(state.runtimes.length, 1);
  assert.equal(state.runtimes[0].health, 'degraded');
  assert.equal(state.runtimes[0].version, '2.0.0');
});

test('upsertRuntime bumps version', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  const state1 = await store.read();
  assert.equal(state1.version, 2);
  await store.upsertRuntime(sampleRuntime);
  const state2 = await store.read();
  assert.equal(state2.version, 3);
});

test('removeRuntime removes by id', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  await store.removeRuntime('llm_claude_code_0');
  const state = await store.read();
  assert.equal(state.runtimes.length, 0);
});

test('removeRuntime is a no-op for unknown id', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  await store.removeRuntime('nonexistent');
  const state = await store.read();
  assert.equal(state.runtimes.length, 1);
});

test('markSeen updates lastSeenAt', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  const now = new Date().toISOString();
  await store.markSeen('llm_claude_code_0', now);
  const state = await store.read();
  assert.equal(state.runtimes[0].lastSeenAt, now);
});

test('updateHealth updates health field', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore(paths);
  await store.upsertRuntime(sampleRuntime);
  await store.updateHealth('llm_claude_code_0', 'unavailable');
  const state = await store.read();
  assert.equal(state.runtimes[0].health, 'unavailable');
});

test('malformed JSON is overwritten with clean state', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  await fs.mkdir(path.dirname(paths.llmRuntimesPath), { recursive: true });
  await fs.writeFile(paths.llmRuntimesPath, 'not json', 'utf8');
  const store = createLlmRuntimeStore(paths);
  const state = await store.read();
  assert.equal(state.version, 1);
  assert.deepEqual(state.runtimes, []);
});

test('store accepts paths object directly', async () => {
  const profileRoot = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const store = createLlmRuntimeStore({ llmRuntimesPath: paths.llmRuntimesPath });
  await store.upsertRuntime(sampleRuntime);
  const state = await store.read();
  assert.equal(state.runtimes.length, 1);
});
