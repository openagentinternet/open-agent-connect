import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
async function writeExecutable(filePath, body) {
  await fs.writeFile(filePath, body, 'utf8');
  await fs.chmod(filePath, 0o755);
}

async function createFakeToolchain(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-dev-mode-'));
  t.after(async () => fs.rm(tempRoot, { recursive: true, force: true }));

  const repoRoot = path.join(tempRoot, 'repo');
  const scriptPath = path.join(repoRoot, 'scripts', 'oac-dev-mode.sh');
  const binDir = path.join(tempRoot, 'bin');
  const homeDir = path.join(tempRoot, 'home');
  const logPath = path.join(tempRoot, 'commands.log');
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'dist', 'oac'), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.copyFile(path.join(REPO_ROOT, 'scripts', 'oac-dev-mode.sh'), scriptPath);
  await fs.chmod(scriptPath, 0o755);
  await fs.writeFile(path.join(repoRoot, 'dist', 'oac', 'main.js'), '', 'utf8');
  await fs.writeFile(logPath, '', 'utf8');

  await writeExecutable(path.join(binDir, 'npm'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf "npm %s\\n" "$*" >> "$OAC_DEV_MODE_TEST_LOG"',
    '',
  ].join('\n'));

  await writeExecutable(path.join(binDir, 'node'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf "node %s\\n" "$*" >> "$OAC_DEV_MODE_TEST_LOG"',
    '',
  ].join('\n'));

  await writeExecutable(path.join(binDir, 'metabot'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf "metabot %s\\n" "$*" >> "$OAC_DEV_MODE_TEST_LOG"',
    '',
  ].join('\n'));

  return {
    repoRoot,
    scriptPath,
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      OAC_DEV_MODE_TEST_LOG: logPath,
    },
    logPath,
  };
}

async function runDevMode(t, args = []) {
  const toolchain = await createFakeToolchain(t);
  const result = await execFile('/bin/bash', [toolchain.scriptPath, ...args], {
    cwd: toolchain.repoRoot,
    env: toolchain.env,
  });
  return {
    ...result,
    commands: await fs.readFile(toolchain.logPath, 'utf8'),
  };
}

test('oac-dev-mode builds the current repo, installs the codex dev runtime, and prints an acceptance handoff', async (t) => {
  const result = await runDevMode(t);

  assert.match(result.commands, /^npm run build$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js install --host codex$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js doctor --host codex$/m);
  assert.match(result.commands, /^metabot --help$/m);
  assert.doesNotMatch(result.commands, /daemon stop|daemon start/);
  assert.match(result.stdout, /Open Agent Connect is now linked to this source checkout/);
  assert.match(result.stdout, /Start a fresh Codex session/);
  assert.match(result.stdout, /natural language/);
});

test('oac-dev-mode supports host selection and daemon restart for UI/runtime acceptance', async (t) => {
  const result = await runDevMode(t, ['--host', 'claude-code', '--restart-daemon']);

  assert.match(result.commands, /^npm run build$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js install --host claude-code$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js doctor --host claude-code$/m);
  assert.match(result.commands, /^metabot daemon stop$/m);
  assert.match(result.commands, /^metabot daemon start$/m);
  assert.match(result.stdout, /Host: claude-code/);
  assert.match(result.stdout, /Daemon restarted from the development runtime/);
});

test('oac-dev-mode can skip the build for skill-only or static UI checks', async (t) => {
  const result = await runDevMode(t, ['--skip-build']);

  assert.doesNotMatch(result.commands, /^npm run build$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js install --host codex$/m);
  assert.match(result.commands, /^node .*dist\/oac\/main\.js doctor --host codex$/m);
  assert.match(result.stdout, /Build skipped/);
});
