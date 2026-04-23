import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

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
  const homeDir = createProfileHome('metabot-cli-config-get-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'evolution_network.enabled']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'evolution_network.enabled',
    value: true,
  });
});

test('runCli supports `metabot config set evolution_network.enabled false`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-');
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

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.evolution_network.enabled, false);
});

test('runCli supports `metabot config get askMaster.enabled`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-ask-master-enabled-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'askMaster.enabled']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'askMaster.enabled',
    value: true,
  });
});

test('runCli supports `metabot config set askMaster.enabled false`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-ask-master-enabled-');
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'askMaster.enabled', 'false']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'askMaster.enabled',
    value: false,
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'askMaster.enabled']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, false);

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.askMaster.enabled, false);
});

test('runCli supports `metabot config get askMaster.triggerMode`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-ask-master-trigger-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'askMaster.triggerMode']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'askMaster.triggerMode',
    value: 'suggest',
  });
});

test('runCli public config get migrates legacy askMaster.triggerMode auto back to suggest', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-ask-master-trigger-legacy-auto-');
  const configPath = resolveMetabotPaths(homeDir).configPath;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true,
    },
    askMaster: {
      enabled: true,
      triggerMode: 'auto',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
      autoPolicy: {
        minConfidence: 0.9,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 1,
        globalCooldownMs: 1_800_000,
        allowTrustedAutoSend: false,
      },
    },
  }, null, 2)}\n`, 'utf8');

  const result = await runConfigCli(homeDir, ['config', 'get', 'askMaster.triggerMode']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'askMaster.triggerMode',
    value: 'suggest',
  });
});

test('runCli supports `metabot config set askMaster.triggerMode manual`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-ask-master-trigger-');
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'askMaster.triggerMode', 'manual']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'askMaster.triggerMode',
    value: 'manual',
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'askMaster.triggerMode']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, 'manual');

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.askMaster.triggerMode, 'manual');
});

test('runCli rejects public `metabot config set askMaster.triggerMode auto`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-ask-master-trigger-auto-');
  const result = await runConfigCli(homeDir, ['config', 'set', 'askMaster.triggerMode', 'auto']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.match(result.payload.message, /must be one of `manual` or `suggest`/i);

  const configPath = resolveMetabotPaths(homeDir).configPath;
  assert.throws(() => readFileSync(configPath, 'utf8'), /ENOENT/);
});
