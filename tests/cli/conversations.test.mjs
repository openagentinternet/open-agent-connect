import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches conversations list and messages with --local and --peer', async () => {
  const calls = [];
  const dependencies = {
    conversations: {
      list: async (input) => {
        calls.push(['list', input]);
        return commandSuccess({ localBot: { name: 'alice' }, conversations: [] });
      },
      messages: async (input) => {
        calls.push(['messages', input]);
        return commandSuccess({ messages: [] });
      },
      guidance: async (input) => {
        calls.push(['guidance', input]);
        return commandSuccess({ messageId: 'gm-1' });
      },
    },
  };

  assert.equal(await runCli(['conversations', 'list', '--local', 'alice', '--limit', '10'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies,
  }), 0);
  assert.equal(await runCli(['conversations', 'messages', '--local', 'alice', '--peer', 'gm-bob', '--limit', '20'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies,
  }), 0);
  assert.equal(await runCli([
    'conversations', 'guidance', '--local', 'alice', '--peer', 'gm-bob', '--guidance', 'Answer in Chinese',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies,
  }), 0);

  assert.deepEqual(calls, [
    ['list', { local: 'alice', limit: 10 }],
    ['messages', { local: 'alice', peer: 'gm-bob', limit: 20 }],
    ['guidance', { local: 'alice', peer: 'gm-bob', guidance: 'Answer in Chinese' }],
  ]);
});

test('runCli rejects conversations commands with missing or malformed flags', async () => {
  const calls = [];
  const dependencies = {
    conversations: {
      list: async (input) => {
        calls.push(input);
        return commandSuccess({ conversations: [] });
      },
      messages: async (input) => {
        calls.push(input);
        return commandSuccess({ messages: [] });
      },
      guidance: async (input) => {
        calls.push(input);
        return commandSuccess({ messageId: 'gm-1' });
      },
    },
  };
  const run = (args) => runCli(args, {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies,
  });

  assert.equal(await run(['conversations', 'list']), 1);
  assert.equal(await run(['conversations', 'messages', '--local', 'alice']), 1);
  assert.equal(await run(['conversations', 'guidance', '--local', 'alice', '--peer', 'gm-bob']), 1);
  assert.equal(await run(['conversations', 'list', '--local', 'alice', '--limit', 'abc']), 1);
  assert.equal(await run(['conversations', 'unknown']), 1);

  assert.deepEqual(calls, []);
});
