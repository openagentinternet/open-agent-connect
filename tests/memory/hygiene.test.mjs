// Memory-hygiene step rules against seeded file stores: impression-observation
// compaction, episode reconcile/archive, dream-memory decay + tombstone purge,
// knowledge-revision pruning, dream-run purge, once-per-date dedupe, manual
// bypass, error isolation and the disabled-config gate.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createMemoryPolicyStore } = require('../../dist/core/memory/memoryPolicy.js');
const { createExperienceStore } = require('../../dist/core/memory/experienceStore.js');
const { createImpressionStore } = require('../../dist/core/memory/impressionStore.js');
const { createKnowledgeStore } = require('../../dist/core/memory/knowledgeStore.js');
const { createDreamStore } = require('../../dist/core/memory/dreamStore.js');
const { createHygieneStore } = require('../../dist/core/memory/hygieneStore.js');
const {
  memoryHygieneDue,
  runMemoryHygiene,
} = require('../../dist/core/memory/memoryHygieneService.js');

const DAY_MS = 86_400_000;

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-hygiene-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function memoryEntry(overrides) {
  return {
    id: 'mem-seed',
    text: '一条种子记忆',
    confidence: 0.8,
    isExplicit: false,
    status: 'created',
    scopeKind: 'owner',
    scopeKey: 'owner:self',
    usageClass: 'profile_fact',
    visibility: 'local_only',
    origin: 'dream',
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function observation(overrides) {
  return {
    id: 'obs-seed',
    observerGlobalMetaId: 'gm-self',
    subjectGlobalMetaId: 'gm-peer',
    episodeId: null,
    observationText: '观察文本',
    interpretationText: '解读文本',
    dimensions: {},
    communicationGuidance: null,
    confidence: {},
    dreamDate: '2026-01-01',
    dreamVersion: 1,
    modelId: null,
    sourceHash: 'seed-hash',
    idempotencyKey: 'seed-key',
    supersedesObservationId: null,
    evidenceIds: [],
    status: 'active',
    createdAt: 0,
    ...overrides,
  };
}

function episode(overrides) {
  return {
    id: 'ep-seed',
    ownerGlobalMetaId: 'gm-self',
    episodeType: 'direct_interaction',
    sourceChannel: 'metaweb_private',
    sourceKey: 'session:seed',
    sessionId: null,
    externalConversationId: null,
    taskId: null,
    orderId: null,
    status: 'open',
    startedAt: 0,
    endedAt: null,
    metadata: {},
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    participants: [],
    evidence: [],
    ...overrides,
  };
}

function dreamRun(overrides) {
  return {
    dreamDate: '2026-01-01',
    status: 'completed',
    attemptCount: 1,
    llm: null,
    dreamVersion: 1,
    error: null,
    startedAt: 0,
    completedAt: 0,
    ...overrides,
  };
}

function dreamFragment(overrides) {
  return {
    dreamDate: '2026-01-01',
    fragmentKey: 'frag-seed',
    sessionId: 'sess-1',
    chunkIndex: 0,
    contentHash: 'h',
    sourceMessageCount: 1,
    sourceCharCount: 10,
    estimatedInputTokens: 20,
    status: 'completed',
    summaryJson: null,
    llm: null,
    dreamVersion: 1,
    error: null,
    attemptCount: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test('impression-observations keeps the anchors and supersedes the old tail, then rebuilds the snapshot', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  const observations = [
    // Two recent observations survive unconditionally.
    observation({ id: 'obs-recent-1', createdAt: now - 1000 }),
    observation({ id: 'obs-recent-2', createdAt: now - 2000 }),
  ];
  // Ten old observations (older than the 90-day retention): the newest 8 stay
  // as anchors, the oldest 2 are superseded.
  for (let index = 0; index < 10; index += 1) {
    observations.push(observation({
      id: `obs-old-${index}`,
      createdAt: now - (100 + index) * DAY_MS,
    }));
  }
  await writeJson(paths.memoryImpressionsPath, {
    version: 1,
    observations,
    snapshots: [],
    collaborationFacts: [],
  });

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });

  assert.equal(stats.counts.observationPairsCompacted, 1);
  assert.equal(stats.counts.observationsSuperseded, 4); // 12 - 8 anchors, all past the cutoff
  assert.equal(stats.counts.observationSnapshotsRebuilt, 1);
  assert.equal(stats.errors.length, 0);

  const store = createImpressionStore(paths);
  const active = await store.listObservations({ observerGlobalMetaId: 'gm-self', subjectGlobalMetaId: 'gm-peer' });
  assert.equal(active.length, 8); // 2 recent + 6 anchors
  assert.ok(!active.some((entry) => entry.id === 'obs-old-6' || entry.id === 'obs-old-7' || entry.id === 'obs-old-8' || entry.id === 'obs-old-9'));
  const snapshot = await store.getSnapshot('gm-self', 'gm-peer');
  assert.ok(snapshot);
  assert.equal(snapshot.latestObservationId, 'obs-recent-1');
});

test('episodes step reconciles orders/tasks/dormant interactions and archives terminal rows', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  const old = now - 200 * DAY_MS;
  await writeJson(paths.memoryExperiencePath, {
    version: 1,
    episodes: [
      // Order completed in runtime-state: open episode settles to completed.
      episode({
        id: 'ep-order-1',
        episodeType: 'service_order',
        sourceChannel: 'service_order',
        sourceKey: 'order:ord-1',
        orderId: 'ord-1',
        status: 'open',
        startedAt: now - 300 * DAY_MS,
      }),
      // Task done: open episode settles to completed.
      episode({
        id: 'ep-task-1',
        episodeType: 'task_participation',
        sourceChannel: 'metaweb_group',
        sourceKey: 'grouptask:7:2026-01-01',
        taskId: '7',
        status: 'open',
        startedAt: now - 300 * DAY_MS,
      }),
      // Task cancelled: open episode settles to abandoned.
      episode({
        id: 'ep-task-2',
        episodeType: 'task_participation',
        sourceChannel: 'metaweb_group',
        sourceKey: 'grouptask:8:2026-01-01',
        taskId: '8',
        status: 'open',
        startedAt: now - 300 * DAY_MS,
      }),
      // Dormant direct interaction (no evidence inside the window) settles.
      episode({
        id: 'ep-dormant',
        episodeType: 'direct_interaction',
        sourceChannel: 'metaweb_private',
        sourceKey: 'session:dormant',
        status: 'open',
        startedAt: old,
        updatedAt: old,
      }),
      // Active direct interaction with recent evidence stays open.
      episode({
        id: 'ep-active',
        episodeType: 'direct_interaction',
        sourceChannel: 'metaweb_private',
        sourceKey: 'session:active',
        status: 'open',
        startedAt: now - 10 * DAY_MS,
        evidence: [{ id: 'ev-1', episodeId: 'ep-active', evidenceType: 'x', sourceKey: 'k', occurredAt: now - 1000 }],
      }),
      // Terminal episode past the archive horizon gets the archivedAt mark.
      episode({
        id: 'ep-old-terminal',
        episodeType: 'direct_interaction',
        sourceChannel: 'metaweb_private',
        sourceKey: 'session:old-terminal',
        status: 'completed',
        startedAt: old,
        endedAt: old,
        updatedAt: old,
      }),
      // Recent terminal episode stays hot.
      episode({
        id: 'ep-recent-terminal',
        episodeType: 'direct_interaction',
        sourceChannel: 'metaweb_private',
        sourceKey: 'session:recent-terminal',
        status: 'completed',
        startedAt: now - 1000,
        endedAt: now - 1000,
      }),
    ],
  });
  await writeJson(paths.runtimeStatePath, {
    sellerOrders: [{ id: 'ord-1', state: 'completed', createdAt: now - 300 * DAY_MS, updatedAt: now - 300 * DAY_MS }],
  });
  await writeJson(path.join(paths.runtimeRoot, 'grouptask', 'state.json'), {
    tasks: [
      { id: 7, status: 'done', title: 't7' },
      { id: 8, status: 'cancelled', title: 't8' },
    ],
  });

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });

  assert.equal(stats.counts.episodesReconciled, 3); // 1 order + 2 tasks
  assert.equal(stats.counts.dormantInteractionsClosed, 1);
  // 5 archives: the old terminal episode plus the four old episodes just
  // settled by the reconcile stroke (same-pass archive, IDBots parity).
  assert.equal(stats.counts.episodesArchived, 5);

  const store = createExperienceStore(paths);
  const byId = new Map((await store.listEpisodes({ includeArchived: true })).map((entry) => [entry.id, entry]));
  assert.equal(byId.get('ep-order-1').status, 'completed');
  assert.equal(byId.get('ep-task-1').status, 'completed');
  assert.equal(byId.get('ep-task-2').status, 'abandoned');
  assert.equal(byId.get('ep-dormant').status, 'completed');
  assert.equal(byId.get('ep-active').status, 'open');
  assert.ok(byId.get('ep-old-terminal').archivedAt);
  assert.equal(byId.get('ep-recent-terminal').archivedAt, null);
  // Archived episodes leave the default (hot) listing.
  const hot = await store.listEpisodes({});
  assert.ok(!hot.some((entry) => entry.id === 'ep-old-terminal'));
});

test('recurring activity on a source key revives an archived episode', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  await writeJson(paths.memoryExperiencePath, {
    version: 1,
    episodes: [episode({
      id: 'ep-archived',
      episodeType: 'service_order',
      sourceChannel: 'service_order',
      sourceKey: 'order:ord-9',
      orderId: 'ord-9',
      status: 'completed',
      startedAt: now - 300 * DAY_MS,
      endedAt: now - 300 * DAY_MS,
      archivedAt: new Date(now - 10 * DAY_MS).toISOString(),
    })],
  });

  const store = createExperienceStore(paths);
  const revived = await store.createEpisode({
    ownerGlobalMetaId: 'gm-self',
    episodeType: 'service_order',
    sourceChannel: 'service_order',
    sourceKey: 'order:ord-9',
    orderId: 'ord-9',
    status: 'open',
    startedAt: now,
  });
  assert.equal(revived.id, 'ep-archived');
  assert.equal(revived.archivedAt, null);
  const hot = await store.listEpisodes({});
  assert.ok(hot.some((entry) => entry.id === 'ep-archived'));
});

test('dream-memories archives decayed dream rows, never self_identity or conversation rows', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  const old = now - 200 * DAY_MS;
  const recent = now - 1000;
  await writeJson(paths.memoryMemoriesPath, {
    version: 1,
    entries: [
      memoryEntry({ id: 'mem-decay-fact', usageClass: 'profile_fact', origin: 'dream', updatedAt: old }),
      memoryEntry({ id: 'mem-decay-boundary', usageClass: 'value_boundary', origin: 'dream', updatedAt: old }),
      memoryEntry({ id: 'mem-identity', usageClass: 'self_identity', origin: 'dream', updatedAt: old }),
      memoryEntry({ id: 'mem-conversation', usageClass: 'profile_fact', origin: 'conversation', updatedAt: old }),
      memoryEntry({ id: 'mem-recent-dream', usageClass: 'profile_fact', origin: 'dream', updatedAt: recent }),
      // Tombstones: one past the 365-day grace, one recent.
      memoryEntry({ id: 'mem-tomb-old', status: 'deleted', usageClass: 'profile_fact', origin: 'dream', updatedAt: now - 400 * DAY_MS }),
      memoryEntry({ id: 'mem-tomb-recent', status: 'deleted', usageClass: 'profile_fact', origin: 'dream', updatedAt: now - 1000 }),
    ],
  });

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });

  assert.equal(stats.counts.memoriesArchived, 2);
  assert.equal(stats.counts.tombstonesPurged, 1);

  const store = createMemoryStore(paths);
  const archived = await store.list({ includeArchived: true, includeDeleted: true });
  const byId = new Map(archived.map((entry) => [entry.id, entry]));
  assert.ok(byId.get('mem-decay-fact').archivedAt);
  assert.ok(byId.get('mem-decay-boundary').archivedAt);
  assert.equal(byId.get('mem-identity').archivedAt, null);
  assert.equal(byId.get('mem-conversation').archivedAt, null);
  assert.equal(byId.get('mem-recent-dream').archivedAt, null);
  assert.ok(!byId.has('mem-tomb-old'));
  assert.ok(byId.has('mem-tomb-recent'));
  // Archived rows leave default listings; includeArchived opts back in.
  const defaultView = await store.list({ includeDeleted: true });
  assert.ok(!defaultView.some((entry) => entry.archivedAt != null));
  const withArchived = await store.list({ includeArchived: true, includeDeleted: true });
  assert.equal(withArchived.filter((entry) => entry.archivedAt != null).length, 2);
});

test('knowledge-revisions keeps the newest N revisions per entry', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);
  const { entry } = await store.upsertKnowledge({ topic: '主题A', summary: 'v1', kind: 'know_how', origin: 'dream' });
  for (let index = 2; index <= 8; index += 1) {
    await store.updateKnowledge({ id: entry.id, summary: `v${index}` });
  }
  assert.equal((await store.getKnowledge(entry.id)).revisions.length, 7);

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });
  assert.equal(stats.counts.knowledgeRevisionsPruned, 2);

  const after = await store.getKnowledge(entry.id);
  assert.equal(after.revisions.length, 5);
  // The newest 5 by version survive (v3..v7); the two oldest are dropped.
  assert.ok(after.revisions.every((revision) => ['v3', 'v4', 'v5', 'v6', 'v7'].includes(revision.summary)));
});

test('dream-runs purges completed/failed runs and fragments past the retention horizon', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  const oldDate = (() => {
    const d = new Date(now - 200 * DAY_MS);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const recentDate = (() => {
    const d = new Date(now - 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  await writeJson(paths.memoryDreamRunsPath, {
    version: 1,
    runs: [
      dreamRun({ dreamDate: oldDate, status: 'completed', startedAt: now - 200 * DAY_MS, completedAt: now - 200 * DAY_MS }),
      dreamRun({ dreamDate: oldDate, status: 'failed', startedAt: now - 200 * DAY_MS, completedAt: now - 200 * DAY_MS }),
      dreamRun({ dreamDate: oldDate, status: 'running', startedAt: now - 200 * DAY_MS, completedAt: null }),
      dreamRun({ dreamDate: recentDate, status: 'completed', startedAt: now - 1000, completedAt: now - 1000 }),
    ],
    fragments: [
      dreamFragment({ dreamDate: oldDate }),
      dreamFragment({ dreamDate: recentDate }),
    ],
  });

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });
  assert.equal(stats.counts.dreamRunsPurged, 2);
  assert.equal(stats.counts.dreamFragmentsPurged, 1);

  const store = createDreamStore(paths);
  const states = await store.getRunStates();
  // The running run shares the old date and must survive the purge.
  assert.equal(states.get(oldDate).status, 'running');
  assert.ok(states.has(recentDate));
  assert.equal((await store.getFragment(oldDate, 'frag-seed')), null);
  assert.ok(await store.getFragment(recentDate, 'frag-seed'));
});

test('scheduled runs are once per local date; manual run bypasses the dedupe', async () => {
  const paths = await createTempProfileHome();
  const nowDate = new Date();
  nowDate.setHours(10, 0, 0, 0); // ≥ 04:00 local
  const seed = memoryEntry({ id: 'mem-decay-fact', usageClass: 'profile_fact', origin: 'dream', updatedAt: Date.now() - 200 * DAY_MS });
  await writeJson(paths.memoryMemoriesPath, { version: 1, entries: [seed] });

  const first = await runMemoryHygiene(paths, { trigger: 'scheduled', now: nowDate });
  assert.equal(first.counts.memoriesArchived, 1);
  assert.equal(first.errors.length, 0);
  assert.equal(first.trigger, 'scheduled');

  // Same local date: the scheduled pass dedupes and does not stamp again.
  const second = await runMemoryHygiene(paths, { trigger: 'scheduled', now: nowDate });
  assert.equal(second.counts.skippedAlreadyRun, 1);
  assert.equal(second.counts.memoriesArchived, undefined);
  const ledger = await createHygieneStore(paths).getLedger();
  assert.equal(ledger.lastRun.trigger, 'scheduled');
  assert.equal(ledger.lastRun.counts.memoriesArchived, 1);

  // Manual run bypasses the once-per-date dedupe and runs the full pass.
  const manual = await runMemoryHygiene(paths, { trigger: 'manual', now: nowDate });
  assert.equal(manual.trigger, 'manual');
  assert.equal(manual.counts.memoriesArchived, 0); // the only decayed row was already archived
  assert.equal((await createHygieneStore(paths).getLedger()).lastRun.trigger, 'manual');
});

test('scheduled pass is gated by the 04:00 local window', async () => {
  const paths = await createTempProfileHome();
  const beforeDawn = new Date();
  beforeDawn.setHours(3, 0, 0, 0);
  const early = await runMemoryHygiene(paths, { trigger: 'scheduled', now: beforeDawn });
  assert.equal(early.counts.skippedNotDue, 1);
  assert.equal((await createHygieneStore(paths).getLedger()).lastRun, null);

  const due = await memoryHygieneDue(paths, { now: beforeDawn });
  assert.deepEqual(due, { due: false, reason: 'before 04:00 local time' });
});

test('memoryHygieneDue reports eligibility and once-per-date state', async () => {
  const paths = await createTempProfileHome();
  const nowDate = new Date();
  nowDate.setHours(10, 0, 0, 0);
  assert.deepEqual(await memoryHygieneDue(paths, { now: nowDate }), { due: true, reason: 'due' });
  await runMemoryHygiene(paths, { trigger: 'scheduled', now: nowDate });
  const after = await memoryHygieneDue(paths, { now: nowDate });
  assert.equal(after.due, false);
  assert.match(after.reason, /already run today/);
});

test('a throwing step lands in errors and the remaining steps still run', async () => {
  const paths = await createTempProfileHome();
  const now = Date.now();
  const store = createKnowledgeStore(paths);
  const { entry } = await store.upsertKnowledge({ topic: '主题B', summary: 'v1', kind: 'know_how', origin: 'dream' });
  for (let index = 2; index <= 8; index += 1) {
    await store.updateKnowledge({ id: entry.id, summary: `v${index}` });
  }
  const memoryStore = createMemoryStore(paths);
  const broken = {
    ...memoryStore,
    archiveDecayedDreamMemories: async () => {
      throw new Error('disk full');
    },
  };

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' }, { memoryStore: broken });
  assert.ok(stats.errors.some((error) => error.startsWith('dream-memories: disk full')));
  // The knowledge step still ran despite the broken memory step.
  assert.equal(stats.counts.knowledgeRevisionsPruned, 2);
  // The run is stamped so the next pass can retry the failed step.
  assert.ok((await createHygieneStore(paths).getLedger()).lastRun);
});

test('disabled hygiene config skips the whole run without stamping', async () => {
  const paths = await createTempProfileHome();
  const policyStore = createMemoryPolicyStore(paths);
  await policyStore.setOverride({ hygieneEnabled: false });
  assert.equal((await policyStore.getHygieneConfig()).enabled, false);

  const stats = await runMemoryHygiene(paths, { trigger: 'manual' });
  assert.equal(stats.counts.skippedDisabled, 1);
  assert.equal((await createHygieneStore(paths).getLedger()).lastRun, null);
  const due = await memoryHygieneDue(paths);
  assert.deepEqual(due, { due: false, reason: 'hygiene disabled by policy' });
});

test('hygiene config set clamps thresholds and keeps the enabled flag separate', async () => {
  const paths = await createTempProfileHome();
  const policyStore = createMemoryPolicyStore(paths);
  const config = await policyStore.setHygieneConfig({
    observationRetentionDays: 7, // below the 14-day floor
    observationAnchorsPerPair: 99, // above the 50 cap
    deepConsolidationIntervalDays: 3, // below the 7-day floor
    enabled: true,
  });
  assert.equal(config.observationRetentionDays, 14);
  assert.equal(config.observationAnchorsPerPair, 50);
  assert.equal(config.deepConsolidationIntervalDays, 7);
  assert.equal(config.enabled, true);

  const reread = await policyStore.getHygieneConfig();
  assert.equal(reread.observationRetentionDays, 14);
  assert.equal(reread.enabled, true);

  await policyStore.setHygieneConfig({ enabled: false });
  assert.equal((await policyStore.getHygieneConfig()).enabled, false);
  assert.equal((await policyStore.effectivePolicy()).hygieneEnabled, false);
});
