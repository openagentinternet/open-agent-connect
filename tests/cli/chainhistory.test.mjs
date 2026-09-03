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

test('runCli dispatches chainhistory summary pending with an optional limit', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryPending: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], summarizedToday: 0 });
      },
    },
  };

  assert.equal(
    await runCli(['chainhistory', 'summary', 'pending', '--from', 'alice', '--limit', '5'], makeContext(dependencies)),
    0,
  );
  assert.equal(
    await runCli(['chainhistory', 'summary', 'pending'], makeContext(dependencies)),
    0,
  );
  assert.deepEqual(calls, [
    { from: 'alice', limit: 5 },
    { from: undefined },
  ]);
});

test('chainhistory summary pending rejects a non-positive --limit', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryPending: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], summarizedToday: 0 });
      },
    },
  };

  for (const args of [
    ['summary', 'pending', '--limit', '0'],
    ['summary', 'pending', '--limit', '-3'],
    ['summary', 'pending', '--limit', 'abc'],
  ]) {
    const result = await runChainhistoryCommand(args, makeContext(dependencies));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_flag');
  }
  assert.equal(await runCli(['chainhistory', 'summary', 'pending', '--limit', '0'], makeContext(dependencies)), 1);
  assert.deepEqual(calls, [], 'no invalid --limit reaches the handler');
});

test('runCli dispatches chainhistory summary apply with a validated payload', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryApply: async (input) => {
        calls.push(input);
        return commandSuccess({ applied: true });
      },
    },
  };
  const payload = JSON.stringify({
    kind: 'write',
    pinId: 'pin-sum-1',
    outcome: 'done',
    summary: 'two sentences',
  });

  const exitCode = await runCli(
    ['chainhistory', 'summary', 'apply', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext(dependencies, payload),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    kind: 'write',
    pinId: 'pin-sum-1',
    outcome: 'done',
    summary: 'two sentences',
  }]);

  // outcome failed needs no summary.
  const failedPayload = JSON.stringify({ kind: 'read', pinId: 'pin-sum-2', outcome: 'failed' });
  assert.equal(
    await runCli(['chainhistory', 'summary', 'apply', '--payload-file', 'p.json'], makeContext(dependencies, failedPayload)),
    0,
  );
  assert.deepEqual(calls[1], { from: undefined, kind: 'read', pinId: 'pin-sum-2', outcome: 'failed' });
});

test('chainhistory summary apply rejects malformed payloads', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryApply: async (input) => {
        calls.push(input);
        return commandSuccess({ applied: true });
      },
    },
  };

  // Missing --payload-file.
  let result = await runChainhistoryCommand(['summary', 'apply', '--from', 'alice'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_flag');

  const invalidPayloads = [
    ['{}', 'invalid_payload'], // no kind/pinId/outcome
    [JSON.stringify({ kind: 'delete', pinId: 'p', outcome: 'done', summary: 's' }), 'invalid_payload'],
    [JSON.stringify({ kind: 'write', outcome: 'done', summary: 's' }), 'invalid_payload'], // no pinId
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'unknown' }), 'invalid_payload'],
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'done' }), 'invalid_payload'], // done without summary
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'done', summary: '   ' }), 'invalid_payload'], // blank summary
    ['[1,2]', 'invalid_payload'], // non-object payload
  ];
  for (const [payload, code] of invalidPayloads) {
    result = await runChainhistoryCommand(['summary', 'apply', '--payload-file', 'p.json'], makeContext(dependencies, payload));
    assert.equal(result.ok, false, `payload ${payload} should fail`);
    assert.equal(result.code, code);
  }
  assert.deepEqual(calls, [], 'no malformed invocation reaches the handler');
});

test('chainhistory summary verbs without handlers fail not_implemented', async () => {
  // Direct invocation: runCli always merges runtime defaults, so the missing-
  // handler branch is only reachable with a bare context.
  let result = await runChainhistoryCommand(['summary', 'pending', '--from', 'alice'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
  result = await runChainhistoryCommand(['summary', 'apply', '--from', 'alice', '--payload-file', 'p.json'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

test('chainhistory summary unknown nested subcommand fails unknown_command', async () => {
  const result = await runChainhistoryCommand(['summary', 'frobnicate'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');
  assert.equal(await runCli(['chainhistory', 'summary', 'frobnicate'], makeContext({})), 1);
});
