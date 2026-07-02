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

test('runCli supports `metabot skills resolve --skill metabot-network-manage --format markdown`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-no-host-markdown-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-manage',
    '--format',
    'markdown',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(typeof result.payload.data, 'string');
  assert.equal(result.payload.data.includes('# Resolved Skill Contract: metabot-network-manage'), true);
  assert.equal(result.payload.data.includes('Host: `shared`'), true);
  assert.equal(result.payload.data.includes('metabot network bots --online --limit 20'), true);
  assert.equal(
    result.payload.data.includes('For first-run discovery, start with metabot network bots --online --limit 20 and Bot page follow-up in Browser. Use service discovery only when the user explicitly asks for services or a remote capability.'),
    true,
  );
});

test('runCli supports no-host shared-default resolution for existing public skill `metabot-network-directory` in json mode', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-directory-no-host-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.format, 'json');
  assert.equal(result.payload.data.host, 'shared');
  assert.equal(result.payload.data.requestedHost, undefined);
  assert.equal(result.payload.data.resolutionMode, 'shared_default');
  assert.equal(result.payload.data.contract.skillName, 'metabot-network-directory');
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

test('runCli supports registry-derived `metabot skills resolve --host gemini`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-gemini-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'gemini',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'gemini');
  assert.equal(result.payload.data.requestedHost, 'gemini');
});

test('runCli supports `metabot skills resolve --skill metabot-network-manage --format json`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-no-host-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-manage',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.format, 'json');
  assert.equal(result.payload.data.contract.skillName, 'metabot-network-manage');
  assert.match(result.payload.data.contract.summary, /online bot reads first, optional service search second/i);
  assert.match(
    result.payload.data.contract.instructions,
    /For first-run discovery, start with metabot network bots --online --limit 20 and Bot page follow-up in Browser/i
  );
  assert.equal(
    result.payload.data.contract.scope.allowedCommands.includes('metabot network bots --online --limit 20'),
    true,
  );
});

test('runCli supports `metabot skills resolve --skill metabot-browser-open --format json`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-browser-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-browser-open',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'shared');
  assert.equal(result.payload.data.contract.skillName, 'metabot-browser-open');
  assert.equal(result.payload.data.contract.commandTemplate, 'metabot browser open');
  assert.equal(result.payload.data.contract.scope.localUiOpen, true);
  assert.equal(result.payload.data.contract.scope.chainWrite, false);
  assert.equal(
    result.payload.data.contract.scope.allowedCommands.includes('metabot browser open --uri metaid://sunnyfung.eth'),
    true,
  );
  assert.equal(
    result.payload.data.contract.scope.allowedCommands.includes('metabot browser open --uri pin://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0'),
    true,
  );
});

test('runCli no-host json shape keeps top-level host and marks shared-default resolution', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-no-host-json-shape-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-manage',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'shared');
  assert.equal(result.payload.data.requestedHost, undefined);
  assert.equal(result.payload.data.resolutionMode, 'shared_default');
  assert.equal(result.payload.data.contract.skillName, 'metabot-network-manage');
});

test('runCli rejects unsupported explicit hosts for `metabot skills resolve`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-invalid-host-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'shared',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.match(result.payload.message, /Unsupported --host value: shared/);
  assert.match(result.payload.message, /claude-code, codex, copilot/);
});

test('runCli rejects retired `metabot-ask-master` skill resolution', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-retired-ask-master-');
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

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'unknown_skill');
  assert.match(result.payload.message, /metabot-ask-master/);
});
