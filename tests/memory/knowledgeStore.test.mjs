import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createKnowledgeStore } = require('../../dist/core/memory/knowledgeStore.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-knowledge-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('upsert creates, then revises with version bump and archived revision', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);

  const created = await store.upsertKnowledge({
    topic: '用户喜欢的设计风格',
    summary: '极简、大留白',
    kind: 'know_how',
    category: '设计',
  });
  assert.equal(created.created, true);
  assert.equal(created.revised, false);
  assert.equal(created.entry.version, 1);

  // Same content again: no fake revision.
  const noop = await store.upsertKnowledge({ topic: '用户喜欢的设计风格', summary: '极简、大留白', kind: 'know_how', category: '设计' });
  assert.equal(noop.created, false);
  assert.equal(noop.revised, false);
  assert.equal(noop.entry.version, 1);

  // Topic match is whitespace/case-insensitive via the fingerprint.
  const revised = await store.upsertKnowledge({
    topic: '  用户喜欢的设计风格 ',
    summary: '极简、大留白、深色优先',
    kind: 'know_how',
    category: '设计',
  });
  assert.equal(revised.created, false);
  assert.equal(revised.revised, true);
  assert.equal(revised.entry.version, 2);
  assert.equal(revised.entry.summary, '极简、大留白、深色优先');
  assert.equal(revised.entry.revisions.length, 1);
  assert.equal(revised.entry.revisions[0].summary, '极简、大留白');
  assert.equal(revised.entry.revisions[0].version, 1);
});

test('pitfall kind is first-class; update-by-id rewrites in place', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);

  const pitfall = await store.upsertKnowledge({
    topic: '某框架升级时的内存泄漏坑',
    summary: '升级到 v3 后必须手动释放 worker',
    kind: 'pitfall',
  });
  assert.equal(pitfall.entry.kind, 'pitfall');

  const updated = await store.updateKnowledge({
    id: pitfall.entry.id,
    summary: '升级到 v3.1 后不再需要手动释放',
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.summary, '升级到 v3.1 后不再需要手动释放');

  const missing = await store.updateKnowledge({ id: 'kn_missing', summary: 'x' });
  assert.equal(missing, null);
});

test('list filters by kind/category/query/status; archive and delete behave', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);

  await store.upsertKnowledge({ topic: '发布清单整理法', summary: '先排序再标风险', kind: 'know_how', category: '协作' });
  const target = await store.upsertKnowledge({ topic: '深色主题适配坑', summary: '注意对比度', kind: 'pitfall', category: '设计' });

  assert.equal((await store.listKnowledge({ kind: 'pitfall' })).length, 1);
  assert.equal((await store.listKnowledge({ category: '协作' })).length, 1);
  assert.equal((await store.listKnowledge({ query: '对比度' })).length, 1);
  assert.equal(await store.countActive(), 2);

  const archived = await store.archiveKnowledge(target.entry.id);
  assert.equal(archived.status, 'archived');
  assert.equal(await store.countActive(), 1);
  assert.equal((await store.listKnowledge({ status: 'all' })).length, 2);

  assert.equal(await store.deleteKnowledge(target.entry.id), true);
  assert.equal((await store.listKnowledge({ status: 'all' })).length, 1);
  assert.equal(await store.deleteKnowledge(target.entry.id), false);
});

test('listKnowledgeForDream returns the compact active view', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);
  await store.upsertKnowledge({ topic: '甲', summary: '结论甲', kind: 'principle' });
  const view = await store.listKnowledgeForDream();
  assert.equal(view.length, 1);
  assert.deepEqual(Object.keys(view[0]).sort(), ['category', 'id', 'kind', 'summary', 'topic', 'version'].sort());
});

test('validation: topic/summary required and bounded', async () => {
  const paths = await createTempProfileHome();
  const store = createKnowledgeStore(paths);
  await assert.rejects(() => store.upsertKnowledge({ topic: '', summary: 'x' }), /topic is required/);
  await assert.rejects(() => store.upsertKnowledge({ topic: 'x', summary: '' }), /summary is required/);
  await assert.rejects(
    () => store.upsertKnowledge({ topic: 't', summary: 's', sourceDreamDate: '19-08-2026' }),
    /YYYY-MM-DD/,
  );
});
