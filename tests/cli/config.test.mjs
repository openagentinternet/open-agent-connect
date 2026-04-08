import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function createRuntimeEnv(homeDir) {
  return {
    ...process.env,
    HOME: homeDir,
    METABOT_HOME: homeDir,
  };
}

async function runConfigCli(homeDir, args) {
  const stdout = [];
  const exitCode = await runCli(args, {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  return {
    exitCode,
    payload: JSON.parse(stdout.join('').trim()),
  };
}

test('runCli supports `metabot config get evolution_network.enabled`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-config-get-'));
  const result = await runConfigCli(homeDir, ['config', 'get', 'evolution_network.enabled']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'evolution_network.enabled',
    value: true,
  });
});

test('runCli supports `metabot config set evolution_network.enabled false`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-config-set-'));
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'evolution_network.enabled', 'false']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'evolution_network.enabled',
    value: false,
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'evolution_network.enabled']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, false);

  const configPath = path.join(homeDir, '.metabot', 'hot', 'config.json');
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.evolution_network.enabled, false);
});
