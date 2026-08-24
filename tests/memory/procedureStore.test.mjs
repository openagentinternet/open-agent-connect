import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createProcedureStore,
  procedureTitleFingerprint,
  scoreProceduresForQuery,
} = require('../../dist/core/memory/procedureStore.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return resolveMetabotPaths(homeDir);
}

test('upsert dedupes by title fingerprint with version bumps; archive lifecycle', async () => {
  const paths = makeProfile('metabot-proc-upsert-');
  const store = createProcedureStore(paths);
  const first = await store.upsertProcedure({
    title: '发布 SimpleNote 教程',
    steps: ['写内容', '上传封面', '调用 post_simplenote'],
    pitfalls: ['别用 Web2 图床'],
    tags: ['publishing'],
  });
  assert.equal(first.created, true);
  assert.equal(first.procedure.version, 1);

  const rewrite = await store.upsertProcedure({
    title: '发布  SimpleNote  教程 ', // whitespace/case-normalized fingerprint
    steps: ['写内容', '上传封面', '调用 post_simplenote', '引用 pin:// 链接'],
  });
  assert.equal(rewrite.created, false);
  assert.equal(rewrite.procedure.id, first.procedure.id);
  assert.equal(rewrite.procedure.version, 2);
  assert.equal(rewrite.procedure.steps.length, 4);
  assert.equal(rewrite.procedure.pitfalls.length, 0, 'rewrite replaces pitfalls when omitted');

  assert.equal((await store.listProcedures()).length, 1);
  const archived = await store.archiveProcedureByTitle('发布 SimpleNote 教程');
  assert.equal(archived.status, 'archived');
  assert.equal((await store.listProcedures({ status: 'active' })).length, 0);
  assert.equal(await store.archiveProcedureByTitle('no such'), null);
});

test('recall scores multi-keyword and colloquial CJK queries; single chars match titles only', () => {
  const procedures = [
    { id: 'a', title: '发布链上文章', triggerText: '', tags: [], steps: ['写 markdown', 'post_simplenote 发布'], pitfalls: [], sourcePinIds: [], category: null, tags2: [], confidence: 0.5, status: 'active', origin: 'agent', useCount: 0, lastUsedAt: null, version: 1, createdAt: 0, updatedAt: 0, titleFingerprint: 'x' },
    { id: 'b', title: '搜索 MetaWeb', triggerText: '怎么搜链上知识', tags: ['search'], steps: ['search_metaweb'], pitfalls: [], sourcePinIds: [], category: null, confidence: 0.5, status: 'active', origin: 'agent', useCount: 0, lastUsedAt: null, version: 1, createdAt: 0, updatedAt: 0, titleFingerprint: 'y' },
  ].map((row) => ({ ...row, tags: row.id === 'a' ? [] : ['search'] }));

  const multi = scoreProceduresForQuery(procedures, '怎么 搜索 链上 知识');
  assert.equal(multi[0].procedure.id, 'b');
  assert.ok(multi[0].score >= 0.5);

  // Colloquial single-char query matches the TITLE only.
  const single = scoreProceduresForQuery(procedures, '搜');
  assert.equal(single.length, 1);
  assert.equal(single[0].procedure.id, 'b');
  const miss = scoreProceduresForQuery(procedures, '量子');
  assert.deepEqual(miss, []);
});

test('touchUsed bumps useCount and per-bot isolation holds', async () => {
  const pathsA = makeProfile('metabot-proc-iso-a-');
  const pathsB = makeProfile('metabot-proc-iso-b-');
  const storeA = createProcedureStore(pathsA);
  const storeB = createProcedureStore(pathsB);
  const saved = await storeA.upsertProcedure({ title: 'Proc A', steps: ['one'] });
  await storeB.upsertProcedure({ title: 'Proc B', steps: ['two'] });
  await storeA.touchUsed(saved.procedure.id);
  const rows = await storeA.listProcedures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].useCount, 1);
  assert.ok(rows[0].lastUsedAt > 0);
  assert.equal((await storeB.listProcedures())[0].title, 'Proc B');
  assert.equal(procedureTitleFingerprint('Title X'), procedureTitleFingerprint('title  x'));
});
