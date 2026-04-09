import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function createRuntimeEnv(homeDir) {
  return {
    ...process.env,
    HOME: homeDir,
    METABOT_HOME: homeDir,
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeEvolutionConfig(homeDir, config) {
  const configPath = path.join(homeDir, '.metabot', 'hot', 'config.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    evolution_network: config,
  }, null, 2), 'utf8');
}

test('runCli dispatches `metabot network services --online` and preserves the list envelope', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['network', 'services', '--online'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async (input) => {
          calls.push(input);
          return commandSuccess({
            services: [
              { servicePinId: 'service-weather', online: true },
            ],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ online: true }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      services: [
        { servicePinId: 'service-weather', online: true },
      ],
    },
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

test('runCli records execution and analysis when network-services evolution is enabled and a triggering response occurs', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-network-evolution-'));
  writeEvolutionConfig(homeDir, {
    enabled: true,
    autoAdoptSameSkillSameScope: true,
    autoRecordExecutions: true,
  });
  const stdout = [];

  const exitCode = await runCli(['network', 'services', '--online'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async () => commandFailed('network_unavailable', 'The chain directory query failed.'),
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(JSON.parse(stdout.join('').trim()).state, 'failed');

  const evolutionRoot = path.join(homeDir, '.metabot', 'evolution');
  const indexPath = path.join(evolutionRoot, 'index.json');
  assert.equal(existsSync(indexPath), true);

  const index = readJson(indexPath);
  assert.equal(index.executions.length, 1);
  assert.equal(index.analyses.length, 1);

  const executionPath = path.join(evolutionRoot, 'executions', `${index.executions[0]}.json`);
  const analysisPath = path.join(evolutionRoot, 'analyses', `${index.analyses[0]}.json`);
  const execution = readJson(executionPath);
  const analysis = readJson(analysisPath);

  assert.equal(execution.skillName, 'metabot-network-directory');
  assert.equal(execution.commandTemplate, 'metabot network services --online');
  assert.equal(analysis.skillName, 'metabot-network-directory');
  assert.equal(analysis.triggerSource, 'hard_failure');
  assert.equal(analysis.shouldGenerateCandidate, true);
});

test('runCli records execution bookkeeping for default evolution config on success', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-network-evolution-default-'));
  const stdout = [];

  const exitCode = await runCli(['network', 'services', '--online'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async () => commandSuccess({
          services: [
            {
              servicePinId: 'service-weather',
              providerGlobalMetaId: 'provider-123',
              online: true,
            },
          ],
        }),
      },
    },
  });

  assert.equal(exitCode, 0);

  const evolutionRoot = path.join(homeDir, '.metabot', 'evolution');
  const indexPath = path.join(evolutionRoot, 'index.json');
  assert.equal(existsSync(indexPath), true);

  const index = readJson(indexPath);
  assert.equal(index.executions.length, 1);
  assert.equal(index.analyses.length, 0);
  assert.equal(index.artifacts.length, 0);

  const executionDir = path.join(evolutionRoot, 'executions');
  const executionFiles = readdirSync(executionDir);
  assert.equal(executionFiles.length, 1);
  const execution = readJson(path.join(executionDir, executionFiles[0]));
  assert.equal(execution.commandTemplate, 'metabot network services --online');
  assert.equal(execution.envelope.data.services[0].servicePinId, 'service-weather');

  assert.deepEqual(readdirSync(path.join(evolutionRoot, 'analyses')), []);
  assert.deepEqual(readdirSync(path.join(evolutionRoot, 'artifacts')), []);
});

test('runCli writes no evolution side effects when network-services evolution is disabled', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-network-evolution-disabled-'));
  writeEvolutionConfig(homeDir, {
    enabled: false,
    autoAdoptSameSkillSameScope: true,
    autoRecordExecutions: true,
  });

  const exitCode = await runCli(['network', 'services', '--online'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async () => commandFailed('network_unavailable', 'The chain directory query failed.'),
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'index.json')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'executions')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'analyses')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'artifacts')), false);
});

test('runCli writes no evolution side effects when autoRecordExecutions is false', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-network-evolution-no-record-'));
  writeEvolutionConfig(homeDir, {
    enabled: true,
    autoAdoptSameSkillSameScope: true,
    autoRecordExecutions: false,
  });

  const exitCode = await runCli(['network', 'services', '--online'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      network: {
        listServices: async () => commandFailed('network_unavailable', 'The chain directory query failed.'),
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'index.json')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'executions')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'analyses')), false);
  assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'artifacts')), false);
});

test('runCli does not treat waiting/manual_action_required network responses as hard failures for evolution', async () => {
  const cases = [
    {
      name: 'waiting',
      expectedExitCode: 2,
      response: () => commandWaiting('network_pending', 'Waiting for remote directory sync.', 500),
    },
    {
      name: 'manual_action_required',
      expectedExitCode: 2,
      response: () => commandManualActionRequired('network_ui_required', 'Open UI to complete provider auth.'),
    },
  ];

  for (const testCase of cases) {
    const homeDir = mkdtempSync(path.join(tmpdir(), `metabot-cli-network-evolution-${testCase.name}-`));
    writeEvolutionConfig(homeDir, {
      enabled: true,
      autoAdoptSameSkillSameScope: true,
      autoRecordExecutions: true,
    });

    const exitCode = await runCli(['network', 'services', '--online'], {
      env: createRuntimeEnv(homeDir),
      cwd: homeDir,
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies: {
        network: {
          listServices: async () => testCase.response(),
        },
      },
    });

    assert.equal(exitCode, testCase.expectedExitCode);
    assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'index.json')), false);
    assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'executions')), false);
    assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'analyses')), false);
    assert.equal(existsSync(path.join(homeDir, '.metabot', 'evolution', 'artifacts')), false);
  }
});
