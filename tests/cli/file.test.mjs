import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot file upload --request-file` with parsed JSON request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
    contentType: 'image/png',
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-1',
            metafileUri: 'metafile://file-pin-1.png',
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    contentType: 'image/png',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'file-pin-1',
      metafileUri: 'metafile://file-pin-1.png',
    },
  });
});
