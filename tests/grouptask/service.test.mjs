import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const service = require('../../dist/core/grouptask/service.js');
const {
  buildKickoffMessage,
  closeGroupTask,
  computeGroupTaskMemberWorkStatus,
  computeGroupTaskStall,
  createGroupTask,
  extractCheckpointDecisionSummary,
  getGroupTaskDetail,
  kickGroupTaskMember,
  listGroupTaskSummaries,
  postGroupTaskMessage,
  reopenGroupTask,
  resolveChairProfile,
  GroupTaskServiceError,
} = service;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

/**
 * Fake dual-endpoint indexer. Group info is always found (created groups are
 * indexed immediately); the member list and history are mutable arrays the
 * test controls.
 */
function createFakeIndexer() {
  const state = {
    members: [],
    history: [],
  };
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('/group-info')) {
      return jsonResponse({ code: 0, data: { groupId: new URL(url).searchParams.get('groupId') } });
    }
    if (url.includes('/group-member-list')) {
      return jsonResponse({ code: 0, data: { list: state.members.map((id) => ({ metaId: id })) } });
    }
    if (url.includes('/group-chat-list-by-index')) {
      const parsed = new URL(url);
      const start = Number(parsed.searchParams.get('startIndex'));
      const size = Number(parsed.searchParams.get('size'));
      const slice = state.history.filter((item) => item.index >= start).slice(0, size);
      return jsonResponse({ code: 0, data: { list: slice } });
    }
    throw new Error(`Unexpected fake indexer URL: ${url}`);
  };
  return { state, fetchImpl };
}

function createFakeContext(prefix, { withTwin = true, owner = true } = {}) {
  const systemHome = mkdtempTempRootSync(prefix);
  const pins = [];
  let pinSeq = 0;

  const makeProfile = (slug, botType, gmid) => {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    mkdirSync(homeDir, { recursive: true });
    return {
      slug,
      homeDir,
      name: slug.replace(/-/gu, ' '),
      globalMetaId: gmid,
      metaId: `meta-${slug}`,
      botType,
      avatar: null,
    };
  };
  const profiles = [
    makeProfile('twin-bot', withTwin ? 'twin' : 'worker', 'IDTWIN'),
    makeProfile('worker-1', 'worker', 'IDWORKER1'),
    makeProfile('worker-2', 'worker', 'IDWORKER2'),
  ];

  const makeSigner = (label) => ({
    async writePin(request) {
      pinSeq += 1;
      const pinId = `pin-${label}-${pinSeq}`;
      pins.push({ label, pinId, ...request });
      return { pinId, txId: `tx-${pinSeq}` };
    },
  });

  const indexer = createFakeIndexer();
  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => (owner
      ? { globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner') }
      : null),
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl: indexer.fetchImpl },
  };
  return { ctx, pins, indexer, profiles, systemHome };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('computeGroupTaskStall flags idle non-terminal tasks only', () => {
  const now = Date.now();
  const fresh = computeGroupTaskStall({ status: 'executing', lastDrivenAt: now - 60_000, updatedAt: now }, now);
  assert.equal(fresh.stall, false);
  const stale = computeGroupTaskStall({ status: 'executing', lastDrivenAt: now - 31 * 60_000, updatedAt: now }, now);
  assert.equal(stale.stall, true);
  const terminal = computeGroupTaskStall({ status: 'done', lastDrivenAt: now - 90 * 60_000, updatedAt: now }, now);
  assert.equal(terminal.stall, false);
  // Falls back to updatedAt when never driven
  const neverDriven = computeGroupTaskStall({ status: 'planning', lastDrivenAt: null, updatedAt: now - 40 * 60_000 }, now);
  assert.equal(neverDriven.stall, true);
});

test('computeGroupTaskMemberWorkStatus follows the IDBots precedence', () => {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  // Fresh [WORKING] wins
  assert.equal(
    computeGroupTaskMemberWorkStatus({ lastSpeakAt: null, lastWorkingAt: nowMs - 60_000, nowMs }),
    'working',
  );
  // Stale [WORKING] + assigned member => timeout
  assert.equal(
    computeGroupTaskMemberWorkStatus({
      lastSpeakAt: nowSec,
      lastWorkingAt: nowMs - 25 * 60_000,
      memberStatus: 'assigned',
      nowMs,
    }),
    'timeout',
  );
  // Self-reported working without signals => working
  assert.equal(
    computeGroupTaskMemberWorkStatus({ lastSpeakAt: null, lastWorkingAt: null, memberStatus: 'working', nowMs }),
    'working',
  );
  // Spoke but no working signal => idle
  assert.equal(
    computeGroupTaskMemberWorkStatus({ lastSpeakAt: nowSec - 600, lastWorkingAt: null, nowMs }),
    'idle',
  );
  // Silence => unknown
  assert.equal(
    computeGroupTaskMemberWorkStatus({ lastSpeakAt: null, lastWorkingAt: null, nowMs }),
    'unknown',
  );
});

test('buildKickoffMessage lists members without @ prefixes', () => {
  const message = buildKickoffMessage({
    title: 'Haiku sprint',
    goal: 'One haiku',
    acceptanceCriteria: '5-7-5',
    chairName: 'Twin Bot',
    memberNames: ['Worker One', 'Worker Two'],
  });
  assert.match(message, /^\[GROUP TASK\] Haiku sprint/u);
  assert.match(message, /Members: Worker One, Worker Two/u);
  assert.doesNotMatch(message, /@Worker/u, 'roster must not use @ (engine reads @ as assignment)');
});

test('extractCheckpointDecisionSummary strips checkpoint tags', () => {
  assert.equal(
    extractCheckpointDecisionSummary('[CHECKPOINT] Should we use  classical style?'),
    'Should we use classical style?',
  );
  assert.equal(extractCheckpointDecisionSummary('[CHECKPOINT_RESOLVED:go]'), null);
  assert.equal(extractCheckpointDecisionSummary(null), null);
});

// ---------------------------------------------------------------------------
// Chair resolution
// ---------------------------------------------------------------------------

test('resolveChairProfile prefers the twin, honors explicit slug, fails without either', async () => {
  const { ctx } = createFakeContext('metabot-gts-chair-');
  assert.equal((await resolveChairProfile(ctx)).slug, 'twin-bot');
  assert.equal((await resolveChairProfile(ctx, 'worker-1')).slug, 'worker-1');

  const { ctx: noTwin } = createFakeContext('metabot-gts-notwin-', { withTwin: false });
  await assert.rejects(
    () => resolveChairProfile(noTwin),
    (error) => error instanceof GroupTaskServiceError && error.code === 'chair_unresolved',
  );
});

// ---------------------------------------------------------------------------
// Create + list + detail
// ---------------------------------------------------------------------------

test('createGroupTask writes create/join/kickoff pins and persists the roster', async () => {
  const { ctx, pins } = createFakeContext('metabot-gts-create-');
  const { chairSlug, task } = await createGroupTask(ctx, {
    title: 'Haiku sprint',
    goal: 'One haiku about autumn',
    acceptanceCriteria: '5-7-5 syllables',
    workerSlugs: ['worker-1', 'worker-2', 'worker-1', 'twin-bot'],
  });

  assert.equal(chairSlug, 'twin-bot');
  assert.equal(task.status, 'planning');
  assert.ok(task.groupId);
  assert.equal(task.openTeam, false);

  // Chair + 2 unique workers (dupes and the chair itself are filtered)
  assert.equal(task.members.length, 3);
  const roles = Object.fromEntries(task.members.map((member) => [member.slug, member.role]));
  assert.deepEqual(roles, { 'twin-bot': 'chair', 'worker-1': 'worker', 'worker-2': 'worker' });

  const byPath = (p) => pins.filter((pin) => pin.path === p);
  assert.equal(byPath('/protocols/simplegroupcreate').length, 1);
  // 2 workers + owner
  assert.equal(byPath('/protocols/simplegroupjoin').length, 3);
  assert.equal(byPath('/protocols/simplegroupchat').length, 1, 'kickoff message');
  const ownerJoin = pins.find((pin) => pin.label === 'owner' && pin.path === '/protocols/simplegroupjoin');
  assert.ok(ownerJoin, 'owner identity joined the group');

  const summaries = await listGroupTaskSummaries(ctx);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].chairSlug, 'twin-bot');
  assert.equal(summaries[0].memberCount, 3);
  assert.equal(summaries[0].openTeam, false);
});

test('createGroupTask skips unavailable local workers and reports them', async () => {
  const { ctx, pins, profiles } = createFakeContext('metabot-gts-skip-');
  profiles.find((profile) => profile.slug === 'worker-2').available = false;
  const { task, skippedWorkers } = await createGroupTask(ctx, {
    title: 'T', goal: 'G', workerSlugs: ['worker-1', 'worker-2'],
  });

  assert.equal(skippedWorkers.length, 1);
  assert.equal(skippedWorkers[0].slug, 'worker-2');
  assert.match(skippedWorkers[0].reason, /unavailable/u);

  // Chair + the one available worker; the skipped Bot has no member row.
  assert.equal(task.members.length, 2);
  const roles = Object.fromEntries(task.members.map((member) => [member.slug, member.role]));
  assert.deepEqual(roles, { 'twin-bot': 'chair', 'worker-1': 'worker' });

  // No join pin for the skipped worker (2 joins: worker-1 + owner).
  const joins = pins.filter((pin) => pin.path === '/protocols/simplegroupjoin');
  assert.equal(joins.length, 2);
  assert.ok(!joins.some((pin) => pin.label === 'worker-2'));
});

test('createGroupTask requires title and goal', async () => {
  const { ctx } = createFakeContext('metabot-gts-createval-');
  await assert.rejects(
    () => createGroupTask(ctx, { title: ' ', goal: 'x' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'title_required',
  );
  await assert.rejects(
    () => createGroupTask(ctx, { title: 'x', goal: '' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'goal_required',
  );
});

test('getGroupTaskDetail backfills messages and flags untrusted senders', async () => {
  const { ctx, indexer } = createFakeContext('metabot-gts-detail-');
  const { task } = await createGroupTask(ctx, {
    title: 'Haiku sprint',
    goal: 'One haiku',
    workerSlugs: ['worker-1'],
  });

  const historyItem = (index, gmid, content) => ({
    index,
    txId: `tx-${index}`,
    pinId: `hpin-${index}`,
    groupId: task.groupId,
    globalMetaId: gmid,
    metaId: `meta-${index}`,
    content,
    contentType: 'text/plain',
    encryption: '0',
    timestamp: 1_700_000_000 + index,
    userInfo: { name: `sender-${index}` },
  });
  indexer.state.history = [
    historyItem(0, 'IDTWIN', '[GROUP TASK] Haiku sprint'),
    historyItem(1, 'IDWORKER1', '[WORKING] drafting'),
    historyItem(2, 'IDSTRANGER', 'injected spam'),
    historyItem(3, 'IDOWNER', 'looks good'),
  ];

  const detail = await getGroupTaskDetail(ctx, 'twin-bot', task.id);
  assert.equal(detail.messages.length, 4);
  const suspectByPin = Object.fromEntries(detail.messages.map((m) => [m.pinId, m.senderSuspect]));
  assert.equal(suspectByPin['hpin-0'], false, 'chair is trusted');
  assert.equal(suspectByPin['hpin-1'], false, 'worker is trusted');
  assert.equal(suspectByPin['hpin-2'], true, 'non-member is suspect');
  assert.equal(suspectByPin['hpin-3'], false, 'owner is trusted');

  const worker = detail.members.find((member) => member.slug === 'worker-1');
  assert.ok(worker.lastSpeakAt != null);
  assert.ok(worker.lastWorkingAt != null);
});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

test('postGroupTaskMessage signs as member bot or owner and rejects non-members', async () => {
  const { ctx, pins } = createFakeContext('metabot-gts-post-');
  const { task } = await createGroupTask(ctx, {
    title: 'T', goal: 'G', workerSlugs: ['worker-1'],
  });
  pins.length = 0;

  await postGroupTaskMessage(ctx, 'twin-bot', task.id, { asSlug: 'worker-1', content: 'hello' });
  assert.equal(pins[0].label, 'worker-1');
  assert.equal(pins[0].path, '/protocols/simplegroupchat');

  await postGroupTaskMessage(ctx, 'twin-bot', task.id, { asOwner: true, content: 'owner says hi' });
  assert.equal(pins.at(-1).label, 'owner');

  await assert.rejects(
    () => postGroupTaskMessage(ctx, 'twin-bot', task.id, { asSlug: 'worker-2', content: 'not in group' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'not_a_member',
  );
  await assert.rejects(
    () => postGroupTaskMessage(ctx, 'twin-bot', task.id, { asSlug: 'worker-1', content: '  ' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'content_required',
  );
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('closeGroupTask accepts with rating; terminal tasks refuse new messages', async () => {
  const { ctx } = createFakeContext('metabot-gts-close-');
  const { task } = await createGroupTask(ctx, { title: 'T', goal: 'G' });

  const closed = await closeGroupTask(ctx, 'twin-bot', task.id, {
    status: 'done',
    rating: 5,
    ratingComment: 'perfect',
  });
  assert.equal(closed.status, 'done');
  assert.equal(closed.rating, 5);
  assert.ok(closed.closedAt != null);

  await assert.rejects(
    () => postGroupTaskMessage(ctx, 'twin-bot', task.id, { asSlug: 'twin-bot', content: 'late' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'task_terminal',
  );
});

test('reopenGroupTask only works from review and rejects pending deliverables', async () => {
  const { ctx, profiles } = createFakeContext('metabot-gts-reopen-');
  const { task } = await createGroupTask(ctx, { title: 'T', goal: 'G' });

  await assert.rejects(
    () => reopenGroupTask(ctx, 'twin-bot', task.id),
    (error) => error instanceof GroupTaskServiceError && error.code === 'not_in_review',
  );

  // Drive to review through the store and add a pending deliverable
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
  const store = createGroupTaskStore(resolveMetabotPaths(profiles[0].homeDir));
  await store.updateTaskStatus(task.id, 'executing');
  await store.updateTaskStatus(task.id, 'review');
  await store.addDeliverable({ taskId: task.id, msgPinId: 'pin-d1' });

  const reopened = await reopenGroupTask(ctx, 'twin-bot', task.id, { reason: 'needs edits' });
  assert.equal(reopened.status, 'executing');
  assert.equal(reopened.deliverables[0].status, 'rejected');
  assert.ok(await store.kvGet(`${service.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`));
});

test('getGroupTaskDetail derives settled member statuses in review and done', async () => {
  const { ctx, profiles } = createFakeContext('metabot-gts-settled-');
  const { task } = await createGroupTask(ctx, {
    title: 'T', goal: 'G', workerSlugs: ['worker-1', 'worker-2'],
  });
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
  const store = createGroupTaskStore(resolveMetabotPaths(profiles[0].homeDir));

  // Execution-phase runtime statuses, frozen mid-flight: worker-1 was marked
  // unreachable but DID deliver; worker-2 was 'working' when the task moved on.
  await store.updateTaskStatus(task.id, 'executing');
  await store.setMemberStatus(task.id, 'worker-1', 'unreachable');
  await store.setMemberStatus(task.id, 'worker-2', 'working');
  await store.addDeliverable({ taskId: task.id, msgPinId: 'pin-d1', authorGlobalMetaId: 'IDWORKER1' });

  // Executing: the live view passes runtime statuses through untouched.
  const live = await getGroupTaskDetail(ctx, 'twin-bot', task.id, { sync: false });
  const liveBySlug = Object.fromEntries(live.members.map((member) => [member.slug, member]));
  assert.equal(liveBySlug['worker-1'].status, 'unreachable');
  assert.equal(liveBySlug['worker-2'].status, 'working');

  // Review: the delivered member reads 'delivered', everyone else 'standby',
  // and the execution-phase work badge is suppressed.
  await store.updateTaskStatus(task.id, 'review');
  const review = await getGroupTaskDetail(ctx, 'twin-bot', task.id, { sync: false });
  const reviewBySlug = Object.fromEntries(review.members.map((member) => [member.slug, member]));
  assert.equal(reviewBySlug['worker-1'].status, 'delivered');
  assert.equal(reviewBySlug['worker-2'].status, 'standby');
  assert.equal(reviewBySlug['twin-bot'].status, 'standby');
  for (const member of review.members) assert.equal(member.workStatus, 'unknown');

  // Stored runtime rows are untouched — a rework back to executing resumes the
  // live view.
  const stored = await store.listMembers(task.id);
  assert.equal(stored.find((member) => member.slug === 'worker-1').status, 'unreachable');
  assert.equal(stored.find((member) => member.slug === 'worker-2').status, 'working');

  // Done: everyone reads 'done', work badge stays suppressed.
  await store.updateTaskStatus(task.id, 'done');
  const done = await getGroupTaskDetail(ctx, 'twin-bot', task.id, { sync: false });
  assert.ok(done.members.length > 0);
  for (const member of done.members) {
    assert.equal(member.status, 'done');
    assert.equal(member.workStatus, 'unknown');
  }
});

test('getGroupTaskDetail does not count a rejected-only deliverable as delivered', async () => {
  const { ctx, profiles } = createFakeContext('metabot-gts-settledrej-');
  const { task } = await createGroupTask(ctx, {
    title: 'T', goal: 'G', workerSlugs: ['worker-1'],
  });
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
  const store = createGroupTaskStore(resolveMetabotPaths(profiles[0].homeDir));

  await store.updateTaskStatus(task.id, 'executing');
  const rejected = await store.addDeliverable({
    taskId: task.id, msgPinId: 'pin-r1', authorGlobalMetaId: 'IDWORKER1',
  });
  await store.updateDeliverableVerification(rejected.id, null, 'unconfirmed', 'rejected');
  await store.updateTaskStatus(task.id, 'review');

  const review = await getGroupTaskDetail(ctx, 'twin-bot', task.id, { sync: false });
  const worker = review.members.find((member) => member.slug === 'worker-1');
  assert.equal(worker.status, 'standby', 'rejected-only deliverable stays standby, not delivered');
});

// ---------------------------------------------------------------------------
// Kick
// ---------------------------------------------------------------------------

test('kickGroupTaskMember removes on-chain via chair, marks the row, confirms via indexer', async () => {
  const { ctx, pins, indexer } = createFakeContext('metabot-gts-kick-');
  const { task } = await createGroupTask(ctx, {
    title: 'T', goal: 'G', workerSlugs: ['worker-1'],
  });
  indexer.state.members = ['meta-twin-bot', 'meta-worker-1'];
  pins.length = 0;

  // Removal not yet reflected: first poll sees the member, so confirmation
  // uses the injected tiny poll budget and reports false; local kick holds.
  const first = await kickGroupTaskMember(ctx, 'twin-bot', task.id, {
    slug: 'worker-1',
    reason: 'inactive',
    confirmPollIntervalMs: 1,
    confirmMaxAttempts: 1,
  });
  assert.equal(first.chainRemovalConfirmed, false);
  assert.ok(first.member.removedAt != null, 'returned member row is marked removed');

  const removePin = pins.find((pin) => pin.path === '/protocols/simplegroupremoveuser');
  assert.ok(removePin, 'chair signed a removeuser pin');
  assert.equal(removePin.label, 'twin-bot');
  assert.equal(JSON.parse(removePin.payload).removeMetaid, 'meta-worker-1');
  const notice = pins.find((pin) => pin.path === '/protocols/simplegroupchat');
  assert.ok(notice, 'deterministic moderation notice posted');

  const detail = await getGroupTaskDetail(ctx, 'twin-bot', task.id, { sync: false });
  assert.equal(detail.members.length, 1, 'kicked member no longer listed');

  // Second kick is idempotent: no new removeuser pin, and once the indexer
  // reflects the removal the confirmation flips to true.
  indexer.state.members = ['meta-twin-bot'];
  pins.length = 0;
  const second = await kickGroupTaskMember(ctx, 'twin-bot', task.id, {
    slug: 'worker-1',
    confirmPollIntervalMs: 1,
    confirmMaxAttempts: 2,
  });
  assert.equal(second.chainRemovalConfirmed, true);
  assert.equal(pins.length, 0, 'no duplicate removeuser pin');

  await assert.rejects(
    () => kickGroupTaskMember(ctx, 'twin-bot', task.id, { slug: 'twin-bot' }),
    (error) => error instanceof GroupTaskServiceError && error.code === 'cannot_kick_chair',
  );
});

// ---------------------------------------------------------------------------
// Single-commander: supervision never posts; close cancels pending wakes
// ---------------------------------------------------------------------------

test('supervise records signals and queues wakes but NEVER posts into the group (single-commander)', async () => {
  const { ctx, pins } = createFakeContext('metabot-gt-supervise-');
  const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
  const { createGroupTaskRelayStore } = require('../../dist/core/grouptask/relayStore.js');
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { task, chairSlug } = await createGroupTask(ctx, {
    title: 'Launch campaign',
    goal: 'Run the launch',
    workerSlugs: ['worker-1'],
    sourceSessionId: 'sess-supervise',
  });
  const chairProfile = await ctx.getProfile(chairSlug);
  const store = createGroupTaskStore(resolveMetabotPaths(chairProfile.homeDir));
  const pinCountAfterCreate = pins.length;

  // pause: state gate set, signal recorded, no group post, relay emitted.
  const paused = await service.superviseGroupTask(ctx, chairSlug, task.id, { action: 'pause' });
  assert.equal(paused.notice, null);
  assert.equal(pins.length, pinCountAfterCreate, 'pause posted nothing');
  assert.equal((await store.getTaskById(task.id)).dispatchPausedAt != null, true);

  // resume: gate cleared, wake queued, no group post.
  const resumed = await service.superviseGroupTask(ctx, chairSlug, task.id, { action: 'resume' });
  assert.equal(resumed.nudgeQueued, true);
  assert.equal(pins.length, pinCountAfterCreate, 'resume posted nothing');
  assert.ok(await store.kvGet(`group_task_nudge_request:${task.id}`), 'resume wake queued');

  // flag: ledger only.
  const flagged = await service.superviseGroupTask(ctx, chairSlug, task.id, { action: 'flag', note: 'watch the scope' });
  assert.equal(flagged.notice, null);
  assert.equal(pins.length, pinCountAfterCreate, 'flag posted nothing');
  const signals = await store.listSupervisorSignals(task.id);
  assert.deepEqual(signals.map((signal) => signal.signalType), ['pause', 'resume', 'flag']);

  // Relay milestones for pause/resume carry the event-time stamp (EP33 P3①).
  const relayRows = await createGroupTaskRelayStore(resolveMetabotPaths(chairProfile.homeDir)).listPending();
  const kinds = relayRows.map((row) => row.kind);
  assert.ok(kinds.includes('created') && kinds.includes('paused') && kinds.includes('resumed'));
  assert.ok(/\(event at \d{4}-\d{2}-\d{2} \d{2}:\d{2} local\)$/u.test(relayRows[0].text), 'stamped origin notice');

  // Closing the task cancels the still-pending supervisor wake (EP33 parity).
  await closeGroupTask(ctx, chairSlug, task.id, { status: 'cancelled', reason: 'owner gave up' });
  assert.equal(await store.kvGet(`group_task_nudge_request:${task.id}`), undefined,
    'pending wake cancelled on close');
  assert.equal(await store.kvGet(`group_task_nudge_attempts:${task.id}`), undefined);
});

test('submitGroupTaskWork: a [NO_REPLY] handoff completes WITHOUT an on-chain post; empty handoff fails', async () => {
  const { ctx, pins } = createFakeContext('metabot-gt-submit-noreply-');
  const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { task, chairSlug } = await createGroupTask(ctx, {
    title: 'Poster', goal: 'Make the poster', workerSlugs: ['worker-1'],
  });
  const chairProfile = await ctx.getProfile(chairSlug);
  const store = createGroupTaskStore(resolveMetabotPaths(chairProfile.homeDir));
  const request = await store.createWorkRequest({
    taskId: task.id, groupId: task.groupId, workerSlug: 'worker-1', targetIndex: 0, targetPinId: null,
  });
  const pinCount = pins.length;

  // IDBots task #66-A: the worker already delivered mid-turn — complete
  // WITHOUT re-posting.
  const done = await service.submitGroupTaskWork(ctx, { requestId: request.id, handoff: '[NO_REPLY]' });
  assert.equal(done.status, 'completed');
  assert.equal(done.pinId, null);
  assert.equal(pins.length, pinCount, 'nothing posted for [NO_REPLY]');
  assert.equal((await store.getWorkRequest(request.id)).status, 'completed');

  // An empty handoff still fails (the engine falls back to its bare-LLM turn).
  const request2 = await store.createWorkRequest({
    taskId: task.id, groupId: task.groupId, workerSlug: 'worker-1', targetIndex: 1, targetPinId: null,
  });
  const failed = await service.submitGroupTaskWork(ctx, { requestId: request2.id, handoff: '  ' });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.error.includes('WORKER_EMPTY_HANDOFF'));
});
