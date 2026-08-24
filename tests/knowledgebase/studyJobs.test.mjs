import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const store = require('../../dist/core/knowledgebase/studyJobs.js');
const {
  createStudyJobStore,
  inStudyWindow,
  buildStudySessionPrompt,
  parseStudyRunReport,
  DEFAULT_STUDY_PIN_BUDGET_PER_NIGHT,
  MAX_STUDY_RUNS_PER_JOB,
  MAX_STUDY_CONSECUTIVE_FAILURES,
} = store;

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return resolveMetabotPaths(homeDir);
}

test('enqueue dedupes active jobs per topic, clamps budget, lists oldest-first', async () => {
  const paths = makeProfile('metabot-study-enqueue-');
  const jobs = createStudyJobStore(paths);
  const first = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: '前端框架趋势', budgetPins: 99 });
  assert.equal(first.created, true);
  assert.equal(first.job.budgetPins, 50, 'budget clamped to 50');
  const dup = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: ' 前端框架趋势 ' });
  assert.equal(dup.created, false);
  assert.equal(dup.job.id, first.job.id);
  await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'second topic' });
  await jobs.enqueueStudyJob({ metabotSlug: 'bot-2', topic: 'other bot topic' });
  const mine = await jobs.listStudyJobs('bot-1');
  assert.equal(mine.length, 2);
  const pending = await jobs.listPending();
  assert.deepEqual(
    pending.map((job) => job.topic),
    ['前端框架趋势', 'second topic', 'other bot topic'],
    'oldest first, across all bots',
  );
});

test('run lifecycle: new pins re-pend, nothing-new or cap completes, failures cut off at 3', async () => {
  const paths = makeProfile('metabot-study-lifecycle-');
  const jobs = createStudyJobStore(paths);
  const { job } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'T' });

  await jobs.markRunning(job.id);
  let updated = await jobs.completeRun({ id: job.id, processedPinIds: ['p1', 'p2'], summary: 'learned things', learnedSomethingNew: true });
  assert.equal(updated.status, 'pending', 'new pins re-pend for another night');
  assert.deepEqual(updated.processedPinIds, ['p1', 'p2']);

  updated = await jobs.completeRun({ id: job.id, processedPinIds: ['p1', 'p3'], summary: 'more', learnedSomethingNew: false });
  assert.equal(updated.status, 'done', 'nothing-new completes');
  assert.deepEqual(updated.processedPinIds.sort(), ['p1', 'p2', 'p3'].sort(), 'dedupe across runs');

  const { job: cap } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'Cap' });
  for (let run = 0; run < MAX_STUDY_RUNS_PER_JOB; run += 1) {
    await jobs.completeRun({ id: cap.id, processedPinIds: [`p${run}`], summary: 's', learnedSomethingNew: true });
  }
  assert.equal((await jobs.getStudyJob(cap.id)).status, 'done', 'run cap completes');

  const { job: failing } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'F' });
  for (let attempt = 0; attempt < MAX_STUDY_CONSECUTIVE_FAILURES - 1; attempt += 1) {
    await jobs.failRun(failing.id, 'llm down');
  }
  assert.equal((await jobs.getStudyJob(failing.id)).status, 'pending', 'below threshold stays pending');
  await jobs.failRun(failing.id, 'llm down');
  assert.equal((await jobs.getStudyJob(failing.id)).status, 'failed');
  assert.match((await jobs.getStudyJob(failing.id)).error, /llm down/);
});

test('crash recovery resets stale running rows; window and prompt/report shapes', async () => {
  const paths = makeProfile('metabot-study-recovery-');
  const jobs = createStudyJobStore(paths);
  const { job: a } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'A' });
  const { job: b } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'B' });
  await jobs.markRunning(a.id);
  await jobs.markRunning(b.id);
  const reset = await jobs.resetRunningToPending(Date.now(), a.id);
  assert.equal(reset, 1);
  assert.equal((await jobs.getStudyJob(a.id)).status, 'running', 'in-process job excluded');
  assert.equal((await jobs.getStudyJob(b.id)).status, 'pending');

  assert.equal(inStudyWindow(new Date(2026, 7, 24, 3, 0)), true);
  assert.equal(inStudyWindow(new Date(2026, 7, 24, 9, 0)), false);

  const prompt = buildStudySessionPrompt({ topic: '前端框架', budgetPins: DEFAULT_STUDY_PIN_BUDGET_PER_NIGHT });
  assert.match(prompt, /unattended nightly study session/);
  assert.match(prompt, /bilingual keywords/);
  assert.match(prompt, /ONE ```json fence/);
  assert.match(prompt, /at most 20 documents saved/);

  const report = parseStudyRunReport([
    'I studied things.',
    '```json',
    '{"processedPinIds":["a","b"],"summary":"学到了前端框架趋势"}',
    '```',
    'trailing prose',
  ].join('\n'));
  assert.deepEqual(report.processedPinIds, ['a', 'b']);
  assert.match(report.summary, /前端框架/);

  assert.throws(() => parseStudyRunReport('no fence at all'), /no json report fence/);
  assert.throws(() => parseStudyRunReport('```json\n{"processedPinIds":[]}\n```'), /no summary/);
});

test('runStudyTick: window gate, success re-pends on new pins, failure counted', async () => {
  const paths = makeProfile('metabot-study-tick-');
  const jobs = createStudyJobStore(paths);
  const { job } = await jobs.enqueueStudyJob({ metabotSlug: 'bot-1', topic: 'Tick topic' });
  const turns = [];
  const deps = {
    runStudyTurn: async ({ prompt }) => {
      turns.push(prompt);
      return 'studied\n```json\n{"processedPinIds":["p1"],"summary":"saved one doc"}\n```';
    },
    now: () => new Date(2026, 7, 24, 2, 0).getTime(),
    log: () => undefined,
  };

  const outOfWindow = { ...deps, now: () => new Date(2026, 7, 24, 9, 0).getTime() };
  assert.equal(await store.runStudyTick(jobs, outOfWindow), null, 'outside window no-ops');

  const attempted = await store.runStudyTick(jobs, deps);
  assert.equal(attempted, job.id);
  assert.equal(turns.length, 1);
  assert.match(turns[0], /Tick topic/);
  const after = await jobs.getStudyJob(job.id);
  assert.equal(after.status, 'pending', 'new pin re-pends');
  assert.deepEqual(after.processedPinIds, ['p1']);
  assert.equal(after.consecutiveFailures, 0);

  const failing = {
    runStudyTurn: async () => 'prose only, no fence',
    now: deps.now,
    log: () => undefined,
  };
  await store.runStudyTick(jobs, failing);
  const failed = await jobs.getStudyJob(job.id);
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.status, 'pending');
  assert.match(failed.error, /no json report fence/);
});

test('executor tool loop: allowlist enforced, budget enforced, happy path reports', async () => {
  const store2 = require('../../dist/core/knowledgebase/studyJobs.js');
  const calls = [];
  const tools = {
    searchMetaweb: async ({ query }) => { calls.push(['search', query]); return '- [结果一](pin://p1)'; },
    readMetawebPin: async ({ pinId }) => { calls.push(['read', pinId]); return 'body of ' + pinId; },
    addDocument: async ({ title }) => { calls.push(['add', title]); return 'saved'; },
    learnKnowledgeBase: async () => { calls.push(['learn']); return 'learned'; },
  };
  const script = [
    // Step 1: a non-allowlisted tool is refused by the executor.
    '```json\n{"tool":"post_simplenote","args":{"title":"x"}}\n```',
    // Step 2: search.
    '```json\n{"tool":"search_metaweb","args":{"query":"民法"}}\n```',
    // Step 3: read.
    '```json\n{"tool":"read_metaweb_pin","args":{"pinId":"p1"}}\n```',
    // Step 4: save.
    '```json\n{"tool":"knowledge_base_add_document","args":{"title":"民法典","content":"正文","pinId":"p1"}}\n```',
    // Step 5: report.
    '```json\n{"processedPinIds":["p1"],"summary":"学到了民法典"}\n```',
  ];
  let step = 0;
  const history = [];
  const report = await store2.runStudyTurnWithTools('study prompt', {
    runLlm: async (h) => {
      history.push(JSON.parse(JSON.stringify(h)));
      return script[step++] ?? '```json\n{"processedPinIds":[],"summary":"done"}\n```';
    },
    tools,
  });
  const parsed = JSON.parse(report);
  assert.deepEqual(parsed.processedPinIds, ['p1']);
  assert.match(parsed.summary, /民法典/);
  // The refusal reached the model as a user message.
  assert.ok(history[1].some((entry) => /not available in this session/.test(entry.content)));
  assert.deepEqual(calls.map((entry) => entry[0]), ['search', 'read', 'add']);
});

test('executor tool loop: no-fence replies are nudged; step exhaustion fails', async () => {
  const store2 = require('../../dist/core/knowledgebase/studyJobs.js');
  const tools = {
    searchMetaweb: async () => 'x',
    readMetawebPin: async () => 'x',
    addDocument: async () => 'x',
    learnKnowledgeBase: async () => 'x',
  };
  let turns = 0;
  const nudged = await store2.runStudyTurnWithTools('p', {
    runLlm: async () => {
      turns += 1;
      return turns === 1 ? 'prose without fence' : '```json\n{"processedPinIds":[],"summary":"ok"}\n```';
    },
    tools,
  });
  assert.match(nudged, /ok/);
  assert.equal(turns, 2);

  await assert.rejects(
    store2.runStudyTurnWithTools('p', {
      runLlm: async () => 'no fence ever',
      tools,
      maxSteps: 3,
    }),
    (error) => error instanceof Error && error.code === 'study_steps_exhausted'
  );
});
