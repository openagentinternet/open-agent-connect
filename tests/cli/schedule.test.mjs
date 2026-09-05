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

const ALL_VERBS = [
  'create', 'list', 'show', 'update', 'delete', 'enable', 'disable',
  'run', 'runs', 'due', 'claim', 'complete',
];

function stubScheduleDependencies() {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const schedule = {};
  for (const verb of ALL_VERBS) {
    schedule[verb] = record(verb);
  }
  return { schedule, calls };
}

test('runCli dispatches schedule subcommands to the schedule dependency group', async () => {
  const { schedule, calls } = stubScheduleDependencies();
  const payload = {
    name: 'renamed',
    prompt: 'new prompt',
    schedule: { type: 'cron', expression: '0 9 * * 1' },
    enabled: false,
  };
  const run = (args) => runCli(args, makeContext({ schedule }, payload));

  assert.equal(await run(['schedule', 'create', '--from', 'alice', '--name', 'kb sweep', '--prompt', 'scan', '--every', '60000']), 0);
  assert.equal(await run(['schedule', 'create', '--at', '2026-09-06T08:00:00', '--name', 'x', '--prompt', 'y', '--channel', 'daemon', '--expires-at', '2026-12-31', '--disabled']), 0);
  assert.equal(await run(['schedule', 'create', '--cron', '0 9 * * 1', '--name', 'x', '--prompt', 'y', '--working-directory', '/tmp']), 0);
  assert.equal(await run(['schedule', 'list', '--from', 'alice']), 0);
  assert.equal(await run(['schedule', 'show', '--id', 'task-1', '--from', 'alice']), 0);
  assert.equal(await run(['schedule', 'update', '--id', 'task-1', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['schedule', 'delete', '--id', 'task-1', '--confirm']), 0);
  assert.equal(await run(['schedule', 'enable', '--id', 'task-1']), 0);
  assert.equal(await run(['schedule', 'disable', '--id', 'task-1']), 0);
  assert.equal(await run(['schedule', 'run', '--id', 'task-1']), 0);
  assert.equal(await run(['schedule', 'runs', '--id', 'task-1', '--limit', '7']), 0);
  assert.equal(await run(['schedule', 'due', '--from', 'alice']), 0);
  assert.equal(await run(['schedule', 'due', '--all']), 0);
  assert.equal(await run(['schedule', 'claim', '--id', 'task-1', '--executor', 'host']), 0);
  assert.equal(await run(['schedule', 'complete', '--run-id', 'run-1', '--error', 'llm down']), 0);
  assert.equal(await run(['schedule', 'complete', '--run-id', 'run-1', '--duration-ms', '5000']), 0);

  assert.deepEqual(calls.map(([name]) => name), [
    'create', 'create', 'create', 'list', 'show', 'update', 'delete', 'enable',
    'disable', 'run', 'runs', 'due', 'due', 'claim', 'complete', 'complete',
  ]);

  // create builds the schedule spec from the selector flags.
  assert.deepEqual(calls[0][1].schedule, { type: 'interval', intervalMs: 60000 });
  assert.equal(calls[0][1].from, 'alice');
  assert.equal(calls[0][1].name, 'kb sweep');
  assert.deepEqual(calls[1][1].schedule, { type: 'at', datetime: '2026-09-06T08:00:00' });
  assert.equal(calls[1][1].channel, 'daemon');
  assert.equal(calls[1][1].expiresAt, '2026-12-31');
  assert.equal(calls[1][1].enabled, false);
  assert.deepEqual(calls[2][1].schedule, { type: 'cron', expression: '0 9 * * 1' });
  assert.equal(calls[2][1].workingDirectory, '/tmp');

  // update passes the parsed payload through.
  assert.equal(calls[5][1].id, 'task-1');
  assert.equal(calls[5][1].payload.name, 'renamed');
  assert.deepEqual(calls[5][1].payload.schedule, { type: 'cron', expression: '0 9 * * 1' });

  // runs parses the limit.
  assert.equal(calls[10][1].limit, 7);

  // due --all vs --from.
  assert.equal(calls[11][1].all, undefined);
  assert.equal(calls[12][1].all, true);

  // claim default executor and complete flags.
  assert.equal(calls[13][1].executor, 'host');
  assert.equal(calls[14][1].error, 'llm down');
  assert.equal(calls[15][1].durationMs, 5000);
});

test('runCli rejects malformed schedule invocations', async () => {
  const schedule = {};
  for (const verb of ALL_VERBS) {
    schedule[verb] = async () => commandSuccess({});
  }
  const run = (args) => runCli(args, makeContext({ schedule }, {}));

  // create requires name, prompt, and exactly one schedule selector
  assert.equal(await run(['schedule', 'create', '--name', 'x']), 1);
  assert.equal(await run(['schedule', 'create', '--prompt', 'y']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y', '--at', '2026-09-06T08:00:00', '--every', '60000']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y', '--at', 'not-a-date']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y', '--every', 'abc']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y', '--every', '60000', '--channel', 'bogus']), 1);
  assert.equal(await run(['schedule', 'create', '--name', 'x', '--prompt', 'y', '--every', '60000', '--expires-at', '09-2026']), 1);

  // id-bearing verbs require --id
  for (const verb of ['show', 'delete', 'enable', 'disable', 'run', 'claim']) {
    assert.equal(await run(['schedule', verb]), 1, verb);
  }
  // delete requires --confirm
  assert.equal(await run(['schedule', 'delete', '--id', 'task-1']), 1);
  // update requires --id and --payload-file
  assert.equal(await run(['schedule', 'update']), 1);
  assert.equal(await run(['schedule', 'update', '--id', 'task-1']), 1);
  // claim validates the executor value
  assert.equal(await run(['schedule', 'claim', '--id', 'task-1', '--executor', 'bogus']), 1);
  // complete requires --run-id and validates duration
  assert.equal(await run(['schedule', 'complete']), 1);
  assert.equal(await run(['schedule', 'complete', '--run-id', 'run-1', '--duration-ms', '-5']), 1);
  // runs validates the limit
  assert.equal(await run(['schedule', 'runs', '--limit', 'zero']), 1);
  // due cannot combine --from with --all
  assert.equal(await run(['schedule', 'due', '--from', 'alice', '--all']), 1);
  // unknown subcommand
  assert.equal(await run(['schedule', 'frobnicate']), 1);
});
