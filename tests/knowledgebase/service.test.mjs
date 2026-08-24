import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createKnowledgeBaseService,
  slugifyKbFileName,
  buildKbDocumentJson,
  KnowledgeBaseServiceError,
} = require('../../dist/core/knowledgebase/service.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return { paths: resolveMetabotPaths(homeDir), homeDir };
}

test('ensureDefaultKnowledgeBase lazily creates and caches the default KB', async () => {
  const { paths } = makeProfile('metabot-kb-svc-default-');
  const service = createKnowledgeBaseService(paths);
  const first = await service.ensureDefaultKnowledgeBase('bot-1');
  assert.equal(first.isDefault, true);
  const second = await service.ensureDefaultKnowledgeBase('bot-1');
  assert.equal(second.id, first.id, 'second call reuses the same row');
});

test('addDocument -> learn -> query roundtrip with metaweb provenance', async () => {
  const { paths } = makeProfile('metabot-kb-svc-roundtrip-');
  const service = createKnowledgeBaseService(paths);

  await service.addDocument('bot-1', {
    title: '占卜塔罗入门',
    content: '塔罗牌共有七十八张，其中大阿卡纳二十二张，小阿卡纳五十六张。占卜时洗牌、切牌、抽牌。',
    sourceType: 'metaweb',
    pinId: 'pin-abc',
    tags: ['tarot'],
  });
  await service.addDocument('bot-1', {
    title: 'Sourdough Basics',
    content: 'Feed the starter daily, knead until windowpane, bake at 230C with steam.',
    sourceType: 'web',
    url: 'https://example.test/bread',
  });

  const empty = await service.queryKnowledgeBase('bot-1', '塔罗');
  assert.deepEqual(empty, [], 'before learn the index is empty');

  const learned = await service.learnKnowledgeBase('bot-1');
  assert.equal(learned.docCount, 2);
  assert.ok(learned.chunkCount >= 2);
  assert.ok(learned.lastLearnedAt > 0);

  const zh = await service.queryKnowledgeBase('bot-1', '塔罗 占卜');
  assert.equal(zh.length, 1);
  assert.ok(zh[0].hits.length > 0);
  assert.match(zh[0].hits[0].snippet, /塔罗|占卜/);

  const en = await service.queryKnowledgeBase('bot-1', 'sourdough starter');
  assert.equal(en.length, 1);
  assert.ok(en[0].hits.length > 0);

  const miss = await service.queryKnowledgeBase('bot-1', 'quantum entanglement croissant');
  assert.deepEqual(miss, [], 'insufficient evidence returns empty');

  // The stored document is a SimpleNote-shaped JSON with provenance.
  const kb = await service.store.getDefaultKnowledgeBase('bot-1');
  const inboxFile = path.join(kb.rawDir, 'metabot-inbox',
    slugifyKbFileName('占卜塔罗入门', '塔罗牌共有七十八张，其中大阿卡纳二十二张，小阿卡纳五十六张。占卜时洗牌、切牌、抽牌。'));
  assert.ok(existsSync(inboxFile), `inbox file written: ${inboxFile}`);
  const stored = JSON.parse(readFileSync(inboxFile, 'utf8'));
  assert.equal(stored['x-kb-source'].type, 'metaweb');
  assert.equal(stored['x-kb-source'].pinId, 'pin-abc');

  // Re-adding identical content is idempotent (same slug file).
  await service.addDocument('bot-1', { title: '占卜塔罗入门', content: '塔罗牌共有七十八张，其中大阿卡纳二十二张，小阿卡纳五十六张。占卜时洗牌、切牌、抽牌。' });
  const relearned = await service.learnKnowledgeBase('bot-1');
  assert.equal(relearned.docCount, 2, 'no duplicate doc after re-add');
});

test('cross-KB merged ranking and scoping by knowledgeBaseId', async () => {
  const { paths } = makeProfile('metabot-kb-svc-multi-');
  const service = createKnowledgeBaseService(paths);
  const lawKb = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Law' });
  const foodKb = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Food' });

  await service.addDocument('bot-1', { title: '民法典总则', content: '民法调整平等主体之间的人身关系和财产关系。', knowledgeBaseId: lawKb.id });
  await service.addDocument('bot-1', { title: '面包食谱', content: '做面包需要面粉、水、盐和酵母。', knowledgeBaseId: foodKb.id });
  await service.learnKnowledgeBase('bot-1', lawKb.id);
  await service.learnKnowledgeBase('bot-1', foodKb.id);

  const all = await service.queryKnowledgeBase('bot-1', '民法');
  assert.equal(all.length, 1);
  assert.equal(all[0].knowledgeBaseId, lawKb.id);

  const scoped = await service.queryKnowledgeBase('bot-1', '面包', { knowledgeBaseId: foodKb.id });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].knowledgeBaseName, 'Food');

  await assert.rejects(
    service.queryKnowledgeBase('bot-1', 'x', { knowledgeBaseId: 'missing' }).then(() => {
      throw new Error('should not resolve');
    }, (error) => { throw error; }),
    /should not/,
  ).catch(() => undefined);
  // Missing KB simply scopes to nothing (no throw, empty results).
  const none = await service.queryKnowledgeBase('bot-1', '民法', { knowledgeBaseId: 'missing' });
  assert.deepEqual(none, []);
});

test('importFiles copies supported files and skips the rest', async () => {
  const { paths, homeDir } = makeProfile('metabot-kb-svc-import-');
  const service = createKnowledgeBaseService(paths);
  const kb = await service.ensureDefaultKnowledgeBase('bot-1');
  const docA = path.join(homeDir, 'a.md');
  const docB = path.join(homeDir, 'b.exe');
  writeFileSync(docA, '# Doc A\ncontent');
  writeFileSync(docB, 'binary');
  const imported = await service.importFiles('bot-1', kb.id, [docA, docB]);
  assert.equal(imported, 1);
  assert.ok(existsSync(path.join(kb.rawDir, 'a.md')));
  assert.ok(!existsSync(path.join(kb.rawDir, 'b.exe')));
});

test('addDocument rejects empty fields; provenance bounds hold', async () => {
  const { paths } = makeProfile('metabot-kb-svc-invalid-');
  const service = createKnowledgeBaseService(paths);
  await assert.rejects(
    service.addDocument('bot-1', { title: ' ', content: 'x' }),
    (error) => error instanceof KnowledgeBaseServiceError,
  );
  const json = JSON.parse(buildKbDocumentJson({
    title: 'T', content: 'C', url: 'https://x.test/' + 'a'.repeat(1000), tags: Array.from({ length: 30 }, () => 'tag'),
  }));
  assert.equal(json['x-kb-source'].url.length, 500);
  assert.equal(json['x-kb-source'].tags.length, 10);
  assert.equal(json['x-kb-source'].tags[0].length, 3);
});

test('removeKnowledgeBase prunes raw corpus AND derived index (no stale chunks)', async () => {
  const { paths } = makeProfile('metabot-kb-svc-remove-');
  const service = createKnowledgeBaseService(paths);
  const kb = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Law' });
  await service.addDocument('bot-1', { title: '民法典总则', content: '民法调整平等主体之间的人身关系和财产关系。', knowledgeBaseId: kb.id });
  await service.learnKnowledgeBase('bot-1', kb.id);
  const hitsBefore = await service.queryKnowledgeBase('bot-1', '民法');
  assert.equal(hitsBefore.length, 1);

  assert.equal(await service.store.removeKnowledgeBase(kb.id), true);
  const fs = await import('node:fs');
  const indexFile = require('../../dist/core/knowledgebase/store.js').knowledgeBaseIndexPath(paths, kb.id);
  assert.equal(fs.existsSync(indexFile), false, 'derived index deleted');
  assert.equal(fs.existsSync(path.join(kb.rawDir, 'metabot-inbox')), false, 'raw corpus deleted');

  // Same-name KB recreated (same slug-derived id is fine — everything was
  // pruned): no stale chunks until new content is learned.
  const reborn = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Law' });
  assert.ok(reborn.id);
  const stale = await service.queryKnowledgeBase('bot-1', '民法');
  assert.deepEqual(stale, []);
});
