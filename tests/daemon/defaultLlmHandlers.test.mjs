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
  await writeFile(fakeCodexPath, [
    '#!/bin/sh',
    'echo "codex 1.2.3"',
  ].join('\n'), 'utf8');
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
  assert.equal(byId.get(discoveredRuntimeId).health, 'detected');
  assert.equal(byId.get('llm_codex_missing').health, 'unavailable');
});

test('LLM runtime discovery preserves recently healthy runtime on transient readiness failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-llm-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });

  const systemHome = deriveSystemHome(homeDir);
  const binDir = path.join(systemHome, 'bin');
  await mkdir(binDir, { recursive: true });
  const fakeCodexPath = path.join(binDir, 'codex');
  await writeFile(fakeCodexPath, [
    '#!/bin/sh',
    'echo "codex 1.2.3"',
  ].join('\n'), 'utf8');
  await chmod(fakeCodexPath, 0o755);

  const discoveredRuntimeId = `llm_codex_${fakeCodexPath}`;
  const runtimeStore = createLlmRuntimeStore(resolveMetabotPaths(homeDir));
  await runtimeStore.upsertRuntime(makeRuntime({
    id: discoveredRuntimeId,
    binaryPath: fakeCodexPath,
    health: 'healthy',
    healthCheckedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
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
  assert.equal(byId.get(discoveredRuntimeId).healthReason, undefined);
});


function deferredGate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function waitForCondition(condition, label, timeoutMs = 3000) {
  const startedAt = Date.now();
  for (;;) {
    if (await condition()) return;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('llm discoverRuntimes background mode mirrors the bot handler behavior', async (t) => {
  const homeDir = await createProfileHome('metabot-llm-discover-background-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  await createLlmRuntimeStore(resolveMetabotPaths(homeDir)).write({
    version: 1,
    runtimes: [makeRuntime({ id: 'runtime-codex', health: 'healthy' })],
  });

  const gate = deferredGate();
  let discoverCalls = 0;
  let observedProviders = null;
  let progressiveUpsertDone = false;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    discoverLlmRuntimes: async (input) => {
      discoverCalls += 1;
      observedProviders = input.providers ?? null;
      const discovered = makeRuntime({
        id: 'runtime-workbuddy',
        provider: 'workbuddy',
        displayName: 'WorkBuddy',
        binaryPath: '/bin/workbuddy',
        health: 'detected',
      });
      await input.onRuntimeDiscovered(discovered);
      progressiveUpsertDone = true;
      await gate.promise;
      return { runtimes: [discovered], errors: [] };
    },
  });

  const first = await handlers.llm.discoverRuntimes({ background: true, providers: ['workbuddy', 'bogus'] });
  assert.equal(first.ok, true);
  assert.equal(first.data.status, 'running');
  assert.deepEqual(first.data.runtimes.map((entry) => entry.id), ['runtime-codex']);

  await waitForCondition(() => progressiveUpsertDone, 'background sweep to upsert mid-sweep');
  assert.equal(discoverCalls, 1);
  assert.deepEqual(observedProviders, ['workbuddy'], 'invalid provider entries are ignored');

  const duringList = await handlers.llm.listRuntimes();
  assert.equal(duringList.data.discoveryStatus.running, true);
  assert.ok(
    duringList.data.runtimes.some((entry) => entry.id === 'runtime-workbuddy'),
    'progressive upserts are visible to listRuntimes mid-sweep',
  );

  const second = await handlers.llm.discoverRuntimes({ background: true });
  assert.equal(second.data.status, 'running');
  assert.equal(discoverCalls, 1, 'single-flight: no second sweep while one is in flight');

  gate.release();
  await waitForCondition(async () => {
    const list = await handlers.llm.listRuntimes();
    return list.data.discoveryStatus && list.data.discoveryStatus.running === false;
  }, 'background sweep to settle');

  const afterList = await handlers.llm.listRuntimes();
  assert.equal(afterList.data.discoveryStatus.running, false);
  assert.ok(afterList.data.discoveryStatus.lastFinishedAt);
  assert.ok(afterList.data.runtimes.some((entry) => entry.id === 'runtime-workbuddy'));
  assert.equal(
    afterList.data.runtimes.find((entry) => entry.id === 'runtime-codex').health,
    'healthy',
    'a provider-subset sweep must not retire runtimes of other providers',
  );
});
