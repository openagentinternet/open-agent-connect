import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createKnowledgeBaseStore,
  knowledgeBaseIndexPath,
} = require('../../dist/core/knowledgebase/store.js');
const { createKnowledgeBaseIndexStore } = require('../../dist/core/knowledgebase/indexStore.js');
const {
  tokenizeKnowledgeBaseText,
  buildKbFtsQuery,
  chunkKnowledgeBaseText,
  phraseScore,
  cleanKnowledgeBaseText,
  sha256Text,
} = require('../../dist/core/knowledgebase/text.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return resolveMetabotPaths(homeDir);
}

test('tokenizer emits latin, CJK unigrams and bigrams; query builder is precision-first', () => {
  const tokens = tokenizeKnowledgeBaseText('民法 contract 民法典');
  assert.ok(tokens.includes('contract'));
  assert.ok(tokens.includes('民'));
  assert.ok(tokens.includes('民法'));
  assert.ok(tokens.includes('民法') && tokens.includes('法典'), 'bigrams within runs');
  assert.ok(!tokens.includes('法民'), 'never across boundaries');

  const fts = buildKbFtsQuery('民法典 contract');
  assert.ok(fts.includes('"民法"') && fts.includes('"法典"') && fts.includes('"contract"'));
  assert.ok(!fts.includes('"民"'), 'unigrams inside longer runs never enter the query');
  assert.equal(buildKbFtsQuery('??'), '');
});

test('chunker prefers paragraph boundaries and overlaps', () => {
  const para = '第一段内容。'.repeat(40) + '\n\n' + '第二段内容。'.repeat(40);
  const chunks = chunkKnowledgeBaseText(para, 200, 40);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 210, `chunk bounded: ${chunk.text.length}`);
  }
  assert.deepEqual(chunkKnowledgeBaseText('   '), []);
  assert.deepEqual(chunkKnowledgeBaseText('short'), [{ text: 'short', startOffset: 0, endOffset: 5 }]);
});

test('phraseScore: substring, shared bigrams, latin coverage', () => {
  assert.ok(phraseScore('民法', '民法典是…') > 0);
  assert.equal(phraseScore('', 'x'), 0);
  assert.ok(phraseScore('fishing guide', 'the fishing guide book') >= 1);
  assert.equal(cleanKnowledgeBaseText('a\tb\n\n\n\nc  d'), 'a b\n\nc d');
  assert.equal(sha256Text('x').length, 64);
});

test('registry store: create/list/default/due-for-auto-learn lifecycle', async () => {
  const paths = makeProfile('metabot-kb-registry-');
  const store = createKnowledgeBaseStore(paths);
  assert.deepEqual(await store.listKnowledgeBases(), []);

  const first = await store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Default' });
  assert.equal(first.isDefault, true, 'first KB becomes the default');
  const second = await store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Recipes', autoLearn: false });
  assert.equal(second.isDefault, false);

  const fetched = await store.getKnowledgeBase(second.id);
  assert.equal(fetched.name, 'Recipes');
  assert.equal((await store.getDefaultKnowledgeBase('bot-1')).id, first.id);

  await store.setCounts(first.id, 3, 12, 1234);
  assert.equal((await store.getKnowledgeBase(first.id)).docCount, 3);
  await store.markAutoLearned(first.id, '2026-08-24');
  await store.updateKnowledgeBase(second.id, { autoLearn: true, description: 'cooking' });
  assert.equal((await store.getKnowledgeBase(second.id)).description, 'cooking');

  // Auto-learn window 00:00-06:00 local, once per local day.
  const dueNight = await store.listDueForAutoLearn(new Date(2026, 7, 25, 2, 0, 0));
  const dueDay = await store.listDueForAutoLearn(new Date(2026, 7, 25, 10, 0, 0));
  assert.deepEqual(dueNight.map((row) => row.id).sort(), [first.id, second.id].sort());
  assert.equal(dueDay.length, 0);
  const dueAgain = await store.listDueForAutoLearn(new Date(2026, 7, 24, 3, 0, 0));
  assert.equal(dueAgain.length, 1, 'already learned today is skipped');
  assert.equal(dueAgain[0].id, second.id);

  assert.equal(await store.removeKnowledgeBase(second.id), true);
  assert.equal(await store.removeKnowledgeBase(second.id), false);
});

test('index store: rebuild from raw dir, Chinese query, rebuild wipes stale docs', async () => {
  const paths = makeProfile('metabot-kb-index-');
  const store = createKnowledgeBaseStore(paths);
  const kb = await store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Corpus' });
  const rawDir = kb.rawDir;
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(path.join(rawDir, 'law.md'), '# 民法典\n\n民法典是市场经济的基本法，调整平等主体之间的人身和财产关系。\n\n合同编规定了合同的订立、效力与违约责任。');
  writeFileSync(path.join(rawDir, 'cooking.md'), '# Cooking\n\nHow to make sourdough bread at home with a starter.');
  writeFileSync(path.join(rawDir, 'note.json'), JSON.stringify({
    title: '契约精神', contentType: 'text/markdown', content: '契约精神是民法的核心原则，诚实信用贯穿始终。', createTime: '1787000000',
  }));
  writeFileSync(path.join(rawDir, 'raw-pin.json'), JSON.stringify({ pinId: 'x', raw: 'data 数据' }));

  const indexPath = knowledgeBaseIndexPath(paths, kb.id);
  const index = createKnowledgeBaseIndexStore(indexPath);
  const stats = await index.rebuild(rawDir, () => 1_000);
  assert.equal(stats.docCount, 4);
  assert.ok(stats.chunkCount >= 4);

  const hits = await index.query('民法典 合同', { topK: 3 });
  assert.ok(hits.length > 0, 'Chinese query matches');
  assert.equal(hits[0].docRelPath, 'law.md');
  assert.ok(hits[0].score >= 0.18);
  assert.ok(hits[0].snippet.length > 0);

  const noteHits = await index.query('契约精神 诚实信用');
  assert.ok(noteHits.length > 0);
  assert.equal(noteHits[0].docRelPath, 'note.json', 'SimpleNote JSON unwrapped to its body');

  const miss = await index.query('quantum crochet', { minScore: 0.18 });
  assert.deepEqual(miss, [], 'no cross-language false positives above threshold');

  // Rebuild after deleting a doc drops it from the index.
  const fs = await import('node:fs');
  fs.rmSync(path.join(rawDir, 'cooking.md'));
  await index.rebuild(rawDir, () => 2_000);
  const english = await index.query('sourdough');
  assert.deepEqual(english, [], 'stale doc gone after rebuild');

  await index.clear();
  assert.equal((await index.load()).chunks.length, 0);
});
