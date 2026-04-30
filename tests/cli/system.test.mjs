import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function deriveSystemHome(homeDir) {
  const normalizedHomeDir = path.resolve(homeDir);
  const profilesRoot = path.dirname(normalizedHomeDir);
  const metabotRoot = path.dirname(profilesRoot);
  if (path.basename(profilesRoot) === 'profiles' && path.basename(metabotRoot) === '.metabot') {
    return path.dirname(metabotRoot);
  }
  return normalizedHomeDir;
}

async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  const now = Date.now();
  await fs.writeFile(
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
  await fs.writeFile(
    path.join(managerRoot, 'active-home.json'),
    `${JSON.stringify({ homeDir, updatedAt: now }, null, 2)}\n`,
    'utf8',
  );
  return { homeDir, systemHome };
}

function createRuntimeEnv(homeDir, overrides = {}) {
  return {
    ...process.env,
    HOME: deriveSystemHome(homeDir),
    METABOT_HOME: homeDir,
    ...overrides,
  };
}

async function runSystemCli(homeDir, args, options = {}) {
  const stdout = [];
  const stderr = [];
  const exitCode = await runCli(args, {
    env: createRuntimeEnv(homeDir, options.envOverrides),
    cwd: homeDir,
    dependencies: options.dependencies,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });
  return {
    exitCode,
    payload: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
    stderr: stderr.join(''),
  };
}

async function withMockFetch(mockImpl, run) {
  const originalFetch = global.fetch;
  global.fetch = mockImpl;
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
  }
}

test('runCli routes `metabot system update` with parsed flags to dependency handler', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  let capturedInput = null;
  const result = await runSystemCli(
    homeDir,
    ['system', 'update', '--host', 'codex', '--target-version', 'v0.2.1', '--dry-run'],
    {
      dependencies: {
        system: {
          update: async (input) => {
            capturedInput = input;
            return { ok: true, state: 'success', data: { outcome: 'no_update' } };
          },
        },
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(capturedInput, {
    host: 'codex',
    version: 'v0.2.1',
    dryRun: true,
  });
});

test('runCli rejects unsupported host for `metabot system update`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-invalid-host-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const result = await runSystemCli(homeDir, ['system', 'update', '--host', 'unknown']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.code, 'invalid_argument');
});

test('runCli rejects `metabot system uninstall --confirm-token` without --all', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-uninstall-token-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const result = await runSystemCli(
    homeDir,
    ['system', 'uninstall', '--confirm-token', 'DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS'],
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.code, 'invalid_argument');
});

test('runCli returns manual_action_required when `metabot system uninstall --all` is missing confirmation token', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-uninstall-confirm-needed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const result = await runSystemCli(homeDir, ['system', 'uninstall', '--all']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.state, 'manual_action_required');
  assert.equal(result.payload.code, 'confirmation_required');
});

test('runCli rejects invalid full-erase token for `metabot system uninstall --all`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-uninstall-invalid-token-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const result = await runSystemCli(
    homeDir,
    ['system', 'uninstall', '--all', '--confirm-token', 'WRONG_TOKEN'],
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.code, 'invalid_confirmation_token');
});

test('runCli safe uninstall removes guarded symlinks and keeps profiles', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-uninstall-safe-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const hostSkillRoot = path.join(systemHome, '.codex', 'skills');
  await fs.mkdir(hostSkillRoot, { recursive: true });
  const guarded = path.join(hostSkillRoot, 'metabot-identity-manage');
  const unguarded = path.join(hostSkillRoot, 'metabot-custom');
  await fs.symlink(path.join(systemHome, '.metabot', 'skills', 'metabot-identity-manage'), guarded);
  await fs.symlink(path.join(systemHome, '.other', 'skills', 'metabot-custom'), unguarded);

  const cliShimPath = path.join(systemHome, '.metabot', 'bin', 'metabot');
  await fs.mkdir(path.dirname(cliShimPath), { recursive: true });
  await fs.writeFile(cliShimPath, '#!/usr/bin/env bash\necho shim\n', 'utf8');

  const result = await runSystemCli(homeDir, ['system', 'uninstall']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.tier, 'safe');
  assert.equal(result.payload.data.preservedSensitiveData, true);

  const profilesStat = await fs.stat(path.join(systemHome, '.metabot', 'profiles'));
  assert.equal(profilesStat.isDirectory(), true);
  await assert.rejects(fs.lstat(guarded), { code: 'ENOENT' });
  const unguardedStat = await fs.lstat(unguarded);
  assert.equal(unguardedStat.isSymbolicLink(), true);
});

test('runCli update without host fails when multiple installpacks exist', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-ambiguous-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  await fs.mkdir(path.join(systemHome, '.metabot', 'installpacks', 'codex'), { recursive: true });
  await fs.mkdir(path.join(systemHome, '.metabot', 'installpacks', 'claude-code'), { recursive: true });
  const result = await runSystemCli(homeDir, ['system', 'update', '--dry-run']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.code, 'update_host_ambiguous');
});

test('runCli update without host fails when no installpack is found', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-unresolved-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const result = await runSystemCli(homeDir, ['system', 'update', '--dry-run']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.code, 'update_host_unresolved');
});

test('runCli update maps non-200 download response to download_failed', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-download-failed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await withMockFetch(
    async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    async () => runSystemCli(homeDir, ['system', 'update', '--host', 'codex']),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'download_failed');
});

test('runCli update maps invalid archive/install failure to install_failed', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-system-update-install-failed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const invalidArchive = Buffer.from('this-is-not-a-valid-tar-gz-archive', 'utf8');
  const result = await withMockFetch(
    async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => invalidArchive.buffer.slice(
        invalidArchive.byteOffset,
        invalidArchive.byteOffset + invalidArchive.byteLength,
      ),
    }),
    async () => runSystemCli(homeDir, ['system', 'update', '--host', 'codex']),
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'install_failed');
});

