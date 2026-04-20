import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-skills-markdown-'));
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
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-skills-json-'));
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
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-skills-ask-master-markdown-'));
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
  assert.doesNotMatch(result.payload.data, /metabot advisor ask/);
});

test('runCli supports `metabot skills resolve --skill metabot-ask-master --host codex --format json`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-skills-ask-master-json-'));
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
  assert.match(result.payload.data.contract.commandTemplate, /metabot master ask --request-file/);
  assert.doesNotMatch(result.payload.data.contract.commandTemplate, /metabot advisor ask/);
});
