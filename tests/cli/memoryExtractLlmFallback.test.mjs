// Fast-tier tests for the memory-extract LLM judge Chain C fallback
// (Codex↔DSH parity Phase 3, item 2): the `memory extract` CLI handler must
// keep DSH-first priority (host-executor generate route first) and fall back
// to the local CLI runtime chain (`runLlmPromptWithRuntimeFallback`) only
// when the host path is unusable — so the LLM judge lights up on non-DSH
// installs and still never breaks a turn.

import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createDefaultCliDependencies } = require('../../dist/cli/runtime.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { writeBotRoleInfo } = require('../../dist/core/bot/botRole.js');
const registryBackendsModule = require('../../dist/core/llm/executor/backends/registry.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-extract-fallback-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  const managerRoot = path.join(base, '.metabot', 'manager');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  // Index the profile so `resolveActorHomeDir` accepts METABOT_HOME.
  await fs.writeFile(path.join(managerRoot, 'identity-profiles.json'), `${JSON.stringify({
    profiles: [{
      name: 'Test Bot',
      slug: 'test-slug',
      aliases: [],
      homeDir: profileRoot,
      globalMetaId: 'global-meta-id',
      mvcAddress: 'mvc-address',
      createdAt: 1,
      updatedAt: 1,
    }],
  }, null, 2)}\n`);
  const paths = resolveMetabotPaths(profileRoot);
  await writeBotRoleInfo(paths.botRoleStatePath, { botType: 'twin' });
  return { base, profileRoot, paths };
}

async function writeFakeLocalRuntime(paths) {
  const now = new Date().toISOString();
  await createLlmRuntimeStore(paths).upsertRuntime({
    id: 'rt-fake',
    provider: 'custom',
    displayName: 'Fake runtime',
    binaryPath: '/nonexistent/fake-llm',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: [],
    lastSeenAt: now,
    model: 'fake-model',
    createdAt: now,
    updatedAt: now,
  });
}

function patchRegistryBackends(backendCalls, output) {
  const original = registryBackendsModule.createRegistryBackendFactories;
  registryBackendsModule.createRegistryBackendFactories = () => new Proxy({}, {
    get: () => (_binaryPath, _env) => ({
      provider: 'custom',
      async execute(request) {
        backendCalls.push(request);
        return { status: 'completed', output, durationMs: 1 };
      },
    }),
  });
  return () => {
    registryBackendsModule.createRegistryBackendFactories = original;
  };
}

async function startRecordingHostDaemon(output) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        pathname: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(commandSuccess({ output })));
    });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function startDeadPort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return `http://127.0.0.1:${port}`;
}

const FAKE_EXTRACTION_BY_HOST = JSON.stringify({
  changes: [{ action: 'add', text: 'host-judge durable fact alpha', is_explicit: true }],
});
const FAKE_EXTRACTION_BY_RUNTIME = JSON.stringify({
  changes: [{ action: 'add', text: 'runtime-judge durable fact beta', is_explicit: true }],
});

test('memory extract: host executor wins when the DSH bridge route answers (local runtime untouched)', async (t) => {
  const { profileRoot, paths } = await createTempProfileHome();
  await writeFakeLocalRuntime(paths);
  const backendCalls = [];
  t.after(patchRegistryBackends(backendCalls, FAKE_EXTRACTION_BY_RUNTIME));
  const host = await startRecordingHostDaemon(FAKE_EXTRACTION_BY_HOST);
  t.after(async () => host.close());

  const dependencies = createDefaultCliDependencies({
    cwd: profileRoot,
    env: {
      HOME: path.dirname(path.dirname(path.dirname(profileRoot))),
      METABOT_HOME: profileRoot,
      METABOT_ALLOW_UNINDEXED_HOME: '1',
      METABOT_DAEMON_BASE_URL: host.baseUrl,
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });

  const result = await dependencies.memory.extract({
    payload: {
      userText: 'host executor should answer this turn about alpha preferences',
      assistantText: 'Understood.',
      sessionId: 'sess-host',
      channel: 'dsh',
      userMessageId: 'msg-host',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.llmReviewed >= 1, true);
  assert.equal(
    host.requests.some((request) => request.pathname === '/api/llm/host-executor/generate'),
    true,
    'host-executor generate route was called',
  );
  assert.deepEqual(backendCalls, [], 'local runtime chain was never consulted');
  const memories = await createMemoryStore(paths).list({});
  assert.equal(memories.some((entry) => entry.text === 'host-judge durable fact alpha'), true);
});

test('memory extract: falls back to the local runtime chain when the bridge route is absent', async (t) => {
  const { base, profileRoot, paths } = await createTempProfileHome();
  await writeFakeLocalRuntime(paths);
  const backendCalls = [];
  t.after(patchRegistryBackends(backendCalls, FAKE_EXTRACTION_BY_RUNTIME));
  const deadBaseUrl = await startDeadPort();

  const dependencies = createDefaultCliDependencies({
    cwd: profileRoot,
    env: {
      HOME: base,
      METABOT_HOME: profileRoot,
      METABOT_ALLOW_UNINDEXED_HOME: '1',
      METABOT_DAEMON_BASE_URL: deadBaseUrl,
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });

  const result = await dependencies.memory.extract({
    payload: {
      userText: 'runtime fallback should answer this turn about beta preferences',
      assistantText: 'Understood.',
      sessionId: 'sess-runtime',
      channel: 'dsh',
      userMessageId: 'msg-runtime',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.llmReviewed >= 1, true);
  assert.equal(backendCalls.length >= 1, true, 'local runtime backend executed the judge prompt');
  assert.match(backendCalls[0].systemPrompt ?? backendCalls[0].system ?? '', /long-term memories/i);
  const memories = await createMemoryStore(paths).list({});
  assert.equal(memories.some((entry) => entry.text === 'runtime-judge durable fact beta'), true);
});

test('memory extract: degrades to rule-only extraction when no LLM path exists', async (t) => {
  const { base, profileRoot, paths } = await createTempProfileHome();
  // No runtime store record: the local chain has no healthy runtime; the
  // host route is unreachable. The turn must still extract rule-based facts.
  const deadBaseUrl = await startDeadPort();

  const dependencies = createDefaultCliDependencies({
    cwd: profileRoot,
    env: {
      HOME: base,
      METABOT_HOME: profileRoot,
      METABOT_ALLOW_UNINDEXED_HOME: '1',
      METABOT_DAEMON_BASE_URL: deadBaseUrl,
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });

  const result = await dependencies.memory.extract({
    payload: {
      userText: '请记住：我喜欢喝燕麦拿铁',
      assistantText: '好的，已记住。',
      sessionId: 'sess-rule',
      channel: 'dsh',
      userMessageId: 'msg-rule',
    },
  });

  assert.equal(result.ok, true);
  const memories = await createMemoryStore(paths).list({});
  assert.equal(memories.some((entry) => entry.text.includes('燕麦拿铁')), true, 'rule-only extraction still persisted the explicit fact');
});
