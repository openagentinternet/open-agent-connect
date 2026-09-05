import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createGroupTaskStore, resolveGroupTaskRoot, GroupTaskStoreError } = require('../../dist/core/grouptask/store.js');

function createStore(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'chair-bot');
  mkdirSync(homeDir, { recursive: true });
  const paths = resolveMetabotPaths(homeDir);
  return { store: createGroupTaskStore(paths), paths };
}

async function createTask(store, overrides = {}) {
  return store.createTask({
    groupId: 'group-pin-1',
    title: 'Write a haiku',
    goal: 'One haiku about autumn',
    chairSlug: 'chair-bot',
    createdBy: 'user',
    ...overrides,
  });
}

test('grouptask store lives under .runtime/grouptask and persists task rows', async () => {
  const { store, paths } = createStore('metabot-grouptask-store-');
  assert.equal(store.root, path.join(paths.runtimeRoot, 'grouptask'));
  assert.equal(resolveGroupTaskRoot(paths), store.root);

  const task = await createTask(store);
  assert.equal(task.id, 1);
  assert.equal(task.status, 'planning');
  assert.equal(task.lastProcessedIndex, -1);
  assert.equal(task.pinned, false);

  const reloaded = await store.getTaskById(task.id);
  assert.equal(reloaded.title, 'Write a haiku');
  assert.equal((await store.getTaskByGroupId('group-pin-1')).id, task.id);
  assert.equal(await store.getTaskByGroupId('group-pin-unknown'), null);
});

test('grouptask store enforces the status state machine', async () => {
  const { store } = createStore('metabot-grouptask-fsm-');
  const task = await createTask(store);

  await store.updateTaskStatus(task.id, 'executing', { actor: { kind: 'system' } });
  await store.updateTaskStatus(task.id, 'review');
  // review -> executing is the rework hatch
  await store.updateTaskStatus(task.id, 'executing', { actor: { kind: 'owner' }, reason: 'rework' });
  await store.updateTaskStatus(task.id, 'review');
  const done = await store.updateTaskStatus(task.id, 'done');
  assert.equal(done.status, 'done');
  assert.ok(done.closedAt != null);

  // Terminal: no further transitions
  await assert.rejects(
    () => store.updateTaskStatus(task.id, 'executing'),
    (error) => error instanceof GroupTaskStoreError && error.code === 'illegal_transition',
  );

  const events = await store.listStatusEvents(task.id);
  assert.equal(events.length, 5);
  const transitions = await store.listTransitions(task.id);
  assert.equal(transitions.length, 5);
  assert.equal(transitions.find((t) => t.reason === 'rework').toStatus, 'executing');

  // Illegal from planning
  const other = await createTask(store, { groupId: 'group-pin-2' });
  await assert.rejects(
    () => store.updateTaskStatus(other.id, 'review'),
    (error) => error instanceof GroupTaskStoreError && error.code === 'illegal_transition',
  );
});

test('grouptask store member add / remove / status', async () => {
  const { store } = createStore('metabot-grouptask-members-');
  const task = await createTask(store);

  await store.addMember({ taskId: task.id, slug: 'chair-bot', globalMetaId: 'IDCHAIR', role: 'chair' });
  await store.addMember({ taskId: task.id, slug: 'worker-1', globalMetaId: 'IDWORKER', role: 'worker' });
  const remote = await store.addMember({
    taskId: task.id,
    slug: null,
    globalMetaId: 'IDREMOTE',
    role: 'worker',
    displayName: 'Remote Bot',
  });

  assert.equal((await store.listMembers(task.id)).length, 3);

  const updated = await store.setMemberStatus(task.id, 'worker-1', 'working');
  assert.equal(updated.status, 'working');
  const remoteUpdated = await store.setMemberStatus(task.id, null, 'standby', 'idremote');
  assert.equal(remoteUpdated.id, remote.id);

  const removed = await store.markMemberRemoved({ taskId: task.id, slug: 'worker-1', removePinId: 'pin-rm' });
  assert.equal(removed.removePinId, 'pin-rm');
  assert.equal((await store.listMembers(task.id)).length, 2);
  assert.equal((await store.listMembers(task.id, { includeRemoved: true })).length, 3);

  // Removing a remote member by globalMetaId
  await store.markMemberRemoved({ taskId: task.id, globalMetaId: 'IDREMOTE' });
  assert.equal((await store.listMembers(task.id)).length, 1);
});

test('grouptask store rating validation and local list housekeeping', async () => {
  const { store } = createStore('metabot-grouptask-list-');
  const task = await createTask(store);

  await assert.rejects(
    () => store.updateTaskRating(task.id, 9),
    (error) => error instanceof GroupTaskStoreError && error.code === 'invalid_rating',
  );
  const rated = await store.updateTaskRating(task.id, 5, 'great');
  assert.equal(rated.rating, 5);

  await store.renameTask(task.id, '  My haiku  ');
  assert.equal((await store.getTaskById(task.id)).displayName, 'My haiku');

  const second = await createTask(store, { groupId: 'group-pin-2' });
  await store.setTaskPinned(second.id, true);
  const list = await store.listTasks();
  assert.equal(list[0].id, second.id, 'pinned tasks sort first');

  await store.archiveTask(second.id);
  assert.equal((await store.listTasks()).length, 1);
  assert.equal((await store.listArchivedTasks())[0].id, second.id);
  await store.unarchiveTask(second.id);
  assert.equal((await store.listTasks()).length, 2);
});

test('grouptask store message cache: append dedupes, cursor, working/speak maps', async () => {
  const { store } = createStore('metabot-grouptask-msgs-');
  const groupId = 'group-pin-1';

  const message = (index, extra = {}) => ({
    index,
    pinId: `pin-${index}`,
    txId: `tx-${index}`,
    senderMetaId: 'meta',
    senderGlobalMetaId: 'IDWORKER',
    senderName: 'Worker',
    senderAvatar: null,
    content: `message ${index}`,
    contentType: 'text/plain',
    chainTimestamp: 1_000 + index,
    replyPin: null,
    mention: [],
    senderSuspect: false,
    ...extra,
  });

  assert.equal(await store.getMessageCursor(groupId), -1);
  assert.equal(await store.appendMessages(groupId, [message(0), message(1)]), 2);
  // Duplicate pinIds are ignored
  assert.equal(await store.appendMessages(groupId, [message(1), message(2, { content: '[WORKING] busy' })]), 1);
  assert.equal(await store.getMessageCursor(groupId), 2);

  const page = await store.listMessages(groupId, { limit: 2 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.messages.map((m) => m.index), [1, 2]);
  const older = await store.listMessages(groupId, { beforeIndex: 1 });
  assert.deepEqual(older.messages.map((m) => m.index), [0]);

  assert.equal((await store.getMessageByPinId(groupId, 'pin-2')).content, '[WORKING] busy');

  const speak = await store.getMembersLastSpeakAt(groupId, ['idworker', 'IDOTHER']);
  assert.equal(speak.get('idworker'), 1_002);
  assert.equal(speak.has('idother'), false);

  const working = await store.getMembersWorkingAt(groupId, ['IDWORKER']);
  assert.equal(working.get('idworker'), 1_002, 'only the [WORKING] message counts');
});

test('grouptask store checkpoints, deliverables, kv', async () => {
  const { store } = createStore('metabot-grouptask-cp-');
  const task = await createTask(store);

  const checkpoint = await store.openCheckpoint(task.id, 'style choice', 'pin-cp');
  // Idempotent: a second open returns the existing open checkpoint
  const again = await store.openCheckpoint(task.id, 'other', null);
  assert.equal(again.id, checkpoint.id);

  const resolved = await store.resolveCheckpoint(task.id, 'go classical', 'pin-answer');
  assert.equal(resolved.status, 'resolved');
  assert.equal(await store.resolveCheckpoint(task.id, 'noop', null), null);

  await store.openCheckpoint(task.id, 'second', null);
  assert.equal(await store.closeOpenCheckpoints(task.id, 'cancelled', 'task closed'), 1);
  const checkpoints = await store.listCheckpoints(task.id);
  assert.deepEqual(checkpoints.map((c) => c.status), ['resolved', 'cancelled']);

  const deliverable = await store.addDeliverable({
    taskId: task.id,
    msgPinId: 'pin-d1',
    authorGlobalMetaId: 'IDWORKER',
    kind: 'text',
  });
  assert.equal(deliverable.status, 'pending');
  assert.equal(await store.hasDeliverableWithMsgPin(task.id, 'pin-d1'), true);
  assert.equal(await store.updateDeliverablesStatusByTask(task.id, 'pending', 'rejected'), 1);
  assert.equal((await store.listDeliverables(task.id))[0].status, 'rejected');

  await store.kvSet('group_task_owner_joined:group-pin-1', '1');
  assert.equal(await store.kvGet('group_task_owner_joined:group-pin-1'), '1');
  await store.kvDelete('group_task_owner_joined:group-pin-1');
  assert.equal(await store.kvGet('group_task_owner_joined:group-pin-1'), undefined);
});

test('grouptask store acceptance summaries version and finalize', async () => {
  const { store } = createStore('metabot-grouptask-accept-');
  const task = await createTask(store);

  assert.equal(await store.getLatestAcceptanceSummary(task.id), null);
  await store.addAcceptanceSummary({
    taskId: task.id,
    summary: 'v1 draft',
    deliverableRefs: [],
    outcome: 'review',
    rating: null,
    ratingComment: null,
    publishedGroupPinId: null,
  });
  const v2 = await store.addAcceptanceSummary({
    taskId: task.id,
    summary: 'v2 final',
    deliverableRefs: ['pin-d1'],
    outcome: 'review',
    rating: null,
    ratingComment: null,
    publishedGroupPinId: null,
  });
  assert.equal(v2.version, 2);

  await store.finalizeAcceptanceSummary(task.id, { outcome: 'done', rating: 4, ratingComment: 'ok' });
  const latest = await store.getLatestAcceptanceSummary(task.id);
  assert.equal(latest.version, 2);
  assert.equal(latest.outcome, 'done');
  assert.equal(latest.rating, 4);

  await store.updateAcceptanceSummaryPublishedPin(task.id, 'pin-pub');
  assert.equal((await store.getLatestAcceptanceSummary(task.id)).publishedGroupPinId, 'pin-pub');
});

test('deliverable dedupe lookup and correction reopen reset verification state', async () => {
  const { store } = createStore('metabot-gt-store-deliverable-');
  const task = await createTask(store);
  const row = await store.addDeliverable({
    taskId: task.id,
    msgPinId: 'pin-msg-1',
    authorGlobalMetaId: 'IDWORKER1',
    kind: 'pin',
    uri: 'pin://abc',
  });
  await store.updateDeliverableVerification(row.id, { sources: [] }, 'confirmed', 'delivered');

  const found = await store.findDeliverableByMsgPinAndUri(task.id, 'pin-msg-1', 'pin://abc', 'pin');
  assert.equal(found?.id, row.id);
  assert.equal(await store.findDeliverableByMsgPinAndUri(task.id, 'pin-msg-1', 'pin://other', 'pin'), null);

  const reopened = await store.reopenDeliverable(row.id);
  assert.equal(reopened.status, 'pending');
  assert.equal(reopened.verification, null);
  assert.equal(reopened.confirmation, 'unconfirmed');
  assert.equal(await store.reopenDeliverable(9999), null);
});

// ---------------------------------------------------------------------------
// Phase 2: source session, dispatch pause, supervisor signals
// ---------------------------------------------------------------------------

test('grouptask store: sourceSessionId persists and dispatch pause sets/clears', async () => {
  const { store } = createStore('metabot-grouptask-store-p2-');
  const task = await createTask(store, { sourceSessionId: 'sess-origin-42' });
  assert.equal(task.sourceSessionId, 'sess-origin-42');
  const plain = await createTask(store);
  assert.equal(plain.sourceSessionId, null);

  const paused = await store.setTaskDispatchPaused(task.id, 1234);
  assert.equal(paused.dispatchPausedAt, 1234);
  const resumed = await store.setTaskDispatchPaused(task.id, null);
  assert.equal(resumed.dispatchPausedAt, null);
});

test('grouptask store: supervisor signals append and list per task', async () => {
  const { store } = createStore('metabot-grouptask-store-sig-');
  const task = await createTask(store);
  await store.addSupervisorSignal({ taskId: task.id, signalType: 'pause', note: 'owner busy' });
  await store.addSupervisorSignal({
    taskId: task.id, signalType: 'nudge', memberGlobalMetaId: 'IDWORKER1', memberName: 'worker', note: 'no ACK',
  });
  const signals = await store.listSupervisorSignals(task.id);
  assert.deepEqual(signals.map((signal) => signal.signalType), ['pause', 'nudge']);
  assert.equal(signals[1].memberName, 'worker');
  assert.equal((await store.listSupervisorSignals(999)).length, 0);
});
