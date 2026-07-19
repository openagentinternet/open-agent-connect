import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  buildDaemonConfigHash,
  getDaemonRuntimeFingerprint,
} = require('../../dist/cli/runtime.js');

test('getDaemonRuntimeFingerprint changes when runtime js files change', async () => {
  const rootDir = await mkdtempTempRoot('metabot-runtime-fingerprint-');
  const cliDir = path.join(rootDir, 'cli');
  const coreDir = path.join(rootDir, 'core');
  await mkdir(cliDir, { recursive: true });
  await mkdir(coreDir, { recursive: true });

  await writeFile(path.join(cliDir, 'main.js'), 'console.log("a");\n', 'utf8');
  await writeFile(path.join(coreDir, 'remoteCall.js'), 'export const version = "old";\n', 'utf8');

  const first = getDaemonRuntimeFingerprint(rootDir);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeFile(path.join(coreDir, 'remoteCall.js'), 'export const version = "new";\n', 'utf8');

  const second = getDaemonRuntimeFingerprint(rootDir);
  assert.notEqual(first, second);
});

test('buildDaemonConfigHash changes when the runtime fingerprint changes even if env stays the same', () => {
  const env = {
    METABOT_CHAIN_API_BASE_URL: 'https://chain.example',
  };

  const first = buildDaemonConfigHash(env, {
    runtimeFingerprint: 'runtime-fingerprint-a',
  });
  const second = buildDaemonConfigHash(env, {
    runtimeFingerprint: 'runtime-fingerprint-b',
  });

  assert.notEqual(first, second);
});
