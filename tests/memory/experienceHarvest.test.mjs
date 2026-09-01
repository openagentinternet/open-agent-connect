import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createExperienceStore } = require('../../dist/core/memory/experienceStore.js');
const { harvestDreamDayExperiences } = require('../../dist/core/memory/experienceHarvest.js');
const { getDayBoundsMs } = require('../../dist/core/memory/dreamPrompt.js');

const DATE = '2026-08-20';
const { startMs, endMs } = getDayBoundsMs(DATE);
const OLD = startMs - 3 * 86400_000;
const IN_DAY = startMs + 3600_000;
const OBSERVER = 'gm-self';

const sec = (ms) => Math.floor(ms / 1000);

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-harvest-test-');
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
    groupId: 'grp-task',
    title: '官网落地页',
    goal: '做出落地页',
    status: 'done',
    chairSlug: 'test-slug',
    chairGlobalMetaId: OBSERVER,
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
    globalMetaId: OBSERVER,
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
    senderGlobalMetaId: 'gm-peer-1',
    senderName: '远程工',
    senderAvatar: null,
    content: '进度汇报',
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

async function countLedger(store) {
  const episodes = await store.listEpisodes({});
  let participants = 0;
  let evidence = 0;
  for (const episode of episodes) {
    participants += (await store.listParticipants(episode.id)).length;
    evidence += (await store.listEvidence(episode.id)).length;
  }
  return { episodes: episodes.length, participants, evidence };
}

test('harvest folds an in-day chat + accepted task into one episode per group', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [makeTask({
      id: 1,
      ratedAt: IN_DAY + 600_000,
      closedAt: IN_DAY + 600_000,
      rating: 4,
      ratingComment: '交付质量不错',
    })],
    members: [
      makeMember({ id: 1, taskId: 1, slug: 'test-slug', globalMetaId: OBSERVER, role: 'chair' }),
      makeMember({ id: 2, taskId: 1, slug: null, globalMetaId: 'gm-peer-1', role: 'worker', displayName: '远程工' }),
    ],
  }));
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-task.json'), {
    messages: [
      makeMessage({ index: 0, pinId: 'pin-old', content: '昨天的消息', chainTimestamp: sec(OLD) }),
      makeMessage({ index: 1, pinId: 'pin-m1', senderGlobalMetaId: 'gm-peer-1', senderName: '远程工', content: '进度汇报', chainTimestamp: sec(IN_DAY) }),
      makeMessage({ index: 2, pinId: 'pin-bad', senderGlobalMetaId: 'gm-bad', senderName: '冒名者', content: '伪造的发言', chainTimestamp: sec(IN_DAY + 30_000), senderSuspect: true }),
      makeMessage({ index: 3, pinId: 'pin-m2', senderGlobalMetaId: OBSERVER, senderName: '我自己', content: '收到', chainTimestamp: sec(IN_DAY + 60_000) }),
    ],
    updatedAt: IN_DAY,
  });

  const experienceStore = createExperienceStore(paths);
  const result = await harvestDreamDayExperiences({
    paths,
    experienceStore,
    observerGlobalMetaId: OBSERVER,
    date: DATE,
    startMs,
    endMs,
  });
  assert.equal(result.episodes, 1);

  const episodes = await experienceStore.listEpisodes({ ownerGlobalMetaId: OBSERVER });
  assert.equal(episodes.length, 1);
  const episode = episodes[0];
  assert.equal(episode.episodeType, 'task_participation');
  assert.equal(episode.sourceChannel, 'metaweb_group');
  assert.equal(episode.sourceKey, `grouptask-chat:grp-task:${DATE}`);
  assert.equal(episode.taskId, '1');
  assert.equal(episode.status, 'completed');
  assert.equal(episode.startedAt, sec(IN_DAY) * 1000);
  assert.equal(episode.endedAt, sec(IN_DAY + 60_000) * 1000);

  // Participants: the observer plus the resolvable same-day sender — the
  // suspect sender is never attributed.
  const participants = await experienceStore.listParticipants(episode.id);
  assert.deepEqual(
    participants.map((participant) => participant.globalMetaId).sort(),
    ['gm-peer-1', OBSERVER],
  );
  assert.ok(!participants.some((participant) => participant.globalMetaId === 'gm-bad'));

  // Evidence: pin/hash references for the two in-day messages, plus the
  // acceptance row — and never the raw review text.
  const evidence = await experienceStore.listEvidence(episode.id);
  const messages = evidence.filter((entry) => entry.evidenceType === 'group_task_message');
  assert.deepEqual(messages.map((entry) => entry.pinId).sort(), ['pin-m1', 'pin-m2']);
  assert.ok(messages.every((entry) => /^[0-9a-f]{40}$/.test(entry.contentHash)));
  assert.ok(messages.every((entry) => entry.occurredAt >= startMs && entry.occurredAt < endMs));
  const acceptance = evidence.find((entry) => entry.evidenceType === 'group_task_acceptance');
  assert.ok(acceptance);
  assert.equal(acceptance.sourceKey, `grouptask:1:${DATE}:acceptance`);
  assert.equal(acceptance.metadata.rating, 4);
  assert.ok(!JSON.stringify(acceptance).includes('交付质量不错'));
});

test('harvest opens a per-task day episode for an accepted task without chat', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [makeTask({
      id: 2,
      groupId: null,
      title: '被否掉的任务',
      status: 'cancelled',
      closedAt: IN_DAY,
      rating: 2,
      ratingComment: '差评原因',
    })],
    members: [
      makeMember({ id: 1, taskId: 2, slug: 'test-slug', globalMetaId: OBSERVER, role: 'chair' }),
      makeMember({ id: 2, taskId: 2, slug: null, globalMetaId: 'gm-peer-2', role: 'worker' }),
    ],
  }));

  const experienceStore = createExperienceStore(paths);
  const result = await harvestDreamDayExperiences({
    paths,
    experienceStore,
    observerGlobalMetaId: OBSERVER,
    date: DATE,
    startMs,
    endMs,
  });
  assert.equal(result.episodes, 1);

  const episodes = await experienceStore.listEpisodes({ ownerGlobalMetaId: OBSERVER });
  const episode = episodes[0];
  assert.equal(episode.sourceKey, `grouptask:2:${DATE}`);
  assert.equal(episode.status, 'abandoned');
  assert.equal(episode.startedAt, IN_DAY);

  const participants = await experienceStore.listParticipants(episode.id);
  assert.deepEqual(
    participants.map((participant) => participant.globalMetaId).sort(),
    ['gm-peer-2', OBSERVER],
  );
  const evidence = await experienceStore.listEvidence(episode.id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].evidenceType, 'group_task_acceptance');
  assert.ok(!JSON.stringify(evidence[0]).includes('差评原因'));
});

test('harvest records in-day seller orders with buyer/seller participants', async () => {
  const paths = await createTempProfileHome();
  await writeJson(paths.runtimeStatePath, {
    identity: null,
    services: [],
    traces: [],
    sellerOrders: [{
      id: 'ord-1',
      state: 'completed',
      providerGlobalMetaId: OBSERVER,
      buyerGlobalMetaId: 'gm-buyer',
      serviceName: '天气服务',
      servicePinId: 'pin-service',
      orderPinId: 'pin-order-1',
      createdAt: IN_DAY,
      updatedAt: IN_DAY + 1000,
      endedAt: IN_DAY + 2000,
    }],
  });

  const experienceStore = createExperienceStore(paths);
  const result = await harvestDreamDayExperiences({
    paths,
    experienceStore,
    observerGlobalMetaId: OBSERVER,
    date: DATE,
    startMs,
    endMs,
  });
  assert.equal(result.episodes, 1);

  const episodes = await experienceStore.listEpisodes({ ownerGlobalMetaId: OBSERVER });
  const episode = episodes[0];
  assert.equal(episode.episodeType, 'service_order');
  assert.equal(episode.sourceChannel, 'service_order');
  assert.equal(episode.sourceKey, 'order:ord-1');
  assert.equal(episode.status, 'completed');
  assert.equal(episode.startedAt, IN_DAY);
  assert.equal(episode.endedAt, IN_DAY + 2000);

  const participants = await experienceStore.listParticipants(episode.id);
  const rolesById = new Map(participants.map((participant) => [participant.globalMetaId, participant.role]));
  assert.equal(rolesById.get(OBSERVER), 'seller');
  assert.equal(rolesById.get('gm-buyer'), 'buyer');

  const evidence = await experienceStore.listEvidence(episode.id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceKey, 'order:ord-1:completed');
  assert.equal(evidence[0].pinId, 'pin-order-1');
});

test('harvest is idempotent across re-dreams and repair runs', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [makeTask({ id: 1, ratedAt: IN_DAY, closedAt: IN_DAY, rating: 5, ratingComment: '非常棒' })],
    members: [
      makeMember({ id: 1, taskId: 1, slug: 'test-slug', globalMetaId: OBSERVER, role: 'chair' }),
      makeMember({ id: 2, taskId: 1, slug: null, globalMetaId: 'gm-peer-1', role: 'worker' }),
    ],
  }));
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-task.json'), {
    messages: [
      makeMessage({ index: 1, pinId: 'pin-m1' }),
      makeMessage({ index: 2, pinId: 'pin-m2', senderGlobalMetaId: OBSERVER, content: '收到' }),
    ],
    updatedAt: IN_DAY,
  });
  await writeJson(paths.runtimeStatePath, {
    identity: null,
    services: [],
    traces: [],
    sellerOrders: [{
      id: 'ord-1',
      state: 'in_progress',
      providerGlobalMetaId: OBSERVER,
      buyerGlobalMetaId: 'gm-buyer',
      createdAt: IN_DAY,
      updatedAt: IN_DAY,
    }],
  });

  // Fresh store instances per run — the real re-dream scenario.
  const first = await harvestDreamDayExperiences({
    paths,
    experienceStore: createExperienceStore(paths),
    observerGlobalMetaId: OBSERVER,
    date: DATE,
    startMs,
    endMs,
  });
  const afterFirst = await countLedger(createExperienceStore(paths));
  const second = await harvestDreamDayExperiences({
    paths,
    experienceStore: createExperienceStore(paths),
    observerGlobalMetaId: OBSERVER,
    date: DATE,
    startMs,
    endMs,
  });
  const afterSecond = await countLedger(createExperienceStore(paths));

  assert.equal(first.episodes, 2);
  assert.equal(second.episodes, 2);
  assert.deepEqual(afterSecond, afterFirst);
});

test('harvest is a no-op without an observer GlobalMetaID', async () => {
  const paths = await createTempProfileHome();
  const grouptaskRoot = path.join(paths.runtimeRoot, 'grouptask');
  await writeJson(path.join(grouptaskRoot, 'state.json'), emptyGroupTaskState({
    tasks: [makeTask({ id: 1, ratedAt: IN_DAY, rating: 5 })],
    members: [makeMember({ id: 1, taskId: 1 })],
  }));
  await writeJson(path.join(grouptaskRoot, 'messages', 'grp-task.json'), {
    messages: [makeMessage({ index: 1, pinId: 'pin-m1' })],
    updatedAt: IN_DAY,
  });

  const experienceStore = createExperienceStore(paths);
  const result = await harvestDreamDayExperiences({
    paths,
    experienceStore,
    observerGlobalMetaId: '',
    date: DATE,
    startMs,
    endMs,
  });
  assert.equal(result.episodes, 0);
  assert.equal((await experienceStore.listEpisodes({})).length, 0);
});
