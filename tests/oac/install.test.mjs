import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { runOac } = require('../../dist/oac/main.js');
const execFile = promisify(execFileCallback);

async function createSystemHome(prefix) {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return { systemHome };
}

function createRuntimeEnv(systemHome, overrides = {}) {
  return {
    ...process.env,
    HOME: systemHome,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runOacCli(systemHome, args, envOverrides = {}) {
  const stdout = [];
  const stderr = [];
  const exitCode = await runOac(args, {
    env: createRuntimeEnv(systemHome, envOverrides),
    cwd: systemHome,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    payload: stdout.length && stdout.join('').trim().startsWith('{') ? JSON.parse(stdout.join('').trim()) : null,
  };
}

async function assertSymlinkPointsTo(entryPath, targetPath) {
  const stat = await fs.lstat(entryPath);
  assert.equal(stat.isSymbolicLink(), true);
  const resolved = await fs.readlink(entryPath);
  assert.equal(path.resolve(path.dirname(entryPath), resolved), targetPath);
}

async function writeRecordingNodeShim(nodePath, logPath) {
  await fs.writeFile(
    nodePath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [ "${1:-}" = "-p" ]; then',
      '  printf "%s\\n" "22"',
      '  exit 0',
      'fi',
      `printf '%s\\n' "$0" > ${JSON.stringify(logPath)}`,
      `printf '%s\\n' "$@" >> ${JSON.stringify(logPath)}`,
      `exec ${JSON.stringify(process.execPath)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(nodePath, 0o755);
}

test('runOac help shows primary bare install flow and registry platform host list', async (t) => {
  const { systemHome } = await createSystemHome('oac-help-platforms-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['--help']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /oac install/);
  assert.match(result.stdout, /oac doctor/);
  assert.match(result.stdout, /uninstall\s+Remove OAC shim/);
  assert.match(result.stdout, /oac install --host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro\|trae\|codebuddy>/);
});

test('runOac installs shared skills, metabot shim, and codex host bindings for an explicit host', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-codex-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'codex']);

  const sharedSkillPath = path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master');
  const sharedSkillFile = path.join(sharedSkillPath, 'SKILL.md');
  const metabotShimPath = path.join(systemHome, '.metabot', 'bin', 'metabot');
  const hostSkillPath = path.join(systemHome, '.codex', 'skills', 'metabot-ask-master');
  const evalsPath = path.join(
    systemHome,
    '.metabot',
    'skills',
    'metabot-call-remote-service',
    'evals',
    'evals.json',
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'codex');
  assert.equal(result.payload.data.metabotShimPath, metabotShimPath);
  assert.ok(result.payload.data.installedSkills.includes('metabot-ask-master'));
  assert.ok(result.payload.data.boundRoots.some((root) =>
    root.platformId === 'codex'
      && root.status === 'bound'
      && root.boundSkills.includes('metabot-ask-master')
  ));

  assert.equal(await fs.readFile(sharedSkillFile, 'utf8').then((body) => body.includes('metabot master ask')), true);
  const shim = await fs.readFile(metabotShimPath, 'utf8');
  assert.match(shim, /dist\/cli\/main\.js/);
  assert.match(shim, /METABOT_NODE/);
  assert.match(shim, /node@22/);
  assert.match(shim, /Node\.js >=20 <25/);
  assert.match(shim, /exec "\$NODE_BIN"/);
  assert.doesNotMatch(shim, /exec node /);
  await assertSymlinkPointsTo(hostSkillPath, sharedSkillPath);
  await assert.rejects(fs.stat(evalsPath), { code: 'ENOENT' });
});

test('installed metabot shim uses METABOT_NODE instead of the ambient node command', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-metabot-node-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'codex']);
  assert.equal(result.exitCode, 0);

  const fakeNodePath = path.join(systemHome, 'fake-node22');
  const fakeNodeLog = path.join(systemHome, 'fake-node22.log');
  await writeRecordingNodeShim(fakeNodePath, fakeNodeLog);

  let commandFailure = null;
  try {
    await execFile(path.join(systemHome, '.metabot', 'bin', 'metabot'), [], {
      cwd: systemHome,
      env: createRuntimeEnv(systemHome, {
        METABOT_NODE: fakeNodePath,
        PATH: '/usr/bin:/bin',
      }),
    });
  } catch (error) {
    commandFailure = error;
  }

  assert.ok(commandFailure, 'metabot shim should execute the CLI through METABOT_NODE');
  assert.equal(commandFailure.code, 1);
  assert.deepEqual(JSON.parse(String(commandFailure.stdout).trim()), {
    ok: false,
    state: 'failed',
    code: 'missing_command',
    message: 'No command provided.',
  });
  const fakeNodeInvocation = await fs.readFile(fakeNodeLog, 'utf8');
  assert.match(fakeNodeInvocation, new RegExp(escapeRegExp(fakeNodePath)));
  assert.match(fakeNodeInvocation, /dist\/cli\/main\.js/);
});

test('runOac auto-detects codex when CODEX_HOME is the only host signal', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-detect-codex-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const codexHome = path.join(systemHome, '.custom-codex');
  await fs.mkdir(codexHome, { recursive: true });
  const result = await runOacCli(systemHome, ['install'], { CODEX_HOME: codexHome });

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, undefined);
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'shared-agents' && root.status === 'bound'));
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'codex' && root.status === 'bound'));
  await assertSymlinkPointsTo(
    path.join(codexHome, 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
  await assertSymlinkPointsTo(
    path.join(systemHome, '.agents', 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
});

test('runOac install uses Windows user profile fallback when HOME is unavailable', async (t) => {
  const userProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-install-userprofile-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-install-cwd-fallback-'));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousCwd = process.cwd();
  t.after(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    process.chdir(previousCwd);
    await fs.rm(userProfile, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  });

  delete process.env.HOME;
  process.env.USERPROFILE = userProfile;
  process.chdir(cwd);

  const stdout = [];
  const stderr = [];
  const exitCode = await runOac(['install'], {
    env: {
      PATH: process.env.PATH,
      USERPROFILE: userProfile,
    },
    cwd,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  const payload = JSON.parse(stdout.join('').trim());
  assert.equal(exitCode, 0, stderr.join(''));
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sharedSkillRoot, path.join(userProfile, '.metabot', 'skills'));
  assert.equal(payload.data.metabotShimPath, path.join(userProfile, '.metabot', 'bin', 'metabot'));
  assert.equal(
    await fs.stat(path.join(userProfile, '.agents', 'skills', 'metabot-ask-master')).then(() => true),
    true,
  );
  await assert.rejects(
    fs.stat(path.join(cwd, '.metabot', 'skills', 'metabot-ask-master')),
    { code: 'ENOENT' },
  );
});

test('bare runOac install binds shared agents root and skips platform roots whose parent is absent', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-bare-shared-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, undefined);
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'shared-agents' && root.status === 'bound'));
  assert.ok(result.payload.data.skippedRoots.some((root) => root.platformId === 'codex' && root.status === 'skipped'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.agents', 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
  await assert.rejects(fs.lstat(path.join(systemHome, '.codex', 'skills', 'metabot-ask-master')), { code: 'ENOENT' });
});

test('runOac install --host openclaw force-creates platform-native bindings', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-openclaw-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'openclaw']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'openclaw');
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'openclaw' && root.status === 'bound'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.openclaw', 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
});

test('runOac install can force-bind Trae and CodeBuddy skill roots', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-trae-codebuddy-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const trae = await runOacCli(systemHome, ['install', '--host', 'trae']);
  assert.equal(trae.exitCode, 0);
  assert.equal(trae.payload.ok, true);
  assert.equal(trae.payload.data.host, 'trae');
  assert.ok(trae.payload.data.boundRoots.some((root) => root.platformId === 'trae' && root.rootId === 'trae-home'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.trae', 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );

  const codebuddy = await runOacCli(systemHome, ['install', '--host', 'codebuddy']);
  assert.equal(codebuddy.exitCode, 0);
  assert.equal(codebuddy.payload.ok, true);
  assert.equal(codebuddy.payload.data.host, 'codebuddy');
  assert.ok(codebuddy.payload.data.boundRoots.some((root) => root.platformId === 'codebuddy' && root.rootId === 'codebuddy-home'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.codebuddy', 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
});

test('runOac doctor verifies an existing install without rewriting installed skills', async (t) => {
  const { systemHome } = await createSystemHome('oac-doctor-installed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install']);
  assert.equal(install.exitCode, 0);

  const markerPath = path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master', 'doctor-marker.txt');
  await fs.writeFile(markerPath, 'must remain\n', 'utf8');

  const doctor = await runOacCli(systemHome, ['doctor']);

  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);
  assert.equal(doctor.payload.data.host, undefined);
  assert.equal(doctor.payload.data.metabotShimPath, path.join(systemHome, '.metabot', 'bin', 'metabot'));
  assert.ok(doctor.payload.data.boundRoots.some((root) => root.platformId === 'shared-agents' && root.status === 'bound'));
  assert.ok(doctor.payload.data.skippedRoots.some((root) => root.platformId === 'codex' && root.status === 'skipped'));
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'must remain\n');
});

test('runOac doctor --host openclaw fails when forced platform bindings are missing', async (t) => {
  const { systemHome } = await createSystemHome('oac-doctor-missing-openclaw-bindings-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install', '--host', 'openclaw']);
  assert.equal(install.exitCode, 0);
  await fs.rm(path.join(systemHome, '.openclaw', 'skills', 'metabot-ask-master'), {
    recursive: true,
    force: true,
  });

  const doctor = await runOacCli(systemHome, ['doctor', '--host', 'openclaw']);

  assert.equal(doctor.exitCode, 1);
  assert.equal(doctor.payload.ok, false);
  assert.equal(doctor.payload.code, 'doctor_host_bindings_missing');
  assert.match(doctor.payload.message, /metabot-ask-master/);
});

test('runOac uninstall removes guarded registry root symlinks and preserves non-OAC entries', async (t) => {
  const { systemHome } = await createSystemHome('oac-uninstall-registry-roots-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install']);
  assert.equal(install.exitCode, 0);

  const sharedSkillRoot = path.join(systemHome, '.metabot', 'skills');
  const sharedAskMaster = path.join(sharedSkillRoot, 'metabot-ask-master');
  const codexRoot = path.join(systemHome, '.codex', 'skills');
  const geminiRoot = path.join(systemHome, '.gemini', 'skills');
  await fs.mkdir(codexRoot, { recursive: true });
  await fs.mkdir(geminiRoot, { recursive: true });

  const codexGuarded = path.join(codexRoot, 'metabot-ask-master');
  const geminiGuarded = path.join(geminiRoot, 'metabot-network-directory');
  const unrelatedSymlink = path.join(codexRoot, 'metabot-custom');
  const externalMetabotLink = path.join(codexRoot, 'metabot-external');
  const nativeFile = path.join(geminiRoot, 'native-helper');
  const externalHome = path.join(systemHome, '.external-home');
  const externalSkill = path.join(externalHome, '.metabot', 'skills', 'metabot-external');
  await fs.mkdir(externalSkill, { recursive: true });
  await fs.symlink(sharedAskMaster, codexGuarded);
  await fs.symlink(path.join(sharedSkillRoot, 'metabot-network-directory'), geminiGuarded);
  await fs.symlink(path.join(systemHome, '.other', 'skills', 'metabot-custom'), unrelatedSymlink);
  await fs.symlink(externalSkill, externalMetabotLink);
  await fs.writeFile(nativeFile, 'native helper\n', 'utf8');

  const uninstall = await runOacCli(systemHome, ['uninstall']);

  assert.equal(uninstall.exitCode, 0);
  assert.equal(uninstall.payload.ok, true);
  assert.equal(uninstall.payload.data.tier, 'safe');
  assert.equal(uninstall.payload.data.removedCliShim, true);
  await assert.rejects(fs.lstat(path.join(systemHome, '.agents', 'skills', 'metabot-ask-master')), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(codexGuarded), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(geminiGuarded), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(systemHome, '.metabot', 'bin', 'metabot')), { code: 'ENOENT' });
  assert.equal((await fs.lstat(unrelatedSymlink)).isSymbolicLink(), true);
  assert.equal((await fs.lstat(externalMetabotLink)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(nativeFile, 'utf8'), 'native helper\n');
  assert.match(await fs.readFile(path.join(sharedAskMaster, 'SKILL.md'), 'utf8'), /metabot master ask/);
});
