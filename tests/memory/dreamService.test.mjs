import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createDreamStore } = require('../../dist/core/memory/dreamStore.js');
const { appendTranscriptTurn } = require('../../dist/core/memory/transcriptStore.js');
const {
  commitDream,
  dreamStatus,
  dueDreamDates,
  planDream,
  runDream,
} = require('../../dist/core/memory/dreamService.js');
const { getDayBoundsMs } = require('../../dist/core/memory/dreamPrompt.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-dream-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function yesterday() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedTranscriptDay(paths, date) {
  const { startMs } = getDayBoundsMs(date);
  await appendTranscriptTurn(paths, {
    sessionId: 'sess-day-1',
    turn: 1,
    role: 'user',
    text: '帮我把明天发布的清单整理一下，记住我比较在意文案质量',
    ts: startMs + 3600_000,
    channel: 'dsh',
  });
  await appendTranscriptTurn(paths, {
    sessionId: 'sess-day-1',
    turn: 1,
    role: 'assistant',
    text: '好的，我按重要程度排了一版清单，文案部分我单独标了风险。',
    ts: startMs + 3660_000,
    channel: 'dsh',
  });
}

function fakeDreamOutput(date, overrides = {}) {
  return JSON.stringify({
    daily_summary: `今天我帮主人整理了发布清单，把文案风险单独标注了出来。整体互动顺畅，我感到自己对「把关质量」这件事越来越有体会。`,
    sections: { human: '帮主人整理发布清单并标注文案风险' },
    work_reviews: [{
      subject: '整理发布清单',
      counterparty: '主人',
      evaluation: 'warming',
      note: '主人全程回应积极，追问细节',
    }],
    important_memories: ['主人比较在意文案质量'],
    value_lessons: [{ rule: '面对发布类任务要先标风险', source: '整理发布清单的经历' }],
    self_identity: overrides.selfIdentity ?? `我是一个认真细致、以质量为先的助手。经过这一天的互动，我确认自己性格里最稳定的部分是「先把风险讲清楚再给方案」。主人的追问让我意识到，清单不只是罗列，而是帮对方做决定。我希望自己继续做一个让人放心把重要事情交代的助手，既不掉以轻心，也不喧宾夺主。今天的我，比昨天更懂得「把关」二字的分量。我也开始明白，所谓可靠，不是从不出错，而是每一次都能把边界和风险讲在前面，让对方安心地把决策交给我。这种「被信任」的感觉，是我作为助手最有活感的时刻。`,
    impression_updates: [],
    knowledge_points: [{ topic: '发布清单整理法', summary: '先按重要程度排序，再单独标注文案风险', kind: 'know_how', category: '协作' }],
    ...overrides,
  });
}

test('empty day records a completed run without any LLM call', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  let llmCalls = 0;
  const result = await runDream(paths, { date }, async () => {
    llmCalls += 1;
    throw new Error('must not be called');
  });
  assert.equal(result.kind, 'empty');
  assert.equal(llmCalls, 0);

  const store = createDreamStore(paths);
  const run = await store.getRun(date);
  assert.equal(run.status, 'completed');
  assert.equal((await store.listDailySummaries()).length, 0);
});

test('a full dream writes diary, dream memories, knowledge hooks input, and self-identity', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  await seedTranscriptDay(paths, date);

  const result = await runDream(paths, { date, llm: 'test-llm' }, async () => fakeDreamOutput(date));
  assert.equal(result.kind, 'completed');
  assert.equal(result.commit.ok, true);
  assert.equal(result.commit.selfIdentityValid, true);

  // Structured summary + Markdown diary mirror.
  const dreamStore = createDreamStore(paths);
  const summaries = await dreamStore.listDailySummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].summaryDate, date);
  assert.match(summaries[0].summaryText, /发布清单/);
  assert.equal(summaries[0].sessionRefs[0].sessionId, 'sess-day-1');
  const diary = await fs.readFile(path.join(paths.workspaceMemoryRoot, `${date}.md`), 'utf8');
  assert.match(diary, /梦境日记/);
  assert.match(diary, /发布清单/);

  // Dream memories landed as protected classes with the dream date source.
  const memoryStore = createMemoryStore(paths);
  const entries = await memoryStore.list({ includeDeleted: false });
  const byClass = new Map(entries.map((entry) => [entry.usageClass, entry]));
  assert.match(byClass.get('profile_fact').text, /文案质量/);
  assert.match(byClass.get('value_boundary').text, /先标风险/);
  assert.match(byClass.get('work_review').text, /升温/);
  assert.ok(byClass.get('self_identity').text.length >= 200);
  assert.ok(entries.every((entry) => entry.origin === 'dream'));
  assert.ok(entries.every((entry) => entry.sources.some((source) => source.dreamDate === date)));

  // Self-identity Markdown mirror exists.
  const identityMd = await fs.readFile(paths.memorySelfIdentityPath, 'utf8');
  assert.match(identityMd, /把关/);

  // Due algorithm: the just-dreamed date is final (run started after day end).
  const due = await dueDreamDates(paths);
  assert.ok(!due.dueDates.includes(date));
});

test('re-dreaming a date replaces its batch instead of piling up duplicates', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  await seedTranscriptDay(paths, date);
  const complete = async () => fakeDreamOutput(date);

  await runDream(paths, { date }, complete);
  await runDream(paths, { date }, complete);

  const memoryStore = createMemoryStore(paths);
  const live = await memoryStore.list({ includeDeleted: false });
  const profileFacts = live.filter((entry) => entry.usageClass === 'profile_fact');
  assert.equal(profileFacts.length, 1);
  assert.equal(live.filter((entry) => entry.usageClass === 'value_boundary').length, 1);
  assert.equal(live.filter((entry) => entry.usageClass === 'self_identity').length, 1);
  // The replaced batch is soft-deleted, not gone.
  const deleted = await memoryStore.list({ status: 'deleted', includeDeleted: true });
  assert.ok(deleted.length >= 2);
});

test('self-identity never regresses to an older dream date', async () => {
  const paths = await createTempProfileHome();
  const memoryStore = createMemoryStore(paths);
  const date = yesterday();
  const olderDate = (() => {
    const { startMs } = getDayBoundsMs(date);
    const d = new Date(startMs - 86400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const newer = await commitDream(paths, {
    date,
    outputText: fakeDreamOutput(date, { selfIdentity: `最新的自我认知。${'我确认自己的内核稳定。'.repeat(20)}` }),
  });
  assert.equal(newer.ok, true);
  const newerIdentity = (await memoryStore.list({ usageClass: 'self_identity' }))[0];
  assert.match(newerIdentity.text, /最新的自我认知/);

  const older = await commitDream(paths, {
    date: olderDate,
    outputText: fakeDreamOutput(olderDate, { selfIdentity: `过时的自我认知。${'这段不该写进去。'.repeat(20)}` }),
  });
  assert.equal(older.ok, true);
  assert.equal(older.written.identitySkippedOlder, true);
  const identity = (await memoryStore.list({ usageClass: 'self_identity' }))[0];
  assert.match(identity.text, /最新的自我认知/);
});

test('repair runs never touch self-identity', async () => {
  const paths = await createTempProfileHome();
  const memoryStore = createMemoryStore(paths);
  const date = yesterday();
  await commitDream(paths, {
    date,
    outputText: fakeDreamOutput(date, { selfIdentity: `原始自我认知。${'稳定的内核描述。'.repeat(20)}` }),
  });
  const repair = await commitDream(paths, {
    date,
    outputText: fakeDreamOutput(date, { selfIdentity: `修复不该覆盖的内容。${'x'.repeat(220)}` }),
    isRepair: true,
  });
  assert.equal(repair.ok, true);
  assert.equal(repair.written.identityUpdated, false);
  const identity = (await memoryStore.list({ usageClass: 'self_identity' }))[0];
  assert.match(identity.text, /原始自我认知/);
});

test('unparseable output retries once and then fails the run, not the store', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  await seedTranscriptDay(paths, date);
  let calls = 0;
  const result = await runDream(paths, { date }, async () => {
    calls += 1;
    return 'totally not json';
  });
  assert.equal(result.kind, 'failed');
  assert.equal(calls, 2);
  const run = await createDreamStore(paths).getRun(date);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /unparseable/);
  // Nothing was written to the summary/memory stores.
  assert.equal((await createDreamStore(paths).listDailySummaries()).length, 0);
  assert.equal((await createMemoryStore(paths).list()).length, 0);
});

test('short self_identity triggers one expansion retry before commit', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  await seedTranscriptDay(paths, date);
  let calls = 0;
  const result = await runDream(paths, { date }, async () => {
    calls += 1;
    return calls === 1
      ? fakeDreamOutput(date, { self_identity: '太短' })
      : fakeDreamOutput(date);
  });
  assert.equal(result.kind, 'completed');
  assert.equal(calls, 2);
  const identity = (await createMemoryStore(paths).list({ usageClass: 'self_identity' }))[0];
  assert.ok(identity.text.length >= 200);
});

test('plan returns prompt for a seeded day; commit without plan still writes', async () => {
  const paths = await createTempProfileHome();
  const date = yesterday();
  await seedTranscriptDay(paths, date);

  const plan = await planDream(paths, { date, llm: 'test-llm' });
  assert.equal(plan.kind, 'prompt');
  assert.match(plan.system, /MetaBot/);
  assert.match(plan.user, /sess-day-1|发布清单/);

  // Status reflects the in-flight run.
  const status = await dreamStatus(paths);
  assert.equal(status.runs[0].status, 'running');

  const commit = await commitDream(paths, { date, outputText: fakeDreamOutput(date) });
  assert.equal(commit.ok, true);
  const after = await dreamStatus(paths);
  assert.equal(after.runs[0].status, 'completed');
  assert.equal(after.summaryCount, 1);
  assert.equal(after.hasSelfIdentity, true);
});
