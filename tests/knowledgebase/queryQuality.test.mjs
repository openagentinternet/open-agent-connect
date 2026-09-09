// Query-quality acceptance for the knowledge-base index store, mirroring the
// bot-authored incident report (2026-09-09, knowledge-base-remaining-issues):
// function-word queries must not produce high-scoring noise hits (V1/V3/V5),
// real matches must outrank/outscore noise (V2), exact probes stay first (V4),
// and hits stay score-descending with usable snippets (V7).
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createKnowledgeBaseService } = require('../../dist/core/knowledgebase/service.js');
const { buildKbQueryTokens } = require('../../dist/core/knowledgebase/text.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  return { paths: resolveMetabotPaths(homeDir), homeDir };
}

const STYLE_BODY = [
  '# 图片风格出图方法论',
  '',
  '风格名的选择决定了整张图的基调，一张好的风格名应该由工艺词、物理细节和纪律兜底组成。',
  '在实读核验之前，不要相信任何预设的输出是符合预期的，因为出图是一个有随机性的过程。',
  '每一个风格都需要用同一组关键词反复测试，一般来说至少要测试四到八次才能够确认稳定性。',
  '物理细节是指材质、光线和构图的具体描述，一个风格如果只有抽象的概念词，出图就会漂移。',
  '这个方法的核心是：关键词不是越多越好，而是越具体越好，这一点在实测中反复得到验证。',
].join('\n');

const BREAD_BODY = [
  '# 天然酵母面包食谱',
  '',
  '喂养酵种需要面粉与水按比例混合，室温下发酵至双倍大，大约需要十二小时。',
  '烘烤时先高温带蒸汽定型，再降温烤至外壳金黄，内部组织应当湿润有弹性。',
].join('\n');

async function seededService(prefix) {
  const { paths } = makeProfile(prefix);
  const service = createKnowledgeBaseService(paths);
  await service.addDocument('bot-1', { title: '图片风格出图方法论', content: STYLE_BODY });
  await service.addDocument('bot-1', { title: '天然酵母面包食谱', content: BREAD_BODY });
  return service;
}

function topHitOf(results) {
  const first = results[0];
  assert.ok(first, 'expected at least one KB result group');
  return first.hits[0];
}

test('buildKbQueryTokens drops function words on both scripts (V3 groundwork)', () => {
  const tokens = buildKbQueryTokens('这个风格是什么以及为什么 the of and 风格');
  assert.ok(!tokens.includes('什么'));
  assert.ok(!tokens.includes('以及'));
  assert.ok(!tokens.includes('这个'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('of'));
  assert.ok(!tokens.includes('and'));
  assert.ok(tokens.includes('风格'), 'content-bearing bigrams survive');
  // CJK runs emit bigrams only: no function unigrams from inside a run.
  assert.ok(!tokens.includes('是'), 'no unigrams from inside runs');
});

test('unrelated query returns empty instead of high-score noise (V1/V5)', async () => {
  const service = await seededService('metabot-kb-quality-unrelated-');
  const results = await service.queryKnowledgeBase('bot-1', '完全不相关的关键词：量子色动力学 弦论 积分方程');
  assert.deepEqual(results, [], 'no evidence clears the threshold — honest empty, not 0.88 noise');
});

test('function-word-only query never produces hits (V3)', async () => {
  const service = await seededService('metabot-kb-quality-stopwords-');
  // The corpus above deliberately contains 这个/关键词/可以 so a leaked
  // function word would surface exactly like it did on the live index.
  const results = await service.queryKnowledgeBase('bot-1', '的 什么 可以 这个 哪些');
  assert.deepEqual(results, []);
});

test('related query scores clearly and outranks anything unrelated (V2)', async () => {
  const service = await seededService('metabot-kb-quality-related-');
  const related = await service.queryKnowledgeBase('bot-1', '图片风格 出图 方法论');
  const top = topHitOf(related);
  assert.ok(top.score >= 0.4, `related top score meaningful, got ${top.score}`);
  assert.match(top.docRelPath, /图片风格出图方法论|image/);

  // The report's exact failure mode: the unrelated query used to return 0.8853,
  // HIGHER than real matches. Now it is simply empty.
  const unrelated = await service.queryKnowledgeBase('bot-1', '完全不相关的关键词：量子色动力学 弦论 积分方程');
  assert.equal(unrelated.length, 0);
});

test('exact unique probe matches first with the top score (V4)', async () => {
  const { paths } = makeProfile('metabot-kb-quality-probe-');
  const service = createKnowledgeBaseService(paths);
  await service.addDocument('bot-1', { title: '探针文档', content: `唯一串 ALICE-KB-WRITE-PROBE-20260909 标记本块。 ${STYLE_BODY}` });
  await service.addDocument('bot-1', { title: '天然酵母面包食谱', content: BREAD_BODY });

  const results = await service.queryKnowledgeBase('bot-1', 'ALICE-KB-WRITE-PROBE-20260909');
  const top = topHitOf(results);
  assert.equal(top.score >= 0.85, true, `probe hits at full confidence, got ${top.score}`);
});

test('hits are score-descending with usable snippets (V7)', async () => {
  const service = await seededService('metabot-kb-quality-order-');
  const results = await service.queryKnowledgeBase('bot-1', '风格 物理细节 出图', { topK: 5 });
  const hits = results[0]?.hits ?? [];
  assert.ok(hits.length >= 1);
  for (let idx = 1; idx < hits.length; idx += 1) {
    assert.ok(hits[idx - 1].score >= hits[idx].score, 'sorted descending');
  }
  // Snippet carries real context (raised from 220 chars) and stays bounded.
  assert.ok(hits[0].snippet.length > 50, 'snippet carries context');
  assert.ok(hits[0].snippet.length <= 321, 'snippet bounded at 320 chars + ellipsis');
  assert.ok(typeof hits[0].ord === 'number');
  assert.ok(typeof hits[0].title === 'string' && hits[0].title.length > 0);
});
