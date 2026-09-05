import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
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
