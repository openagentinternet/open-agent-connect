import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot chain write --request-file` with parsed JSON request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello metabot"}',
    contentType: 'application/json',
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['chain', 'write', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      chain: {
        write: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'pin-chain-write-1',
            path: input.path,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello metabot"}',
    contentType: 'application/json',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'pin-chain-write-1',
      path: '/protocols/simplebuzz',
    },
  });
});
