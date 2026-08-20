import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-memory-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('create + list round-trips an owner-scope memory with classification', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const created = await store.create({ text: '我喜欢喝美式咖啡', isExplicit: true });
  assert.equal(created.scopeKind, 'owner');
  assert.equal(created.scopeKey, 'owner:self');
  assert.equal(created.usageClass, 'preference');
  assert.equal(created.visibility, 'local_only');
  assert.equal(created.status, 'created');

  const entries = await store.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, created.id);
});

test('owner operational preferences become external_safe; other classes never do', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const ops = await store.create({ text: '以后回复请用简洁的 markdown 格式', isExplicit: true });
  assert.equal(ops.usageClass, 'operational_preference');
  assert.equal(ops.visibility, 'external_safe');

  const fact = await store.create({ text: '我叫老张', isExplicit: true });
  assert.equal(fact.usageClass, 'profile_fact');
  assert.equal(fact.visibility, 'local_only');

  // Contact-scope entries are always local_only, even for operational text.
  const contactScoped = await store.create({
    text: 'reply in markdown format',
    scopeKind: 'contact',
    scopeKey: 'metaweb_private:peer:gm-bob',
    usageClass: 'operational_preference',
    visibility: 'external_safe',
  });
  assert.equal(contactScoped.visibility, 'local_only');
});

test('identical text revives the existing entry instead of duplicating', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const first = await store.create({ text: '我喜欢喝美式咖啡。', confidence: 0.7, source: { sessionId: 's1' } });
  const second = await store.create({ text: '我喜欢喝美式咖啡', confidence: 0.9, source: { sessionId: 's2' } });

  assert.equal(second.id, first.id);
  assert.equal(second.confidence, 0.9);
  assert.equal(second.sources.length, 2);

  const entries = await store.list();
  assert.equal(entries.length, 1);
});

test('near-duplicate text (>= 0.82 similarity) merges instead of inserting', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const first = await store.create({ text: '我喜欢喝美式咖啡' });
  const second = await store.create({ text: '我喜欢喝美式咖啡呀' });

  assert.equal(second.id, first.id);
  assert.equal((await store.list()).length, 1);

  // A clearly different fact must not merge.
  const third = await store.create({ text: '我女儿今年上小学二年级' });
  assert.notEqual(third.id, first.id);
  assert.equal((await store.list()).length, 2);
});

test('update edits text and re-fingerprints; delete soft-deletes and deactivates sources', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const created = await store.create({ text: '我叫老张', source: { sessionId: 's1' } });
  const updated = await store.update({ id: created.id, text: '我叫老张，住在杭州' });
  assert.ok(updated.text.includes('杭州'));
  assert.notEqual(updated.fingerprint, created.fingerprint);

  assert.equal(await store.remove({ id: created.id }), true);
  assert.equal((await store.list()).length, 0);
  const deleted = (await store.list({ status: 'deleted', includeDeleted: true }))[0];
  assert.equal(deleted.status, 'deleted');
  assert.ok(deleted.sources.every((source) => !source.isActive));
});

test('self_identity entries are protected from non-dream update/delete', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const identity = await store.create({
    text: '我是一个认真可靠的助手，经历过许多代码评审。',
    usageClass: 'self_identity',
    origin: 'dream',
  });
  assert.equal(identity.usageClass, 'self_identity');

  assert.equal(await store.update({ id: identity.id, text: 'attempted rewrite' }), null);
  assert.equal(await store.remove({ id: identity.id }), false);

  const allowed = await store.update({ id: identity.id, text: '我是一个认真可靠的助手。', allowProtected: true });
  assert.equal(allowed.text, '我是一个认真可靠的助手。');
  assert.equal(await store.remove({ id: identity.id, allowProtected: true }), true);
});

test('dream batch replace: softDeleteDreamMemoriesForDate clears one day batch, keeps self_identity', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const dreamFact = await store.create({
    text: '用户今天完成了发布',
    origin: 'dream',
    forceNew: true,
    source: { dreamDate: '2026-08-19' },
  });
  const identity = await store.create({
    text: '我是稳定的自我认知条目，不会被批量删除。',
    usageClass: 'self_identity',
    origin: 'dream',
    forceNew: true,
    source: { dreamDate: '2026-08-19' },
  });
  const otherDay = await store.create({
    text: '另一天的梦境事实',
    origin: 'dream',
    forceNew: true,
    source: { dreamDate: '2026-08-18' },
  });

  assert.equal(await store.softDeleteDreamMemoriesForDate('2026-08-19'), 1);
  const remaining = await store.list({ includeDeleted: false });
  const remainingIds = remaining.map((entry) => entry.id).sort();
  assert.deepEqual(remainingIds, [identity.id, otherDay.id].sort());
  const deletedFact = (await store.list({ status: 'deleted', includeDeleted: true }))
    .find((entry) => entry.id === dreamFact.id);
  assert.equal(deletedFact.status, 'deleted');
});

test('orphan implicit memories go stale once their sources are inactive', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  // No source at all -> orphan after the sweep.
  const orphan = await store.create({ text: '我女儿今年上小学', isExplicit: false });
  // Explicit entries never go stale.
  const explicit = await store.create({ text: '我叫老张', isExplicit: true });
  // Implicit with an active source stays created.
  const sourced = await store.create({ text: '我养了只猫', isExplicit: false, source: { sessionId: 's1' } });

  await store.markOrphanImplicitMemoriesStale();
  const byId = new Map((await store.list({ includeDeleted: true })).map((entry) => [entry.id, entry]));
  assert.equal(byId.get(orphan.id).status, 'stale');
  assert.equal(byId.get(explicit.id).status, 'created');
  assert.equal(byId.get(sourced.id).status, 'created');

  await store.markMemorySourcesInactiveBySession('s1');
  await store.markOrphanImplicitMemoriesStale();
  const after = new Map((await store.list({ includeDeleted: true })).map((entry) => [entry.id, entry]));
  assert.equal(after.get(sourced.id).status, 'stale');
});

test('stats and listScopes summarize the store', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  await store.create({ text: '我叫老张', isExplicit: true });
  await store.create({ text: '我喜欢喝美式咖啡', isExplicit: false });
  await store.create({
    text: 'peer prefers short replies',
    scopeKind: 'contact',
    scopeKey: 'metaweb_private:peer:gm-bob',
  });

  const stats = await store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.explicit, 1);
  assert.equal(stats.implicit, 1);

  const scopes = await store.listScopes();
  assert.equal(scopes.owner.count, 2);
  assert.equal(scopes.contacts.length, 1);
  assert.equal(scopes.contacts[0].peerGlobalMetaId, 'gm-bob');
  assert.equal(scopes.conversations.length, 0);
});

test('text caps: generic entries truncate at 360 chars, self_identity at 1200', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const long = await store.create({ text: '很长的记忆'.repeat(100) });
  assert.ok(long.text.length <= 360);
  assert.ok(long.text.endsWith('…'));

  const identity = await store.create({ text: '自我认知'.repeat(200), usageClass: 'self_identity' });
  assert.ok(identity.text.length <= 1200);
  assert.ok(identity.text.length > 360);
});
