import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createScheduleStore,
  computeNextRunAtMs,
} = require('../../dist/core/schedule/store.js');

const NOW = Date.parse('2026-09-05T10:00:00');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-schedule-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

async function readStoreFile(paths) {
  return JSON.parse(await fs.readFile(paths.schedulePath, 'utf8'));
}

async function writeStoreFile(paths, file) {
  await fs.mkdir(path.dirname(paths.schedulePath), { recursive: true });
  await fs.writeFile(paths.schedulePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

test('createTask writes a task with the expected initial state', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);

  const interval = await store.createTask({
    name: 'kb sweep',
    prompt: 'scan metaweb',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  assert.ok(interval.id);
  assert.equal(interval.enabled, true);
  assert.equal(interval.channel, 'auto');
  assert.equal(interval.expiresAt, null);
  assert.equal(interval.state.consecutiveErrors, 0);
  assert.equal(interval.state.lastStatus, null);
  assert.equal(interval.state.nextRunAtMs, NOW + 60_000);
  assert.equal(interval.createdAt, interval.updatedAt);

  const at = await store.createTask({
    name: 'one-shot',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-06T08:30:00' },
    channel: 'daemon',
    expiresAt: '2026-12-31',
  }, { now: NOW });
  assert.equal(at.enabled, true);
  assert.equal(at.channel, 'daemon');
  assert.equal(at.expiresAt, '2026-12-31');
  assert.equal(at.state.nextRunAtMs, Date.parse('2026-09-06T08:30:00'));

  // Disabled tasks carry no next occurrence until re-enabled.
  const disabled = await store.createTask({
    name: 'disabled',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
    enabled: false,
  }, { now: NOW });
  assert.equal(disabled.state.nextRunAtMs, null);

  const cron = await store.createTask({
    name: 'weekly',
    prompt: 'p',
    schedule: { type: 'cron', expression: '0 9 * * 1' },
  }, { now: NOW });
  assert.ok(cron.state.nextRunAtMs > NOW);
});

test('createTask rejects invalid schedules', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  await assert.rejects(
    store.createTask({ name: 'x', prompt: 'p', schedule: { type: 'interval', intervalMs: 1000 } }),
    /60000/,
  );
  await assert.rejects(
    store.createTask({ name: 'x', prompt: 'p', schedule: { type: 'at', datetime: 'not-a-date' } }),
    /datetime/i,
  );
  await assert.rejects(
    store.createTask({ name: 'x', prompt: 'p', schedule: { type: 'cron', expression: '0 9 * *' } }),
    /cron/i,
  );
  await assert.rejects(
    store.createTask({ name: '', prompt: 'p', schedule: { type: 'interval', intervalMs: 60_000 } }),
    /name/i,
  );
  await assert.rejects(
    store.createTask({ name: 'x', prompt: '', schedule: { type: 'interval', intervalMs: 60_000 } }),
    /prompt/i,
  );
});

test('listDue applies enabled, expiry, running, and nextRunAtMs filters', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);

  const due = await store.createTask({
    name: 'due now',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-05T09:00:00' },
  }, { now: NOW });
  const disabled = await store.createTask({
    name: 'disabled',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-05T09:00:00' },
    enabled: false,
  }, { now: NOW });
  const future = await store.createTask({
    name: 'future',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-05T11:00:00' },
  }, { now: NOW });
  const expired = await store.createTask({
    name: 'expired',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-05T09:00:00' },
    expiresAt: '2026-09-04',
  }, { now: NOW });

  assert.deepEqual(
    (await store.listDue({ now: NOW })).map((task) => task.id),
    [due.id],
  );

  // Running tasks are excluded by the runningAtMs guard.
  await store.claim(due.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW });
  assert.equal((await store.listDue({ now: NOW })).length, 0);
  assert.equal(disabled.enabled, false);
  assert.ok(future.state.nextRunAtMs > NOW);
  assert.equal(expired.expiresAt, '2026-09-04');
});

test('claim is exclusive and rejects expired tasks', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);

  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });

  const first = await store.claim(task.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.run.status, 'running');
  assert.equal(first.run.trigger, 'scheduled');
  assert.equal(first.run.executor, 'host');

  const second = await store.claim(task.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW + 1000 });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'already_running');

  const expired = await store.createTask({
    name: 'expired',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
    expiresAt: '2026-09-04',
  }, { now: NOW });
  const expiredClaim = await store.claim(expired.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW });
  assert.equal(expiredClaim.ok, false);
  assert.equal(expiredClaim.code, 'task_expired');

  const missing = await store.claim('no-such-id', { trigger: 'scheduled', executor: 'host' }, { now: NOW });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'task_not_found');
});

test('complete settles the run and applies bookkeeping', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });

  const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW });
  const done = await store.complete(claimed.run.id, {}, { now: NOW + 5000 });
  assert.equal(done.settled, true);
  assert.equal(done.run.status, 'success');
  assert.equal(done.run.error, null);
  assert.equal(done.run.durationMs, 5000);
  assert.ok(done.run.finishedAt);
  assert.equal(done.task.state.lastStatus, 'success');
  assert.equal(done.task.state.lastRunAtMs, NOW);
  assert.equal(done.task.state.consecutiveErrors, 0);
  assert.equal(done.task.state.nextRunAtMs, NOW + 5000 + 60_000);
  assert.equal(done.task.state.runningAtMs, null);

  // Error settle records the message and increments the counter.
  const claimed2 = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW + 60_000 });
  const failed = await store.complete(claimed2.run.id, { error: 'llm down' }, { now: NOW + 60_000 + 1000 });
  assert.equal(failed.run.status, 'error');
  assert.equal(failed.run.error, 'llm down');
  assert.equal(failed.task.state.consecutiveErrors, 1);
  assert.equal(failed.task.state.lastError, 'llm down');

  // A double complete is a no-op (idempotent settle).
  const again = await store.complete(claimed2.run.id, { error: 'late' }, { now: NOW + 60_000 + 2000 });
  assert.equal(again.settled, false);
  assert.equal(again.run.status, 'error');
  assert.equal(again.task.state.consecutiveErrors, 1);

  const missing = await store.complete('no-such-run', {}, { now: NOW });
  assert.deepEqual(missing, { notFound: true });
});

test('auto-disable after 5 consecutive errors; success resets the counter', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 'boom',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });

  for (let i = 0; i < 5; i += 1) {
    const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW + i * 1000 });
    const result = await store.complete(claimed.run.id, { error: `e${i}` }, { now: NOW + i * 1000 + 500 });
    assert.equal(result.task.state.consecutiveErrors, i + 1);
  }
  const after = await store.getTask(task.id);
  assert.equal(after.enabled, false);
  assert.equal(after.state.nextRunAtMs, null);

  // Re-enabling resets nothing by itself; a success clears the counter.
  await store.setEnabled(task.id, true, { now: NOW + 10_000 });
  const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW + 10_000 });
  const result = await store.complete(claimed.run.id, {}, { now: NOW + 10_000 + 500 });
  assert.equal(result.task.state.consecutiveErrors, 0);
  assert.equal(result.task.state.nextRunAtMs, NOW + 10_000 + 500 + 60_000);
});

test('one-shot at tasks auto-disable after any execution', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 'one-shot',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-05T11:00:00' },
  }, { now: NOW });

  const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW + 3600_000 });
  const failed = await store.complete(claimed.run.id, { error: 'x' }, { now: NOW + 3600_000 + 500 });
  assert.equal(failed.task.enabled, false);
  assert.equal(failed.task.state.nextRunAtMs, null);

  // A second occurrence must never fire again.
  assert.equal((await store.listDue({ now: NOW + 7200_000 })).some((t) => t.id === task.id), false);
});

test('setEnabled returns TASK_EXPIRED and TASK_AT_PAST warnings and recomputes the schedule', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);

  const expired = await store.createTask({
    name: 'expired',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
    expiresAt: '2026-09-04',
    enabled: false,
  }, { now: NOW });
  const enableExpired = await store.setEnabled(expired.id, true, { now: NOW });
  assert.deepEqual(enableExpired.warnings, ['TASK_EXPIRED']);
  assert.equal(enableExpired.task.enabled, true);

  const past = await store.createTask({
    name: 'past',
    prompt: 'p',
    schedule: { type: 'at', datetime: '2026-09-01T08:00:00' },
    enabled: false,
  }, { now: NOW });
  const enablePast = await store.setEnabled(past.id, true, { now: NOW });
  assert.deepEqual(enablePast.warnings, ['TASK_AT_PAST']);
  assert.equal(enablePast.task.state.nextRunAtMs, Date.parse('2026-09-01T08:00:00'));

  // Disabling clears the next occurrence; a fresh enable recomputes it.
  const interval = await store.createTask({
    name: 'interval',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  await store.setEnabled(interval.id, false, { now: NOW + 1000 });
  assert.equal((await store.getTask(interval.id)).state.nextRunAtMs, null);
  const reEnabled = await store.setEnabled(interval.id, true, { now: NOW + 2000 });
  assert.equal(reEnabled.task.state.nextRunAtMs, NOW + 2000 + 60_000);
  assert.deepEqual(reEnabled.warnings, []);

  const missing = await store.setEnabled('no-such-id', true, { now: NOW });
  assert.deepEqual(missing, { notFound: true });
});

test('updateTask partially updates fields and recomputes the schedule', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 'old name',
    prompt: 'old prompt',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });

  const updated = await store.updateTask(task.id, {
    name: 'new name',
    prompt: 'new prompt',
    schedule: { type: 'cron', expression: '0 9 * * 1' },
  }, { now: NOW + 1000 });
  assert.ok(!('notFound' in updated));
  assert.equal(updated.task.name, 'new name');
  assert.equal(updated.task.prompt, 'new prompt');
  assert.equal(updated.task.schedule.type, 'cron');
  assert.ok(updated.task.state.nextRunAtMs > NOW + 1000);

  // Name-only updates leave the schedule math untouched.
  const before = updated.task.state.nextRunAtMs;
  const renamed = await store.updateTask(task.id, { name: 'third name' }, { now: NOW + 2000 });
  assert.ok(!('notFound' in renamed));
  assert.equal(renamed.task.state.nextRunAtMs, before);

  const missing = await store.updateTask('no-such-id', { name: 'x' }, { now: NOW });
  assert.deepEqual(missing, { notFound: true });
});

test('deleteTask removes the task and its runs', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW });

  const deleted = await store.deleteTask(task.id);
  assert.deepEqual(deleted, { deleted: true });
  assert.equal(await store.getTask(task.id), null);
  assert.equal((await store.listRuns({ taskId: task.id })).length, 0);
  assert.equal((await store.listRuns()).length, 0);

  assert.deepEqual(await store.deleteTask(task.id), { deleted: false });
  assert.ok(claimed.ok);
});

test('crash recovery flips running runs to error on load without touching the task', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW });

  // Simulate a crashed process: a run row stuck in `running` on disk.
  const file = await readStoreFile(paths);
  file.runs.find((run) => run.id === claimed.run.id).status = 'running';
  await writeStoreFile(paths, file);

  const runs = await store.listRuns({ taskId: task.id });
  assert.equal(runs[0].status, 'error');
  assert.equal(runs[0].error, 'Process stopped during execution');

  // The task state is untouched: no consecutiveErrors increment, and the
  // in-flight marker stays so a crashed host cannot double-fire.
  const after = await store.getTask(task.id);
  assert.equal(after.state.consecutiveErrors, 0);
  assert.equal(after.state.runningAtMs, NOW);
});

test('the stale-running sweep on due/claim un-wedges a crashed host claim', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  await store.claim(task.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW - 31 * 60_000 });

  // The claim happened 31 minutes ago; due sweeps it without incrementing
  // consecutiveErrors, and the next occurrence is recomputed from now.
  const due = await store.listDue({ now: NOW });
  assert.equal(due.some((entry) => entry.id === task.id), false);
  const after = await store.getTask(task.id);
  assert.equal(after.state.runningAtMs, null);
  assert.equal(after.state.consecutiveErrors, 0);
  assert.equal(after.state.nextRunAtMs, NOW + 60_000);

  // A fresh claim is never swept.
  const fresh = await store.createTask({
    name: 'fresh',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  await store.claim(fresh.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW });
  await store.listDue({ now: NOW + 1000 });
  assert.equal((await store.getTask(fresh.id)).state.runningAtMs, NOW);
});

test('a stale swept claim can be claimed again and settled by the late host completion', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  const hostClaim = await store.claim(task.id, { trigger: 'scheduled', executor: 'host' }, { now: NOW - 31 * 60_000 });

  // Due sweep clears the wedge; a daemon claim now succeeds.
  await store.listDue({ now: NOW });
  const daemonClaim = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW });
  assert.equal(daemonClaim.ok, true);

  // The dead host's late completion lands on the ORIGINAL run id, which the
  // load flip already settled to error — the idempotency guard sees the task
  // no longer in flight and leaves everything alone.
  const late = await store.complete(hostClaim.run.id, {}, { now: NOW + 1000 });
  assert.equal(late.settled, false);
  assert.equal((await store.getTask(task.id)).state.runningAtMs, NOW);
});

test('run history is pruned to 100 runs per task', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 't',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });

  for (let i = 0; i < 120; i += 1) {
    const claimed = await store.claim(task.id, { trigger: 'scheduled', executor: 'daemon' }, { now: NOW + i * 1000 });
    await store.complete(claimed.run.id, {}, { now: NOW + i * 1000 + 500 });
  }
  const runs = await store.listRuns({ taskId: task.id });
  assert.equal(runs.length, 100);
  assert.equal(runs[0].startedAt, new Date(NOW + 119 * 1000).toISOString());
});

test('computeNextRunAtMs implements fire-once catch-up for interval and cron', async () => {
  const paths = await createTempProfileHome();
  const store = createScheduleStore(paths);
  const interval = await store.createTask({
    name: 'interval',
    prompt: 'p',
    schedule: { type: 'interval', intervalMs: 60_000 },
  }, { now: NOW });
  // A missed interval occurrence fires once at catch-up, then the next is
  // recomputed from the settle time — no interval storm.
  assert.equal(interval.state.nextRunAtMs, NOW + 60_000);
  assert.equal(computeNextRunAtMs(interval, NOW + 3600_000), NOW + 3600_000 + 60_000);

  const cron = await store.createTask({
    name: 'cron',
    prompt: 'p',
    schedule: { type: 'cron', expression: '*/30 * * * *' },
  }, { now: NOW });
  assert.equal(computeNextRunAtMs(cron, NOW), NOW + 30 * 60_000);
  // Past missed occurrences are not re-emitted: strictly-after semantics.
  assert.ok(computeNextRunAtMs(cron, NOW + 90 * 60_000) > NOW + 90 * 60_000);
});
