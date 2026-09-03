import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const chainHistoryStoreModule = require('../../dist/core/chainhistory/store.js');
const { createChainHistoryStore } = chainHistoryStoreModule;
const { createDreamStore } = require('../../dist/core/memory/dreamStore.js');
const { getDayBoundsMs } = require('../../dist/core/memory/dreamPrompt.js');

const DATE = '2026-08-20';
const { startMs, endMs } = getDayBoundsMs(DATE);
const OLD = startMs - 3 * 86400_000;
const IN_DAY = startMs + 3600_000;

const sec = (ms) => Math.floor(ms / 1000);

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-dream-store-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeTask(overrides = {}) {
  return {
    id: 1,
    groupId: 'grp-1',
    title: 'Task title',
    goal: 'Task goal',
    acceptanceCriteria: null,
    status: 'executing',
    chairSlug: 'test-slug',
    chairGlobalMetaId: 'gm-self',
    createdBy: 'user',
    lastProcessedIndex: -1,
    lastDrivenAt: null,
    createPinId: null,
    createdAt: OLD,
    updatedAt: OLD,
    closedAt: null,
    rating: null,
    ratingComment: null,
    ratedAt: null,
    displayName: null,
    pinned: false,
    archivedAt: null,
    ...overrides,
  };
}

function makeMember(overrides = {}) {
  return {
    id: 1,
    taskId: 1,
    slug: 'test-slug',
    globalMetaId: 'gm-self',
    role: 'chair',
    joinedPinId: null,
    createdAt: OLD,
    displayName: null,
    removedAt: null,
    removePinId: null,
    status: 'assigned',
    statusChangedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides = {}) {
  return {
    index: 0,
    pinId: 'pin-0',
    txId: 'tx-0',
    senderMetaId: 'meta-x',
    senderGlobalMetaId: 'gm-peer',
    senderName: 'Peer',
    senderAvatar: null,
    content: 'hello',
    contentType: 'text',
    chainTimestamp: sec(IN_DAY),
    replyPin: null,
    mention: [],
    senderSuspect: false,
    ...overrides,
  };
}

function emptyGroupTaskState(overrides = {}) {
  return {
    seq: 0,
    tasks: [],
    members: [],
    deliverables: [],
    transitions: [],
    statusEvents: [],
    checkpoints: [],
    integrityEvents: [],
    planChanges: [],
    acceptanceSummaries: [],
    kv: {},
    ...overrides,
  };
}

test('gatherActivity: missing grouptask/order files yield empty group activity', async () => {
  const paths = await createTempProfileHome();
  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });
  assert.deepEqual(activity.sessions, []);
  assert.deepEqual(activity.taskRuns, []);
  assert.equal(activity.orderCount, 0);
  assert.deepEqual(activity.groupTasks, []);
  assert.deepEqual(activity.groupChats, []);
  assert.deepEqual(activity.chainWrites, []);
  assert.deepEqual(activity.chainReads, []);
});

test('gatherActivity: corrupt state files are tolerated as empty', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await fs.mkdir(path.join(grouptaskRoot, 'messages'), { recursive: true });
  await fs.writeFile(path.join(grouptaskRoot, 'state.json'), 'not json{{', 'utf8');
  await fs.writeFile(path.join(grouptaskRoot, 'openteam.json'), '{oops', 'utf8');
  await fs.writeFile(path.join(grouptaskRoot, 'messages', 'grp-1.json'), 'not json either', 'utf8');
  await fs.mkdir(paths.runtimeRoot, { recursive: true });
  await fs.writeFile(paths.runtimeStatePath, 'also not json', 'utf8');

  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });
  assert.equal(activity.orderCount, 0);
  assert.deepEqual(activity.groupTasks, []);
  assert.deepEqual(activity.groupChats, []);
});

test('gatherActivity: accepted/active tasks, role join, guest fallback, orders', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');

  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [
      // Rated + closed in-day, chaired by this profile.
      makeTask({
        id: 1,
        groupId: 'grp-accepted',
        title: '官网落地页',
        goal: '做出落地页',
        status: 'done',
        ratedAt: IN_DAY + 600_000,
        closedAt: IN_DAY + 600_000,
        rating: 5,
        ratingComment: '做得漂亮',
      }),
      // Non-terminal, no chat, but driven in-day -> active via engine drive.
      makeTask({ id: 2, groupId: 'grp-driven', title: '被驱动的任务', chairSlug: 'other-chair', lastDrivenAt: IN_DAY }),
      // Non-terminal with in-day chat -> active via messages.
      makeTask({ id: 3, groupId: 'grp-chatty', title: '热聊中的任务', chairSlug: 'other-chair' }),
      // Terminal but closed before the day -> excluded.
      makeTask({ id: 4, groupId: 'grp-old', title: '旧任务', status: 'done', closedAt: OLD, updatedAt: OLD }),
      // Cancelled in-day without a rating -> accepted, rating null.
      makeTask({ id: 5, groupId: 'grp-cancelled', title: '取消的任务', status: 'cancelled', closedAt: IN_DAY + 300_000 }),
      // Non-terminal with no same-day activity -> excluded.
      makeTask({ id: 6, groupId: 'grp-idle', title: '没动静的任务', lastDrivenAt: OLD }),
    ],
    members: [
      makeMember({ id: 1, taskId: 1, slug: 'test-slug', role: 'chair' }),
      makeMember({ id: 2, taskId: 1, slug: null, globalMetaId: 'gm-worker-1', role: 'worker', displayName: '远程工' }),
      makeMember({ id: 3, taskId: 2, slug: 'test-slug', role: 'worker' }),
      makeMember({ id: 4, taskId: 3, slug: 'test-slug', role: 'worker' }),
    ],
  }));

  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-accepted.json'), {
    messages: [
      makeMessage({ index: 0, pinId: 'pin-old', content: '昨天的消息', chainTimestamp: sec(OLD) }),
      makeMessage({ index: 1, pinId: 'pin-a1', senderGlobalMetaId: 'gm-worker-1', senderName: '远程工', content: '进度汇报', chainTimestamp: sec(IN_DAY) }),
      makeMessage({ index: 2, pinId: 'pin-bad', senderGlobalMetaId: 'gm-bad', senderName: '冒名者', content: '伪造的发言', chainTimestamp: sec(IN_DAY + 60_000), senderSuspect: true }),
      makeMessage({ index: 3, pinId: 'pin-a2', senderGlobalMetaId: 'gm-self', senderName: '我自己', content: '收到，继续推进', chainTimestamp: sec(IN_DAY + 120_000) }),
    ],
    updatedAt: IN_DAY,
  });
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-chatty.json'), {
    messages: [
      makeMessage({ index: 0, pinId: 'pin-c0', content: '第一条', chainTimestamp: sec(IN_DAY + 10_000) }),
      makeMessage({ index: 1, pinId: 'pin-c1', content: '第二条', senderName: null, chainTimestamp: sec(IN_DAY + 20_000) }),
      makeMessage({ index: 2, pinId: 'pin-c2', content: '', chainTimestamp: sec(IN_DAY + 30_000) }),
      makeMessage({ index: 3, pinId: 'pin-c3', content: '第三条', chainTimestamp: sec(IN_DAY + 40_000) }),
    ],
    updatedAt: IN_DAY,
  });
  // Guest group: only known through the OpenTeam membership, and the groupId
  // needs the store's file-name sanitization (':' -> '_').
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp_guest.json'), {
    messages: [
      makeMessage({ index: 0, pinId: 'pin-g0', content: '客串支援第一条', chainTimestamp: sec(IN_DAY + 50_000) }),
      makeMessage({ index: 1, pinId: 'pin-g1', content: '客串支援第二条', chainTimestamp: sec(IN_DAY + 70_000) }),
    ],
    updatedAt: IN_DAY,
  });
  // Orphan cache: the group is unknown locally -> skipped.
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp_orphan.json'), {
    messages: [makeMessage({ index: 0, pinId: 'pin-o0', content: '孤儿消息' })],
    updatedAt: IN_DAY,
  });
  await writeJson(path.join(grouptaskRoot, 'openteam.json'), {
    seq: 1,
    invites: [],
    guestInvites: [],
    memberships: [{
      id: 1,
      groupId: 'grp:guest',
      slug: 'test-slug',
      inviterGlobalMetaId: 'gm-inviter',
      inviterName: null,
      taskTitle: '客串设计支援',
      goalSummary: null,
      inviteId: 'inv-1',
      joinedPinId: 'pin-join',
      status: 'active',
      createdAt: OLD,
      activatedAt: OLD,
      lastProcessedIndex: 1,
      leftAt: null,
      leftCause: null,
      leftReason: null,
    }],
    kv: {},
  });

  await writeJson(paths.runtimeStatePath, {
    identity: null,
    services: [],
    traces: [],
    sellerOrders: [
      { id: 'ord-1', createdAt: IN_DAY, updatedAt: IN_DAY },
      { id: 'ord-2', createdAt: OLD, updatedAt: IN_DAY },
      { id: 'ord-3', createdAt: OLD, updatedAt: OLD },
    ],
  });

  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });

  // Accepted first (rated/closed in-day), then still-active tasks.
  const byTaskId = new Map(activity.groupTasks.map((task) => [task.taskId, task]));
  assert.deepEqual([...byTaskId.keys()].sort(), [1, 2, 3, 5]);

  const accepted = byTaskId.get(1);
  assert.equal(accepted.phase, 'accepted');
  assert.equal(accepted.memberRole, 'chair');
  assert.equal(accepted.rating, 5);
  assert.equal(accepted.ratingComment, '做得漂亮');
  assert.equal(accepted.status, 'done');
  assert.equal(accepted.dayMessageCount, 2);

  const cancelled = byTaskId.get(5);
  assert.equal(cancelled.phase, 'accepted');
  assert.equal(cancelled.rating, null);
  assert.equal(cancelled.ratingComment, null);

  const driven = byTaskId.get(2);
  assert.equal(driven.phase, 'active');
  assert.equal(driven.memberRole, 'worker');
  assert.equal(driven.dayMessageCount, undefined);

  const chatty = byTaskId.get(3);
  assert.equal(chatty.phase, 'active');
  assert.equal(chatty.dayMessageCount, 3);

  // Chats: day windowing, seconds -> ms, suspect + empty-content skips.
  assert.equal(activity.groupChats.length, 3);
  const acceptedChat = activity.groupChats.find((chat) => chat.taskId === 1);
  assert.equal(acceptedChat.title, '官网落地页');
  assert.equal(acceptedChat.taskStatus, 'done');
  assert.equal(acceptedChat.memberRole, 'chair');
  assert.deepEqual(
    acceptedChat.messages.map((message) => message.content),
    ['进度汇报', '收到，继续推进'],
  );
  assert.equal(acceptedChat.messages[0].occurredAt, sec(IN_DAY) * 1000);

  const chattyChat = activity.groupChats.find((chat) => chat.taskId === 3);
  assert.deepEqual(
    chattyChat.messages.map((message) => message.content),
    ['第一条', '第二条', '第三条'],
  );
  assert.equal(chattyChat.messages[1].senderName, 'unknown');

  // Guest group chat falls back to the OpenTeam membership title.
  const guestChat = activity.groupChats.find((chat) => chat.title === '客串设计支援');
  assert.ok(guestChat);
  assert.equal(guestChat.taskId, 0);
  assert.equal(guestChat.memberRole, 'worker');
  assert.equal(guestChat.taskStatus, 'active');
  assert.equal(guestChat.messages.length, 2);

  // Orders created OR updated in-day count; task runs stay empty (no such feature).
  assert.equal(activity.orderCount, 2);
  assert.deepEqual(activity.taskRuns, []);
});

test('gatherActivity: in-day chat messages are capped at the first 200', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [makeTask({ id: 1, groupId: 'grp-busy', title: '繁忙任务' })],
    members: [makeMember({ id: 1, taskId: 1, slug: 'test-slug', role: 'chair' })],
  }));
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-busy.json'), {
    messages: Array.from({ length: 205 }, (_, index) => makeMessage({
      index,
      pinId: `pin-${index}`,
      content: `msg-${index}`,
      chainTimestamp: sec(startMs + index * 1000),
    })),
    updatedAt: IN_DAY,
  });

  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });
  const chat = activity.groupChats.find((entry) => entry.taskId === 1);
  assert.equal(chat.messages.length, 200);
  assert.equal(chat.messages[0].content, 'msg-0');
  assert.equal(chat.messages[199].content, 'msg-199');
  assert.equal(activity.groupTasks[0].phase, 'active');
  assert.equal(activity.groupTasks[0].dayMessageCount, 200);
});

test('gatherActivity: chain writes/reads are included, day-windowed, chronological', async () => {
  const paths = await createTempProfileHome();
  const chainHistory = createChainHistoryStore(paths);

  // Writes: two in-day (recorded out of order), one before the day.
  await chainHistory.recordWrite({
    pinId: 'pin-w-old',
    path: '/protocols/simplebuzz',
    operation: 'create',
    contentText: '昨天的动态',
    contentType: 'text/plain',
    occurredAtMs: OLD,
  });
  await chainHistory.recordWrite({
    pinId: 'pin-w-2',
    path: '/protocols/simplebuzz',
    operation: 'create',
    contentText: '下午发的第二条动态',
    contentType: 'text/plain',
    occurredAtMs: IN_DAY + 180_000,
  });
  await chainHistory.recordWrite({
    pinId: 'pin-w-1',
    contentText: '上午发的第一条动态',
    contentType: 'text/plain',
    occurredAtMs: IN_DAY,
  });
  // The async LLM gist lands on the write record after the fact.
  await chainHistory.applySummaryOutcome('write', 'pin-w-2', { status: 'done', summary: '下午动态的大意' });

  // Reads: two in-day, one before the day. pin-r-1 is read twice (readCount
  // bumps, lastReadAtMs moves) and then marked as saved to the KB.
  await chainHistory.recordRead({ pinId: 'pin-r-old', title: '昨天读的文章', contentText: '旧文', readAtMs: OLD });
  await chainHistory.recordRead({ pinId: 'pin-r-2', protocol: 'metaprotocol', contentText: '第二篇正文', readAtMs: IN_DAY + 240_000 });
  await chainHistory.recordRead({
    pinId: 'pin-r-1',
    path: '/protocols/simplebuzz',
    title: '第一篇长文',
    authorGlobalMetaId: 'gm-author-1',
    contentText: '第一篇正文摘录',
    readAtMs: IN_DAY + 60_000,
  });
  await chainHistory.recordRead({ pinId: 'pin-r-1', readAtMs: IN_DAY + 120_000 });
  await chainHistory.markReadSavedToKb('pin-r-1', 'kb-1');

  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });

  assert.deepEqual(activity.chainWrites.map((write) => write.pinId), ['pin-w-1', 'pin-w-2']);
  const firstWrite = activity.chainWrites[0];
  assert.equal(firstWrite.path, null);
  assert.equal(firstWrite.operation, null);
  assert.equal(firstWrite.contentText, '上午发的第一条动态');
  assert.equal(firstWrite.contentType, 'text/plain');
  assert.equal(firstWrite.summary, null);
  assert.equal(firstWrite.occurredAtMs, IN_DAY);
  const secondWrite = activity.chainWrites[1];
  assert.equal(secondWrite.path, '/protocols/simplebuzz');
  assert.equal(secondWrite.operation, 'create');
  assert.equal(secondWrite.summary, '下午动态的大意');

  assert.deepEqual(activity.chainReads.map((read) => read.pinId), ['pin-r-1', 'pin-r-2']);
  const firstRead = activity.chainReads[0];
  assert.equal(firstRead.title, '第一篇长文');
  assert.equal(firstRead.path, '/protocols/simplebuzz');
  assert.equal(firstRead.protocol, null);
  assert.equal(firstRead.authorGlobalMetaId, 'gm-author-1');
  assert.equal(firstRead.contentExcerpt, '第一篇正文摘录');
  assert.equal(firstRead.savedToKb, true);
  assert.equal(firstRead.readCount, 2);
  assert.equal(firstRead.lastReadAtMs, IN_DAY + 120_000);
  const secondRead = activity.chainReads[1];
  assert.equal(secondRead.protocol, 'metaprotocol');
  assert.equal(secondRead.savedToKb, false);
  assert.equal(secondRead.readCount, 1);
});

test('gatherActivity: chain history is capped at 50 per kind, earliest first', async () => {
  const paths = await createTempProfileHome();
  const chainHistory = createChainHistoryStore(paths);
  for (let index = 0; index < 55; index += 1) {
    await chainHistory.recordWrite({
      pinId: `pin-cap-w-${index}`,
      contentText: `write ${index}`,
      occurredAtMs: startMs + index * 1000,
    });
    await chainHistory.recordRead({
      pinId: `pin-cap-r-${index}`,
      contentText: `read ${index}`,
      readAtMs: startMs + index * 1000,
    });
  }

  const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });
  assert.equal(activity.chainWrites.length, 50);
  assert.equal(activity.chainReads.length, 50);
  assert.equal(activity.chainWrites[0].pinId, 'pin-cap-w-0');
  assert.equal(activity.chainWrites[49].pinId, 'pin-cap-w-49');
  assert.equal(activity.chainReads[0].pinId, 'pin-cap-r-0');
  assert.equal(activity.chainReads[49].pinId, 'pin-cap-r-49');
});

test('gatherActivity: a chain-history store failure degrades to empty arrays', async () => {
  const paths = await createTempProfileHome();
  const original = chainHistoryStoreModule.createChainHistoryStore;
  chainHistoryStoreModule.createChainHistoryStore = () => {
    throw new Error('chain history store unavailable');
  };
  try {
    const activity = await createDreamStore(paths).gatherActivity({ startMs, endMs });
    assert.deepEqual(activity.chainWrites, []);
    assert.deepEqual(activity.chainReads, []);
  } finally {
    chainHistoryStoreModule.createChainHistoryStore = original;
  }
});

test('resetStaleRunningRuns resets only runs past the stale cutoff', async () => {
  const paths = await createTempProfileHome();
  const store = createDreamStore(paths);
  await store.beginRun('2026-08-18', 'llm', 1);
  await store.beginRun('2026-08-19', 'llm', 1);
  await store.beginRun('2026-08-20', 'llm', 1);
  await store.finishRun('2026-08-20', 'completed');
  const now = Date.now();
  // Backdate 08-18 past the cutoff; 08-19 stays fresh.
  const runsPath = paths.memoryDreamRunsPath;
  const file = JSON.parse(await fs.readFile(runsPath, 'utf8'));
  file.runs.find((run) => run.dreamDate === '2026-08-18').startedAt = now - 3600_000;
  file.runs.find((run) => run.dreamDate === '2026-08-19').startedAt = now - 60_000;
  await fs.writeFile(runsPath, JSON.stringify(file), 'utf8');

  const reset = await store.resetStaleRunningRuns({ staleMs: 30 * 60_000, now });
  assert.equal(reset, 1);
  const stale = await store.getRun('2026-08-18');
  assert.equal(stale.status, 'failed');
  assert.equal(stale.error, 'stale running run reset');
  assert.equal(stale.completedAt, now);
  assert.equal((await store.getRun('2026-08-19')).status, 'running');
  assert.equal((await store.getRun('2026-08-20')).status, 'completed');
  // Idempotent: nothing left to reset.
  assert.equal(await store.resetStaleRunningRuns({ staleMs: 30 * 60_000, now }), 0);
});
