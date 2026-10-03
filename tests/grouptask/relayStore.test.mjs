import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createGroupTaskRelayStore } = require('../../dist/core/grouptask/relayStore.js');

function createStore(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'chair-bot');
  mkdirSync(homeDir, { recursive: true });
  return createGroupTaskRelayStore(resolveMetabotPaths(homeDir));
}

test('relay store: add, listPending, and drain are one-shot per row', async () => {
  const store = createStore('metabot-gt-relay-');
  await store.add({ taskId: 1, groupId: 'grp-1', sessionId: 'sess-a', kind: 'created', title: 'T', text: 'created' });
  await store.add({ taskId: 1, groupId: 'grp-1', sessionId: 'sess-b', kind: 'review', title: 'T', text: 'in review' });

  const pending = await store.listPending();
  assert.equal(pending.length, 2);

  const drained = await store.drain();
  assert.equal(drained.length, 2);
  assert.ok(drained.every((row) => row.drainedAt != null));
  assert.equal((await store.listPending()).length, 0, 'drain is one-shot');
  assert.equal((await store.drain()).length, 0);
});

test('relay store: drain prunes drained rows past the 30-day retention', async () => {
  const store = createStore('metabot-gt-relay-prune-');
  const now = Date.now();
  const stale = now - 40 * 24 * 60 * 60 * 1000;
  const makeRow = (id, drainedAt) => ({
    id, taskId: 1, groupId: 'grp-1', sessionId: 'sess', kind: 'review',
    title: 'T', text: 'x', createdAt: now - 1000, drainedAt,
  });
  mkdirSync(store.root, { recursive: true });
  writeFileSync(path.join(store.root, 'relay.json'), JSON.stringify({
    seq: 3,
    rows: [makeRow(1, stale), makeRow(2, now - 1000), makeRow(3, null)],
  }));

  const drained = await store.drain();
  assert.equal(drained.length, 1, 'the pending row is the only one drained');
  const after = JSON.parse(readFileSync(path.join(store.root, 'relay.json'), 'utf8'));
  assert.deepEqual(after.rows.map((row) => row.id), [2, 3], 'stale drained row pruned, pending retained');
});

test('relay store: drain caps retained rows at 200, evicting the oldest drained first', async () => {
  const store = createStore('metabot-gt-relay-cap-');
  const now = Date.now();
  const rows = Array.from({ length: 250 }, (_, index) => ({
    id: index + 1, taskId: 1, groupId: 'grp-1', sessionId: 'sess', kind: 'review',
    title: 'T', text: 'x', createdAt: now, drainedAt: now - index,
  }));
  mkdirSync(store.root, { recursive: true });
  writeFileSync(path.join(store.root, 'relay.json'), JSON.stringify({ seq: 250, rows }));

  assert.equal((await store.drain()).length, 0);
  const after = JSON.parse(readFileSync(path.join(store.root, 'relay.json'), 'utf8'));
  assert.equal(after.rows.length, 200, 'file capped at 200 rows');
  assert.equal(after.rows[0].id, 1, 'newest drained rows kept');
  assert.equal(after.rows.at(-1).id, 200);
  assert.ok(after.rows.every((row) => row.drainedAt != null));
  assert.deepEqual(await store.listPending(), [], 'listPending behavior unchanged');
});

test('relay store: rows survive a reopen (state file persistence)', async () => {
  const systemHome = mkdtempTempRootSync('metabot-gt-relay-persist-');
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'chair-bot');
  mkdirSync(homeDir, { recursive: true });
  const paths = resolveMetabotPaths(homeDir);
  const first = createGroupTaskRelayStore(paths);
  await first.add({ taskId: 7, groupId: null, sessionId: 'sess-x', kind: 'paused', title: 'Title', text: 'paused by owner' });
  const second = createGroupTaskRelayStore(paths);
  const pending = await second.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'paused');
  assert.equal(pending[0].sessionId, 'sess-x');
});
