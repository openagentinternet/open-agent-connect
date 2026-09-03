import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { runChainhistoryCommand } = require('../../dist/cli/commands/chainhistory.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

const READ_PAYLOAD = JSON.stringify({
  pinId: 'pin-cli-1',
  path: '/protocols/simplenote',
  protocol: 'simplenote',
  title: 'CLI Note',
  authorGlobalMetaId: 'gm-author',
  contentText: 'full text body',
  source: 'read_metaweb_pin',
});

function makeContext(dependencies, payload = READ_PAYLOAD) {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    cwd: '/tmp',
    readTextFile: async () => payload,
    dependencies,
  };
}

test('runCli dispatches chainhistory read record to the chainhistory dependency group', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };

  const exitCode = await runCli(
    ['chainhistory', 'read', 'record', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext(dependencies),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    input: {
      pinId: 'pin-cli-1',
      path: '/protocols/simplenote',
      protocol: 'simplenote',
      title: 'CLI Note',
      authorGlobalMetaId: 'gm-author',
      contentText: 'full text body',
      source: 'read_metaweb_pin',
    },
  }]);
});

test('chainhistory read record without a handler fails not_implemented', async () => {
  // Direct invocation: runCli always merges runtime defaults, so the missing-
  // handler branch is only reachable with a bare context.
  const result = await runChainhistoryCommand(
    ['read', 'record', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext({}),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

test('chainhistory read record rejects malformed invocations', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };

  // Missing --payload-file.
  let result = await runChainhistoryCommand(['read', 'record', '--from', 'alice'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_flag');

  // Payload without pinId.
  result = await runChainhistoryCommand(
    ['read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, '{}'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_payload');

  // Non-object payload file content.
  result = await runChainhistoryCommand(
    ['read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, '[1,2]'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_payload');

  // Unknown subcommands.
  result = await runChainhistoryCommand(['write', 'record'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');
  result = await runChainhistoryCommand(['read', 'frobnicate'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');

  assert.deepEqual(calls, [], 'no malformed invocation reaches the handler');

  // runCli surfaces the same failures as non-zero exit codes.
  assert.equal(await runCli(['chainhistory', 'read', 'record'], makeContext(dependencies)), 1);
  assert.equal(await runCli(['chainhistory', 'read', 'record', '--payload-file', 'p.json'], makeContext(dependencies, '{}')), 1);
  assert.equal(await runCli(['chainhistory', 'frobnicate'], makeContext(dependencies)), 1);
});

test('chainhistory read record keeps only string payload fields', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };
  const payload = JSON.stringify({
    pinId: 'pin-cli-2',
    title: 42,
    path: '',
    contentText: 'kept verbatim  ',
    extra: 'dropped',
  });

  const exitCode = await runCli(
    ['chainhistory', 'read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, payload),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: undefined,
    input: { pinId: 'pin-cli-2', contentText: 'kept verbatim  ' },
  }]);
});
