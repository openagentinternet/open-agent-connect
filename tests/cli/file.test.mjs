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

test('runCli dispatches `metabot file upload --request-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-btc-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-btc-1',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    network: 'btc',
  }]);
});

test('runCli fails `metabot file upload` when --chain value is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-missing-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
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
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Missing value for --chain/);
});

test('runCli fails `metabot file upload` when --chain value is unsupported', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-invalid-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
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
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});
