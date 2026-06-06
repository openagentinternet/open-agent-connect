import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

async function trackedFiles() {
  const { stdout } = await execFile('git', ['ls-files'], {
    cwd: REPO_ROOT,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.split('\n').filter(Boolean);
}

async function fileExists(filePath) {
  try {
    await access(path.join(REPO_ROOT, filePath));
    return true;
  } catch {
    return false;
  }
}

function isUserFacingDoc(filePath) {
  return filePath === 'README.md'
    || filePath === 'CLAUDE.md'
    || filePath === 'DACT.md'
    || filePath.startsWith('docs/')
    || filePath.startsWith('SKILLs/');
}

test('retired new-api vendor planning artifacts are absent from the working tree', async () => {
  const matches = [];

  for (const filePath of await trackedFiles()) {
    if (
      (filePath.includes('new-api-vendor-skill')
        || filePath === 'product-commerce-orders-delivered.png')
      && await fileExists(filePath)
    ) {
      matches.push(filePath);
    }
  }

  assert.deepEqual(matches, []);
});

test('user-facing docs do not reference retired feature surfaces', async () => {
  const retiredSurfacePattern = /\b(?:ASK Master|Ask Master|ask master|master ask|master publish|metabot master|metabot-ask-master|\/api\/master|src\/cli\/commands\/master\.ts|src\/core\/master|EVOLUTION_NETWORK|Evolution Network|evolution network|evolution_network|evolution artifacts?|local evolution history|metabot evolution|src\/cli\/commands\/evolution\.ts|src\/core\/evolution|tests\/evolution|\.runtime\/evolution|evolutionRoot|\/ui\/chat-viewer|chat-viewer|Private Chat Viewer)\b/i;
  const matches = [];

  for (const filePath of (await trackedFiles()).filter(isUserFacingDoc)) {
    if (!(await fileExists(filePath))) {
      continue;
    }
    const content = await readFile(path.join(REPO_ROOT, filePath), 'utf8');
    if (retiredSurfacePattern.test(content)) {
      matches.push(filePath);
    }
  }

  assert.deepEqual(matches, []);
});
