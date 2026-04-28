import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SKILLPACKS_DIR = path.join(REPO_ROOT, 'skillpacks');
const RELEASE_PACKS_DIR = path.join(REPO_ROOT, 'release', 'packs');
const HOSTS = ['codex', 'claude-code', 'openclaw'];

await rm(RELEASE_PACKS_DIR, { recursive: true, force: true });
await mkdir(RELEASE_PACKS_DIR, { recursive: true });

for (const host of HOSTS) {
  const outputFile = path.join(RELEASE_PACKS_DIR, `oac-${host}.tar.gz`);
  await execFile('tar', ['-czf', outputFile, '-C', SKILLPACKS_DIR, host]);
  console.log(`oac-${host}.tar.gz`);
}
