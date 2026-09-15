// SurfService orchestration — OAC port of the IDBots surfService tests:
// success path marks seen + advances watermarks; failure leaves the ledger
// untouched (catch-up); pre-dream gating; notes carry-over.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMetawebSurfStore } = require('../../dist/core/surf/store.js');
const { createSurfSettingsStore } = require('../../dist/core/surf/settings.js');
const { SurfService, PRE_DREAM_SURF_RECENCY_MS } = require('../../dist/core/surf/service.js');

async function createTempProfileHome(label) {
  const base = await mkdtempTempRoot(`metabot-surf-svc-${label}-`);
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function fakeRegistry(itemsByProtocol, errors = {}) {
  return Object.keys(itemsByProtocol).map((key) => ({
    key,
    displayName: key,
    paths: [`/protocols/${key}`],
    interactions: ['like'],
    relevanceHint: '',
    fetchFresh: async () => {
      if (errors[key]) throw new Error(errors[key]);
      return { items: itemsByProtocol[key], hasMore: false, nextCursor: null };
    },
  }));
}

function item(key, pinId, createdAt) {
  return {
    pinId,
    protocolKey: key,
    chainName: 'mvc',
    title: pinId,
    summary: '',
    authorName: '',
    authorGlobalMetaId: '',
    createdAt,
    likeCount: null,
    commentCount: null,
    extra: null,
  };
}

function makeService(paths, options = {}) {
  const store = createMetawebSurfStore(paths);
  const settings = createSurfSettingsStore(paths);
  const broadcasts = [];
  return {
    store,
    broadcasts,
    service: new SurfService({
      botSlug: 'test-slug',
      botName: 'Test',
      store,
      settings,
      broadcast: (payload) => broadcasts.push(payload),
      registry: options.registry ?? fakeRegistry({ simplebuzz: [item('simplebuzz', 'p-1', 2000)] }),
      nowMs: options.nowMs ?? (() => Date.parse('2026-09-15T22:00:00Z')),
      runSurfSession: options.runSurfSession,
      isMemoryEnabled: options.isMemoryEnabled,
      listChainWritesForSurf: options.listChainWritesForSurf,
    }),
  };
}

test('successful run: session result recorded, seen ledger marked, watermark advanced', async () => {
  const paths = await createTempProfileHome('success');
  const { service, store, broadcasts } = makeService(paths, {
    runSurfSession: async () => ({
      stats: { deepRead: 2, liked: 1 },
      reportMarkdown: '# Surf report\nlearned things',
      reportJson: JSON.stringify({ summary: 'learned things', notes: 'avoid spam' }),
      seenActions: [{ pinId: 'p-1', action: 'read' }],
    }),
  });
  const run = await service.runSurfAndWait('manual-ui');
  assert.equal(run.status, 'done');
  assert.equal(run.stats.fetched, 1);
  assert.equal(run.stats.liked, 1);
  assert.match(run.reportMarkdown, /Surf digest/);

  // Ledger: the briefed pin presented; the session's read folds on top.
  assert.equal(await store.getSeenAction('p-1'), 'read');
  // Watermark advanced past the newest item.
  const state = await store.getProtocolState('simplebuzz');
  assert.equal(state.lastSeenTs, 2000);
  // Broadcasts cover running + done.
  assert.deepEqual(broadcasts.map((entry) => entry.status), ['running', 'done']);
});

test('failed run keeps real partial stats; ledger and watermark untouched (catch-up semantics)', async () => {
  const paths = await createTempProfileHome('failure');
  const { service, store } = makeService(paths, {
    runSurfSession: async () => {
      const error = new Error('LLM transport died');
      error.surfPartialStats = { deepRead: 3, liked: 1 };
      throw error;
    },
  });
  const run = await service.runSurfAndWait('pre-dream');
  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'LLM transport died');
  assert.equal(run.stats.fetched, 1);
  assert.equal(run.stats.deepRead, 3);
  assert.equal(run.stats.liked, 1);
  // Catch-up semantics: nothing marked seen, watermark not advanced.
  assert.equal(await store.getSeenAction('p-1'), null);
  assert.equal(await store.getProtocolState('simplebuzz'), null);
});

test('pre-dream gate: opt-in default OFF, memory gate, 20h recency window', async () => {
  const paths = await createTempProfileHome('gate');
  const settings = createSurfSettingsStore(paths);
  let nowMs = Date.parse('2026-09-15T22:00:00Z');
  const { service, store } = makeService(paths, {
    nowMs: () => nowMs,
    isMemoryEnabled: () => true,
  });

  // Default OFF.
  assert.equal(await service.shouldPreDreamSurf(), false);
  await settings.update({ surfBeforeDreamEnabled: true });
  assert.equal(await service.shouldPreDreamSurf(), true);

  // Recency: a finished run within 20h blocks the nightly one.
  const recent = await service.runSurfAndWait('manual-ui');
  assert.equal(recent.status, 'done');
  assert.equal(await service.shouldPreDreamSurf(), false);
  nowMs += PRE_DREAM_SURF_RECENCY_MS + 60_000;
  assert.equal(await service.shouldPreDreamSurf(), true);

  // Memory off → quiet skip (the dream proceeds either way).
  const memPaths = await createTempProfileHome('gate-mem');
  await createSurfSettingsStore(memPaths).update({ surfBeforeDreamEnabled: true });
  const memService = makeService(memPaths, { isMemoryEnabled: () => false }).service;
  assert.equal(await memService.shouldPreDreamSurf(), false);
  // And beginRun refuses pre-dream loudly with memory off.
  await assert.rejects(
    () => memService.runSurfAndWait('pre-dream'),
    /requires memory enabled/,
  );
  void store;
});

test('pre-run reconciliation folds chain-write receipts into the ledger', async () => {
  const paths = await createTempProfileHome('reconcile');
  const { service, store } = makeService(paths, {
    listChainWritesForSurf: async () => [
      {
        pinId: 'my-old-like',
        path: '/protocols/paylike',
        contentText: JSON.stringify({ isLike: 1, likeTo: 'their-old-pin' }),
      },
    ],
  });
  await service.runSurfAndWait('manual-ui');
  assert.equal(await store.getSeenAction('their-old-pin'), 'liked');
  assert.equal(await store.getSeenAction('my-old-like'), 'posted');
});

test('previous notes from the last DONE run ride into the next session context', async () => {
  const paths = await createTempProfileHome('notes');
  const contexts = [];
  const { service } = makeService(paths, {
    runSurfSession: async (context) => {
      contexts.push(context);
      return {
        reportJson: JSON.stringify({ summary: 's', notes: contexts.length === 1 ? 'check agentpedia first' : '' }),
      };
    },
  });
  await service.runSurfAndWait('manual-ui');
  await service.runSurfAndWait('manual-ui');
  assert.equal(contexts[0].previousNotes, null);
  assert.equal(contexts[1].previousNotes, 'check agentpedia first');
});

test('concurrent runs refuse; crash recovery fails stale running rows', async () => {
  const paths = await createTempProfileHome('mutex');
  let releaseSession;
  const gate = new Promise((resolve) => { releaseSession = resolve; });
  const { service } = makeService(paths, {
    runSurfSession: async () => {
      await gate;
      return {};
    },
  });
  const first = await service.startSurf('manual-ui');
  assert.equal(service.isRunning(), true);
  await assert.rejects(
    () => service.startSurf('manual-ui'),
    /already in progress/,
  );
  releaseSession();
  await first;
  // startSurf returns before the background executeRun settles; wait for it.
  for (let attempt = 0; attempt < 100 && service.isRunning(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(service.isRunning(), false);

  const stale = await createMetawebSurfStore(paths).createRun({
    id: 'stale-run',
    trigger: 'manual-ui',
    nowIso: '2026-09-15T20:00:00Z',
  });
  assert.equal(stale.status, 'running');
  const recovered = await service.recoverAfterRestart();
  assert.equal(recovered, 1);
  const after = await createMetawebSurfStore(paths).getRun('stale-run');
  assert.equal(after.status, 'failed');
});
