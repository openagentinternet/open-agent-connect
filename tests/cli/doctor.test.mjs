import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

function createHarness(options = {}) {
  const homeDir = options.homeDir ?? '/tmp/metabot-cli-doctor-test-home';
  const stdout = [];
  const stderr = [];
  const calls = {
    browser: [],
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
        HOME: homeDir,
        ...options.env,
      },
      cwd: homeDir,
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
      dependencies: {
        browser: {
          open: async (input) => {
            calls.browser.push(input);
            return commandSuccess({
              localUiUrl: input.uri
                ? `/browser?uri=${encodeURIComponent(input.uri)}`
                : '/browser',
            });
          },
        },
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
              localUiUrl: (() => {
                const query = new URLSearchParams();
                if (input.from) query.set('from', input.from);
                if (input.traceId) query.set('traceId', input.traceId);
                const suffix = query.size ? `?${query.toString()}` : '';
                return `/ui/${input.page}${suffix}`;
              })(),
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

test('runCli doctor reports when the invoked CLI entry differs from the canonical shim target', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-doctor-entry-'));
  const canonicalShimPath = path.join(homeDir, '.metabot', 'bin', 'metabot');
  const canonicalTargetPath = path.join(homeDir, 'dev-worktree', 'dist', 'cli', 'main.js');
  const currentEntryPath = '/opt/homebrew/lib/node_modules/open-agent-connect/dist/cli/main.js';
  await mkdir(path.dirname(canonicalShimPath), { recursive: true });
  await writeFile(
    canonicalShimPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `exec "$NODE_BIN" ${JSON.stringify(canonicalTargetPath)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );

  const harness = createHarness({
    homeDir,
    env: {
      METABOT_CLI_CURRENT_ENTRY_PATH: currentEntryPath,
    },
  });
  const exitCode = await runCli(['doctor'], harness.context);

  assert.equal(exitCode, 0);
  const payload = parseLastJson(harness.stdout);
  assert.deepEqual(
    payload.data.checks.find((check) => check.code === 'cli_runtime_matches_canonical_shim'),
    {
      code: 'cli_runtime_matches_canonical_shim',
      ok: false,
      canonicalShimPath,
      canonicalTargetPath,
      currentEntryPath,
    },
  );
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

test('runCli dispatches `metabot browser open` and returns the browser url', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'open'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.browser, [{}]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      localUiUrl: '/browser',
    },
  });
});

test('runCli dispatches `metabot browser open --uri` and encodes the resource uri', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'open', '--uri', 'metaid://idq1alice'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.browser, [{ uri: 'metaid://idq1alice' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      localUiUrl: '/browser?uri=metaid%3A%2F%2Fidq1alice',
    },
  });
});

test('runCli dispatches provider console `metabot ui open --page` values', async () => {
  for (const page of ['conversations', 'services', 'settings']) {
    const harness = createHarness();
    const exitCode = await runCli(['ui', 'open', '--page', page, '--from', 'alice'], harness.context);

    assert.equal(exitCode, 0);
    assert.deepEqual(harness.calls.ui, [{ page, from: 'alice' }]);
    assert.deepEqual(parseLastJson(harness.stdout), {
      ok: true,
      state: 'success',
      data: {
        page,
        localUiUrl: `/ui/${page}?from=alice`,
      },
    });
  }
});

test('runCli rejects unknown browser subcommands before opening', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'unknown'], harness.context);

  assert.equal(exitCode, 1);
  assert.deepEqual(harness.calls.browser, []);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: false,
    state: 'failed',
    code: 'unknown_command',
    message: 'Unknown command: browser unknown',
  });
});

test('runCli rejects `metabot browser open --uri` without a non-empty value', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['browser', 'open', '--uri'], harness.context);

  assert.equal(exitCode, 1);
  assert.deepEqual(harness.calls.browser, []);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: false,
    state: 'failed',
    code: 'invalid_flag',
    message: 'Missing value for --uri.',
  });
});

test('runCli rejects unknown and retired `metabot ui open --page` values before opening', async () => {
  for (const page of ['unknown', 'chat-viewer']) {
    const harness = createHarness();
    const exitCode = await runCli(['ui', 'open', '--page', page], harness.context);

    assert.equal(exitCode, 1);
    assert.deepEqual(harness.calls.ui, []);
    assert.deepEqual(parseLastJson(harness.stdout), {
      ok: false,
      state: 'failed',
      code: 'unknown_ui_page',
      message: `Unknown UI page: ${page}`,
    });
  }
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

test('runCli dispatches `metabot ui open --page loom --from` and forwards the actor URL', async () => {
  const harness = createHarness();
  const exitCode = await runCli(['ui', 'open', '--page', 'loom', '--from', 'eric'], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.ui, [{ page: 'loom', from: 'eric' }]);
  assert.deepEqual(parseLastJson(harness.stdout), {
    ok: true,
    state: 'success',
    data: {
      page: 'loom',
      localUiUrl: '/ui/loom?from=eric',
    },
  });
});

test('runCli dispatches `metabot ui open` with actor, session, and service selectors', async () => {
  const harness = createHarness();
  const exitCode = await runCli([
    'ui',
    'open',
    '--page',
    'trace',
    '--from',
    'alice',
    '--trace-id',
    'trace-123',
    '--session-id',
    'session-123',
    '--service-id',
    'svc-123',
  ], harness.context);

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.calls.ui, [{
    page: 'trace',
    from: 'alice',
    traceId: 'trace-123',
    sessionId: 'session-123',
    serviceId: 'svc-123',
  }]);
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
