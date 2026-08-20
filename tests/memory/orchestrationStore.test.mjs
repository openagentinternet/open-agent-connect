import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createOrchestrationStore } = require('../../dist/core/memory/orchestrationStore.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-orch-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('task lifecycle: create with steps, dependencies gate readiness, attempts close out', async () => {
  const paths = await createTempProfileHome();
  const store = createOrchestrationStore(paths);

  const task = await store.createTask({
    title: '发布准备',
    goal: '完成明天的发布',
    steps: [
      { workerSlug: 'bob', objective: '整理清单', idempotencyKey: 'k1' },
      { workerSlug: 'carol', objective: '校对文案', dependsOn: ['step-unknown'], idempotencyKey: 'k2' },
    ],
  });
  assert.equal(task.status, 'planning');
  assert.equal(task.steps[0].status, 'ready');
  assert.equal(task.steps[1].status, 'blocked');

  await store.updateTaskStatus(task.id, 'running');
  const attempt = await store.addAttempt(task.id, task.steps[0].id, { dshSessionId: 'dsh-sess-1' });
  assert.equal(attempt.status, 'queued');
  await store.updateAttempt(task.id, task.steps[0].id, attempt.id, { status: 'running' });
  const done = await store.updateAttempt(task.id, task.steps[0].id, attempt.id, {
    status: 'completed',
    handoff: '清单已整理好',
  });
  assert.ok(done.endedAt);

  const unnotified = await store.listUnnotifiedTerminalAttempts();
  assert.equal(unnotified.length, 1);
  await store.markAttemptNotified(task.id, task.steps[0].id, attempt.id);
  assert.equal((await store.listUnnotifiedTerminalAttempts()).length, 0);

  const found = await store.findStepByIdempotencyKey('k1');
  assert.equal(found.step.workerSlug, 'bob');
  assert.equal(await store.activeStepCountForWorker('bob'), 0);
});

test('idempotency keys are unique across all tasks', async () => {
  const paths = await createTempProfileHome();
  const store = createOrchestrationStore(paths);
  await store.createTask({
    title: '甲',
    steps: [{ workerSlug: 'bob', objective: 'x', idempotencyKey: 'dup-key' }],
  });
  await assert.rejects(
    () => store.createTask({
      title: '乙',
      steps: [{ workerSlug: 'carol', objective: 'y', idempotencyKey: 'dup-key' }],
    }),
    /idempotencyKey already in use/,
  );
});

test('active workload counts queued/running steps of open tasks only', async () => {
  const paths = await createTempProfileHome();
  const store = createOrchestrationStore(paths);
  const task = await store.createTask({
    title: '进行中',
    steps: [
      { workerSlug: 'bob', objective: 'a' },
      { workerSlug: 'bob', objective: 'b' },
    ],
  });
  await store.updateTaskStatus(task.id, 'running');
  await store.updateStep(task.id, task.steps[0].id, { status: 'running' });
  await store.updateStep(task.id, task.steps[1].id, { status: 'queued' });
  assert.equal(await store.activeStepCountForWorker('bob'), 2);
  await store.updateStep(task.id, task.steps[0].id, { status: 'completed' });
  assert.equal(await store.activeStepCountForWorker('bob'), 1);
  await store.updateTaskStatus(task.id, 'completed');
  assert.equal(await store.activeStepCountForWorker('bob'), 0);
});
