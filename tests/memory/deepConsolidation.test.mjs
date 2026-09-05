// Deep-consolidation prompt, tolerant parser, guardrail refusals, in-place
// knowledge rewrites, cadence stamping rules, and fake-completion end-to-end
// runs (no real LLM, no sleeps, fast tier).
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createKnowledgeStore } = require('../../dist/core/memory/knowledgeStore.js');
const { createHygieneStore } = require('../../dist/core/memory/hygieneStore.js');
const {
  buildDeepConsolidationPrompt,
  deepConsolidationRetireCap,
  describeDeepConsolidationParseFailure,
  parseDeepConsolidationOutput,
  shouldRunDeepConsolidation,
} = require('../../dist/core/memory/deepConsolidationPrompt.js');
const { runMemoryHygiene } = require('../../dist/core/memory/memoryHygieneService.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-deep-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

/** Seed 8 belief-layer items: 3 value boundaries + 3 work reviews + 2 knowledge. */
async function seedBeliefLayer(paths) {
  const memoryStore = createMemoryStore(paths);
  const boundaries = [];
  for (let index = 0; index < 3; index += 1) {
    boundaries.push(await memoryStore.create({
      text: `价值边界${index}:任务完成前先确认验收标准`,
      usageClass: 'value_boundary',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
    }));
  }
  const reviews = [];
  for (let index = 0; index < 3; index += 1) {
    reviews.push(await memoryStore.create({
      text: `工作复盘${index}:一次顺利的发布协作`,
      usageClass: 'work_review',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
    }));
  }
  const knowledgeStore = createKnowledgeStore(paths);
  const knowledge = [];
  for (let index = 0; index < 2; index += 1) {
    knowledge.push((await knowledgeStore.upsertKnowledge({
      topic: `发布流程${index}`,
      summary: `步骤:先排序,再标注风险 ${index}`,
      kind: 'know_how',
      origin: 'dream',
    })).entry);
  }
  return { memoryStore, knowledgeStore, boundaries, reviews, knowledge };
}

test('shouldRunDeepConsolidation gates on 8 items and the retire cap is a quarter, rounded up', () => {
  assert.equal(shouldRunDeepConsolidation(7), false);
  assert.equal(shouldRunDeepConsolidation(8), true);
  assert.equal(deepConsolidationRetireCap(8), 2);
  assert.equal(deepConsolidationRetireCap(9), 3);
  assert.equal(deepConsolidationRetireCap(20), 5);
});

test('buildDeepConsolidationPrompt lists the inventory and the action cap', () => {
  const items = [
    { id: 'mem-1', kind: 'value_boundary', text: '先确认验收标准' },
    { id: 'mem-2', kind: 'work_review', text: '顺利的发布' },
    { id: 'kn-1', kind: 'knowledge', text: '发布流程: 先排序', extra: 'kind=know_how, v3' },
  ];
  const prompt = buildDeepConsolidationPrompt({ botName: 'Alice', items });
  assert.match(prompt, /MetaBot "Alice"/);
  assert.match(prompt, /- mem-1 \| value_boundary \| 先确认验收标准/);
  assert.match(prompt, /- kn-1 \| knowledge \| 发布流程: 先排序 \[kind=know_how, v3\]/);
  assert.match(prompt, /retire_memory_ids/);
  assert.match(prompt, new RegExp(`at most ${deepConsolidationRetireCap(items.length)} combined retire/rewrite actions`));
});

test('parseDeepConsolidationOutput tolerates prose and brace-slicing; describeFailure distinguishes causes', () => {
  const output = {
    retire_memory_ids: ['mem-a', 'mem-b'],
    retire_knowledge_ids: ['kn-1'],
    rewrite_knowledge: [{ id: 'kn-2', topic: 'T', summary: 'S', kind: 'pitfall' }],
    notes: 'one short note',
  };
  // Pure JSON parses.
  assert.deepEqual(parseDeepConsolidationOutput(JSON.stringify(output)), {
    retireMemoryIds: ['mem-a', 'mem-b'],
    retireKnowledgeIds: ['kn-1'],
    rewriteKnowledge: [{ id: 'kn-2', topic: 'T', summary: 'S', kind: 'pitfall' }],
    notes: 'one short note',
  });
  // Prose around the object parses via the brace slice.
  const wrapped = `Sure, here is the review:\n${JSON.stringify(output)}\nHope that helps!`;
  const parsed = parseDeepConsolidationOutput(wrapped);
  assert.equal(parsed.retireMemoryIds.length, 2);
  // Unknown rewrite kinds default to know_how; junk entries are dropped.
  const tolerant = parseDeepConsolidationOutput(JSON.stringify({
    ...output,
    rewrite_knowledge: [
      { id: 'kn-2', topic: 'T', summary: 'S', kind: 'bogus' },
      { id: 'kn-3', topic: 'T', summary: 'S', kind: 'principle' },
      { topic: 'missing-id' },
    ],
  }));
  assert.equal(tolerant.rewriteKnowledge[0].kind, 'know_how');
  assert.equal(tolerant.rewriteKnowledge[1].kind, 'principle');
  assert.equal(tolerant.rewriteKnowledge.length, 2);
  // No JSON object at all vs malformed object.
  assert.equal(parseDeepConsolidationOutput('just prose, no braces'), null);
  assert.match(describeDeepConsolidationParseFailure('just prose, no braces'), /no complete JSON object/);
  assert.equal(parseDeepConsolidationOutput('{ broken json'), null);
  assert.match(describeDeepConsolidationParseFailure('{ broken json }'), /malformed JSON object/);
  assert.match(describeDeepConsolidationParseFailure(''), /empty output/);
});

test('deep consolidation applies a clean proposal end-to-end and stamps the cadence', async () => {
  const paths = await createTempProfileHome();
  const { memoryStore, knowledgeStore, boundaries, knowledge } = await seedBeliefLayer(paths);
  const target = boundaries[0];
  const rewriteTarget = knowledge[0];
  let llmCalls = 0;

  const stats = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async (input) => {
      llmCalls += 1;
      assert.match(input.system, /memory consolidation assistant/);
      assert.match(input.user, /价值边界0/);
      return JSON.stringify({
        retire_memory_ids: [target.id],
        retire_knowledge_ids: [],
        rewrite_knowledge: [{
          id: rewriteTarget.id,
          topic: rewriteTarget.topic,
          summary: '重写后的要点:先排期,再标风险,最后复核',
          kind: 'know_how',
        }],
        notes: '合并了两条过时的边界。',
      });
    },
  });

  assert.equal(llmCalls, 1);
  assert.equal(stats.counts.deepConsolidationBots, 1);
  assert.equal(stats.counts.deepRetiredMemories, 1);
  assert.equal(stats.counts.deepRewrittenKnowledge, 1);
  assert.equal(stats.errors.length, 0);

  // Memory retire is a soft archive mark; default listings hide it.
  const hidden = await memoryStore.list({});
  assert.ok(!hidden.some((entry) => entry.id === target.id));
  const archived = await memoryStore.list({ includeArchived: true });
  const archivedRow = archived.find((entry) => entry.id === target.id);
  assert.ok(archivedRow.archivedAt);
  assert.equal(archivedRow.status, 'created');

  // Knowledge rewrite happened in place by id: same id, version bumped, prior
  // text preserved as a revision.
  const rewritten = await knowledgeStore.getKnowledge(rewriteTarget.id);
  assert.equal(rewritten.id, rewriteTarget.id);
  assert.equal(rewritten.version, 2);
  assert.match(rewritten.summary, /重写后的要点/);
  assert.equal(rewritten.revisions.length, 1);
  assert.match(rewritten.revisions[0].summary, /先排序,再标注风险/);

  // Cadence stamped only after a clean apply.
  assert.ok(await createHygieneStore(paths).getDeepConsolidationLastRunAt());
  // A second immediate run is inside the interval: no LLM call, no recount.
  const again = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => {
      llmCalls += 1;
      return '{}';
    },
  });
  assert.equal(llmCalls, 1);
  assert.equal(again.counts.deepConsolidationBots, undefined);
});

test('over-cap retire lists are refused unstamped; non-inventory and non-dream ids are filtered', async () => {
  const paths = await createTempProfileHome();
  const { memoryStore, knowledgeStore, boundaries, reviews, knowledge } = await seedBeliefLayer(paths);
  const knowledgeIds = knowledge.map((entry) => entry.id);
  const memoryIds = [...boundaries, ...reviews].map((entry) => entry.id);

  // Cap = ceil(8 * 0.25) = 2; propose 3 valid dream-origin retires -> refuse.
  const refused = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => JSON.stringify({
      retire_memory_ids: memoryIds.slice(0, 3),
      retire_knowledge_ids: [],
      rewrite_knowledge: [],
      notes: 'aggressive purge',
    }),
  });
  assert.ok(refused.errors.some((error) => /retire list exceeds guardrail \(3 > 2\); refusing/.test(error)));
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);
  for (const id of memoryIds.slice(0, 3)) {
    const row = (await memoryStore.list({ includeArchived: true })).find((entry) => entry.id === id);
    assert.equal(row.archivedAt, null);
  }

  // A compliant list that mixes in a conversation-origin id and a bogus id:
  // only the dream-origin inventory ids are archived.
  const conversationMemory = await memoryStore.create({
    text: '用户明确让我记住这件事',
    usageClass: 'work_review',
    origin: 'conversation',
    isExplicit: true,
    forceNew: true,
  });
  const filtered = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => JSON.stringify({
      retire_memory_ids: [memoryIds[0], conversationMemory.id, 'mem-does-not-exist'],
      retire_knowledge_ids: [knowledgeIds[0], 'kn-does-not-exist'],
      rewrite_knowledge: [{ id: 'kn-does-not-exist', topic: 'x', summary: 'y', kind: 'know_how' }],
      notes: 'filter me',
    }),
  });
  assert.equal(filtered.errors.length, 0);
  assert.equal(filtered.counts.deepRetiredMemories, 1);
  assert.equal(filtered.counts.deepRetiredKnowledge, 1);
  assert.equal(filtered.counts.deepRewrittenKnowledge, 0);
  const archivedRows = (await memoryStore.list({ includeArchived: true })).filter((entry) => entry.archivedAt != null);
  assert.deepEqual(archivedRows.map((entry) => entry.id), [memoryIds[0]]);
  assert.equal((await knowledgeStore.getKnowledge(knowledgeIds[0])).status, 'archived');
  assert.ok(await createHygieneStore(paths).getDeepConsolidationLastRunAt());
});

test('no available LLM runtime skips deep consolidation without failing or stamping', async () => {
  const paths = await createTempProfileHome();
  await seedBeliefLayer(paths);

  // No completion transport at all: deterministic steps run, deep is skipped.
  const noTransport = await runMemoryHygiene(paths, { trigger: 'manual' });
  assert.equal(noTransport.counts.deepConsolidationSkipped, 1);
  assert.equal(noTransport.errors.length, 0);
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);

  // Completion that resolves to null (no healthy runtime): same skip.
  const nullRuntime = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => null,
  });
  assert.equal(nullRuntime.counts.deepConsolidationSkipped, 1);
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);

  // --no-deep: the step is skipped entirely, with no skip counter.
  const noDeep = await runMemoryHygiene(paths, { trigger: 'manual', deep: false }, {
    complete: async () => {
      throw new Error('must not be called');
    },
  });
  assert.equal(noDeep.counts.deepConsolidationSkipped, undefined);
});

test('LLM failures and unparseable output land in errors and never stamp the cadence', async () => {
  const paths = await createTempProfileHome();
  await seedBeliefLayer(paths);

  const failed = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => {
      throw new Error('provider 429');
    },
  });
  assert.ok(failed.errors.some((error) => /deep-consolidation: provider 429/.test(error)));
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);

  const unparseable = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => 'I reviewed everything and here is my prose answer.',
  });
  assert.ok(unparseable.errors.some((error) => /unparseable output \(no complete JSON object/.test(error)));
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);
});

test('below-minimum inventories skip deep consolidation without an LLM call', async () => {
  const paths = await createTempProfileHome();
  const memoryStore = createMemoryStore(paths);
  for (let index = 0; index < 4; index += 1) {
    await memoryStore.create({
      text: `价值边界${index}:先确认验收标准`,
      usageClass: 'value_boundary',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
    });
  }
  let llmCalls = 0;
  const stats = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => {
      llmCalls += 1;
      return '{}';
    },
  });
  assert.equal(llmCalls, 0);
  assert.equal(stats.counts.deepConsolidationSkipped, undefined);
  assert.equal(stats.counts.deepConsolidationBots, undefined);
  assert.equal((await createHygieneStore(paths).getDeepConsolidationLastRunAt()), null);
});

test('the notUsedSince guard protects memories touched after the inventory snapshot', async () => {
  const paths = await createTempProfileHome();
  const { memoryStore, boundaries } = await seedBeliefLayer(paths);
  const target = boundaries[0];
  // A completion that re-touches the target row before returning the proposal
  // (the LLM await window): the row must survive.
  const stats = await runMemoryHygiene(paths, {
    trigger: 'manual',
    complete: async () => {
      await memoryStore.list({ query: '价值边界0', touchLastUsed: true });
      return JSON.stringify({
        retire_memory_ids: [target.id],
        retire_knowledge_ids: [],
        rewrite_knowledge: [],
        notes: 'touched during await',
      });
    },
  });
  assert.equal(stats.counts.deepRetiredMemories, 0);
  const row = (await memoryStore.list({ includeArchived: true })).find((entry) => entry.id === target.id);
  assert.equal(row.archivedAt, null);
});
