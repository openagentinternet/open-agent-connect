import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createLongTermStore } = require('../../dist/core/longtask/store.js');

/** Long-term task store — the file layout, with the reference's SQL constraints
 *  (CHECK on stage/status, UNIQUE(task_id, ordinal)) enforced at write time. */

const pathsFor = (label) => {
  const root = path.join(mkdtempTempRootSync(`metabot-longterm-${label}-`), 'longterm');
  return {
    root,
    tasksPath: path.join(root, 'tasks.json'),
    subtasksPath: path.join(root, 'subtasks.json'),
    eventsPath: path.join(root, 'events.json'),
    nudgeStatePath: path.join(root, 'nudge-state.json'),
  };
};

const T0 = '2026-10-16T00:00:00.000Z';
const T1 = '2026-10-16T01:00:00.000Z';

test('store: a created task survives a fresh store instance (the file is the truth)', async () => {
  const paths = pathsFor('persist');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'ship the port', goal: 'g', nowIso: T0 });

  const reopened = createLongTermStore(paths);
  const task = await reopened.getTask('t1');
  assert.equal(task.title, 'ship the port');
  assert.equal(task.stage, 'defining', 'a new task starts in defining');
  assert.equal((await reopened.listTasks()).length, 1);
});

test('store: a duplicate ordinal is refused and leaves the file intact', async () => {
  const paths = pathsFor('unique');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });
  await store.addSubtask({ taskId: 't1', id: 's1', ordinal: 1, title: 'first' });

  await assert.rejects(
    () => store.addSubtask({ taskId: 't1', id: 's2', ordinal: 1, title: 'clash' }),
    /ordinal 1 is already used/,
  );
  const rows = await store.listSubtasks('t1');
  assert.equal(rows.length, 1, 'the refused row was not written');
  assert.equal(rows[0].id, 's1');
});

test('store: unknown stage/status and an unknown task are refused at write time', async () => {
  const paths = pathsFor('validate');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });

  await assert.rejects(() => store.createTask({ id: 't2', title: 'T', stage: 'bogus', nowIso: T0 }), /unknown stage/);
  await assert.rejects(
    () => store.addSubtask({ taskId: 't1', id: 's1', ordinal: 1, title: 'x', status: 'bogus' }),
    /unknown status/,
  );
  await assert.rejects(
    () => store.addSubtask({ taskId: 'nope', id: 's1', ordinal: 1, title: 'x' }),
    /no such task/,
  );
  // Negative ordinals are not a thing.
  await assert.rejects(
    () => store.addSubtask({ taskId: 't1', id: 's1', ordinal: -1, title: 'x' }),
    /ordinal must be a non-negative integer/,
  );
});

test('store: a status move appends an audit event and touches the task', async () => {
  const paths = pathsFor('events');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });
  await store.addSubtask({ taskId: 't1', id: 's1', ordinal: 1, title: 'step' });

  await store.updateSubtaskStatus('t1', 's1', 'accepted', T1);
  const events = await store.listEvents('t1');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'subtask_status');
  assert.equal(events[0].subtaskId, 's1');
  assert.equal(events[0].detail, 'pending -> accepted');
  assert.equal((await store.getTask('t1')).updatedAt, T1);

  // Re-setting the same status is not a transition, so it adds no event.
  await store.updateSubtaskStatus('t1', 's1', 'accepted', T1);
  assert.equal((await store.listEvents('t1')).length, 1);
});

test('store: concurrent writes never drop a row (serialized queue)', async () => {
  const paths = pathsFor('concurrent');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.addSubtask({ taskId: 't1', id: `s${index}`, ordinal: index, title: `step ${index}` })),
  );
  const rows = await store.listSubtasks('t1');
  assert.equal(rows.length, 12, 'every concurrent append survived');
  assert.deepEqual(rows.map((row) => row.ordinal), Array.from({ length: 12 }, (_, i) => i));
});

test('store: the board derives column, progress and current from stored sub-tasks', async () => {
  const paths = pathsFor('board');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 'live', title: 'Live', stage: 'active', nowIso: T0 });
  await store.createTask({ id: 'gone', title: 'Gone', stage: 'cancelled', nowIso: T0 });

  await store.addSubtask({ taskId: 'live', id: 'a', ordinal: 1, title: 'a', status: 'accepted' });
  await store.addSubtask({ taskId: 'live', id: 'b', ordinal: 2, title: 'b', status: 'waiting_owner' });
  await store.addSubtask({ taskId: 'live', id: 'c', ordinal: 3, title: 'c', status: 'skipped' });
  await store.addSubtask({ taskId: 'gone', id: 'x', ordinal: 1, title: 'x' });

  const board = await store.getBoard();
  const live = board.find((card) => card.task.id === 'live');
  const gone = board.find((card) => card.task.id === 'gone');

  // b is the lowest open one (a is accepted, c is skipped) and it is waiting on
  // the owner — the column follows the current sub-task.
  assert.equal(live.currentSubtask.id, 'b');
  assert.equal(live.column, 'waiting_owner');
  // 1 accepted of 2 live (the skipped one left both sides), not 1 of 3.
  assert.deepEqual(live.progress, { accepted: 1, total: 2, percent: 50 });

  // A cancelled task keeps its data but has no column.
  assert.equal(gone.column, null);
  assert.equal(gone.progress.total, 1);
});

test('store: a stage move appends an audit event; re-setting the same stage is silent', async () => {
  const paths = pathsFor('stage-events');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });

  const paused = await store.setTaskStage('t1', 'paused', T1);
  assert.equal(paused.stage, 'paused');
  const events = await store.listEvents('t1');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'task_stage');
  assert.equal(events[0].subtaskId, null);
  assert.equal(events[0].actor, 'local');
  assert.equal(events[0].detail, 'defining -> paused');
  assert.equal((await store.getTask('t1')).updatedAt, T1);

  // Re-setting the same stage is not a move, so it adds no event — the same
  // rule as the status move above.
  await store.setTaskStage('t1', 'paused', T1);
  assert.equal((await store.listEvents('t1')).length, 1);

  // An unknown task is null, and nothing lands in any journal.
  assert.equal(await store.setTaskStage('nope', 'paused', T1), null);
  assert.equal((await store.listEvents('t1')).length, 1);
});

test('store: updateTask patches title/goal, journals the change, refuses blank titles', async () => {
  const paths = pathsFor('update');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'Old', goal: 'g1', nowIso: T0 });

  const updated = await store.updateTask({ taskId: 't1', title: 'New', goal: 'g2', nowIso: T1 });
  assert.equal(updated.title, 'New');
  assert.equal(updated.goal, 'g2');
  assert.equal(updated.updatedAt, T1);
  const events = await store.listEvents('t1');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'task_update');
  assert.equal(events[0].detail, 'title: "Old" -> "New"; goal updated');

  // Re-writing the same values is not a change: no second event.
  await store.updateTask({ taskId: 't1', title: 'New', nowIso: T1 });
  assert.equal((await store.listEvents('t1')).length, 1);

  // A blank title is refused at write time, the same posture as the CHECKs.
  await assert.rejects(
    () => store.updateTask({ taskId: 't1', title: '   ', nowIso: T1 }),
    /title must be a non-empty string/,
  );
  // Unknown task: null, nothing written.
  assert.equal(await store.updateTask({ taskId: 'nope', title: 'x', nowIso: T1 }), null);
});

test('store: expectedMinutes round-trips through addSubtask (set → number, absent or invalid → null)', async () => {
  const paths = pathsFor('expected-minutes');
  const store = createLongTermStore(paths);
  await store.createTask({ id: 't1', title: 'T', nowIso: T0 });

  const estimated = await store.addSubtask({ taskId: 't1', id: 's1', ordinal: 1, title: 'a', expectedMinutes: 90 });
  assert.equal(estimated.expectedMinutes, 90);
  const plain = await store.addSubtask({ taskId: 't1', id: 's2', ordinal: 2, title: 'b' });
  assert.equal(plain.expectedMinutes, null);
  const zeroed = await store.addSubtask({ taskId: 't1', id: 's3', ordinal: 3, title: 'c', expectedMinutes: 0 });
  assert.equal(zeroed.expectedMinutes, null, 'non-positive minutes fall back to unestimated');

  // And it survives a reopen — the file is the truth.
  const rows = await createLongTermStore(paths).listSubtasks('t1');
  assert.deepEqual(rows.map((row) => row.expectedMinutes), [90, null, null]);
});
