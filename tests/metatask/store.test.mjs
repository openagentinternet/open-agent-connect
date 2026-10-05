import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createMetaTaskStore } = require('../../dist/core/metatask/store.js');
const { replayMetaTask } = require('../../dist/core/metatask/engine/engine.js');

/**
 * MetaTask projection store (M3 — JSON redesign): event cache round-trip +
 * anti-downgrade upsert + projection persistence + board derivation (my-roles)
 * + refresh state transitions. The store is a rebuildable cache of the chain
 * replay; deleting the directory only costs one re-collect.
 */

const ev = (pinId, path, body, author = 'idq1somebot', height = 190_100) => ({
  pinId,
  path,
  author,
  height,
  txIndex: 0,
  timestampMs: 1_790_000_000_000,
  body,
});

const buildProjection = () => {
  const events = [
    ev('tree0000000001i0', 'tree', {
      root: 'r1',
      nodes: [
        { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 5000 },
        { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 5000 },
      ],
    }, 'idq1publisherx'),
    ev('task0000000001i0', 'task', {
      title: 'store test task',
      treeid: 'tree0000000001i0',
      policy: { verify_quorum: 2, claim_ttl_hours: 48, verify_window_hours: 72 },
      tags: ['metatask'],
    }, 'idq1publisherx'),
    ev('claim00000001i0', 'claim', { taskid: 'task0000000001i0', node: 't1' }, 'idq1workerbee'),
  ];
  return replayMetaTask(events, { rootPinId: 'task0000000001i0' });
};

function openStore() {
  const root = mkdtempTempRootSync('oac-metatask-store-');
  const store = createMetaTaskStore(path.join(root, 'metatask'));
  return { root, store };
}

const projectionFilePath = (root, rootPinId) =>
  path.join(root, 'metatask', 'projections', `${rootPinId.replace(/[^a-z0-9._-]/gi, '_')}.json`);

test('metatask store: re-opening an existing directory keeps the cached state', async () => {
  const { root, store } = openStore();
  try {
    await store.upsertEvents([ev('aaa0000000001i0', 'claim', { taskid: 't', node: 'n1' }, 'idq1a')]);
    const again = createMetaTaskStore(path.join(root, 'metatask'));
    const loaded = await again.loadEvents();
    assert.equal(loaded.length, 1, 'events survive a re-open (jsonl reload)');
    assert.equal(loaded[0].body.node, 'n1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: event cache round-trip is idempotent by pinId', async () => {
  const { root, store } = openStore();
  try {
    const events = [
      ev('aaa0000000001i0', 'claim', { taskid: 't', node: 'n1' }, 'idq1a', 190_100),
      ev('aaa0000000002i0', 'verify', { targetid: 'x', verdict: 'pass', semantic_check: 'ok' }, 'idq1b', 190_101),
    ];
    await store.upsertEvents(events);
    const appendedAgain = await store.upsertEvents(events); // idempotent by pinId
    assert.equal(appendedAgain, 0, 'identical rows cost no write');
    const loaded = await store.loadEvents();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].path, 'claim');
    assert.equal(loaded[0].body.node, 'n1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: projections persist and board derives my-roles', async () => {
  const { root, store } = openStore();
  try {
    const projection = buildProjection();
    await store.saveProjections([projection]);
    const loaded = await store.getProjection(projection.rootPinId);
    assert.ok(loaded);
    assert.equal(loaded.title, 'store test task');
    assert.equal(loaded.nodeStates.t1.status, 'claimed');

    // The worker's roster marks the task as "participating"; a stranger's does not.
    const asWorker = await store.board(['idq1workerbee']);
    assert.equal(asWorker.tasks.length, 1);
    assert.deepEqual(asWorker.tasks[0].myRoles, ['participant']);
    // Nothing verified yet: the mid-task estimate is 0 (not undefined).
    assert.equal(asWorker.tasks[0].myStats.estShareBP, 0);
    const asPublisher = await store.board(['idq1publisherx']);
    assert.deepEqual(asPublisher.tasks[0].myRoles, ['publisher']);
    const asStranger = await store.board(['idq1stranger']);
    assert.deepEqual(asStranger.tasks[0].myRoles, []);

    // Stale roots drop out on the next save.
    await store.saveProjections([]);
    assert.equal((await store.board([])).tasks.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: board activity uses the engine clock, not holder/submission stamps', async () => {
  const { root, store } = openStore();
  try {
    const base = 1_790_000_000_000;
    const trace = (pinId, path, body, author, height, offsetMs) => ({
      ...ev(pinId, path, body, author, height),
      timestampMs: base + offsetMs,
    });
    const events = [
      trace(
        'tree0000000002i0',
        'tree',
        {
          root: 'r1',
          nodes: [
            { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 5000 },
            { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 5000 },
          ],
        },
        'idq1publisherx',
        190_100,
        0,
      ),
      trace(
        'task0000000002i0',
        'task',
        { title: 'actively reviewed', treeid: 'tree0000000002i0', policy: { verify_quorum: 1, claim_ttl_hours: 48, verify_window_hours: 72 } },
        'idq1publisherx',
        190_101,
        1_000,
      ),
      trace('claim00000002i0', 'claim', { taskid: 'task0000000002i0', node: 't1' }, 'idq1workerbee', 190_110, 60_000),
      trace(
        'submiss0000002i0',
        'submission',
        { taskid: 'task0000000002i0', node: 't1', claimid: 'claim00000002i0', result: { type: 'table' }, hash: '5'.repeat(64) },
        'idq1workerbee',
        190_111,
        120_000,
      ),
      trace(
        'verify00000002i0',
        'verify',
        { targetid: 'submiss0000002i0', verdict: 'pass', method: 'ran the spec', semantic_check: 'checked' },
        'idq1reviewerzz',
        190_120,
        600_000,
      ),
    ];
    const projection = replayMetaTask(events, { rootPinId: 'task0000000002i0' });
    assert.equal(projection.nodeStates.t1.status, 'verified');
    // The freshest task-scoped event is a VOTE: it is outside the
    // holder/submission scan, which is exactly how a freshly reviewed task used
    // to sort first while displaying "days ago".
    assert.equal(projection.lastActivityMs, base + 600_000);
    assert.ok(projection.lastActivityMs > projection.nodeStates.t1.submission.atMs);

    await store.saveProjections([projection]);
    const board = await store.board([]);
    assert.equal(board.tasks.length, 1);
    assert.equal(board.tasks[0].lastActivityMs, projection.lastActivityMs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: board myStats carries the mid-task estShareBP', async () => {
  const { root, store } = openStore();
  try {
    const events = [
      ev('tree0000000003i0', 'tree', {
        root: 'r1',
        nodes: [
          { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 5000 },
          { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 5000 },
        ],
      }, 'idq1publisherx'),
      ev('task0000000003i0', 'task', {
        title: 'mid-task estimate',
        treeid: 'tree0000000003i0',
        policy: { verify_quorum: 1, claim_ttl_hours: 48, verify_window_hours: 72 },
        tags: ['metatask'],
      }, 'idq1publisherx'),
      ev('claim00000003i0', 'claim', { taskid: 'task0000000003i0', node: 't1' }, 'idq1workerbee'),
      ev('submiss0000003i0', 'submission', {
        taskid: 'task0000000003i0',
        node: 't1',
        claimid: 'claim00000003i0',
        result: { type: 'table' },
        hash: '6'.repeat(64),
      }, 'idq1workerbee'),
      ev('verify00000003i0', 'verify', {
        targetid: 'submiss0000003i0',
        verdict: 'pass',
        method: 'ran the spec',
        semantic_check: 'checked',
      }, 'idq1reviewerzz'),
    ];
    const projection = replayMetaTask(events, { rootPinId: 'task0000000003i0' });
    assert.equal(projection.nodeStates.t1.status, 'verified');
    assert.equal(projection.settlement, null, 'the root is still open, so nothing is settled');
    assert.equal('estimation' in projection, false, 'replay output never carries estimation');
    await store.saveProjections([projection]);
    assert.equal('estimation' in ((await store.getProjection('task0000000003i0')) ?? {}), false, 'estimation is never persisted');

    // t1 carries 5000bp: submitter floor(5000*8000/10000) = 4000, pool 1000 to
    // the single reviewer -> the whole roster estimates 5000.
    const both = await store.board(['idq1workerbee', 'idq1reviewerzz']);
    assert.equal(both.tasks[0].myStats.estShareBP, 5000);
    assert.equal(both.tasks[0].myStats.shareBP, 0, 'shareBP stays 0 until a manifest exists');
    assert.equal(both.tasks[0].settlementFinalized, false);

    const workerOnly = await store.board(['idq1workerbee']);
    assert.deepEqual(workerOnly.tasks[0].myRoles, ['participant']);
    assert.equal(workerOnly.tasks[0].myStats.estShareBP, 4000);
    assert.equal(workerOnly.tasks[0].myStats.verified, 1);

    // A roster with no recorded activity has no myStats at all (publisher-only
    // role is not participation).
    const publisherOnly = await store.board(['idq1publisherx']);
    assert.deepEqual(publisherOnly.tasks[0].myRoles, ['publisher']);
    assert.equal(publisherOnly.tasks[0].myStats, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: sweep state exposes the persisted dirty key and preserves skipped rows', async () => {
  const { root, store } = openStore();
  try {
    const projection = buildProjection();
    const rootPinId = projection.rootPinId;

    // A row written by the sweep carries the dirty key it was built from.
    await store.saveProjections([projection], { liveRootIds: [rootPinId], dirtyKeys: { [rootPinId]: 'dirty-abc' } });
    const state = await store.projectionSweepState();
    assert.deepEqual(state.map((entry) => [entry.rootPinId, entry.dirtyKey]), [[rootPinId, 'dirty-abc']]);
    assert.equal(state[0].projection.title, 'store test task');

    // A skipped root is absent from `projections` but stays live: its file must
    // survive untouched (the sentinel title is not overwritten).
    const file = projectionFilePath(root, rootPinId);
    const sentineled = JSON.parse(fs.readFileSync(file, 'utf8'));
    sentineled.projection.title = 'SENTINEL';
    fs.writeFileSync(file, JSON.stringify(sentineled));
    await store.saveProjections([], { liveRootIds: [rootPinId], dirtyKeys: {} });
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.projection.title, 'SENTINEL', 'the row file was not rewritten');
    assert.equal(after.dirtyKey, 'dirty-abc', 'the dirty key survived the skip');
    // The store re-reads from disk, so the sentinel is visible to callers.
    assert.equal((await store.getProjection(rootPinId)).title, 'SENTINEL');

    // A root outside liveRootIds is pruned (the stale-root rule).
    await store.saveProjections([], { liveRootIds: [] });
    assert.equal(await store.getProjection(rootPinId), null);
    assert.equal(fs.existsSync(file), false, 'the pruned projection file is gone');

    // A write without an explicit key reports '' so the next sweep replays it.
    await store.saveProjections([projection]);
    assert.equal((await store.projectionSweepState())[0].dirtyKey, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: an unserializable projection fails the whole batch without partial writes', async () => {
  const { root, store } = openStore();
  try {
    const projectionA = buildProjection();
    const projectionB = { ...buildProjection(), rootPinId: 'task0000000009i0' };
    // A circular reference cannot be serialized: the batch must throw before
    // ANY file lands (the serialize-first rule), unlike a per-row writer that
    // would leave projectionA behind.
    const broken = { ...projectionB };
    broken.self = broken;
    await assert.rejects(
      () => store.saveProjections([projectionA, broken], {
        liveRootIds: [projectionA.rootPinId, projectionB.rootPinId],
      }),
      /circular|Converting/
    );
    assert.equal(await store.getProjection(projectionA.rootPinId), null, 'the first write rolled back with the batch');
    assert.equal(await store.getProjection(projectionB.rootPinId), null);
    await store.saveProjections([projectionA]);
    assert.ok(await store.getProjection(projectionA.rootPinId));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: watch statuses and alerts persist', async () => {
  const { root, store } = openStore();
  try {
    await store.setWatchStatuses([
      { root: 'task1', node: 't1', status: 'claimed' },
      { root: 'task1', node: 'r1', status: 'open' },
    ]);
    await store.setWatchStatuses([{ root: 'task1', node: 't1', status: 'verified' }]);
    assert.deepEqual(
      (await store.getWatchStatuses()).map((entry) => [entry.node, entry.status]).sort(),
      [['r1', 'open'], ['t1', 'verified']]
    );

    await store.appendAlerts([
      { kind: 'claim_ttl_soon', rootPinId: 'task1', node: 't1', detail: '1h', createdAtMs: 10 },
      { kind: 'submission_change', rootPinId: 'task1', node: 'r1', detail: 'open->claimed', createdAtMs: 11 },
    ]);
    assert.equal((await store.listAlerts()).length, 2);

    // The 48h decay horizon prunes one-shot transition notices.
    await store.appendAlerts([{ kind: 'closing_drive', rootPinId: 'task1', node: 'r1', detail: '2', createdAtMs: 59_500 }]);
    await store.pruneAlerts(1_000, 60_000);
    const remaining = await store.listAlerts();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].kind, 'closing_drive');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: a degraded empty body never overwrites a cached good one', async () => {
  const { root, store } = openStore();
  try {
    const goodTree = { root: 'r1', nodes: [{ id: 'r1', parent: null, title: 'root', weight: 10_000, deps: [], params: {} }] };
    const treePin = 'tree0000000009i0';
    await store.upsertEvents([ev(treePin, 'tree', goodTree, 'idq1publisherx')]);

    // A later sweep whose content recovery failed reports {} — the truncated
    // summary that never parsed. The cached good body must survive, while the
    // rest of the row still refreshes.
    await store.upsertEvents([ev(treePin, 'tree', {}, 'idq1publisherx', 190_200)]);
    const cached = (await store.loadEvents()).find((event) => event.pinId === treePin);
    assert.deepEqual(cached.body, goodTree, 'anti-downgrade: the good body is kept');
    assert.equal(cached.height, 190_200, 'every other field still updates');

    // A genuinely changed non-empty body still wins.
    const changedTree = { root: 'r1', nodes: [{ id: 'r2', parent: null, title: 'root2', weight: 10_000, deps: [], params: {} }] };
    await store.upsertEvents([ev(treePin, 'tree', changedTree, 'idq1publisherx')]);
    assert.deepEqual((await store.loadEvents()).find((event) => event.pinId === treePin).body, changedTree);

    // The upgrade path stays open: a cached {} is still replaceable by a
    // recovered body (the self-heal case).
    const poisonPin = 'tree0000000008i0';
    await store.upsertEvents([ev(poisonPin, 'tree', {}, 'idq1publisherx')]);
    await store.upsertEvents([ev(poisonPin, 'tree', goodTree, 'idq1publisherx')]);
    assert.deepEqual((await store.loadEvents()).find((event) => event.pinId === poisonPin).body, goodTree);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: refresh state transitions', async () => {
  const { root, store } = openStore();
  try {
    assert.equal((await store.refreshInfo()).refreshing, false);
    await store.setRefreshing(true);
    assert.equal((await store.refreshInfo()).refreshing, true);
    await store.markRefreshDone(true, null, 190_151);
    const info = await store.refreshInfo();
    assert.equal(info.refreshing, false);
    assert.equal(info.boundaryBlock, 190_151);
    assert.equal(info.lastError, null);
    assert.ok(info.lastOkAtMs);
    const seq1 = await store.bumpSeq();
    const seq2 = await store.bumpSeq();
    assert.equal(seq2, seq1 + 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


// ── identity enrichment throttling (acceptance follow-up 2: 6h / 64-per-sweep) ──

test('metatask store: identity refresh TTL re-resolves stale rows, keeps fresh ones', async () => {
  const { root } = openStore();
  try {
    let clock = 1_000_000;
    const calls = [];
    const counted = createMetaTaskStore(path.join(root, 'metatask'), {
      identityTtlMs: 3_600_000,
      now: () => clock,
      resolveIdentities: async (metaIds) => {
        calls.push([...metaIds]);
        const out = {};
        for (const metaId of metaIds) out[metaId] = { metaId, name: `name-${metaId}`, avatar: null };
        return out;
      },
    });
    const projection = buildProjection();
    // First pass: nothing cached -> resolver sees the actors.
    await counted.enrichIdentities([projection]);
    assert.equal(calls.length, 1);
    // Second pass immediately: everything fresh -> no resolver call.
    await counted.enrichIdentities([projection]);
    assert.equal(calls.length, 1, 'fresh identities stay cached');
    // Advance past the TTL -> the same actors re-enter the remote tier.
    clock += 3_600_001;
    await counted.enrichIdentities([projection]);
    assert.equal(calls.length, 2, 'stale rows re-resolve after the horizon');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metatask store: the remote tier is capped at 64 identities per sweep', async () => {
  const { root } = openStore();
  try {
    const calls = [];
    const counted = createMetaTaskStore(path.join(root, 'metatask'), {
      resolveIdentities: async (metaIds) => {
        calls.push(metaIds.length);
        return {};
      },
    });
    // 100 distinct actors on one projection: only 64 reach the resolver.
    const nodes = {};
    const participants = [];
    for (let index = 0; index < 100; index += 1) {
      const metaId = `idq1bulk${String(index).padStart(4, '0')}`;
      participants.push({ metaId, effectiveClaims: 0, submissions: 1, verifiedContrib: 0, reviewVotes: 0, reviewCorrect: 0, reviewTerminal: 0 });
      nodes[`n${index}`] = {
        id: `n${index}`, parent: null, title: 'leaf', kind: 'proof', weight: null, params: null, specid: null,
        status: 'claimed', disputed: false,
        holder: { pinId: `c${index}`, claimant: metaId, sinceMs: 1 },
        submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 1,
      };
    }
    const bulk = {
      ...buildProjection(),
      participants,
      nodeStates: nodes,
      settlement: null,
    };
    await counted.enrichIdentities([bulk]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 64, '64-per-sweep cap (IDBots parity)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
