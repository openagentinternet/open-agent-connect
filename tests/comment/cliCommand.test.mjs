import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runComment(argv, commentDeps) {
  const stdout = [];
  const exitCode = await runCli(['comment', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { comment: commentDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('runCli dispatches `metabot comment pin --request-file` with --from and --chain', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-comment-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    pinId: 'target-pin-9',
    content: 'a real answer',
  }), 'utf8');

  const calls = [];
  const { exitCode, result } = await runComment(
    ['pin', '--request-file', requestFile, '--from', 'alice', '--chain', 'doge'],
    {
      pin: async (input) => {
        calls.push(input);
        return commandSuccess({ pinId: 'c1', targetPinId: input.pinId });
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pinId, 'target-pin-9');
  assert.equal(calls[0].content, 'a real answer');
  assert.equal(calls[0].from, 'alice');
  assert.equal(calls[0].network, 'doge');
});

test('runCli dispatches `metabot comment pin --request-file` without flags (defaults path)', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-comment-defaults-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    pinId: 'p1',
    content: 'hi',
  }), 'utf8');

  const calls = [];
  const { exitCode } = await runComment(['pin', '--request-file', requestFile], {
    pin: async (input) => {
      calls.push(input);
      return commandSuccess({ pinId: 'c2' });
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ pinId: 'p1', content: 'hi' }]);
});

test('comment pin requires --request-file and rejects unknown subcommands', async () => {
  const missing = await runComment(['pin'], { pin: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');

  // Same convention as the other helpers-based verbs (buzz): the shared
  // commandUnknownSubcommand helper reports code "unknown_command".
  const bogus = await runComment(['bogus'], {});
  assert.equal(bogus.result.code, 'unknown_command');
});

test('comment pin fails fast on an unsupported --chain value before dispatch', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-comment-invalid-chain-');
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({ pinId: 'p1', content: 'hi' }), 'utf8');

  const calls = [];
  const { exitCode, result } = await runComment(['pin', '--request-file', requestFile, '--chain', 'eth'], {
    pin: async (input) => {
      calls.push(input);
      return commandSuccess({ pinId: 'should-not-happen' });
    },
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  assert.equal(result.code, 'invalid_flag');
  assert.match(result.message, /Unsupported --chain value/);
});
