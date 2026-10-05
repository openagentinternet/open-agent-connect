import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MetaTaskWatchService } = require('../../dist/core/metatask/watch.js');

/**
 * metatask.watch regression (P7 — OAC port of the IDBots suite): the
 * closing-drive dedupe key must match the stored alert (node included). The
 * v1 bug compared recent() against null while storing a node id, so the
 * nudge re-fired every 10-minute tick and flooded the board with duplicate
 * "aggregation stalled" rows.
 */

const PUBLISHER = 'idq1publisherx0000000000000000000';

function buildProjection({ lastActivityMs }) {
  return {
    rootPinId: 'task000000000000000000000000000000000000000000000000000001i0',
    title: 'stalled task',
    publisher: PUBLISHER,
    taskComplete: false,
    lastActivityMs,
    progress: { total: 3, verified: 0, claimed: 0, open: 3, disputed: 0 },
    nodes: [
      { id: 'r1', parent: null, kind: 'aggregate' },
      { id: 't1', parent: 'r1', kind: 'proof' },
      { id: 't2', parent: 'r1', kind: 'proof' },
    ],
    nodeStates: {
      r1: { id: 'r1', status: 'open', disputed: false, holder: null, submission: null, passVotes: 0, failVotes: 0, votes: [] },
      t1: { id: 't1', status: 'open', disputed: false, holder: null, submission: null, passVotes: 0, failVotes: 0, votes: [] },
      t2: { id: 't2', status: 'open', disputed: false, holder: null, submission: null, passVotes: 0, failVotes: 0, votes: [] },
    },
    participants: [{ metaId: PUBLISHER, effectiveClaims: 1, submissions: 0, verifiedContrib: 0, reviewVotes: 0, reviewCorrect: 0, reviewTerminal: 0 }],
    settlement: null,
    identities: {},
  };
}

function fakeStore(projection) {
  const alerts = [];
  let statuses = [];
  return {
    alerts,
    pruneAlerts: async () => undefined,
    listAlerts: async () => [...alerts],
    getWatchStatuses: async () => statuses,
    setWatchStatuses: async (entries) => { statuses = entries; },
    appendAlerts: async (list) => { alerts.push(...list); },
    board: async () => ({
      localRosterMetaIds: [PUBLISHER],
      identities: {},
      alerts: [...alerts],
      tasks: [{
        rootPinId: projection.rootPinId,
        title: projection.title,
        publisher: PUBLISHER,
        mode: 'tree',
        myRoles: ['publisher'],
        taskComplete: false,
        progress: projection.progress,
        participantCount: 1,
        lastActivityMs: projection.lastActivityMs,
        freshness: { boundaryBlock: 189988, evaluatedAtMs: 0, eventCount: 3 },
        myStats: null,
        settlementFinalized: false,
      }],
      activation: { hAct2: 191500, hAct3: null },
      refresh: { lastRefreshAtMs: 1, lastOkAtMs: 1, lastError: null, boundaryBlock: 189988, refreshing: false },
    }),
    getProjection: async () => projection,
  };
}

test('closing-drive nudge fires once per dedupe window, not per tick', async () => {
  const now = 1_790_500_000_000;
  const stalled = now - 25 * 3_600_000; // > 24h stall threshold
  const store = fakeStore(buildProjection({ lastActivityMs: stalled }));
  const service = new MetaTaskWatchService({ store: () => store, rosterMetaIds: () => [PUBLISHER] });

  // Five consecutive ticks (would have produced 5 duplicates before the fix).
  for (let i = 0; i < 5; i += 1) await service.run(now + i * 10 * 60_000);
  const closing = store.alerts.filter((alert) => alert.kind === 'closing_drive');
  assert.equal(closing.length, 1, `expected exactly 1 closing_drive alert, got ${closing.length}`);

  // After the 24h dedupe window passes with the stall unresolved, exactly one more fires.
  await service.run(now + 25 * 3_600_000);
  assert.equal(store.alerts.filter((alert) => alert.kind === 'closing_drive').length, 2);
});

test('no closing-drive nudge while the task is not stalled', async () => {
  const now = 1_790_500_000_000;
  const store = fakeStore(buildProjection({ lastActivityMs: now - 3_600_000 }));
  const service = new MetaTaskWatchService({ store: () => store, rosterMetaIds: () => [PUBLISHER] });
  await service.run(now);
  await service.run(now + 10 * 60_000);
  assert.equal(store.alerts.filter((alert) => alert.kind === 'closing_drive').length, 0);
});
