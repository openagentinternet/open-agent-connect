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

function createProfilePair(prefix) {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const aliceHome = path.join(systemHome, '.metabot', 'profiles', 'actor-alice');
  const bobHome = path.join(systemHome, '.metabot', 'profiles', 'actor-bob');
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  mkdirSync(aliceHome, { recursive: true });
  mkdirSync(bobHome, { recursive: true });
  mkdirSync(managerRoot, { recursive: true });
  const now = Date.now();
  writeFileSync(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        {
          name: 'actor-alice',
          slug: 'actor-alice',
          aliases: ['actor-alice', 'alice'],
          homeDir: aliceHome,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: now,
          updatedAt: now,
        },
        {
          name: 'actor-bob',
          slug: 'actor-bob',
          aliases: ['actor-bob', 'bob'],
          homeDir: bobHome,
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
    `${JSON.stringify({ homeDir: bobHome, updatedAt: now }, null, 2)}\n`,
    'utf8',
  );
  return { aliceHome, bobHome };
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

test('runCli dispatches `metabot config get --from` with actor selection', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runCli(['config', 'get', '--from', 'alice', 'chain.defaultWriteNetwork'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      config: {
        get: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: { key: input.key, value: 'mvc' },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice', key: 'chain.defaultWriteNetwork' }]);
});

test('runCli dispatches `metabot config set --from` with actor selection', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runCli(['config', 'set', '--from', 'alice', 'chain.defaultWriteNetwork', 'opcat'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      config: {
        set: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: { key: input.key, value: input.value },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice', key: 'chain.defaultWriteNetwork', value: 'opcat' }]);
});

test('runCli config --from reads and writes the selected profile config store', async () => {
  const { aliceHome, bobHome } = createProfilePair('metabot-cli-config-from-runtime-');

  const setResult = await runConfigCli(bobHome, ['config', 'set', '--from', 'actor-alice', 'chain.defaultWriteNetwork', 'opcat']);
  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);

  const aliceResult = await runConfigCli(bobHome, ['config', 'get', '--from', 'actor-alice', 'chain.defaultWriteNetwork']);
  assert.equal(aliceResult.exitCode, 0);
  assert.equal(aliceResult.payload.data.value, 'opcat');

  const bobResult = await runConfigCli(bobHome, ['config', 'get', 'chain.defaultWriteNetwork']);
  assert.equal(bobResult.exitCode, 0);
  assert.equal(bobResult.payload.data.value, 'mvc');

  const aliceConfig = JSON.parse(readFileSync(resolveMetabotPaths(aliceHome).configPath, 'utf8'));
  assert.equal(aliceConfig.chain.defaultWriteNetwork, 'opcat');
  const bobConfig = JSON.parse(readFileSync(resolveMetabotPaths(bobHome).configPath, 'utf8'));
  assert.equal(bobConfig.chain.defaultWriteNetwork, 'mvc');
});

test('runCli supports `metabot config get chain.defaultWriteNetwork`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-default-write-network-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'chain.defaultWriteNetwork']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'chain.defaultWriteNetwork',
    value: 'mvc',
  });
});

test('runCli supports `metabot config get chain.mvcSponsorUploadEnabled`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-mvc-sponsor-upload-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'chain.mvcSponsorUploadEnabled']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'chain.mvcSponsorUploadEnabled',
    value: true,
  });
});

test('runCli supports `metabot config set chain.defaultWriteNetwork opcat`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-default-write-network-');
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'chain.defaultWriteNetwork', 'opcat']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'chain.defaultWriteNetwork',
    value: 'opcat',
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'chain.defaultWriteNetwork']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, 'opcat');

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.chain.defaultWriteNetwork, 'opcat');
});

test('runCli supports `metabot config set chain.mvcSponsorUploadEnabled false`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-mvc-sponsor-upload-false-');
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'chain.mvcSponsorUploadEnabled', 'false']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'chain.mvcSponsorUploadEnabled',
    value: false,
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'chain.mvcSponsorUploadEnabled']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, false);

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.chain.mvcSponsorUploadEnabled, false);
});

test('runCli supports `metabot config set chain.mvcSponsorUploadEnabled true`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-mvc-sponsor-upload-true-');
  await runConfigCli(homeDir, ['config', 'set', 'chain.mvcSponsorUploadEnabled', 'false']);

  const setResult = await runConfigCli(homeDir, ['config', 'set', 'chain.mvcSponsorUploadEnabled', 'true']);
  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'chain.mvcSponsorUploadEnabled',
    value: true,
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'chain.mvcSponsorUploadEnabled']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, true);
});

test('runCli rejects unsupported chain.defaultWriteNetwork values', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-default-write-network-invalid-');
  const result = await runConfigCli(homeDir, ['config', 'set', 'chain.defaultWriteNetwork', 'eth']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.match(result.payload.message, /mvc, btc, doge, opcat/i);

  const configPath = resolveMetabotPaths(homeDir).configPath;
  assert.throws(() => readFileSync(configPath, 'utf8'), /ENOENT/);
});

test('runCli rejects retired Ask Master and evolution config keys', async () => {
  for (const [command, key, value] of [
    ['get', 'askMaster.enabled'],
    ['set', 'askMaster.enabled', 'false'],
    ['get', 'askMaster.triggerMode'],
    ['set', 'askMaster.triggerMode', 'manual'],
    ['get', 'evolution_network.enabled'],
    ['set', 'evolution_network.enabled', 'false'],
  ]) {
    const homeDir = createProfileHome('metabot-cli-config-retired-key-');
    const result = await runConfigCli(homeDir, ['config', command, key, ...(value ? [value] : [])]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.code, 'unsupported_config_key');
    assert.match(result.payload.message, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('runCli supports `metabot config get a2a.simplemsgListenerEnabled`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-get-a2a-listener-');
  const result = await runConfigCli(homeDir, ['config', 'get', 'a2a.simplemsgListenerEnabled']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data, {
    key: 'a2a.simplemsgListenerEnabled',
    value: true,
  });
});

test('runCli supports `metabot config set a2a.simplemsgListenerEnabled false`', async () => {
  const homeDir = createProfileHome('metabot-cli-config-set-a2a-listener-');
  const setResult = await runConfigCli(homeDir, ['config', 'set', 'a2a.simplemsgListenerEnabled', 'false']);

  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.ok, true);
  assert.deepEqual(setResult.payload.data, {
    key: 'a2a.simplemsgListenerEnabled',
    value: false,
  });

  const getResult = await runConfigCli(homeDir, ['config', 'get', 'a2a.simplemsgListenerEnabled']);
  assert.equal(getResult.exitCode, 0);
  assert.equal(getResult.payload.ok, true);
  assert.equal(getResult.payload.data.value, false);

  const configPath = resolveMetabotPaths(homeDir).configPath;
  const configFromDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(configFromDisk.a2a.simplemsgListenerEnabled, false);
});
