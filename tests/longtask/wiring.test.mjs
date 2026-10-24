import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createLongTermStore, longTermStorePaths } = require('../../dist/core/longtask/store.js');
const { runAdvance } = require('../../dist/core/longtask/service.js');

/**
 * The closed loop through the CENTRAL paths registry: a real profile home
 * resolved by `resolveMetabotPaths`, the store built from those keys, and one
 * advance pass on disk. This is what proves the module is reachable from the
 * repository's own mechanisms rather than only from an injected temp object.
 */

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-16T00:00:00.000Z');

test('longtask: a task created through the resolved profile home survives a reopen', async () => {
  const base = mkdtempTempRootSync('metabot-longtask-wire-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  mkdirSync(profileRoot, { recursive: true });
  const paths = resolveMetabotPaths(profileRoot);

  // The registry resolves the store root under the profile's runtime dir.
  assert.ok(paths.longtermRoot.endsWith(path.join('runtime', 'longterm')),
    `unexpected store root: ${paths.longtermRoot}`);

  const store = createLongTermStore(longTermStorePaths(paths));
  await store.createTask({
    id: 't1', title: 'long haul', stage: 'active', nowIso: new Date(T0).toISOString(),
  });
  await store.addSubtask({ taskId: 't1', id: 's1', ordinal: 1, title: 'first step' });

  // Reopened from the same registry keys, the data is there — the files landed
  // where the registry said they would.
  const reopened = createLongTermStore(longTermStorePaths(resolveMetabotPaths(profileRoot)));
  assert.equal((await reopened.listTasks()).length, 1);
  assert.equal((await reopened.listSubtasks('t1')).length, 1);

  // And one advance pass works end to end on that home.
  const result = await runAdvance(reopened, T0 + HOUR);
  assert.deepEqual(result.decisions, [{ taskId: 't1', reasons: ['advance due'] }]);
  assert.equal(result.applied, 1);
  const events = await reopened.listEvents('t1');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'advance');
});

test('longtask: the board reaches the registry-backed store too', async () => {
  const base = mkdtempTempRootSync('metabot-longtask-board-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  mkdirSync(profileRoot, { recursive: true });
  const store = createLongTermStore(longTermStorePaths(resolveMetabotPaths(profileRoot)));
  await store.createTask({ id: 'live', title: 'Live', stage: 'active', nowIso: new Date(T0).toISOString() });
  await store.createTask({ id: 'gone', title: 'Gone', stage: 'cancelled', nowIso: new Date(T0).toISOString() });
  await store.addSubtask({ taskId: 'live', id: 'a', ordinal: 1, title: 'a', status: 'accepted' });
  await store.addSubtask({ taskId: 'live', id: 'b', ordinal: 2, title: 'b', status: 'waiting_owner' });

  const board = await store.getBoard();
  assert.equal(board.find((c) => c.task.id === 'live').column, 'waiting_owner');
  assert.deepEqual(board.find((c) => c.task.id === 'live').progress, { accepted: 1, total: 2, percent: 50 });
  assert.equal(board.find((c) => c.task.id === 'gone').column, null);
});

test('longtask: stage moves, notes and title/goal updates land through the resolved home', async () => {
  const base = mkdtempTempRootSync('metabot-longtask-lifecycle-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  mkdirSync(profileRoot, { recursive: true });
  const store = createLongTermStore(longTermStorePaths(resolveMetabotPaths(profileRoot)));
  await store.createTask({
    id: 'lt1', title: 'Rework', goal: 'old goal', stage: 'active', nowIso: new Date(T0).toISOString(),
  });
  await store.addSubtask({ taskId: 'lt1', id: 's1', ordinal: 1, title: 'first' });

  // What the runtime's `note` handler does, through the same registry keys: a
  // local-actor note pinned to the sub-project (the wait-brief carrier).
  await store.addEvent({
    taskId: 'lt1', subtaskId: 's1', kind: 'note', actor: 'local',
    detail: 'waiting on owner: brief', at: new Date(T0 + 1000).toISOString(),
  });
  // What `set-stage` does: the stage move lands AND is journalled — the
  // planner reads the journal, so silence would read as staleness.
  await store.setTaskStage('lt1', 'paused', new Date(T0 + 2000).toISOString());
  // What `update` does: a title/goal patch plus its journal entry.
  await store.updateTask({ taskId: 'lt1', goal: 'new goal', nowIso: new Date(T0 + 3000).toISOString() });

  const reopened = createLongTermStore(longTermStorePaths(resolveMetabotPaths(profileRoot)));
  const task = await reopened.getTask('lt1');
  assert.equal(task.stage, 'paused');
  assert.equal(task.goal, 'new goal');
  const events = await reopened.listEvents('lt1');
  assert.deepEqual(events.map((event) => event.kind), ['note', 'task_stage', 'task_update']);
  assert.equal(events[0].subtaskId, 's1');
  assert.equal(events[0].actor, 'local');
  assert.equal(events[1].detail, 'active -> paused');
});
