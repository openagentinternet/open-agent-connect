import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot buzz post --request-file` with parsed JSON request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-buzz-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    content: 'hello metabot buzz',
    attachments: ['/tmp/photo.png'],
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['buzz', 'post', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      buzz: {
        post: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'buzz-pin-1',
            attachments: ['metafile://file-pin-1.png'],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    content: 'hello metabot buzz',
    attachments: ['/tmp/photo.png'],
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'buzz-pin-1',
      attachments: ['metafile://file-pin-1.png'],
    },
  });
});

test('runCli dispatches `metabot buzz post --request-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-buzz-btc-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    content: 'hello metabot buzz on btc',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['buzz', 'post', '--request-file', requestFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      buzz: {
        post: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'buzz-pin-btc-1',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    content: 'hello metabot buzz on btc',
    network: 'btc',
  }]);
});

test('runCli fails `metabot buzz post` when --chain value is unsupported', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-buzz-invalid-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    content: 'hello metabot buzz',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['buzz', 'post', '--request-file', requestFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      buzz: {
        post: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});
