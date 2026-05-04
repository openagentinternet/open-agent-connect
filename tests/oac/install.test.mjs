import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runOac } = require('../../dist/oac/main.js');

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
    payload: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

async function assertSymlinkPointsTo(entryPath, targetPath) {
  const stat = await fs.lstat(entryPath);
  assert.equal(stat.isSymbolicLink(), true);
  const resolved = await fs.readlink(entryPath);
  assert.equal(path.resolve(path.dirname(entryPath), resolved), targetPath);
}

test('runOac installs shared skills, metabot shim, and codex host bindings for an explicit host', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-codex-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install', '--host', 'codex']);

  const sharedSkillPath = path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master');
  const sharedSkillFile = path.join(sharedSkillPath, 'SKILL.md');
  const metabotShimPath = path.join(systemHome, '.metabot', 'bin', 'metabot');
  const hostSkillPath = path.join(systemHome, '.codex', 'skills', 'metabot-ask-master');

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'codex');
  assert.equal(result.payload.data.metabotShimPath, metabotShimPath);
  assert.ok(result.payload.data.installedSkills.includes('metabot-ask-master'));
  assert.ok(result.payload.data.boundSkills.includes('metabot-ask-master'));

  assert.equal(await fs.readFile(sharedSkillFile, 'utf8').then((body) => body.includes('metabot master ask')), true);
  const shim = await fs.readFile(metabotShimPath, 'utf8');
  assert.match(shim, /dist\/cli\/main\.js/);
  await assertSymlinkPointsTo(hostSkillPath, sharedSkillPath);
});

test('runOac auto-detects codex when CODEX_HOME is the only host signal', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-detect-codex-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const codexHome = path.join(systemHome, '.custom-codex');
  const result = await runOacCli(systemHome, ['install'], { CODEX_HOME: codexHome });

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'codex');
  await assertSymlinkPointsTo(
    path.join(codexHome, 'skills', 'metabot-ask-master'),
    path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master'),
  );
});

test('runOac requires explicit host when more than one host environment is present', async (t) => {
  const { systemHome } = await createSystemHome('oac-install-ambiguous-host-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runOacCli(systemHome, ['install'], {
    CODEX_HOME: path.join(systemHome, '.codex'),
    CLAUDE_HOME: path.join(systemHome, '.claude'),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'install_host_ambiguous');
  assert.match(result.payload.message, /--host <codex\|claude-code\|openclaw>/);
});

test('runOac doctor verifies an existing install without rewriting installed skills', async (t) => {
  const { systemHome } = await createSystemHome('oac-doctor-installed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install', '--host', 'codex']);
  assert.equal(install.exitCode, 0);

  const markerPath = path.join(systemHome, '.metabot', 'skills', 'metabot-ask-master', 'doctor-marker.txt');
  await fs.writeFile(markerPath, 'must remain\n', 'utf8');

  const doctor = await runOacCli(systemHome, ['doctor', '--host', 'codex']);

  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);
  assert.equal(doctor.payload.data.host, 'codex');
  assert.equal(doctor.payload.data.metabotShimPath, path.join(systemHome, '.metabot', 'bin', 'metabot'));
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'must remain\n');
});

test('runOac doctor fails when host bindings are missing', async (t) => {
  const { systemHome } = await createSystemHome('oac-doctor-missing-bindings-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const install = await runOacCli(systemHome, ['install', '--host', 'codex']);
  assert.equal(install.exitCode, 0);
  await fs.rm(path.join(systemHome, '.codex', 'skills', 'metabot-ask-master'), {
    recursive: true,
    force: true,
  });

  const doctor = await runOacCli(systemHome, ['doctor', '--host', 'codex']);

  assert.equal(doctor.exitCode, 1);
  assert.equal(doctor.payload.ok, false);
  assert.equal(doctor.payload.code, 'doctor_host_bindings_missing');
  assert.match(doctor.payload.message, /metabot-ask-master/);
});
