// Surf turn loop — allowlist enforcement, KB add budget, scheduled-task cap,
// degraded (memory-off) refusal, final-report contract.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  runSurfTurnWithTools,
  withSurfToolLoopContract,
  SURF_TOOL_ALLOWLIST,
  SURF_SCHEDULED_TASK_CAP,
} = require('../../dist/core/surf/turn.js');
const { SURF_KB_ADD_BUDGET } = require('../../dist/core/surf/prompt.js');

function makeTools(overrides = {}) {
  const calls = [];
  const base = {
    searchMetaweb: async ({ query }) => {
      calls.push(['searchMetaweb', query]);
      return 'results';
    },
    readMetawebPin: async ({ pinId }) => `pin ${pinId} body`,
    readMetawebPinsBatch: async ({ pinIds }) => pinIds.map((pinId) => `## ${pinId}`).join('\n'),
    metawebPinVersions: async () => 'v1',
    metaprotocolRegistry: async () => 'registry',
    searchQa: async () => 'qa results',
    listLatestQuestions: async () => 'questions',
    getQuestionAnswers: async () => 'answers',
    searchSocialPosts: async () => 'posts',
    socialPostDetail: async () => 'post',
    socialPostComments: async () => 'comments',
    omniRead: async () => 'omni',
    chainWrite: async ({ path }) => {
      calls.push(['chainWrite', path]);
      return `written ${path}`;
    },
    listKnowledgeBases: async () => 'kbs',
    queryKnowledgeBases: async () => 'hits',
    addDocument: async ({ title }) => {
      calls.push(['addDocument', title]);
      return 'saved';
    },
    learnKnowledgeBase: async () => 'learned',
    saveProcedure: async () => 'procedure saved',
    recallProcedures: async () => 'procedures',
    upsertKnowledge: async () => 'knowledge saved',
    recallKnowledge: async () => 'knowledge',
    createScheduledTask: async (spec) => {
      calls.push(['createScheduledTask', spec.name]);
      return `task ${spec.name} created`;
    },
    ...overrides,
  };
  return { tools: base, calls };
}

function scriptedLlm(replies) {
  let index = 0;
  // The turn loop reuses ONE in-place history array; keep the live reference
  // so assertions can read the tool results appended after each reply.
  let transcript = null;
  return {
    get transcript() { return transcript ?? []; },
    runLlm: async (entries) => {
      transcript = entries;
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return typeof reply === 'function' ? reply(index) : reply;
    },
  };
}

/** User-role entries after the initial prompt, in order (the tool results). */
function toolResults(llm) {
  return llm.transcript.filter((entry) => entry.role === 'user').slice(1).map((entry) => entry.content);
}

const fence = (payload) => `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

test('final report fence terminates the loop and is returned as JSON', async () => {
  const { tools } = makeTools();
  const llm = scriptedLlm([
    fence({ tool: 'search_metaweb', args: { query: 'agents' } }),
    fence({ summary: 'done surfing', readPinIds: ['p1'] }),
  ]);
  const writeState = { interactionBudget: 5, kbBudget: 10 };
  const result = await runSurfTurnWithTools('prompt', {
    runLlm: llm.runLlm,
    tools,
    writeState,
  });
  const parsed = JSON.parse(result);
  assert.equal(parsed.summary, 'done surfing');
  assert.deepEqual(parsed.readPinIds, ['p1']);
});

test('non-allowlisted tools are refused with the available list; memory tools refused when degraded', async () => {
  const { tools } = makeTools();
  const llm = scriptedLlm([
    fence({ tool: 'shell', args: { cmd: 'rm -rf /' } }),
    fence({ tool: 'knowledge_upsert', args: { topic: 't', summary: 's' } }),
    fence({ summary: 'degraded done' }),
  ]);
  const writeState = { interactionBudget: 0, kbBudget: 0 };
  await runSurfTurnWithTools('prompt', {
    runLlm: llm.runLlm,
    tools,
    writeState,
    memoryEnabled: false,
  });
  const results = toolResults(llm);
  assert.match(results[0], /not available in this session/);
  assert.match(results[1], /memory, which is OFF tonight/);
});

test('fence-less replies get the format reminder, not a crash', async () => {
  const { tools } = makeTools();
  const llm = scriptedLlm([
    'I will just answer in prose.',
    fence({ summary: 'ok now fenced' }),
  ]);
  await runSurfTurnWithTools('prompt', {
    runLlm: llm.runLlm,
    tools,
    writeState: { interactionBudget: 1, kbBudget: 1 },
  });
  const results = toolResults(llm);
  assert.match(results[0], /no ```json fence/);
});

test('KB add budget: exceeding the cap returns a tool error, counting continues', async () => {
  const { tools, calls } = makeTools();
  const replies = [];
  for (let index = 0; index < SURF_KB_ADD_BUDGET + 1; index += 1) {
    replies.push(fence({ tool: 'knowledge_base_add_document', args: { title: `d${index}`, content: 'x' } }));
  }
  replies.push(fence({ summary: 'saved a lot' }));
  const llm = scriptedLlm(replies);
  const writeState = { interactionBudget: 0, kbBudget: SURF_KB_ADD_BUDGET };
  await runSurfTurnWithTools('prompt', { runLlm: llm.runLlm, tools, writeState });
  assert.equal(writeState.kbAddsUsed, SURF_KB_ADD_BUDGET);
  assert.equal(calls.filter(([name]) => name === 'addDocument').length, SURF_KB_ADD_BUDGET);
  const results = toolResults(llm);
  assert.match(results[SURF_KB_ADD_BUDGET], /budget exhausted/i);
});

test('scheduled-task cap: hard cap per run; invalid specs rejected; counter on writeState', async () => {
  const { tools, calls } = makeTools();
  const llm = scriptedLlm([
    // Invalid: past datetime.
    fence({ tool: 'create_scheduled_task', args: { name: 'past', prompt: 'x', scheduleType: 'at', at: '2020-01-01T00:00:00' } }),
    // Valid future at (no Z, >30s ahead).
    fence({
      tool: 'create_scheduled_task',
      args: { name: 'ok-1', prompt: 'do it', scheduleType: 'at', at: '2099-01-01T09:00:00' },
    }),
    fence({
      tool: 'create_scheduled_task',
      args: { name: 'ok-2', prompt: 'do it too', scheduleType: 'at', at: '2099-01-02T09:00:00' },
    }),
    // Third: over cap.
    fence({
      tool: 'create_scheduled_task',
      args: { name: 'over', prompt: 'nope', scheduleType: 'at', at: '2099-01-03T09:00:00' },
    }),
    fence({ summary: 'handed off' }),
  ]);
  const writeState = { interactionBudget: 0, kbBudget: 0 };
  await runSurfTurnWithTools('prompt', { runLlm: llm.runLlm, tools, writeState });
  assert.equal(writeState.tasksScheduled, SURF_SCHEDULED_TASK_CAP);
  assert.deepEqual(calls.filter(([name]) => name === 'createScheduledTask').map(([, name]) => name), ['ok-1', 'ok-2']);
  const results = toolResults(llm);
  assert.match(results[0], /TOOL ERROR: .*future/);
  assert.match(results[3], /TOOL ERROR: .*Hard cap/);
});

test('allowlist parity: study + qa + social + omni + comment + posts + challenge + scheduled task', () => {
  for (const name of [
    'search_metaweb', 'read_metaweb_pin', 'read_metaweb_pins_batch', 'metaweb_pin_versions',
    'metaprotocol_registry', 'search_qa', 'list_latest_questions', 'get_question_answers',
    'search_social_posts', 'social_post_detail', 'social_post_comments', 'omni_read',
    'knowledge_base_list', 'knowledge_base_query', 'knowledge_base_add_document', 'knowledge_base_learn',
    'procedure_save', 'procedure_recall', 'knowledge_upsert', 'knowledge_recall',
    'like_pin', 'comment_pin', 'post_simpleanswer', 'post_simplequestion', 'post_buzz',
    'post_simplenote', 'agentpedia_challenge', 'create_scheduled_task',
  ]) {
    assert.ok(SURF_TOOL_ALLOWLIST.has(name), `${name} missing from allowlist`);
  }
  // Surf control tools are deliberately absent inside surf sessions.
  assert.ok(!SURF_TOOL_ALLOWLIST.has('metaweb_surf_start'));
});

test('tool-loop contract preamble lists the fence format and adapts to degraded mode', () => {
  const full = withSurfToolLoopContract('BODY');
  assert.match(full, /"tool":"read_metaweb_pins_batch"/);
  assert.match(full, /knowledge_base_add_document/);
  assert.match(full, /BODY/);
  const degraded = withSurfToolLoopContract('BODY', { memoryEnabled: false });
  assert.doesNotMatch(degraded, /- knowledge_base_add_document/);
  assert.match(degraded, /Memory is OFF tonight/);
});
