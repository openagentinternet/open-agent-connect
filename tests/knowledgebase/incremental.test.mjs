import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createKnowledgeBaseService } = require('../../dist/core/knowledgebase/service.js');
const { knowledgeBaseIndexPath } = require('../../dist/core/knowledgebase/store.js');
const { createKnowledgeBaseIndexStore } = require('../../dist/core/knowledgebase/indexStore.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return { paths: resolveMetabotPaths(homeDir), homeDir };
}

test('incremental learn reuses unchanged docs, re-learns changes, drops deletions', async () => {
  const { paths } = makeProfile('metabot-kb-incr-');
  const service = createKnowledgeBaseService(paths);
  const kb = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'Incr' });

  writeFileSync(path.join(kb.rawDir, 'keep.md'), '# Keep\nzebra unmorphy alpha content');
  writeFileSync(path.join(kb.rawDir, 'change.md'), '# Change\nquixotic original tokenstream');
  // Distinct mtimes so the size+mtime short-circuit is deterministic.
  utimesSync(path.join(kb.rawDir, 'keep.md'), new Date(), new Date(1_700_000_000_000));
  utimesSync(path.join(kb.rawDir, 'change.md'), new Date(), new Date(1_700_000_100_000));
  await service.learnKnowledgeBase('bot-1', kb.id);

  const indexStore = createKnowledgeBaseIndexStore(knowledgeBaseIndexPath(paths, kb.id));
  const afterFirst = await indexStore.load();
  assert.equal(afterFirst.version, 2, 'index file is the v2 shape');
  assert.equal(afterFirst.docs.length, 2);
  for (const chunk of afterFirst.chunks) {
    assert.ok(Array.isArray(chunk.tokens) && chunk.tokens.length > 0, 'v2 chunks carry tokens');
  }

  // Second learn with no changes: every doc keeps its first ingestedAt.
  await service.learnKnowledgeBase('bot-1', kb.id);
  const afterSecond = await indexStore.load();
  assert.deepEqual(
    afterSecond.docs.map((doc) => [doc.relpath, doc.ingestedAt]),
    afterFirst.docs.map((doc) => [doc.relpath, doc.ingestedAt]),
    'unchanged docs reuse their stored chunks+tokens',
  );

  // Change one file (new mtime + new content): only that doc re-ingests.
  writeFileSync(path.join(kb.rawDir, 'change.md'), '# Change\nrewritten body with freshdatabits');
  utimesSync(path.join(kb.rawDir, 'change.md'), new Date(), new Date(1_700_000_200_000));
  await service.learnKnowledgeBase('bot-1', kb.id);
  const afterChange = await indexStore.load();
  const keepRow = afterChange.docs.find((doc) => doc.relpath === 'keep.md');
  const changeRow = afterChange.docs.find((doc) => doc.relpath === 'change.md');
  const keepBefore = afterSecond.docs.find((doc) => doc.relpath === 'keep.md');
  const changeBefore = afterSecond.docs.find((doc) => doc.relpath === 'change.md');
  assert.equal(keepRow.ingestedAt, keepBefore.ingestedAt, 'unchanged doc untouched');
  assert.ok(changeRow.ingestedAt > changeBefore.ingestedAt, 'changed doc re-ingested');

  const hits = await indexStore.query('freshdatabits');
  assert.equal(hits.length, 1, 'changed content is queryable after incremental learn');

  // Same bytes at a different mtime are still detected as unchanged (sha path).
  utimesSync(path.join(kb.rawDir, 'keep.md'), new Date(), new Date(1_700_000_300_000));
  await service.learnKnowledgeBase('bot-1', kb.id);
  const afterTouch = await indexStore.load();
  const keepAfterTouch = afterTouch.docs.find((doc) => doc.relpath === 'keep.md');
  assert.equal(keepAfterTouch.ingestedAt, keepBefore.ingestedAt, 'same sha reuses chunks despite mtime bump');

  // Deletion drops the doc; full rebuild re-ingests what remains.
  const { rmSync } = await import('node:fs');
  rmSync(path.join(kb.rawDir, 'change.md'));
  await service.learnKnowledgeBase('bot-1', kb.id);
  const afterDelete = await indexStore.load();
  assert.deepEqual(afterDelete.docs.map((doc) => doc.relpath), ['keep.md']);

  await service.learnKnowledgeBase('bot-1', kb.id, true);
  const afterFull = await indexStore.load();
  const keepFull = afterFull.docs.find((doc) => doc.relpath === 'keep.md');
  assert.ok(keepFull.ingestedAt > keepBefore.ingestedAt, 'full learn re-ingests everything');

  const kbRow = await service.store.getKnowledgeBase(kb.id);
  assert.equal(kbRow.docCount, 1);
  assert.equal(kbRow.chunkCount, afterFull.chunks.length);
});

test('v1 index files migrate through a full rebuild without losing coverage', async () => {
  const { paths } = makeProfile('metabot-kb-incr-v1-');
  const service = createKnowledgeBaseService(paths);
  const kb = await service.store.createKnowledgeBase({ metabotSlug: 'bot-1', name: 'V1' });
  writeFileSync(path.join(kb.rawDir, 'doc.md'), '# Doc\nvintage content bits');
  await service.learnKnowledgeBase('bot-1', kb.id);

  const { readFileSync, writeFileSync: write } = await import('node:fs');
  const indexFile = knowledgeBaseIndexPath(paths, kb.id);
  const v2 = JSON.parse(readFileSync(indexFile, 'utf8'));
  // Downgrade to a v1 shape (no token lists) like a pre-upgrade install.
  write(indexFile, JSON.stringify({
    version: 1,
    docs: v2.docs,
    chunks: v2.chunks.map(({ docRelPath, ord, text }) => ({ docRelPath, ord, text })),
    inverted: v2.inverted,
  }));

  await service.learnKnowledgeBase('bot-1', kb.id);
  const migrated = await createKnowledgeBaseIndexStore(indexFile).load();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.docs.length, 1);
  const hits = await createKnowledgeBaseIndexStore(indexFile).query('vintage');
  assert.equal(hits.length, 1);
});
