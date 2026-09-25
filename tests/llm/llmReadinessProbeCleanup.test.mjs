import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { watchTempRootPrefix } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { defaultRuntimeReadinessProbe } = require('../../dist/core/llm/llmRuntimeDiscovery.js');

const PROBE_HOME_PREFIX = 'oac-probe-home-';
const PROBE_CWD_PREFIX = 'oac-probe-cwd-';
const TEST_SCRATCH_PREFIX = 'oac-probe-test-';
const TIMEOUT_MS = 50;
const TIMEOUT_MESSAGE = `Readiness probe timed out after ${TIMEOUT_MS}ms.`;
const ABORT_GRACE_MARGIN_MS = 3_000;
// The probe creates its ephemeral home and working directory directly under
// os.tmpdir(); watch those prefixes so a deliberately failing assertion cannot
// leak them.
watchTempRootPrefix(PROBE_HOME_PREFIX);
watchTempRootPrefix(PROBE_CWD_PREFIX);
watchTempRootPrefix(TEST_SCRATCH_PREFIX);
// Copy source for the probe home: a missing path keeps the probe from reading
// the developer's real ~/.codex while leaving the probe home otherwise empty.
const PROBE_ENV = { CODEX_HOME: path.join(os.tmpdir(), 'nonexistent-codex-probe-source') };

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function listProbeHomes() {
  const entries = await readdir(os.tmpdir()).catch(() => []);
  return entries.filter((entry) => entry.startsWith(PROBE_HOME_PREFIX)).sort();
}

function codexRuntime() {
  const now = new Date().toISOString();
  return {
    id: 'llm_codex_probe_cleanup_test',
    provider: 'codex',
    displayName: 'Codex (OpenAI)',
    binaryPath: '/nonexistent/codex-probe-cleanup-test',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'detected',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

// `execute` receives the abort-aware handle so a stub can simulate a codex child
// that outlives the probe timeout and keeps writing into its CODEX_HOME.
function stubCodexBackend(execute) {
  const captured = { probeHome: undefined, probeHomeExisted: false, settled: undefined };
  return {
    captured,
    backendFactories: {
      codex: (binaryPath, env) => {
        captured.probeHome = env?.CODEX_HOME;
        return {
          provider: 'codex',
          execute(request, emitter, signal) {
            captured.settled = (async () => {
              captured.probeHomeExisted = await access(captured.probeHome).then(() => true, () => false);
              return execute({
                probeHome: captured.probeHome,
                emitter,
                waitForAbort: () => new Promise((resolve) => {
                  if (signal.aborted) {
                    resolve();
                    return;
                  }
                  signal.addEventListener('abort', () => resolve(), { once: true });
                }),
              });
            })();
            return captured.settled;
          },
        };
      },
    },
  };
}

function assertProbeRanAgainstEphemeralHome(stub) {
  assert.equal(stub.captured.probeHomeExisted, true, 'the probe must run codex against an existing CODEX_HOME');
  assert.equal(path.dirname(stub.captured.probeHome), os.tmpdir());
  assert.ok(stub.captured.probeHome.startsWith(path.join(os.tmpdir(), PROBE_HOME_PREFIX)));
}

test('defaultRuntimeReadinessProbe removes the ephemeral CODEX_HOME after an aborted codex child settles', async () => {
  const before = new Set(await listProbeHomes());
  const stub = stubCodexBackend(async ({ probeHome, waitForAbort }) => {
    await waitForAbort();
    // Aborted, but the child keeps working: it recreates its CODEX_HOME and
    // flushes a thread into it after the probe timeout already resolved.
    await wait(120);
    await mkdir(probeHome, { recursive: true });
    await writeFile(path.join(probeHome, 'session.jsonl'), '{}\n');
    await wait(80);
    return { status: 'cancelled', output: '', durationMs: 0 };
  });

  const result = await defaultRuntimeReadinessProbe(
    { runtime: codexRuntime(), env: PROBE_ENV, timeoutMs: TIMEOUT_MS },
    { backendFactories: stub.backendFactories },
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, TIMEOUT_MESSAGE);
  assertProbeRanAgainstEphemeralHome(stub);
  assert.deepEqual(await listProbeHomes(), [...before], 'no probe home may survive the probe result');

  await stub.captured.settled;
  assert.deepEqual(
    await listProbeHomes(),
    [...before],
    'a child that recreates its CODEX_HOME after the probe resolved must not leave it behind',
  );
});

test('defaultRuntimeReadinessProbe removes the ephemeral CODEX_HOME while the aborted child is still flushing', async () => {
  const before = new Set(await listProbeHomes());
  const stub = stubCodexBackend(async ({ probeHome, waitForAbort }) => {
    await waitForAbort();
    await writeFile(path.join(probeHome, 'flushing.jsonl'), '{}\n');
    await wait(60);
    return { status: 'cancelled', output: '', durationMs: 0 };
  });

  const result = await defaultRuntimeReadinessProbe(
    { runtime: codexRuntime(), env: PROBE_ENV, timeoutMs: TIMEOUT_MS },
    { backendFactories: stub.backendFactories },
  );

  assert.equal(result.message, TIMEOUT_MESSAGE);
  assertProbeRanAgainstEphemeralHome(stub);
  assert.deepEqual(await listProbeHomes(), [...before]);

  await stub.captured.settled;
  assert.deepEqual(await listProbeHomes(), [...before]);
});

test('defaultRuntimeReadinessProbe returns within the bounded abort grace when the codex child never settles', async () => {
  const before = new Set(await listProbeHomes());
  const stub = stubCodexBackend(async ({ waitForAbort }) => {
    await waitForAbort();
    return new Promise(() => {});
  });

  const startedAt = Date.now();
  const result = await defaultRuntimeReadinessProbe(
    { runtime: codexRuntime(), env: PROBE_ENV, timeoutMs: TIMEOUT_MS },
    { backendFactories: stub.backendFactories },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.message, TIMEOUT_MESSAGE);
  assert.ok(elapsedMs >= TIMEOUT_MS, `probe resolved before its timeout: ${elapsedMs}ms`);
  assert.ok(elapsedMs < ABORT_GRACE_MARGIN_MS, `probe blocked on a hung child: ${elapsedMs}ms`);
  assertProbeRanAgainstEphemeralHome(stub);
  assert.deepEqual(await listProbeHomes(), [...before]);
});

test('defaultRuntimeReadinessProbe removes the ephemeral CODEX_HOME after a successful codex turn', async () => {
  const before = new Set(await listProbeHomes());
  const stub = stubCodexBackend(async ({ emitter }) => {
    emitter.emit({ type: 'text', content: 'OK' });
    return { status: 'completed', output: 'OK', durationMs: 1 };
  });

  const result = await defaultRuntimeReadinessProbe(
    { runtime: codexRuntime(), env: PROBE_ENV, timeoutMs: 5_000 },
    { backendFactories: stub.backendFactories },
  );

  assert.deepEqual(result, { ok: true, output: 'OK' });
  assertProbeRanAgainstEphemeralHome(stub);
  assert.deepEqual(await listProbeHomes(), [...before]);
});

test('defaultRuntimeReadinessProbe removes the ephemeral CODEX_HOME when the codex backend fails', async () => {
  const before = new Set(await listProbeHomes());
  const stub = stubCodexBackend(async () => {
    throw new Error('codex app-server crashed');
  });

  const result = await defaultRuntimeReadinessProbe(
    { runtime: codexRuntime(), env: PROBE_ENV, timeoutMs: 5_000 },
    { backendFactories: stub.backendFactories },
  );

  assert.equal(result.ok, false);
  assert.equal(result.message, 'codex app-server crashed');
  assertProbeRanAgainstEphemeralHome(stub);
  assert.deepEqual(await listProbeHomes(), [...before]);
});

function stubBackend(provider, execute) {
  const captured = {};
  const backendFactories = {
    [provider]: (binaryPath, env) => {
      captured.env = env;
      return {
        provider,
        async execute(request) {
          captured.cwd = request.cwd;
          return execute({ captured, request });
        },
      };
    },
  };
  return { captured, backendFactories };
}

function runtimeFor(provider, id) {
  return { ...codexRuntime(), id, provider };
}

test('defaultRuntimeReadinessProbe isolates the claude-code probe home via CLAUDE_CONFIG_DIR', async () => {
  const sourceHome = await mkdtemp(path.join(os.tmpdir(), `${TEST_SCRATCH_PREFIX}src-`));
  await writeFile(path.join(sourceHome, 'settings.json'), '{"model":"sonnet"}');
  // .credentials.json intentionally absent: seeding is best-effort per file.
  const stub = stubBackend('claude-code', async ({ captured }) => {
    captured.settings = await readFile(path.join(captured.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')
      .catch(() => null);
    return { status: 'completed', output: 'OK', durationMs: 1 };
  });

  const result = await defaultRuntimeReadinessProbe(
    {
      runtime: runtimeFor('claude-code', 'llm_claude_probe_isolation_test'),
      env: { CLAUDE_CONFIG_DIR: sourceHome },
      timeoutMs: 5_000,
    },
    { backendFactories: stub.backendFactories },
  );

  assert.deepEqual(result, { ok: true, output: 'OK' });
  const probeHome = stub.captured.env.CLAUDE_CONFIG_DIR;
  assert.ok(probeHome.startsWith(path.join(os.tmpdir(), PROBE_HOME_PREFIX)));
  assert.notEqual(path.resolve(probeHome), path.resolve(sourceHome));
  assert.equal(stub.captured.settings, '{"model":"sonnet"}', 'seed files must be copied into the probe home');
  await assert.rejects(access(probeHome), 'probe home must be removed after the probe');
});

test('defaultRuntimeReadinessProbe runs the probe turn from an ephemeral cwd when none is given', async () => {
  const stub = stubBackend('gemini', async () => ({ status: 'completed', output: 'OK', durationMs: 1 }));

  const result = await defaultRuntimeReadinessProbe(
    {
      runtime: runtimeFor('gemini', 'llm_gemini_probe_ephemeral_cwd_test'),
      env: {},
      timeoutMs: 5_000,
    },
    { backendFactories: stub.backendFactories },
  );

  assert.deepEqual(result, { ok: true, output: 'OK' });
  const probeCwd = stub.captured.cwd;
  assert.ok(probeCwd?.startsWith(path.join(os.tmpdir(), PROBE_CWD_PREFIX)), `unexpected probe cwd: ${probeCwd}`);
  assert.notEqual(path.resolve(probeCwd), process.cwd(), 'the daemon cwd must not host probe sessions');
  await assert.rejects(access(probeCwd), 'probe cwd must be removed after the probe');
});

test('defaultRuntimeReadinessProbe keeps an explicit cwd and does not remove it', async () => {
  const explicitCwd = await mkdtemp(path.join(os.tmpdir(), `${TEST_SCRATCH_PREFIX}explicit-`));
  const stub = stubBackend('gemini', async () => ({ status: 'completed', output: 'OK', durationMs: 1 }));

  const result = await defaultRuntimeReadinessProbe(
    {
      runtime: runtimeFor('gemini', 'llm_gemini_probe_explicit_cwd_test'),
      env: {},
      timeoutMs: 5_000,
      cwd: explicitCwd,
    },
    { backendFactories: stub.backendFactories },
  );

  assert.deepEqual(result, { ok: true, output: 'OK' });
  assert.equal(path.resolve(stub.captured.cwd), path.resolve(explicitCwd));
  await access(explicitCwd);
});
