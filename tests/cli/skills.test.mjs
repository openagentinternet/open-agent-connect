import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

async function runSkillsCli(homeDir, args) {
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

test('runCli supports `metabot skills resolve --skill metabot-network-directory --host codex --format markdown`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-markdown-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'codex',
    '--format',
    'markdown',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(typeof result.payload.data, 'string');
  assert.equal(result.payload.data.includes('# Resolved Skill Contract: metabot-network-directory'), true);
});

test('runCli supports `metabot skills resolve --skill metabot-network-directory --host codex --format json`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'codex',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.format, 'json');
  assert.equal(result.payload.data.host, 'codex');
  assert.equal(result.payload.data.contract.skillName, 'metabot-network-directory');
});

test('runCli supports `metabot skills resolve --skill metabot-ask-master --host codex --format markdown`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-ask-master-markdown-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-ask-master',
    '--host',
    'codex',
    '--format',
    'markdown',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(typeof result.payload.data, 'string');
  assert.equal(result.payload.data.includes('# Resolved Skill Contract: metabot-ask-master'), true);
  assert.match(result.payload.data, /metabot master ask --request-file/);
  assert.match(result.payload.data, /metabot master suggest --request-file/);
  assert.match(result.payload.data, /manual \/ suggest|manual and suggest/i);
  assert.match(result.payload.data, /preview first, explicit confirm second|preview\/confirm\/send path/i);
  assert.doesNotMatch(result.payload.data, /metabot advisor ask/);
});

test('runCli supports `metabot skills resolve --skill metabot-ask-master --host codex --format json`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-ask-master-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-ask-master',
    '--host',
    'codex',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.format, 'json');
  assert.equal(result.payload.data.host, 'codex');
  assert.equal(result.payload.data.contract.skillName, 'metabot-ask-master');
  assert.match(result.payload.data.contract.summary, /manual \/ suggest|manual and suggest/i);
  assert.match(result.payload.data.contract.instructions, /metabot master suggest --request-file/);
  assert.match(result.payload.data.contract.outputExpectation, /suggest flows first surface a structured suggestion/i);
  assert.match(result.payload.data.contract.commandTemplate, /metabot master ask --request-file/);
  assert.doesNotMatch(result.payload.data.contract.commandTemplate, /metabot advisor ask/);
});
