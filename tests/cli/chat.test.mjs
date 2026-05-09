import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function createChatRequestFile(prefix, request = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    to: 'gm-remote-bob',
    content: 'hello from private chat',
    ...request,
  }), 'utf8');
  return requestFile;
}

test('runCli dispatches `metabot chat private --request-file` with parsed JSON request', async () => {
  const requestFile = await createChatRequestFile('metabot-cli-chat-');
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['chat', 'private', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      chat: {
        private: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'chat-pin-1',
            txids: ['chat-tx-1'],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    to: 'gm-remote-bob',
    content: 'hello from private chat',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'chat-pin-1',
      txids: ['chat-tx-1'],
    },
  });
});

test('runCli dispatches `metabot chat private --request-file --chain` for supported write chains', async () => {
  const requestFile = await createChatRequestFile('metabot-cli-chat-chain-');
  const calls = [];

  for (const chain of ['btc', 'doge', 'opcat']) {
    const exitCode = await runCli(['chat', 'private', '--request-file', requestFile, '--chain', chain], {
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies: {
        chat: {
          private: async (input) => {
            calls.push(input);
            return commandSuccess({
              pinId: `chat-pin-${chain}`,
              network: input.network,
            });
          },
        },
      },
    });

    assert.equal(exitCode, 0);
  }

  assert.deepEqual(calls.map((entry) => entry.network), ['btc', 'doge', 'opcat']);
});

test('runCli fails `metabot chat private` when --chain value is missing', async () => {
  const requestFile = await createChatRequestFile('metabot-cli-chat-missing-chain-');
  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['chat', 'private', '--request-file', requestFile, '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      chat: {
        private: async (input) => {
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
  assert.match(envelope.message, /Missing value for --chain/);
});

test('runCli fails `metabot chat private` when --chain value is unsupported', async () => {
  const requestFile = await createChatRequestFile('metabot-cli-chat-invalid-chain-');
  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['chat', 'private', '--request-file', requestFile, '--chain', 'eth'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      chat: {
        private: async (input) => {
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
