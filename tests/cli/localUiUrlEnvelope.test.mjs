// Fast-tier tests for the additive `localUiUrl` envelope fields on the
// surf / knowledge-base / dream / schedule / memory / traffic CLI commands
// (Codex<->DSH parity Phase 5). The field must appear only when a daemon base
// URL is resolvable, must deep-link the standalone /ui page with the resolved
// actor slug (`?from=<slug>`; traffic is owner-scoped and takes no query),
// and must leave every existing envelope field untouched.

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
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const registryBackendsModule = require('../../dist/core/llm/executor/backends/registry.js');

const SLUG = 'test-slug';

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-localuiurl-');
  const profileRoot = path.join(base, '.metabot', 'profiles', SLUG);
  const managerRoot = path.join(base, '.metabot', 'manager');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  // Index the profile so `resolveActorHomeDir` accepts --from test-slug.
  await fs.writeFile(path.join(managerRoot, 'identity-profiles.json'), `${JSON.stringify({
    profiles: [{
      name: 'Test Bot',
      slug: SLUG,
      aliases: [],
      homeDir: profileRoot,
      globalMetaId: 'global-meta-id',
      mvcAddress: 'mvc-address',
      createdAt: 1,
      updatedAt: 1,
    }],
  }, null, 2)}\n`);
  return { base, profileRoot, paths: resolveMetabotPaths(profileRoot) };
}

function makeDependencies(profileRoot, base, daemonBaseUrl) {
  return createDefaultCliDependencies({
    cwd: profileRoot,
    env: {
      HOME: base,
      METABOT_HOME: profileRoot,
      METABOT_ALLOW_UNINDEXED_HOME: '1',
      ...(daemonBaseUrl ? { METABOT_DAEMON_BASE_URL: daemonBaseUrl } : {}),
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });
}

/** Stub daemon for the thin HTTP-client envelopes (surf run, traffic). */
async function startStubDaemon(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      requests.push({ method: req.method, pathname });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(commandSuccess(routes[pathname] ?? {})));
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

function patchRegistryBackends(output) {
  const original = registryBackendsModule.createRegistryBackendFactories;
  registryBackendsModule.createRegistryBackendFactories = () => new Proxy({}, {
    get: () => () => ({
      provider: 'custom',
      async execute() {
        return { status: 'completed', output, durationMs: 1 };
      },
    }),
  });
  return () => {
    registryBackendsModule.createRegistryBackendFactories = original;
  };
}

// Store-backed read envelopes: one shared behavior, one row per command.
for (const [label, page, run] of [
  ['surf status', '/ui/surf', (deps) => deps.surf.status({ from: SLUG })],
  ['memory list', '/ui/memory', (deps) => deps.memory.list({ from: SLUG })],
  ['dream status', '/ui/dream', (deps) => deps.dream.status({ from: SLUG })],
  ['schedule list', '/ui/schedule', (deps) => deps.schedule.list({ from: SLUG })],
  ['knowledge-base list', '/ui/kb', (deps) => deps.knowledgeBase.list({ from: SLUG })],
  ['knowledge-base query', '/ui/kb', (deps) => deps.knowledgeBase.query({ from: SLUG, text: 'hello' })],
]) {
  test(`${label}: success envelope carries the additive /ui page localUiUrl with the resolved slug`, async () => {
    const { profileRoot, base } = await createTempProfileHome();
    const deps = makeDependencies(profileRoot, base, 'http://127.0.0.1:10001');

    const result = await run(deps);

    assert.equal(result.ok, true);
    assert.equal(result.data.localUiUrl, `http://127.0.0.1:10001${page}?from=${SLUG}`);
  });

  test(`${label}: localUiUrl is absent when no daemon base URL is resolvable`, async () => {
    const { profileRoot, base } = await createTempProfileHome();
    const deps = makeDependencies(profileRoot, base, null);

    const result = await run(deps);

    assert.equal(result.ok, true);
    assert.equal('localUiUrl' in result.data, false);
  });
}

test('surf status: existing envelope fields are unchanged by the localUiUrl decoration', async () => {
  const { profileRoot, base } = await createTempProfileHome();
  const deps = makeDependencies(profileRoot, base, 'http://127.0.0.1:10001');

  const result = await deps.surf.status({ from: SLUG });

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data).filter((key) => key !== 'localUiUrl').sort(),
    ['formatted', 'interactionBudget', 'preDreamDue', 'running', 'runs', 'surfBeforeDreamEnabled'],
  );
  assert.deepEqual(result.data.runs, []);
});

test('surf run: daemon-proxied envelope carries localUiUrl and keeps run fields', async (t) => {
  const { profileRoot, base } = await createTempProfileHome();
  const stub = await startStubDaemon({ '/api/surf/run': { runId: 'run-1' } });
  t.after(async () => stub.close());
  const deps = makeDependencies(profileRoot, base, stub.baseUrl);

  const result = await deps.surf.run({ from: SLUG, trigger: 'manual-chat' });

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data).filter((key) => key !== 'localUiUrl').sort(),
    ['runId', 'status', 'trigger'],
  );
  assert.equal(result.data.runId, 'run-1');
  assert.equal(result.data.trigger, 'manual-chat');
  assert.equal(result.data.localUiUrl, `${stub.baseUrl}/ui/surf?from=${SLUG}`);
  assert.deepEqual(stub.requests.map((request) => request.pathname), ['/api/surf/run']);
});

test('dream run: success envelope carries localUiUrl (empty-day path, no LLM)', async () => {
  const { profileRoot, base } = await createTempProfileHome();
  const deps = makeDependencies(profileRoot, base, 'http://127.0.0.1:10001');

  const result = await deps.dream.run({ from: SLUG, payload: {} });

  assert.equal(result.ok, true);
  assert.equal(result.data.kind, 'empty');
  assert.equal(result.data.localUiUrl, `http://127.0.0.1:10001/ui/dream?from=${SLUG}`);
});

test('schedule create + run: envelopes carry localUiUrl', async (t) => {
  const { profileRoot, base, paths } = await createTempProfileHome();
  await writeFakeLocalRuntime(paths);
  t.after(patchRegistryBackends('scheduled task output'));
  const deps = makeDependencies(profileRoot, base, 'http://127.0.0.1:10001');

  const created = await deps.schedule.create({
    from: SLUG,
    name: 'morning digest',
    prompt: 'Summarize yesterday.',
    schedule: { type: 'interval', intervalMs: 60000 },
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.task.name, 'morning digest');
  assert.equal(created.data.localUiUrl, `http://127.0.0.1:10001/ui/schedule?from=${SLUG}`);

  const run = await deps.schedule.run({ from: SLUG, id: created.data.task.id });
  assert.equal(run.ok, true);
  assert.equal(run.data.output, 'scheduled task output');
  assert.equal(run.data.localUiUrl, `http://127.0.0.1:10001/ui/schedule?from=${SLUG}`);
});

for (const verb of ['status', 'balance']) {
  test(`traffic ${verb}: envelope carries the owner-scoped /ui/traffic localUiUrl without a from query`, async (t) => {
    const { profileRoot, base } = await createTempProfileHome();
    const stub = await startStubDaemon({
      '/api/traffic/status': { mode: 'traffic' },
      '/api/traffic/balance': { account: null, featureUnavailable: false },
    });
    t.after(async () => stub.close());
    const deps = makeDependencies(profileRoot, base, stub.baseUrl);

    const result = verb === 'status'
      ? await deps.traffic.status()
      : await deps.traffic.balance();

    assert.equal(result.ok, true);
    assert.equal(result.data.localUiUrl, `${stub.baseUrl}/ui/traffic`);
    assert.equal(new URL(result.data.localUiUrl).search, '');
  });
}
