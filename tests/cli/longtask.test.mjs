import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runLongTaskCommand, LONG_TASK_SUBCOMMANDS } = require('../../dist/cli/commands/longtask.js');

/** The command layer: flag parsing and dispatch over the injected handlers. */

const contextWith = (longtask) => ({ dependencies: { longtask } });
const ok = (data) => ({ ok: true, state: 'success', data });

test('longtask: create passes the parsed flags through', async () => {
  const calls = [];
  const result = await runLongTaskCommand(
    ['create', '--id', 't1', '--title', 'long haul', '--goal', 'g', '--from', 'bot'],
    contextWith({ create: async (input) => { calls.push(input); return ok(input); } }),
  );
  assert.equal(result.state, 'success');
  assert.deepEqual(calls, [{ from: 'bot', id: 't1', title: 'long haul', goal: 'g' }]);
});

test('longtask: a missing required flag is refused before any handler runs', async () => {
  let called = 0;
  const context = contextWith({ create: async () => { called += 1; return ok({}); } });
  const noId = await runLongTaskCommand(['create', '--title', 'T'], context);
  assert.equal(noId.ok, false);
  assert.equal(noId.code, 'missing_flag');
  assert.match(noId.message, /--id/);
  const noTitle = await runLongTaskCommand(['create', '--id', 't1'], context);
  assert.equal(noTitle.ok, false);
  assert.match(noTitle.message, /--title/);
  assert.equal(called, 0, 'a refused command never reaches the handler');
});

test('longtask: a non-integer ordinal is refused, depends-on is split', async () => {
  const calls = [];
  const context = contextWith({ addSubtask: async (input) => { calls.push(input); return ok(input); } });
  const bad = await runLongTaskCommand(
    ['add-subtask', '--id', 't1', '--subtask', 's1', '--title', 'x', '--ordinal', 'abc'], context);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'invalid_flag_value');
  assert.match(bad.message, /--ordinal/);
  assert.equal(calls.length, 0);

  const good = await runLongTaskCommand(
    ['add-subtask', '--id', 't1', '--subtask', 's1', '--title', 'x', '--ordinal', '2', '--depends-on', 'a, b'],
    context);
  assert.equal(good.state, 'success');
  assert.deepEqual(calls[0].dependsOn, ['a', 'b']);
  assert.equal(calls[0].ordinal, 2);
});

test('longtask: an unknown verb, an unwired verb and a missing surface are all reported', async () => {
  const unknown = await runLongTaskCommand(['nope'], contextWith({}));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown_command');

  const unwired = await runLongTaskCommand(['advance'], contextWith({}));
  assert.equal(unwired.ok, false);
  assert.equal(unwired.code, 'not_implemented');

  const none = await runLongTaskCommand(['list'], { dependencies: {} });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'not_implemented');

  assert.ok(LONG_TASK_SUBCOMMANDS.includes('advance'));
});

test('longtask: the new lifecycle verbs are registered subcommands', () => {
  for (const sub of ['note', 'set-stage', 'update']) {
    assert.ok(LONG_TASK_SUBCOMMANDS.includes(sub), `missing subcommand: ${sub}`);
  }
});

test('longtask: note passes flags through, --subtask optional, missing --text refused pre-handler', async () => {
  const calls = [];
  const context = contextWith({ note: async (input) => { calls.push(input); return ok(input); } });
  const withSub = await runLongTaskCommand(
    ['note', '--id', 't1', '--subtask', 's1', '--text', 'wait brief: options a/b', '--from', 'bot'], context);
  assert.equal(withSub.state, 'success');
  assert.deepEqual(calls, [{ from: 'bot', id: 't1', subtaskId: 's1', text: 'wait brief: options a/b' }]);

  const noSub = await runLongTaskCommand(['note', '--id', 't1', '--text', 'x'], context);
  assert.equal(noSub.state, 'success');
  assert.equal(calls[1].id, 't1');
  assert.equal(calls[1].subtaskId, undefined);
  assert.equal(calls[1].text, 'x');
  assert.equal(calls[1].from, undefined);

  const missing = await runLongTaskCommand(['note', '--id', 't1'], context);
  assert.equal(missing.code, 'missing_flag');
  assert.match(missing.message, /--text/);
  assert.equal(calls.length, 2, 'a refused command never reaches the handler');
});

test('longtask: set-stage validates the four lifecycle stages before dispatch', async () => {
  const calls = [];
  const context = contextWith({ setStage: async (input) => { calls.push(input); return ok(input); } });
  const good = await runLongTaskCommand(['set-stage', '--id', 't1', '--stage', 'paused', '--from', 'bot'], context);
  assert.equal(good.state, 'success');
  assert.deepEqual(calls, [{ from: 'bot', id: 't1', stage: 'paused' }]);

  // `defining` is store-internal: this surface starts tasks active, so it is
  // not a stage a caller can move anything into.
  const bad = await runLongTaskCommand(['set-stage', '--id', 't1', '--stage', 'defining'], context);
  assert.equal(bad.code, 'invalid_flag_value');
  assert.match(bad.message, /active\|paused\|cancelled\|done/);

  const missing = await runLongTaskCommand(['set-stage', '--id', 't1'], context);
  assert.equal(missing.code, 'missing_flag');
  assert.equal(calls.length, 1);
});

test('longtask: update requires at least one of --title/--goal and passes both through', async () => {
  const calls = [];
  const context = contextWith({ updateTask: async (input) => { calls.push(input); return ok(input); } });
  const both = await runLongTaskCommand(
    ['update', '--id', 't1', '--title', 'New title', '--goal', 'New goal', '--from', 'bot'], context);
  assert.equal(both.state, 'success');
  assert.deepEqual(calls, [{ from: 'bot', id: 't1', title: 'New title', goal: 'New goal' }]);

  const goalOnly = await runLongTaskCommand(['update', '--id', 't1', '--goal', 'g2'], context);
  assert.equal(goalOnly.state, 'success');
  assert.equal(calls[1].goal, 'g2');
  assert.equal(calls[1].title, undefined);

  const neither = await runLongTaskCommand(['update', '--id', 't1'], context);
  assert.equal(neither.code, 'missing_flag');
  assert.match(neither.message, /--title or --goal/);
  assert.equal(calls.length, 2);
});

test('longtask: add-subtask passes --expected-minutes through and refuses non-positive values', async () => {
  const calls = [];
  const context = contextWith({ addSubtask: async (input) => { calls.push(input); return ok(input); } });
  const good = await runLongTaskCommand(
    ['add-subtask', '--id', 't1', '--subtask', 's1', '--title', 'x', '--ordinal', '1', '--expected-minutes', '90'],
    context);
  assert.equal(good.state, 'success');
  assert.equal(calls[0].expectedMinutes, 90);

  const absent = await runLongTaskCommand(
    ['add-subtask', '--id', 't1', '--subtask', 's2', '--title', 'x', '--ordinal', '2'], context);
  assert.equal(absent.state, 'success');
  assert.equal(calls[1].expectedMinutes, undefined);

  for (const bad of ['0', '-5', '1.5', 'abc']) {
    const refused = await runLongTaskCommand(
      ['add-subtask', '--id', 't1', '--subtask', 's3', '--title', 'x', '--ordinal', '3', '--expected-minutes', bad],
      context);
    assert.equal(refused.code, 'invalid_flag_value', `--expected-minutes ${bad} must be refused`);
  }
  assert.equal(calls.length, 2);
});
