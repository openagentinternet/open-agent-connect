import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function makeRuntime(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'llm_codex_missing',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/missing/codex',
    version: '0.0.1',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('LLM runtime discovery marks previously known missing runtimes unavailable', async (t) => {
  const homeDir = await createProfileHome('metabot-default-llm-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });

  const systemHome = deriveSystemHome(homeDir);
  const binDir = path.join(systemHome, 'bin');
  await mkdir(binDir, { recursive: true });
  const fakeCodexPath = path.join(binDir, 'codex');
  await writeFile(fakeCodexPath, '#!/usr/bin/env sh\necho "codex 1.2.3"\n', 'utf8');
  await chmod(fakeCodexPath, 0o755);

  const discoveredRuntimeId = `llm_codex_${fakeCodexPath}`;
  const runtimeStore = createLlmRuntimeStore(resolveMetabotPaths(homeDir));
  await runtimeStore.upsertRuntime(makeRuntime());
  await runtimeStore.upsertRuntime(makeRuntime({
    id: discoveredRuntimeId,
    binaryPath: fakeCodexPath,
    health: 'degraded',
  }));

  const originalPath = process.env.PATH;
  process.env.PATH = binDir;
  t.after(() => {
    process.env.PATH = originalPath;
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const result = await handlers.llm.discoverRuntimes();

  assert.equal(result.ok, true);
  const byId = new Map(result.data.runtimes.map((runtime) => [runtime.id, runtime]));
  assert.equal(byId.get(discoveredRuntimeId).health, 'healthy');
  assert.equal(byId.get('llm_codex_missing').health, 'unavailable');
});
