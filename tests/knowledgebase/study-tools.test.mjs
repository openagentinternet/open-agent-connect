import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runStudyTurnWithTools, buildStudySessionPrompt } = require('../../dist/core/knowledgebase/studyJobs.js');

const fence = (payload) => `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

function makeTools(calls) {
  return {
    searchMetaweb: async ({ query }) => { calls.push(['search', query]); return 'searched'; },
    readMetawebPin: async ({ pinId }) => { calls.push(['read', pinId]); return 'pin body'; },
    addDocument: async (args) => { calls.push(['add', args.title]); return 'saved doc'; },
    learnKnowledgeBase: async () => { calls.push(['learn']); return 'learned'; },
    listKnowledgeBases: async () => { calls.push(['kblist']); return 'Law (default) docs=1'; },
    queryKnowledgeBases: async ({ query }) => { calls.push(['kbquery', query]); return 'kb hits'; },
    saveProcedure: async (args) => { calls.push(['procsave', args.title, args.steps.length]); return 'Saved procedure'; },
    recallProcedures: async ({ query }) => { calls.push(['procrecall', query]); return 'no procedures'; },
    upsertKnowledge: async (args) => { calls.push(['kbupsert', args.topic, args.kind]); return 'saved point'; },
    recallKnowledge: async (args) => { calls.push(['kbrecall', args.query]); return 'no knowledge'; },
  };
}

test('study loop dispatches the full ten-tool allowlist in order', async () => {
  const calls = [];
  const replies = [
    fence({ tool: 'knowledge_base_list', args: {} }),
    fence({ tool: 'knowledge_base_query', args: { query: 'tarot' } }),
    fence({ tool: 'procedure_recall', args: { query: 'brew' } }),
    fence({ tool: 'procedure_save', args: { title: 'Brew tea', steps: ['boil', 'steep'], pitfalls: ['oversteep'], sourcePinIds: ['p1'] } }),
    fence({ tool: 'knowledge_upsert', args: { topic: 'tea temp', summary: '85C for green tea.', kind: 'know_how' } }),
    fence({ tool: 'knowledge_recall', args: { query: 'tea' } }),
    fence({ tool: 'agent_browser_tabs', args: {} }),
    fence({ tool: 'knowledge_base_add_document', args: { title: 'Tea guide', content: 'Long body.', pinId: 'p2' } }),
    fence({ tool: 'knowledge_base_learn', args: {} }),
    fence({ processedPinIds: ['p2'], summary: 'one doc, one procedure, one knowledge point' }),
  ];
  const result = await runStudyTurnWithTools('topic prompt', {
    runLlm: async () => replies.shift(),
    maxSteps: 20,
    tools: makeTools(calls),
  });
  assert.deepEqual(JSON.parse(result), {
    processedPinIds: ['p2'],
    summary: 'one doc, one procedure, one knowledge point',
  });
  assert.deepEqual(calls, [
    ['kblist'],
    ['kbquery', 'tarot'],
    ['procrecall', 'brew'],
    ['procsave', 'Brew tea', 2],
    ['kbupsert', 'tea temp', 'know_how'],
    ['kbrecall', 'tea'],
    ['add', 'Tea guide'],
    ['learn'],
  ], 'the non-allowlisted tool call is rejected (no dispatch) and the loop continues');
});

test('study prompt lists the triage targets (KB bodies, procedures, knowledge points)', () => {
  const prompt = buildStudySessionPrompt({ topic: '中国古代法', budgetPins: 20 });
  for (const marker of [
    'knowledge_base_query', 'knowledge_base_list', 'procedure_save', 'procedure_recall',
    'knowledge_upsert', 'knowledge_recall', 'Memory triage',
  ]) {
    assert.ok(prompt.includes(marker), `prompt mentions ${marker}`);
  }
});

test('step ceiling degrades to one final no-tools report and marks it partial (D1-b)', async () => {
  const calls = [];
  const replies = [
    fence({ tool: 'search_metaweb', args: { query: 'oac' } }),
    fence({ tool: 'read_metaweb_pin', args: { pinId: 'p1' } }),
    fence({ processedPinIds: ['p1'], summary: 'collected one pin before the cap' }),
  ];
  const lastPrompts = [];
  const result = await runStudyTurnWithTools('topic prompt', {
    maxSteps: 2,
    runLlm: async (history) => {
      lastPrompts.push(history[history.length - 1].content);
      return replies.shift();
    },
    tools: makeTools(calls),
  });
  assert.deepEqual(JSON.parse(result), {
    processedPinIds: ['p1'],
    summary: '[partial] collected one pin before the cap',
  });
  assert.match(lastPrompts.at(-1), /Tool-step budget exhausted/);
  assert.match(lastPrompts.at(-1), /no further tool calls will run/);
  assert.deepEqual(calls, [['search', 'oac'], ['read', 'p1']]);
});

test('a tool fence in the step-ceiling turn is never dispatched; no report still fails (D1-b)', async () => {
  const calls = [];
  const replies = [
    fence({ tool: 'search_metaweb', args: { query: 'first' } }),
    fence({ tool: 'search_metaweb', args: { query: 'second' } }),
  ];
  await assert.rejects(
    runStudyTurnWithTools('topic prompt', {
      maxSteps: 1,
      runLlm: async () => replies.shift(),
      tools: makeTools(calls),
    }),
    (error) => error instanceof Error && error.code === 'study_steps_exhausted',
  );
  assert.deepEqual(calls, [['search', 'first']], 'the post-ceiling tool call is never executed');
});

test('an existing PARTIAL marker is not double-prefixed (D1-b)', async () => {
  const result = await runStudyTurnWithTools('p', {
    maxSteps: 1,
    runLlm: async (history) => (history.length === 1
      ? fence({ tool: 'search_metaweb', args: { query: 'q' } })
      : fence({ processedPinIds: [], summary: 'PARTIAL: nothing saved in time' })),
    tools: makeTools([]),
  });
  assert.equal(JSON.parse(result).summary, 'PARTIAL: nothing saved in time');
});
