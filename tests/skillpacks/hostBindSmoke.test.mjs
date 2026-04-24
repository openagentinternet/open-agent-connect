import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, mkdtemp, readdir, readlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD_SCRIPT_URL = pathToFileURL(path.join(REPO_ROOT, 'scripts/build-metabot-skillpacks.mjs')).href;
const SHARED_PACK = 'shared';
const HOSTS = ['codex', 'claude-code', 'openclaw'];
const execFile = promisify(execFileCallback);

let builtSkillpacksPromise;

async function getBuiltSkillpacks() {
  if (!builtSkillpacksPromise) {
    builtSkillpacksPromise = (async () => {
      const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-host-bind-smoke-'));
      const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);
      await buildAgentConnectSkillpacks({
        repoRoot: REPO_ROOT,
        outputRoot,
      });
      return { outputRoot };
    })();
  }
  return builtSkillpacksPromise;
}

function sharedPackRoot(root) {
  return path.join(root, SHARED_PACK);
}

function expectedHostSkillRoot(homeDir, host) {
  switch (host) {
    case 'codex':
      return path.join(homeDir, '.codex', 'skills');
    case 'claude-code':
      return path.join(homeDir, '.claude', 'skills');
    case 'openclaw':
      return path.join(homeDir, '.openclaw', 'skills');
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}

async function listInstalledSharedSkills(homeDir) {
  const skillRoot = path.join(homeDir, '.metabot', 'skills');
  const entries = await readdir(skillRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('metabot-'))
    .map((entry) => entry.name)
    .sort();
}

for (const host of HOSTS) {
  test(`shared install plus \`metabot host bind-skills --host ${host}\` projects shared MetaBot skills as symlinks`, async () => {
    const { outputRoot } = await getBuiltSkillpacks();
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), `metabot-${host}-smoke-home-`));
    const sharedRoot = sharedPackRoot(outputRoot);

    await execFile('/bin/bash', [path.join(sharedRoot, 'install.sh')], {
      cwd: sharedRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
      },
    });

    const sharedSkillRoot = path.join(fakeHome, '.metabot', 'skills');
    const installedSkills = await listInstalledSharedSkills(fakeHome);
    assert.ok(installedSkills.length > 0, 'shared install should provide at least one metabot-* skill');

    const metabotBin = path.join(fakeHome, '.metabot', 'bin', 'metabot');
    const bindResult = await execFile(metabotBin, ['host', 'bind-skills', '--host', host], {
      env: {
        ...process.env,
        HOME: fakeHome,
      },
    });

    const payload = JSON.parse(bindResult.stdout.trim());
    const hostSkillRoot = expectedHostSkillRoot(fakeHome, host);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data.boundSkills, installedSkills);
    assert.equal(payload.data.sharedSkillRoot, sharedSkillRoot);
    assert.equal(payload.data.hostSkillRoot, hostSkillRoot);

    const hostEntries = (await readdir(hostSkillRoot, { withFileTypes: true }))
      .filter((entry) => entry.name.startsWith('metabot-'))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(hostEntries, installedSkills);

    for (const skillName of installedSkills) {
      const hostSkillPath = path.join(hostSkillRoot, skillName);
      const stat = await lstat(hostSkillPath);
      assert.equal(stat.isSymbolicLink(), true, `${hostSkillPath} should be a symlink`);

      const target = await readlink(hostSkillPath);
      assert.equal(
        path.resolve(path.dirname(hostSkillPath), target),
        path.join(sharedSkillRoot, skillName),
      );
    }
  });
}
