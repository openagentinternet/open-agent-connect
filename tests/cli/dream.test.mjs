import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function makeContext(dependencies, payload = {}) {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    readTextFile: async () => JSON.stringify(payload),
    dependencies,
  };
}

test('runCli dispatches dream subcommands to the dream dependency group', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    dream: {
      due: record('due'),
      status: record('status'),
      plan: record('plan'),
      run: record('run'),
      synthesize: record('synthesize'),
      commit: record('commit'),
      fail: record('fail'),
      summaries: record('summaries'),
      selfIdentity: record('selfIdentity'),
    },
  };
  const payload = {
    date: '2026-08-19',
    fragmentOutputs: { 'session:s1:0': '{}' },
    outputText: '{"daily_summary":"x"}',
    error: 'llm down',
  };
  const run = (args) => runCli(args, makeContext(dependencies, payload));

  assert.equal(await run(['dream', 'due', '--from', 'alice']), 0);
  assert.equal(await run(['dream', 'status', '--from', 'alice']), 0);
  assert.equal(await run(['dream', 'plan', '--from', 'alice', '--date', '2026-08-19']), 0);
  assert.equal(await run(['dream', 'run', '--from', 'alice']), 0);
  assert.equal(await run(['dream', 'synthesize', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['dream', 'commit', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['dream', 'fail', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['dream', 'summaries', '--from', 'alice', '--limit', '7']), 0);
  assert.equal(await run(['dream', 'self-identity', '--from', 'alice']), 0);

  assert.deepEqual(calls.map(([name]) => name), [
    'due', 'status', 'plan', 'run', 'synthesize', 'commit', 'fail', 'summaries', 'selfIdentity',
  ]);
  assert.equal(calls[2][1].date, '2026-08-19');
  assert.equal(calls[6][1].payload.error, 'llm down');
  assert.equal(calls[7][1].limit, 7);
});

test('runCli rejects malformed dream invocations', async () => {
  const dependencies = {
    dream: {
      plan: async () => commandSuccess({}),
      commit: async () => commandSuccess({}),
      fail: async () => commandSuccess({}),
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies, {}));

  // invalid --date format
  assert.equal(await run(['dream', 'plan', '--date', '19-08-2026']), 1);
  // synthesize without payload file
  assert.equal(await run(['dream', 'synthesize']), 1);
  // commit payload missing date/outputText
  assert.equal(await run(['dream', 'commit', '--payload-file', 'p.json']), 1);
  // fail payload missing date
  assert.equal(await run(['dream', 'fail', '--payload-file', 'p.json']), 1);
  // fail without payload file
  assert.equal(await run(['dream', 'fail']), 1);
  // unknown subcommand
  assert.equal(await run(['dream', 'frobnicate']), 1);
});
