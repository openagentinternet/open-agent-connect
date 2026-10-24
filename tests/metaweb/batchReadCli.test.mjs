import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runMetaweb(argv, metawebDeps) {
  const stdout = [];
  const exitCode = await runCli(['metaweb', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { metaweb: metawebDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('metaweb batch-read requires --pins-file and dispatches the pinIds array', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-metaweb-batch-');
  const pinsFile = path.join(tempDir, 'pins.json');
  await writeFile(pinsFile, JSON.stringify({ pinIds: ['p1', 'p2'] }), 'utf8');

  const calls = [];
  const { exitCode, result } = await runMetaweb(['batch-read', '--pins-file', pinsFile], {
    batchRead: async (input) => {
      calls.push(input);
      return commandSuccess({ requested: 2, formatted: 'sheet' });
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ pinIds: ['p1', 'p2'] }]);

  const missing = await runMetaweb(['batch-read'], { batchRead: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');
});

test('metaweb batch-read passes an empty pinIds array through; the handler decides', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-metaweb-batch-empty-');
  const pinsFile = path.join(tempDir, 'pins.json');
  await writeFile(pinsFile, JSON.stringify({ pinIds: [] }), 'utf8');

  const calls = [];
  const { exitCode } = await runMetaweb(['batch-read', '--pins-file', pinsFile], {
    batchRead: async (input) => {
      calls.push(input);
      return commandSuccess({});
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ pinIds: [] }]);
});
