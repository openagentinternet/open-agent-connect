import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const {
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  commandWaiting,
} = require('../../dist/core/contracts/commandResult.js');

function deriveSystemHome(homeDir) {
  const normalizedHomeDir = path.resolve(homeDir);
  const profilesRoot = path.dirname(normalizedHomeDir);
  const metabotRoot = path.dirname(profilesRoot);
  if (path.basename(profilesRoot) === 'profiles' && path.basename(metabotRoot) === '.metabot') {
    return path.dirname(metabotRoot);
  }
  return normalizedHomeDir;
}

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(managerRoot, { recursive: true });
  const now = Date.now();
  writeFileSync(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        {
          name: slug,
          slug,
          aliases: [slug, slug.replace(/-/g, ' ')],
          homeDir,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(managerRoot, 'active-home.json'),
    `${JSON.stringify({ homeDir, updatedAt: now }, null, 2)}\n`,
    'utf8',
  );
  return homeDir;
}

function createRuntimeEnv(homeDir) {
  return {
    ...process.env,
    HOME: deriveSystemHome(homeDir),
    METABOT_HOME: homeDir,
  };
}


test('runCli dispatches `metabot network services --online` and renders a markdown table', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'services', '--online'], {
    stdout: { isTTY: true, write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async (input) => {
          calls.push(input);
          return commandSuccess({
            services: [
              {
                servicePinId: 'service-weather',
                serviceName: 'weather',
                displayName: 'Weather Service',
                providerGlobalMetaId: 'idq1provider',
                providerName: 'WeatherBot',
                lastSeenAgoSeconds: 5,
                online: true,
              },
            ],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ online: true }]);
  const output = stdout.join('');
  assert.ok(output.includes('| # | service | provider | price | Last Seen |'), 'has table header');
  assert.ok(output.includes('| 1 | Weather Service | WeatherBot(idq1provider) |'), 'has service row with provider name');
  assert.ok(output.includes('5s 🟢 |'), 'has last seen');
});

test('runCli forwards network service query search text', async () => {
  const calls = [];

  const exitCode = await runCli(['network', 'services', '--online', '--query', 'tarot tomorrow fortune'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async (input) => {
          calls.push(input);
          return commandSuccess({ services: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ online: true, query: 'tarot tomorrow fortune' }]);
});

test('runCli forwards cache-only network service search', async () => {
  const calls = [];

  const exitCode = await runCli(['network', 'services', '--cached', '--online', '--query', 'tarot tomorrow fortune'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async (input) => {
          calls.push(input);
          return commandSuccess({ services: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ online: true, query: 'tarot tomorrow fortune', cached: true }]);
});

test('runCli network services does not create retired evolution state side effects', async () => {
  const homeDir = createProfileHome('metabot-cli-network-retired-evolution-');

  const exitCode = await runCli(['network', 'services', '--online'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async () => commandSuccess({ services: [] }),
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(existsSync(path.join(homeDir, '.runtime', 'evolution')), false);
});

test('runCli dispatches `metabot network bots --online --limit` and renders a markdown table', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'bots', '--online', '--limit', '10'], {
    stdout: { isTTY: true, write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listBots: async (input) => {
          calls.push(input);
          return commandSuccess({
            source: 'socket_presence',
            total: 1,
            bots: [
              {
                globalMetaId: 'idq1onlinebot',
                name: 'TestBot',
                goal: 'help users',
                lastSeenAgoSeconds: 12,
                deviceCount: 1,
              },
            ],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ online: true, limit: 10 }]);
  const output = stdout.join('');
  assert.ok(output.includes('| # | name | globalmetaid | bio | Last Seen |'), 'has table header');
  assert.ok(output.includes('| 1 | TestBot | idq1onlinebot | help users | 12s 🟢 |'), 'has bot row');
});

test('runCli rejects `metabot network bots --limit` when value is not a positive integer', async () => {
  const stdout = [];

  const exitCode = await runCli(['network', 'bots', '--online', '--limit', 'abc'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listBots: async () => commandSuccess({ bots: [] }),
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: false,
    state: 'failed',
    code: 'invalid_flag',
    message: 'Unsupported --limit value: abc. Supported range: 1-100.',
  });
});

test('runCli dispatches `metabot network sources add --base-url --label` with parsed source input', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'sources', 'add', '--base-url', 'http://127.0.0.1:4827', '--label', 'weather-demo'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        addSource: async (input) => {
          calls.push(input);
          return commandSuccess({
            baseUrl: input.baseUrl,
            label: input.label,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:4827',
    label: 'weather-demo',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      baseUrl: 'http://127.0.0.1:4827',
      label: 'weather-demo',
    },
  });
});

test('runCli dispatches `metabot network sources list` and preserves the source list envelope', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'sources', 'list'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listSources: async () => {
          calls.push({ command: 'list' });
          return commandSuccess({
            sources: [
              { baseUrl: 'http://127.0.0.1:4827', label: 'weather-demo' },
            ],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ command: 'list' }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      sources: [
        { baseUrl: 'http://127.0.0.1:4827', label: 'weather-demo' },
      ],
    },
  });
});

test('runCli dispatches `metabot network sources remove --base-url` with parsed source input', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'sources', 'remove', '--base-url', 'http://127.0.0.1:4827'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        removeSource: async (input) => {
          calls.push(input);
          return commandSuccess({
            removed: true,
            baseUrl: input.baseUrl,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    baseUrl: 'http://127.0.0.1:4827',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      removed: true,
      baseUrl: 'http://127.0.0.1:4827',
    },
  });
});
