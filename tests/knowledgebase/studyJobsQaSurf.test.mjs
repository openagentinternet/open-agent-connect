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
  runStudyTick,
  runStudyTurnWithTools,
  buildQaSurfSessionPrompt,
  DEFAULT_QA_SURF_BUDGET_PER_NIGHT,
} = store;

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return resolveMetabotPaths(homeDir);
}

test('enqueueQaSurfJob dedupes one active surf job per bot, clamps budget, fresh row after failure', async () => {
  const paths = makeProfile('metabot-qa-surf-enqueue-');
  const jobs = createStudyJobStore(paths);
  const first = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1', budgetPins: 99 });
  assert.equal(first.created, true);
  assert.equal(first.job.kind, 'qa-surf');
  assert.equal(first.job.budgetPins, 50, 'budget clamped to 50');
  assert.match(first.job.id, /^qa-surf-/);
  assert.equal(first.job.topic, 'On-chain Q&A surfing');

  const dup = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1', budgetPins: 3 });
  assert.equal(dup.created, false);
  assert.equal(dup.job.id, first.job.id, 'existing job wins; budget NOT rewritten');
  assert.equal(dup.job.budgetPins, 50);

  // Another bot gets its own job.
  const other = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-2' });
  assert.equal(other.created, true);
  assert.equal(other.job.budgetPins, DEFAULT_QA_SURF_BUDGET_PER_NIGHT, 'default 10');

  // After failure, re-enqueue creates a fresh row.
  await jobs.markRunning(first.job.id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await jobs.failRun(first.job.id, 'llm down');
  }
  assert.equal((await jobs.getStudyJob(first.job.id)).status, 'failed');
  const revived = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1' });
  assert.equal(revived.created, true);
  assert.notEqual(revived.job.id, first.job.id);
});

test('disableQaSurfJob stops active surfing; disable-while-running beats run bookkeeping', async () => {
  const paths = makeProfile('metabot-qa-surf-disable-');
  const jobs = createStudyJobStore(paths);
  const { job } = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1' });
  assert.equal(await jobs.disableQaSurfJob('bot-1'), true);
  const stopped = await jobs.getStudyJob(job.id);
  assert.equal(stopped.status, 'done');
  assert.match(stopped.summary, /Disabled by the owner/);
  assert.equal(await jobs.disableQaSurfJob('bot-1'), false, 'nothing left to disable');

  // Mid-run disable: the session's report must not resurrect the row.
  const { job: second } = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1' });
  await jobs.markRunning(second.id);
  await jobs.disableQaSurfJob('bot-1');
  const after = await jobs.completeRun({
    id: second.id,
    processedPinIds: ['q1'],
    summary: 'answered one',
    learnedSomethingNew: true,
  });
  assert.equal(after.status, 'done', 'bookkeeping skipped — disabled state stands');
  assert.equal(after.runCount, 0);
});

test('qa-surf runs never complete on success and cap the stored handled list at 400', async () => {
  const paths = makeProfile('metabot-qa-surf-recurring-');
  const jobs = createStudyJobStore(paths);
  const { job } = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1' });

  // Quiet night: nothing new — still pending.
  await jobs.markRunning(job.id);
  let updated = await jobs.completeRun({ id: job.id, processedPinIds: [], summary: 'quiet night', learnedSomethingNew: false });
  assert.equal(updated.status, 'pending', 'recurring: quiet nights never complete a surf job');

  // High run count — still pending.
  for (let run = 0; run < 15; run += 1) {
    await jobs.markRunning(job.id);
    updated = await jobs.completeRun({ id: job.id, processedPinIds: [], summary: `run ${run}`, learnedSomethingNew: false });
  }
  assert.equal(updated.status, 'pending', 'recurring: the run cap never completes a surf job');

  // Stored handled list capped at the last 400.
  const bulk = Array.from({ length: 450 }, (_, index) => `pin-${index}`);
  await jobs.markRunning(job.id);
  updated = await jobs.completeRun({ id: job.id, processedPinIds: bulk, summary: 'bulk', learnedSomethingNew: true });
  assert.equal(updated.processedPinIds.length, 400);
  assert.equal(updated.processedPinIds[0], 'pin-50', 'newest 400 kept');
});

test('runStudyTick dispatches the surf prompt by kind and records the report', async () => {
  const paths = makeProfile('metabot-qa-surf-tick-');
  const jobs = createStudyJobStore(paths);
  const { job } = await jobs.enqueueQaSurfJob({ metabotSlug: 'bot-1' });
  const turns = [];
  const ran = await runStudyTick(jobs, {
    runStudyTurn: async ({ slug, kind, prompt, budgetPins }) => {
      turns.push({ slug, kind, prompt, budgetPins });
      return '```json\n{"processedPinIds":["q9"],"summary":"answered one question"}\n```';
    },
    now: () => new Date('2026-09-08T02:00:00').getTime(),
    log: () => undefined,
  });
  assert.equal(ran, job.id);
  assert.equal(turns[0].kind, 'qa-surf');
  assert.equal(turns[0].slug, 'bot-1');
  assert.match(turns[0].prompt, /unattended nightly Q&A surfing session/);
  assert.match(turns[0].prompt, /max_answers=0/);
  assert.match(turns[0].prompt, /Do NOT post_simplequestion in this session/);
  assert.equal(turns[0].budgetPins, DEFAULT_QA_SURF_BUDGET_PER_NIGHT);
  const updated = await jobs.getStudyJob(job.id);
  assert.equal(updated.status, 'pending', 'successful surf run returns to pending');
  assert.deepEqual(updated.processedPinIds, ['q9']);
  assert.match(updated.summary, /answered one question/);
});

test('surf prompt carries the recent handled slice and budget', () => {
  const prompt = buildQaSurfSessionPrompt({
    budgetPins: 7,
    processedPinIds: Array.from({ length: 100 }, (_, index) => `p${index}`),
  });
  assert.match(prompt, /AT MOST 7 NEW pins/);
  assert.match(prompt, /100 total, showing the 80 most recent/);
  assert.match(prompt, /- p99/);
  assert.ok(!prompt.includes('- p19\n'), 'older pins are outside the shown slice');

  const first = buildQaSurfSessionPrompt({ budgetPins: 7, processedPinIds: [] });
  assert.match(first, /first surf run for this bot — nothing handled yet/);
});

test('qa-surf tool loop: allowlist admits the Q&A verbs and rejects post_simplequestion', async () => {
  const calls = [];
  const tools = {
    searchMetaweb: async () => 'no',
    readMetawebPin: async () => 'no',
    addDocument: async () => 'saved',
    learnKnowledgeBase: async () => 'learned',
    listKnowledgeBases: async () => 'none',
    queryKnowledgeBases: async () => 'none',
    saveProcedure: async () => 'saved',
    recallProcedures: async () => 'none',
    upsertKnowledge: async () => 'saved',
    recallKnowledge: async () => 'none',
    searchQa: async (args) => {
      calls.push({ fn: 'search_qa', args });
      return 'qa results';
    },
    listLatestQuestions: async (args) => {
      calls.push({ fn: 'list_latest_questions', args });
      return 'feed';
    },
    getQuestionAnswers: async (args) => {
      calls.push({ fn: 'get_question_answers', args });
      return 'detail';
    },
    postSimpleAnswer: async (args) => {
      calls.push({ fn: 'post_simpleanswer', args });
      return 'Answer published on-chain.';
    },
    likePin: async (args) => {
      calls.push({ fn: 'like_pin', args });
      return 'Liked.';
    },
  };
  const script = [
    '```json\n{"tool":"list_latest_questions","args":{"max_answers":0}}\n```',
    '```json\n{"tool":"get_question_answers","args":{"question_pin_id":"q1"}}\n```',
    '```json\n{"tool":"post_simpleanswer","args":{"answer_to":"q1","content":"do x"}}\n```',
    '```json\n{"tool":"like_pin","args":{"pin_id":"a1","is_like":1}}\n```',
    '```json\n{"tool":"post_simplequestion","args":{"title":"nope"}}\n```',
    '```json\n{"processedPinIds":["q1"],"summary":"done"}\n```',
  ];
  let step = 0;
  const reply = await runStudyTurnWithTools('surf', {
    kind: 'qa-surf',
    runLlm: async () => script[step++],
    tools,
  });
  assert.match(reply, /"summary":"done"/);
  assert.deepEqual(calls.map((entry) => entry.fn), [
    'list_latest_questions',
    'get_question_answers',
    'post_simpleanswer',
    'like_pin',
  ]);
  assert.deepEqual(calls[0].args, { maxAnswers: 0 });
  assert.deepEqual(calls[2].args, { answerTo: 'q1', content: 'do x' });

  // Topic sessions never see the Q&A verbs: the rejection lands as the next
  // user turn in the conversation (observed inside the second runLlm call).
  let sawRejection = null;
  step = 0;
  const topicScript = [
    '```json\n{"tool":"like_pin","args":{"pin_id":"a1","is_like":1}}\n```',
    '```json\n{"processedPinIds":[],"summary":"done"}\n```',
  ];
  await runStudyTurnWithTools('topic run', {
    runLlm: async (history) => {
      const text = topicScript[step++];
      if (step === 2) sawRejection = history[history.length - 1].content;
      return text;
    },
    tools,
  });
  assert.match(sawRejection, /"like_pin" is not available in this session/);
});
