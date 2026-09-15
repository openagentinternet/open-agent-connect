// MetaWeb surf store invariants — OAC port of the IDBots metawebSurfStore
// tests, adapted to the async file store under `.runtime/surf/`.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createMetawebSurfStore,
  SEEN_ACTION_RANK,
  SURF_SEEN_MAX_ROWS_PER_BOT,
} = require('../../dist/core/surf/store.js');
const { createSurfSettingsStore } = require('../../dist/core/surf/settings.js');

async function createTempProfileHome(label) {
  const base = await mkdtempTempRoot(`metabot-surf-${label}-`);
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('run lifecycle: create → finish → list newest first, stale sweep', async () => {
  const paths = await createTempProfileHome('runs');
  const store = createMetawebSurfStore(paths);
  const now = '2026-09-15T10:00:00.000Z';
  const run = await store.createRun({ id: 'run-1', trigger: 'pre-dream', nowIso: now });
  assert.equal(run.status, 'running');
  assert.equal(run.trigger, 'pre-dream');

  assert.equal(await store.hasRunningRun(), true);
  assert.equal((await store.listRuns(10)).length, 1);

  // Stale sweep excludes the live run, clears orphans.
  assert.equal(await store.failStaleRunningRuns({ error: 'restart', nowIso: now, excludeId: 'run-1' }), 0);
  await store.createRun({ id: 'run-0', trigger: 'manual-ui', nowIso: '2026-09-15T09:00:00.000Z' });
  // Sweeping without the exclusion clears BOTH stale running rows.
  assert.equal(await store.failStaleRunningRuns({ error: 'restart', nowIso: now }), 2);

  await store.finishRun('run-1', {
    status: 'done',
    stats: { fetched: 10, deepRead: 4, liked: 2 },
    reportMarkdown: '# Surf report\nok'.repeat(100),
    reportJson: '{"summary":"x"}',
    finishedAtIso: now,
  });
  const finished = await store.getRun('run-1');
  assert.equal(finished.status, 'done');
  assert.ok(finished.reportMarkdown.length <= 20_000);
  // Missing fields in stats normalize to 0.
  assert.equal(finished.stats.fetched, 10);
  assert.equal(finished.stats.commented, 0);

  const runs = await store.listRuns(10);
  assert.deepEqual(runs.map((entry) => entry.id), ['run-1', 'run-0']);
  const latest = await store.getLatestFinishedRun();
  assert.ok(latest);
  assert.equal(latest.id, 'run-1');
});

test('protocol watermark never rewinds; backlog cursor store/clear/preserve', async () => {
  const paths = await createTempProfileHome('watermark');
  const store = createMetawebSurfStore(paths);
  const now = '2026-09-15T10:00:00.000Z';

  await store.advanceProtocolState('simplebuzz', { lastSeenTs: 1000, nowIso: now });
  // A lower watermark must not rewind.
  await store.advanceProtocolState('simplebuzz', { lastSeenTs: 500, nowIso: now });
  // Backlog cursor stored verbatim, watermark untouched by null.
  await store.advanceProtocolState('simplebuzz', { lastSeenTs: null, nowIso: now, backlogCursor: 'opaque-cursor-1' });
  let state = await store.getProtocolState('simplebuzz');
  assert.equal(state.lastSeenTs, 1000);
  assert.equal(state.backlogCursor, 'opaque-cursor-1');
  // null clears the cursor; undefined preserves.
  await store.advanceProtocolState('simplebuzz', { lastSeenTs: null, nowIso: now, backlogCursor: null });
  state = await store.getProtocolState('simplebuzz');
  assert.equal(state.backlogCursor, null);
  await store.advanceProtocolState('simplebuzz', { lastSeenTs: null, nowIso: now, backlogCursor: 'again' });
  await store.advanceProtocolState('simplebuzz', { lastSeenTs: null, nowIso: now });
  state = await store.getProtocolState('simplebuzz');
  assert.equal(state.backlogCursor, 'again');
});

test('seen ledger: strongest action wins, batch dedupe, unseen filter, pruning', async () => {
  const paths = await createTempProfileHome('seen');
  const store = createMetawebSurfStore(paths);
  const now = '2026-09-15T10:00:00.000Z';

  await store.markSeen('pin-1', 'presented', now);
  await store.markSeen('pin-1', 'liked', now);
  assert.equal(await store.getSeenAction('pin-1'), 'liked');
  // Weaker action must not downgrade.
  await store.markSeen('pin-1', 'read', now);
  assert.equal(await store.getSeenAction('pin-1'), 'liked');

  await store.markSeenBatch([
    { pinId: 'pin-2', action: 'read' },
    { pinId: 'pin-2', action: 'saved' },
    { pinId: 'pin-3', action: 'presented' },
    { pinId: '', action: 'skipped' },
  ], now);
  assert.equal(await store.getSeenAction('pin-2'), 'saved');
  assert.deepEqual(await store.filterUnseen(['pin-1', 'pin-2', 'pin-4']), ['pin-4']);

  // Pruning: over-cap ledgers drop the OLDEST rows.
  const later = '2026-09-16T10:00:00.000Z';
  const entries = [];
  for (let index = 0; index < SURF_SEEN_MAX_ROWS_PER_BOT + 10; index += 1) {
    entries.push({ pinId: `bulk-${index}`, action: 'presented' });
  }
  await store.markSeenBatch(entries, later);
  await store.pruneSeenPins(later);
  const stillUnseen = await store.filterUnseen(['pin-1', 'bulk-0', `bulk-${SURF_SEEN_MAX_ROWS_PER_BOT + 9}`]);
  // pin-1 (oldest) dropped by the cap; the newest bulk pin kept.
  assert.ok(stillUnseen.includes('pin-1'));
  assert.ok(!stillUnseen.includes(`bulk-${SURF_SEEN_MAX_ROWS_PER_BOT + 9}`));
});

test('settings: defaults OFF + budget 20; invalid budget rejected', async () => {
  const paths = await createTempProfileHome('settings');
  const settings = createSurfSettingsStore(paths);
  const defaults = await settings.read();
  assert.equal(defaults.surfBeforeDreamEnabled, false);
  assert.equal(defaults.interactionBudget, 20);

  const updated = await settings.update({ surfBeforeDreamEnabled: true, interactionBudget: 55 });
  assert.equal(updated.surfBeforeDreamEnabled, true);
  assert.equal(updated.interactionBudget, 55);
  assert.equal((await settings.read()).interactionBudget, 55);

  await assert.rejects(() => settings.update({ interactionBudget: 101 }));
  await assert.rejects(() => settings.update({ interactionBudget: -1 }));
  await assert.rejects(() => settings.update({ interactionBudget: 'abc' }));
  // String numbers normalize (the CLI passes strings).
  const normalized = await settings.update({ interactionBudget: '30' });
  assert.equal(normalized.interactionBudget, 30);
});

test('seen action ranks order chain-write classes above read/save', () => {
  assert.ok(SEEN_ACTION_RANK.presented < SEEN_ACTION_RANK.read);
  assert.ok(SEEN_ACTION_RANK.read < SEEN_ACTION_RANK.saved);
  assert.ok(SEEN_ACTION_RANK.saved < SEEN_ACTION_RANK.liked);
  assert.ok(SEEN_ACTION_RANK.liked < SEEN_ACTION_RANK.commented);
  assert.ok(SEEN_ACTION_RANK.commented < SEEN_ACTION_RANK.answered);
  assert.ok(SEEN_ACTION_RANK.answered < SEEN_ACTION_RANK.posted);
  assert.ok(SEEN_ACTION_RANK.posted < SEEN_ACTION_RANK.challenged);
});
