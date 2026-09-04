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
