import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runChatGroup(argv, chatDeps) {
  const stdout = [];
  const exitCode = await runCli(['chat', 'group', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { chat: chatDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('runCli dispatches `metabot chat group join --request-file` with --from and --chain', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-group-join-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    groupId: '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0',
    referrer: 'idq1inviter',
    k: 'encoded-key',
  }), 'utf8');

  const calls = [];
  const { exitCode, result } = await runChatGroup(
    ['join', '--request-file', requestFile, '--from', 'alice', '--chain', 'doge'],
    {
      groupJoin: async (input) => {
        calls.push(input);
        return commandSuccess({ pinId: 'gj1', groupId: input.groupId });
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].groupId, '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0');
  assert.equal(calls[0].referrer, 'idq1inviter');
  assert.equal(calls[0].k, 'encoded-key');
  assert.equal(calls[0].from, 'alice');
  assert.equal(calls[0].network, 'doge');
});

test('runCli dispatches `metabot chat group send --request-file` (defaults path)', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-group-send-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    groupId: '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0',
    content: '62c543cdbbf7ec3115c55b20cc4ebdfe',
  }), 'utf8');

  const calls = [];
  const { exitCode } = await runChatGroup(['send', '--request-file', requestFile], {
    groupSend: async (input) => {
      calls.push(input);
      return commandSuccess({ pinId: 'gs1' });
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    groupId: '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0',
    content: '62c543cdbbf7ec3115c55b20cc4ebdfe',
  }]);
});

test('chat group requires --request-file and rejects unknown subactions', async () => {
  const missing = await runChatGroup(['join'], { groupJoin: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');

  // Same convention as the other helpers-based verbs: the shared
  // commandUnknownSubcommand helper reports code "unknown_command".
  const bogus = await runChatGroup(['bogus'], {});
  assert.equal(bogus.result.code, 'unknown_command');
  const noSub = await runChatGroup([], {});
  assert.equal(noSub.result.code, 'unknown_command');
});

test('chat group send fails fast on an unsupported --chain value before dispatch', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-group-send-invalid-chain-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    groupId: '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0',
    content: '62c543cdbbf7ec3115c55b20cc4ebdfe',
  }), 'utf8');

  const calls = [];
  const { exitCode, result } = await runChatGroup(
    ['send', '--request-file', requestFile, '--chain', 'eth'],
    {
      groupSend: async (input) => {
        calls.push(input);
        return commandSuccess({ pinId: 'should-not-happen' });
      },
    },
  );
  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  assert.equal(result.code, 'invalid_flag');
  assert.match(result.message, /Unsupported --chain value/);
});
