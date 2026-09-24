import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createKbDaemonHandlers } = require('../../dist/daemon/kbHandlers.js');
const { createMemoryDaemonHandlers } = require('../../dist/daemon/memoryHandlers.js');
const { createDreamDaemonHandlers } = require('../../dist/daemon/dreamHandlers.js');
const { createScheduleDaemonHandlers } = require('../../dist/daemon/scheduleHandlers.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createStudyJobStore } = require('../../dist/core/knowledgebase/studyJobs.js');
const { createScheduleStore } = require('../../dist/core/schedule/store.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { deriveSystemHome } = require('../helpers/profileHome.mjs');

/**
 * Factory-level checks: the new daemon handler groups run their ports against
 * real per-profile core stores in temp roots (no HTTP, no daemons).
 */

async function createProfileHome(slug = 'bot-1') {
  const base = await mkdtempTempRoot('oac-local-service-handlers-');
  const homeDir = path.join(base, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  return { homeDir, paths: resolveMetabotPaths(homeDir) };
}

function resolveBotFor(homeDir, slug = 'bot-1') {
  return async (from) => {
    if (from && from !== slug) {
      return { failure: { ok: false, state: 'failed', code: 'profile_not_found', message: `MetaBot profile not found: ${from}` } };
    }
    return { slug, name: 'Bot One', homeDir };
  };
}

test('kb handlers manage knowledge bases and study jobs against the real stores', async () => {
  const { homeDir, paths } = await createProfileHome();
  const kb = createKbDaemonHandlers({ resolveBot: resolveBotFor(homeDir) });

  // list ensures the per-bot default KB exists (IDBots parity).
  const list = await kb.list({ from: 'bot-1' });
  assert.equal(list.ok, true);
  assert.ok(list.data.knowledgeBases.length >= 1, 'default KB ensured');

  const created = await kb.create({ from: 'bot-1', name: 'Research', autoLearn: false });
  assert.equal(created.ok, true);
  const kbId = created.data.knowledgeBase.id;

  const updated = await kb.update({ from: 'bot-1', id: kbId, name: 'Research v2' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.knowledgeBase.name, 'Research v2');

  const foreign = await kb.update({ from: 'bot-1', id: 'kb-missing', name: 'x' });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'kb_not_found');

  // Study round-trip: enqueue → fail to [failed] → retry back to pending.
  const enqueued = await kb.studyEnqueue({ from: 'bot-1', topic: 'metaweb protocols', budgetPins: 7 });
  assert.equal(enqueued.ok, true);
  assert.equal(enqueued.data.created, true);
  const jobId = enqueued.data.job.id;

  const store = createStudyJobStore(paths);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await store.markRunning(jobId);
    await store.failRun(jobId, 'nightly failure');
  }
  const statusAfterFails = await kb.studyList({ from: 'bot-1' });
  const failedJob = statusAfterFails.data.jobs.find((job) => job.id === jobId);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.budgetPins, 7);

  const retried = await kb.studyRetry({ from: 'bot-1', jobId });
  assert.equal(retried.ok, true);
  assert.equal(retried.data.count, 1);
  const statusAfterRetry = await kb.studyList({ from: 'bot-1' });
  assert.equal(statusAfterRetry.data.jobs.find((job) => job.id === jobId).status, 'pending');

  const missingRetry = await kb.studyRetry({ from: 'bot-1', jobId: 'study-nope' });
  assert.equal(missingRetry.ok, false);
  assert.equal(missingRetry.code, 'study_job_not_found');

  const removed = await kb.remove({ from: 'bot-1', id: kbId });
  assert.equal(removed.ok, true);
  assert.equal(removed.data.removed, true);
});

test('memory handlers run entry CRUD and policy round-trips against the real store', async () => {
  const { homeDir } = await createProfileHome();
  const memory = createMemoryDaemonHandlers({ resolveBot: resolveBotFor(homeDir), llmExecutor: null });

  const added = await memory.add({ from: 'bot-1', payload: { text: 'Alice likes oolong tea', usageClass: 'preference' } });
  assert.equal(added.ok, true);
  const id = added.data.memory.id;

  const listed = await memory.list({ from: 'bot-1', query: 'oolong' });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.entries.length, 1);
  assert.equal(listed.data.entries[0].id, id);

  const updated = await memory.update({ from: 'bot-1', payload: { id, text: 'Alice likes green tea' } });
  assert.equal(updated.ok, true);

  const policySet = await memory.policySet({ from: 'bot-1', payload: { memoryEnabled: false, dreamEnabled: true } });
  assert.equal(policySet.ok, true);
  assert.equal(policySet.data.policy.memoryEnabled, false);
  assert.equal(policySet.data.policy.dreamEnabled, true);

  const policyGet = await memory.policyGet({ from: 'bot-1' });
  assert.equal(policyGet.data.override.memoryEnabled, false);
  assert.equal(policyGet.data.effective.memoryEnabled, false);

  const deleted = await memory.delete({ from: 'bot-1', payload: { id } });
  assert.equal(deleted.ok, true);
  const listedAfter = await memory.list({ from: 'bot-1', includeDeleted: false });
  assert.equal(listedAfter.data.entries.length, 0);

  const missingUpdate = await memory.update({ from: 'bot-1', payload: { id: 'mem-nope', text: 'x' } });
  assert.equal(missingUpdate.ok, false);
  assert.equal(missingUpdate.code, 'not_found');

  const hygieneStatus = await memory.hygieneStatus({ from: 'bot-1' });
  assert.equal(hygieneStatus.ok, true);
  assert.equal(typeof hygieneStatus.data.config, 'object');
});

test('dream read verbs work on an empty profile and run guards double-starts', async () => {
  const { homeDir } = await createProfileHome();
  const dream = createDreamDaemonHandlers({ resolveBot: resolveBotFor(homeDir), llmExecutor: null });

  const status = await dream.status({ from: 'bot-1' });
  assert.equal(status.ok, true);
  assert.equal(status.data.summaryCount, 0);
  assert.equal(status.data.hasSelfIdentity, false);

  const due = await dream.due({});
  assert.equal(due.ok, true);
  assert.ok(Array.isArray(due.data.dueDates));

  const summaries = await dream.summaries({ from: 'bot-1', limit: '5' });
  assert.equal(summaries.ok, true);
  assert.deepEqual(summaries.data.summaries, []);

  const identity = await dream.selfIdentity({ from: 'bot-1' });
  assert.equal(identity.ok, true);
  assert.equal(identity.data.text, '');

  const capabilities = await dream.capabilities({ from: 'bot-1' });
  assert.equal(capabilities.ok, true);
  assert.deepEqual(capabilities.data.drafts, []);

  const badDate = await dream.run({ from: 'bot-1', date: '23-09-2026', wait: true });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.code, 'invalid_flag');

  // An empty day completes without any LLM call even with no executor wired.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const emptyRun = await dream.run({ from: 'bot-1', date, wait: true });
  assert.equal(emptyRun.ok, true);
  assert.equal(emptyRun.data.kind, 'empty');
});

test('schedule management verbs mutate the real store and require an explicit from', async () => {
  const { homeDir } = await createProfileHome();
  const systemHomeDir = deriveSystemHome(homeDir);
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Bot One',
    homeDir,
    globalMetaId: 'gm-bot-1',
    mvcAddress: 'mvc-bot-1',
  });
  const group = createScheduleDaemonHandlers({
    systemHomeDir,
    createScheduleStore: (dir) => createScheduleStore(resolveMetabotPaths(dir)),
  });

  const created = await group.create({
    from: 'bot-1',
    name: 'Nightly report',
    prompt: 'summarize the day',
    schedule: { type: 'interval', intervalMs: 60_000 },
    channel: 'daemon',
  });
  assert.equal(created.ok, true);
  const taskId = created.data.task.id;

  const missingFrom = await group.create({
    name: 'x',
    prompt: 'y',
    schedule: { type: 'interval', intervalMs: 1000 },
  });
  assert.equal(missingFrom.ok, false);
  assert.equal(missingFrom.code, 'missing_from');

  const updated = await group.update({ from: 'bot-1', id: taskId, payload: { name: 'Morning report' } });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.task.name, 'Morning report');

  const disabled = await group.disable({ from: 'bot-1', id: taskId });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.task.enabled, false);

  const enabled = await group.enable({ from: 'bot-1', id: taskId });
  assert.equal(enabled.ok, true);
  assert.equal(enabled.data.task.enabled, true);

  const missingTask = await group.enable({ from: 'bot-1', id: 'task-nope' });
  assert.equal(missingTask.ok, false);
  assert.equal(missingTask.code, 'task_not_found');

  const listed = await group.list({ from: 'bot-1' });
  assert.equal(listed.data.tasks.length, 1);

  const deleted = await group.delete({ from: 'bot-1', id: taskId });
  assert.equal(deleted.ok, true);
  const listedAfter = await group.list({ from: 'bot-1' });
  assert.equal(listedAfter.data.tasks.length, 0);
});
