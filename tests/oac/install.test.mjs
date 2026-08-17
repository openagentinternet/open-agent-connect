import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runOac } = require('../../dist/oac/main.js');
const execFile = promisify(execFileCallback);

async function createSystemHome(prefix) {
  const systemHome = await mkdtempTempRoot(prefix);
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
  assert.match(result.stdout, /oac install --host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro\|codebuddy\|zcode\|workbuddy\|dsh>/);
});

test('runOac installs shared skills, metabot shim, and codex host bindings for an explicit host', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-codex-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'codex']);

  const sharedSkillPath = path.join(systemHome, '.metabot', 'skills', 'metabot-help');
  const sharedSkillFile = path.join(sharedSkillPath, 'SKILL.md');
  const wikiCreatorSkillPath = path.join(systemHome, '.metabot', 'skills', 'metabot-create-wiki');
  const hostSpecificSkillPath = path.join(systemHome, '.metabot', 'host-skills', 'codex', 'metabot-help');
  const wikiCreatorHostSpecificSkillPath = path.join(systemHome, '.metabot', 'host-skills', 'codex', 'metabot-create-wiki');
  const metabotShimPath = path.join(systemHome, '.metabot', 'bin', 'metabot');
  const hostSkillPath = path.join(systemHome, '.codex', 'skills', 'metabot-help');
  const wikiCreatorHostSkillPath = path.join(systemHome, '.codex', 'skills', 'metabot-create-wiki');
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
  assert.ok(result.payload.data.installedSkills.includes('metabot-help'));
  assert.equal(result.payload.data.installedSkills.includes('metabot-ask-master'), false);
  assert.ok(result.payload.data.installedSkills.includes('metabot-create-wiki'));
  assert.ok(result.payload.data.boundRoots.some((root) =>
    root.platformId === 'codex'
      && root.status === 'bound'
      && root.boundSkills.includes('metabot-help')
  ));

  const sharedSkill = await fs.readFile(sharedSkillFile, 'utf8');
  assert.match(sharedSkill, /\$HOME\/\.metabot\/bin\/metabot --help/);
  assert.doesNotMatch(sharedSkill, /metabot master/);
  assert.doesNotMatch(sharedSkill, /metabot evolution/);
  await assert.rejects(
    fs.stat(path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master')),
    { code: 'ENOENT' },
  );
  assert.doesNotMatch(
    sharedSkill,
    /(?<![\w.$/~-])metabot\s+(?:services|trace|network|identity|doctor|wallet|chat|ui|buzz|file|master|skills|config|chain|llm|evolution)\b/,
  );
  const shim = await fs.readFile(metabotShimPath, 'utf8');
  assert.match(shim, /dist\/cli\/main\.js/);
  assert.match(shim, /METABOT_NODE/);
  assert.match(shim, /node@22/);
  assert.match(shim, /Node\.js >=20 <25/);
  assert.match(shim, /exec "\$NODE_BIN"/);
  assert.doesNotMatch(shim, /exec node /);
  await fs.stat(path.join(wikiCreatorSkillPath, 'scripts', 'scaffold-wiki-skill.js'));
  await fs.stat(path.join(wikiCreatorSkillPath, 'assets', 'metabot-llm-wiki-runtime', 'scripts', 'index.js'));
  await assertSymlinkPointsTo(hostSkillPath, hostSpecificSkillPath);
  await assertSymlinkPointsTo(wikiCreatorHostSkillPath, wikiCreatorHostSpecificSkillPath);
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
    path.join(codexHome, 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-help'),
  );
  await assertSymlinkPointsTo(
    path.join(systemHome, '.agents', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-help'),
  );
});

test('runOac install uses Windows user profile fallback when HOME is unavailable', async (t) => {
  const userProfile = await mkdtempTempRoot('oac-install-userprofile-');
  const cwd = await mkdtempTempRoot('oac-install-cwd-fallback-');
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
    await fs.stat(path.join(userProfile, '.agents', 'skills', 'metabot-help')).then(() => true),
    true,
  );
  await assert.rejects(
    fs.stat(path.join(cwd, '.metabot', 'skills', 'metabot-help')),
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
    path.join(systemHome, '.agents', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-help'),
  );
  await assert.rejects(fs.lstat(path.join(systemHome, '.codex', 'skills', 'metabot-help')), { code: 'ENOENT' });
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
    path.join(systemHome, '.openclaw', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'openclaw', 'metabot-help'),
  );
  const identitySkill = await fs.readFile(
    path.join(systemHome, '.metabot', 'host-skills', 'openclaw', 'metabot-identity-manage', 'SKILL.md'),
    'utf8',
  );
  assert.match(identitySkill, /identity create --name "\$TARGET_NAME" --host openclaw/);
});

test('runOac install can force-bind CodeBuddy skill roots', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-codebuddy-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const codebuddy = await runOacCli(systemHome, ['install', '--host', 'codebuddy']);
  assert.equal(codebuddy.exitCode, 0);
  assert.equal(codebuddy.payload.ok, true);
  assert.equal(codebuddy.payload.data.host, 'codebuddy');
  assert.ok(codebuddy.payload.data.boundRoots.some((root) => root.platformId === 'codebuddy' && root.rootId === 'codebuddy-home'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.codebuddy', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'codebuddy', 'metabot-help'),
  );
});

test('runOac install can force-bind ZCode skill roots', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-zcode-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const zcode = await runOacCli(systemHome, ['install', '--host', 'zcode']);
  assert.equal(zcode.exitCode, 0);
  assert.equal(zcode.payload.ok, true);
  assert.equal(zcode.payload.data.host, 'zcode');
  assert.ok(zcode.payload.data.boundRoots.some((root) => root.platformId === 'zcode' && root.rootId === 'zcode-home'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.zcode', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'zcode', 'metabot-help'),
  );
});

test('runOac install can force-bind WorkBuddy and CodeBuddy-compatible skill roots', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-workbuddy-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const workbuddy = await runOacCli(systemHome, ['install', '--host', 'workbuddy']);
  assert.equal(workbuddy.exitCode, 0);
  assert.equal(workbuddy.payload.ok, true);
  assert.equal(workbuddy.payload.data.host, 'workbuddy');
  assert.ok(workbuddy.payload.data.boundRoots.some((root) => root.platformId === 'workbuddy' && root.rootId === 'workbuddy-home'));
  assert.ok(workbuddy.payload.data.boundRoots.some((root) => root.platformId === 'workbuddy' && root.rootId === 'workbuddy-codebuddy-home'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.workbuddy', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'workbuddy', 'metabot-help'),
  );
  await assertSymlinkPointsTo(
    path.join(systemHome, '.codebuddy', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'workbuddy', 'metabot-help'),
  );
});

test('runOac install --host dsh force-creates DSH skill-bind roots without an OAC executor', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-force-dsh-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'dsh']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'dsh');
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'dsh' && root.rootId === 'dsh-home' && root.status === 'bound'));
  await assertSymlinkPointsTo(
    path.join(systemHome, '.dsh', 'skills', 'metabot-help'),
    path.join(systemHome, '.metabot', 'host-skills', 'dsh', 'metabot-help'),
  );
});

test('runOac install rejects removed Trae host support', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-reject-trae-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'trae']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.match(result.payload.message, /Unsupported --host value: trae/);
});

test('runOac doctor verifies an existing install without rewriting installed skills', async (t) => {
  const { systemHome } = await createSystemHome('oac-doctor-installed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install']);
  assert.equal(install.exitCode, 0);

  const markerPath = path.join(systemHome, '.metabot', 'skills', 'metabot-help', 'doctor-marker.txt');
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
  await fs.rm(path.join(systemHome, '.openclaw', 'skills', 'metabot-help'), {
    recursive: true,
    force: true,
  });

  const doctor = await runOacCli(systemHome, ['doctor', '--host', 'openclaw']);

  assert.equal(doctor.exitCode, 1);
  assert.equal(doctor.payload.ok, false);
  assert.equal(doctor.payload.code, 'doctor_host_bindings_missing');
  assert.match(doctor.payload.message, /metabot-help/);
});

test('runOac uninstall removes guarded registry root symlinks and preserves non-OAC entries', async (t) => {
  const { systemHome } = await createSystemHome('oac-uninstall-registry-roots-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install']);
  assert.equal(install.exitCode, 0);

  const sharedSkillRoot = path.join(systemHome, '.metabot', 'skills');
  const sharedHelp = path.join(sharedSkillRoot, 'metabot-help');
  const codexRoot = path.join(systemHome, '.codex', 'skills');
  const geminiRoot = path.join(systemHome, '.gemini', 'skills');
  await fs.mkdir(codexRoot, { recursive: true });
  await fs.mkdir(geminiRoot, { recursive: true });

  const codexGuarded = path.join(codexRoot, 'metabot-help');
  const geminiGuarded = path.join(geminiRoot, 'metabot-network-directory');
  const unrelatedSymlink = path.join(codexRoot, 'metabot-custom');
  const externalMetabotLink = path.join(codexRoot, 'metabot-external');
  const nativeFile = path.join(geminiRoot, 'native-helper');
  const externalHome = path.join(systemHome, '.external-home');
  const externalSkill = path.join(externalHome, '.metabot', 'skills', 'metabot-external');
  await fs.mkdir(externalSkill, { recursive: true });
  await fs.symlink(sharedHelp, codexGuarded);
  await fs.symlink(path.join(sharedSkillRoot, 'metabot-network-directory'), geminiGuarded);
  await fs.symlink(path.join(systemHome, '.other', 'skills', 'metabot-custom'), unrelatedSymlink);
  await fs.symlink(externalSkill, externalMetabotLink);
  await fs.writeFile(nativeFile, 'native helper\n', 'utf8');

  const uninstall = await runOacCli(systemHome, ['uninstall']);

  assert.equal(uninstall.exitCode, 0);
  assert.equal(uninstall.payload.ok, true);
  assert.equal(uninstall.payload.data.tier, 'safe');
  assert.equal(uninstall.payload.data.removedCliShim, true);
  await assert.rejects(fs.lstat(path.join(systemHome, '.agents', 'skills', 'metabot-help')), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(codexGuarded), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(geminiGuarded), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(systemHome, '.metabot', 'bin', 'metabot')), { code: 'ENOENT' });
  assert.equal((await fs.lstat(unrelatedSymlink)).isSymbolicLink(), true);
  assert.equal((await fs.lstat(externalMetabotLink)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(nativeFile, 'utf8'), 'native helper\n');
  const helpSkill = await fs.readFile(path.join(sharedHelp, 'SKILL.md'), 'utf8');
  assert.match(helpSkill, /\$HOME\/\.metabot\/bin\/metabot --help/);
  assert.doesNotMatch(helpSkill, /metabot master/);
});
