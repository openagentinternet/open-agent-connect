import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createKnowledgeBaseService } = require('../../dist/core/knowledgebase/service.js');
const { knowledgeBaseIndexPath } = require('../../dist/core/knowledgebase/store.js');
const {
  createKnowledgeBaseIndexStore,
  withKbIndexLock,
  KbIndexLockError,
} = require('../../dist/core/knowledgebase/indexStore.js');
const studyJobs = require('../../dist/core/knowledgebase/studyJobs.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return { paths: resolveMetabotPaths(homeDir), homeDir };
}

// ---------------------------------------------------------------------------
// #9 — cross-instance learn lock
// ---------------------------------------------------------------------------

test('withKbIndexLock serializes overlapping critical sections and removes the lock after', async () => {
  const { paths } = makeProfile('metabot-kb-lock-');
  const indexPath = knowledgeBaseIndexPath(paths, 'kb-x');
  const events = [];
  const release = [];
  let gate;
  const first = withKbIndexLock(indexPath, async () => {
    events.push('first-start');
    await new Promise((resolve) => { gate = resolve; });
    events.push('first-end');
  }, { waitMs: 5_000, staleMs: 60_000 });
  release.push(gate);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const second = withKbIndexLock(indexPath, async () => {
    events.push('second-start');
  }, { waitMs: 5_000, staleMs: 60_000 });
  // The second critical section must not start until the first releases.
  const raced = await Promise.race([second.then(() => 'second-done'), new Promise((resolve) => setTimeout(() => resolve('timeout'), 300))]);
  assert.equal(raced, 'timeout', 'second waiter is blocked while the lock is held');
  gate();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
  assert.equal(existsSync(`${indexPath}.lock`), false, 'lock file is released');
});

test('withKbIndexLock refuses with learn_busy when a FRESH lock outlives the wait budget', async () => {
  const { paths } = makeProfile('metabot-kb-lock-busy-');
  const indexPath = knowledgeBaseIndexPath(paths, 'kb-x');
  // A live holder's lock: current timestamp, well within the stale window.
  mkdirSync(path.dirname(`${indexPath}.lock`), { recursive: true });
  writeFileSync(`${indexPath}.lock`, JSON.stringify({ pid: process.pid, at: Date.now() }));
  await assert.rejects(
    withKbIndexLock(indexPath, async () => {
      throw new Error('must not run');
    }, { waitMs: 50, staleMs: 60_000 }),
    (error) => error instanceof KbIndexLockError && error.code === 'learn_busy',
  );
});

test('withKbIndexLock steals a stale crashed lock and proceeds', async () => {
  const { paths } = makeProfile('metabot-kb-lock-stale-');
  const indexPath = knowledgeBaseIndexPath(paths, 'kb-x');
  // Simulate a lock a crashed process left behind well past the stale age.
  mkdirSync(path.dirname(`${indexPath}.lock`), { recursive: true });
  writeFileSync(`${indexPath}.lock`, JSON.stringify({ pid: 999999, at: Date.now() - 60_000 }));
  const result = await withKbIndexLock(indexPath, async () => 'ran', { waitMs: 2_000, staleMs: 1_000 });
  assert.equal(result, 'ran');
  assert.equal(existsSync(`${indexPath}.lock`), false);
});

// ---------------------------------------------------------------------------
// #10 — single-doc upsert (the addDocument hot path)
// ---------------------------------------------------------------------------

test('upsertDoc adds one doc without touching the rest; unchanged docs report no change', async () => {
  const { paths } = makeProfile('metabot-kb-upsert-');
  const kbDir = path.join(paths.workspaceRoot, 'manual-corpus');
  mkdirSync(kbDir, { recursive: true });
  writeFileSync(path.join(kbDir, 'a.md'), '# A\nzebra unmorphy alpha content');
  writeFileSync(path.join(kbDir, 'b.md'), '# B\nquixotic tokenstream content');
  const indexStore = createKnowledgeBaseIndexStore(path.join(paths.runtimeRoot, 'kb', 'upsert-index.json'));
  await indexStore.rebuild(kbDir, () => 1_000);

  writeFileSync(path.join(kbDir, 'c.md'), '# C\n塔罗牌占卜入门知识。');
  const added = await indexStore.upsertDoc(kbDir, path.join(kbDir, 'c.md'), () => 2_000);
  assert.equal(added.changed, true);
  assert.equal(added.docCount, 3);

  const hits = await indexStore.query('塔罗牌 占卜');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].docRelPath, 'c.md');

  // Unchanged: no rewrite, same counts.
  const unchanged = await indexStore.upsertDoc(kbDir, path.join(kbDir, 'c.md'), () => 3_000);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.docCount, 3);

  // Same path, new content: updated in place.
  writeFileSync(path.join(kbDir, 'c.md'), '# C2\n民法典合同编要点解读。');
  const updated = await indexStore.upsertDoc(kbDir, path.join(kbDir, 'c.md'), () => 4_000);
  assert.equal(updated.changed, true);
  const updatedHits = await indexStore.query('塔罗牌 占卜');
  assert.equal(updatedHits.length, 0, 'stale content is gone');
  const freshHits = await indexStore.query('民法典 合同');
  assert.equal(freshHits.length, 1);
});

test('upsertDoc returns null on a v1 index (caller falls back to a full rebuild)', async () => {
  const { paths } = makeProfile('metabot-kb-upsert-v1-');
  const kbDir = path.join(paths.workspaceRoot, 'v1-corpus');
  mkdirSync(kbDir, { recursive: true });
  writeFileSync(path.join(kbDir, 'a.md'), 'content one');
  const indexFile = path.join(paths.runtimeRoot, 'kb', 'v1-index.json');
  mkdirSync(path.dirname(indexFile), { recursive: true });
  writeFileSync(indexFile, JSON.stringify({
    version: 1,
    docs: [{ relpath: 'a.md', sha256: 'x', size: 11, mtimeMs: 1, title: 'a', chunkCount: 1, ingestedAt: 1 }],
    chunks: [{ docRelPath: 'a.md', ord: 0, text: 'content one' }],
    inverted: {},
  }));
  const indexStore = createKnowledgeBaseIndexStore(indexFile);
  writeFileSync(path.join(kbDir, 'b.md'), 'content two');
  assert.equal(await indexStore.upsertDoc(kbDir, path.join(kbDir, 'b.md'), () => 1), null);
});

test('addDocument stays searchable across service instances (index hit on disk)', async () => {
  const { paths } = makeProfile('metabot-kb-fastpath-');
  const writer = createKnowledgeBaseService(paths);
  await writer.addDocument('bot-1', {
    title: '快路径验证',
    content: '塔罗牌共七十八张，大阿卡纳二十二张，可用于占卜。',
  });
  // A fresh instance (no memoized caches) must see the saved doc immediately.
  const reader = createKnowledgeBaseService(paths);
  const results = await reader.queryKnowledgeBase('bot-1', '塔罗牌 占卜');
  assert.equal(results.length, 1);
  assert.ok(results[0].hits.length > 0);
  const rows = await reader.store.listKnowledgeBases();
  assert.equal(rows.find((row) => row.isDefault).docCount, 1, 'counts were persisted by the fast path');
});

test('a learn from another instance waits on the lock and still lands (#9 service level)', async () => {
  const { paths } = makeProfile('metabot-kb-lock-svc-');
  const kb = await createKnowledgeBaseService(paths).ensureDefaultKnowledgeBase('bot-1');
  writeFileSync(path.join(kb.rawDir, 'a.md'), '# A\n塔罗牌占卜知识内容。');
  const indexPath = knowledgeBaseIndexPath(paths, kb.id);
  // Hold the lock the way another process would, then learn through a
  // separate service instance — it must wait, not interleave.
  const holder = withKbIndexLock(indexPath, async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, { waitMs: 10_000, staleMs: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const learner = createKnowledgeBaseService(paths);
  const learned = await learner.learnKnowledgeBase('bot-1');
  assert.equal(learned.docCount, 1);
  await holder;
});

// ---------------------------------------------------------------------------
// #13 — watchdog, rotation, pre-flight gate
// ---------------------------------------------------------------------------

test('study turn watchdog breaks to the no-tools report path and marks it partial', async () => {
  const toolFence = '```json\n{"tool":"search_metaweb","args":{"query":"x"}}\n```';
  const reportFence = '```json\n{"processedPinIds":["p1"],"summary":"watchdog report"}\n```';
  const calls = [];
  const result = await studyJobs.runStudyTurnWithTools('study topic', {
    runLlm: async (history) => {
      calls.push(history.length);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const last = history[history.length - 1].content;
      return last.includes('no further tool calls will run') ? reportFence : toolFence;
    },
    tools: {
      searchMetaweb: async () => 'result',
      readMetawebPin: async () => 'pin',
      addDocument: async () => 'saved',
      learnKnowledgeBase: async () => 'learned',
      listKnowledgeBases: async () => 'list',
      queryKnowledgeBases: async () => 'hits',
      saveProcedure: async () => 'saved',
      recallProcedures: async () => 'none',
      upsertKnowledge: async () => 'upserted',
      recallKnowledge: async () => 'none',
    },
    maxSteps: 50,
    wallClockMs: 120,
  });
  const report = JSON.parse(result);
  assert.match(report.summary, /^\[partial\]/);
  assert.deepEqual(report.processedPinIds, ['p1']);
  assert.ok(calls.length < 50, `watchdog stopped the loop early (${calls.length} calls)`);
});

test('rotateForTick rotates with wrap-around and normalizes out-of-range starts', () => {
  assert.deepEqual(studyJobs.rotateForTick([1, 2, 3, 4], 2), [3, 4, 1, 2]);
  assert.deepEqual(studyJobs.rotateForTick([1, 2, 3], 0), [1, 2, 3]);
  assert.deepEqual(studyJobs.rotateForTick([1, 2, 3, 4], 6), [3, 4, 1, 2]);
  assert.deepEqual(studyJobs.rotateForTick([1, 2, 3, 4], -1), [4, 1, 2, 3]);
  assert.deepEqual(studyJobs.rotateForTick([], 0), []);
});

test('profileHasStudyLlm gates only the truly-LLM-less profiles', () => {
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: true, connectedExecutors: 1, runtimes: [] }), true);
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: true, connectedExecutors: 0, runtimes: [] }), false,
    'a DSH pair without a connected host executor cannot serve the drain');
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: false, connectedExecutors: 0, runtimes: [{ health: 'healthy' }] }), true);
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: false, connectedExecutors: 0, runtimes: [{ health: 'unavailable' }] }), false);
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: false, connectedExecutors: 0, runtimes: [{}] }), true,
    'unknown health is treated as usable (conservative gate)');
  assert.equal(studyJobs.profileHasStudyLlm({ dshPairConfigured: false, connectedExecutors: 0, runtimes: [] }), false);
});
