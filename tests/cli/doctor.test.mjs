import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const {
  commandSuccess,
} = require('../../dist/core/contracts/commandResult.js');
const pkg = require('../../package.json');

function createHarness() {
  const stdout = [];
  const stderr = [];
  const calls = {
    daemon: [],
    doctor: [],
    identity: [],
    identityWho: [],
    identityList: [],
    identityAssign: [],
    trace: [],
    ui: [],
  };

  return {
    calls,
    stdout,
    stderr,
    context: {
      env: {
        ...process.env,
        HOME: '/tmp/metabot-cli-doctor-test-home',
      },
      cwd: '/tmp/metabot-cli-doctor-test-home',
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
      dependencies: {
        daemon: {
          start: async () => {
            calls.daemon.push({ command: 'start' });
            return commandSuccess({
              host: '127.0.0.1',
              port: 4827,
              baseUrl: 'http://127.0.0.1:4827',
            });
          },
        },
        doctor: {
          run: async () => {
            calls.doctor.push({ command: 'doctor' });
            return commandSuccess({
              checks: [
                { code: 'daemon_reachable', ok: true },
                { code: 'identity_loaded', ok: false },
              ],
            });
          },
        },
        identity: {
          create: async (input) => {
            calls.identity.push(input);
            return commandSuccess({
              name: input.name,
              globalMetaId: 'gm-alice',
            });
          },
          who: async () => {
            calls.identityWho.push({ command: 'who' });
            return commandSuccess({
              activeHomeDir: '/tmp/home-a',
              identity: {
                name: 'Alice',
                globalMetaId: 'gm-alice',
              },
            });
          },
          list: async () => {
            calls.identityList.push({ command: 'list' });
            return commandSuccess({
              activeHomeDir: '/tmp/home-a',
              profiles: [
                {
                  name: 'Alice',
                  homeDir: '/tmp/home-a',
                  globalMetaId: 'gm-alice',
                },
              ],
            });
          },
          assign: async (input) => {
            calls.identityAssign.push(input);
            return commandSuccess({
              activeHomeDir: '/tmp/home-b',
              assignedProfile: {
                name: input.name,
                homeDir: '/tmp/home-b',
                globalMetaId: 'gm-bob',
              },
            });
          },
        },
        trace: {
          get: async (input) => {
            calls.trace.push(input);
            return commandSuccess({
              traceId: input.traceId,
              status: 'completed',
            });
          },
        },
        ui: {
          open: async (input) => {
            calls.ui.push(input);
            return commandSuccess({
              page: input.page,
              localUiUrl: input.traceId
                ? `/ui/${input.page}?traceId=${encodeURIComponent(input.traceId)}`
                : `/ui/${input.page}`,
            });
          },
        },
      },
    },
  };
}

function parseLastJson(chunks) {
  return JSON.parse(chunks.join('').trim());
}

test('runCli dispatches `metabot daemon start` and prints machine-first JSON', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['daemon', 'start'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.daemon, [{ command: 'start' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      host: '127.0.0.1',
      port: 4827,
      baseUrl: 'http://127.0.0.1:4827',
    },
  });
});

test('runCli dispatches `metabot doctor` and preserves the doctor envelope', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['doctor'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.doctor, [{ command: 'doctor' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      version: pkg.version,
      checks: [
        { code: 'daemon_reachable', ok: true },
        { code: 'identity_loaded', ok: false },
        {
          code: 'canonical_cli_shim_preferred',
          ok: true,
          canonicalShimPath: null,
        },
      ],
    },
  });
});

test('runCli dispatches `metabot identity create --name` with the provided MetaBot name', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['identity', 'create', '--name', 'Alice'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.identity, [{ name: 'Alice' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      name: 'Alice',
      globalMetaId: 'gm-alice',
    },
  });
});

test('runCli dispatches `metabot identity who` and returns the active identity envelope', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['identity', 'who'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.identityWho, [{ command: 'who' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      activeHomeDir: '/tmp/home-a',
      identity: {
        name: 'Alice',
        globalMetaId: 'gm-alice',
      },
    },
  });
});

test('runCli dispatches `metabot identity list` and returns known local profiles', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['identity', 'list'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.identityList, [{ command: 'list' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      activeHomeDir: '/tmp/home-a',
      profiles: [
        {
          name: 'Alice',
          homeDir: '/tmp/home-a',
          globalMetaId: 'gm-alice',
        },
      ],
    },
  });
});

test('runCli dispatches `metabot identity assign --name` and returns the assigned profile', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['identity', 'assign', '--name', 'Bob'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.identityAssign, [{ name: 'Bob' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      activeHomeDir: '/tmp/home-b',
      assignedProfile: {
        name: 'Bob',
        homeDir: '/tmp/home-b',
        globalMetaId: 'gm-bob',
      },
    },
  });
});

test('runCli dispatches `metabot trace get --trace-id` and returns the trace envelope', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['trace', 'get', '--trace-id', 'trace-123'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.trace, [{ traceId: 'trace-123' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      traceId: 'trace-123',
      status: 'completed',
    },
  });
});

test('runCli dispatches `metabot ui open --page` and returns the local UI URL', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['ui', 'open', '--page', 'hub'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.ui, [{ page: 'hub' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      page: 'hub',
      localUiUrl: '/ui/hub',
    },
  });
});

test('runCli dispatches `metabot ui open --page trace --trace-id` and returns the trace inspector URL', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['ui', 'open', '--page', 'trace', '--trace-id', 'trace-123'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.ui, [{ page: 'trace', traceId: 'trace-123' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      page: 'trace',
      localUiUrl: '/ui/trace?traceId=trace-123',
    },
  });
});

test('runCli doctor fails closed when no active profile is initialized', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(['doctor'], {
    env: {
      ...process.env,
      HOME: systemHome,
      METABOT_TEST_FAKE_CHAIN_WRITE: '1',
      METABOT_TEST_FAKE_SUBSIDY: '1',
      METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    },
    cwd: systemHome,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join(''), /^$/);
  assert.deepEqual(parseLastJson(stdout), {
    ok: false,
    state: 'failed',
    code: 'cli_execution_failed',
    message: 'No active profile initialized.',
  });
});

test('runCli doctor rejects an explicit orphan METABOT_HOME that is not manager-indexed', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const orphanHome = path.join(systemHome, '.metabot', 'profiles', 'orphan-profile');
  const stdout = [];
  const stderr = [];

  await mkdir(orphanHome, { recursive: true });

  const exitCode = await runCli(['doctor'], {
    env: {
      ...process.env,
      HOME: systemHome,
      METABOT_HOME: orphanHome,
      METABOT_TEST_FAKE_CHAIN_WRITE: '1',
      METABOT_TEST_FAKE_SUBSIDY: '1',
      METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    },
    cwd: systemHome,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join(''), /^$/);
  assert.match(parseLastJson(stdout).message, /manager-indexed profile|unindexed profile/i);
});
