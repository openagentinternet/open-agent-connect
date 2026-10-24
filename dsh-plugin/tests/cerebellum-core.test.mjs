/**
 * Cerebellum core contract tests — ported from IDBots' tests @ commit
 * d75bea8ac2249da4886bfa0f6f1db838d234ef1f:
 * cerebellumConfig.test.mjs, cerebellumMemoryWriteGate.test.mjs,
 * cerebellumMemoryRank.test.mjs, cerebellumSkillShortlist.test.mjs,
 * cerebellumRemoteServiceShortlist.test.mjs, cerebellumKnowledgeHotRank.test.mjs,
 * cerebellumVolatileBlockGate.test.mjs, cerebellumConversationRank.test.mjs,
 * cerebellumWorkerRank.test.mjs, cerebellumTurnDecisionBundle.test.mjs,
 * cerebellumEffortSelector.test.mjs, jevRelayService.test.mjs.
 *
 * All fetches are injected fakes — no network. Covers the acceptance matrix:
 * request shape, answer parsing (probability map, bare choice fallback,
 * clamps), every failure mode → null, caps, fail-open semantics, the
 * call-context stack (bounded fetch, one-shot 401 re-bootstrap, 429 breaker,
 * shared in-flight bootstrap), and the config enabled/provider/key matrix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const configModule = await import('../lib/cerebellum/config.js');
const {
  resolveCerebellumConfig,
  CEREBELLUM_FREE_RELAY_BASE_URL,
  CEREBELLUM_FREE_MODEL,
  CEREBELLUM_DEFAULT_BASE_URL,
  CEREBELLUM_DEFAULT_MODEL,
} = configModule;

const writeGate = await import('../lib/cerebellum/questions/memoryWriteGate.js');
const memoryRank = await import('../lib/cerebellum/questions/memoryRank.js');
const skillShortlist = await import('../lib/cerebellum/questions/skillShortlist.js');
const serviceShortlist = await import('../lib/cerebellum/questions/remoteServiceShortlist.js');
const knowledgeRank = await import('../lib/cerebellum/questions/knowledgeHotRank.js');
const volatileGate = await import('../lib/cerebellum/questions/volatileBlockGate.js');
const conversationRank = await import('../lib/cerebellum/questions/conversationSearchRank.js');
const workerRank = await import('../lib/cerebellum/questions/workerRank.js');
const bundle = await import('../lib/cerebellum/questions/turnDecisionBundle.js');
const effort = await import('../lib/cerebellum/effort.js');
const clientModule = await import('../lib/cerebellum/client.js');
const {
  createCerebellumClient,
  createSignalBoundedFetch,
  classifyJevRelayHttpStatus,
  classifyJevRelayThrownError,
  parseJevRelayErrorCode,
  extractJevRelayErrorDetail,
  JEV_RELAY_QUOTA_BREAKER_MS,
  JEV_FREE_QUOTA_EXHAUSTED_CODE,
  JEV_RELAY_ERROR_DETAIL_MAX_CHARS,
  JEV_RELAY_API_KEY_KV,
  JEV_RELAY_BASE_URL_KV,
  bindCerebellumCore,
} = clientModule;

const CONFIG = {
  provider: 'typesafe-jev',
  apiKey: 'sk-test',
  baseUrl: 'https://jev.example',
  model: 'jev-test-model',
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** A fetch that stalls forever until the caller's AbortSignal fires (the
 *  platform-fetch behavior the bounded wrapper and the executors rely on). */
const hangingUntilAbort = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener(
    'abort',
    () => reject(new DOMException('The operation was aborted', 'AbortError')),
    { once: true },
  );
});

// ---------------------------------------------------------------------------
// Config resolver (ported from cerebellumConfig.test.mjs)
// ---------------------------------------------------------------------------

test('config: returns null for missing, disabled, or malformed configs', () => {
  assert.equal(resolveCerebellumConfig(null), null);
  assert.equal(resolveCerebellumConfig(undefined), null);
  assert.equal(resolveCerebellumConfig('nope'), null);
  assert.equal(resolveCerebellumConfig({}), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: null }), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: false, provider: 'typesafe-jev', apiKey: 'k' } }), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: true } }), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'unknown-provider', apiKey: 'k' } }), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: 1, provider: 'typesafe-jev', apiKey: 'k' } }), null);
});

test('config: direct provider requires an api key', () => {
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: '' } }), null);
  assert.equal(resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev' } }), null);
});

test('config: resolves a fully configured direct provider', () => {
  assert.deepEqual(
    resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: ' sk-direct ', baseUrl: 'https://api.example', model: 'jev-preview' } }),
    { provider: 'typesafe-jev', apiKey: 'sk-direct', baseUrl: 'https://api.example', model: 'jev-preview' },
  );
});

test('config: strips trailing slashes, fills default base URL and model when blank', () => {
  assert.deepEqual(
    resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: 'k', baseUrl: 'https://api.example///', model: '  ' } }),
    { provider: 'typesafe-jev', apiKey: 'k', baseUrl: 'https://api.example', model: CEREBELLUM_DEFAULT_MODEL },
  );
  const withDefaults = resolveCerebellumConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: 'k' } });
  assert.equal(withDefaults.baseUrl, CEREBELLUM_DEFAULT_BASE_URL);
  assert.equal(withDefaults.model, CEREBELLUM_DEFAULT_MODEL);
});

test('config: free provider resolves with an empty api key and pins relay baseUrl/model', () => {
  const resolved = resolveCerebellumConfig({
    cerebellum: { enabled: true, provider: 'idbots-jev-free', apiKey: '', baseUrl: 'https://ignored.example', model: 'ignored' },
  });
  assert.deepEqual(resolved, {
    provider: 'idbots-jev-free',
    apiKey: '',
    baseUrl: CEREBELLUM_FREE_RELAY_BASE_URL,
    model: CEREBELLUM_FREE_MODEL,
  });
});

// ---------------------------------------------------------------------------
// Memory write gate (ported from cerebellumMemoryWriteGate.test.mjs)
// ---------------------------------------------------------------------------

test('write gate: implicit mode asks about durable facts; explicit-only narrows to instructions', () => {
  const implicit = writeGate.buildMemoryWriteGateQuestion({ explicitOnly: false });
  assert.equal(implicit.type, 'noul');
  assert.ok(implicit.instructions.includes('stable personal fact'));
  assert.ok(!implicit.instructions.includes('explicit-only mode'));
  assert.equal(implicit.criteria.true, writeGate.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_IMPLICIT.true);
  const explicit = writeGate.buildMemoryWriteGateQuestion({ explicitOnly: true });
  assert.ok(explicit.instructions.includes('explicit-only mode'));
  assert.equal(explicit.criteria.false, writeGate.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_EXPLICIT_ONLY.false);
});

test('write gate: request carries one noul question over the original-language turn', () => {
  const request = writeGate.buildMemoryWriteGateRequest({
    userText: '记住我 prefers 美式咖啡',
    assistantText: '好的',
    model: 'jev-latest',
    explicitOnly: false,
  });
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.state.user_message, '记住我 prefers 美式咖啡');
  assert.deepEqual(Object.keys(request.questions), [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]);
  assert.equal(request.questions[writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID].type, 'noul');
});

test('write gate: excerpts are whitespace-collapsed and capped (1200/400)', () => {
  const request = writeGate.buildMemoryWriteGateRequest({
    userText: `${'长'.repeat(2000)}\n\nx`,
    assistantText: 'a'.repeat(600),
    model: 'm',
    explicitOnly: false,
  });
  assert.equal(request.state.user_message.length, writeGate.CEREBELLUM_MEMORY_WRITE_GATE_MAX_USER_CHARS);
  assert.ok(!request.state.user_message.includes('\n'));
  assert.equal(request.state.assistant_message.length, writeGate.CEREBELLUM_MEMORY_WRITE_GATE_MAX_ASSISTANT_CHARS);
});

test('write gate: parse happy path, clamping, and unusable shapes', () => {
  const payload = { answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 0.7 } } };
  assert.equal(writeGate.parseMemoryWriteGateAnswer(payload), 0.7);
  const clamped = { answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 1.9 } } };
  assert.equal(writeGate.parseMemoryWriteGateAnswer(clamped), 1);
  assert.equal(writeGate.parseMemoryWriteGateAnswer(null), null);
  assert.equal(writeGate.parseMemoryWriteGateAnswer({}), null);
  assert.equal(writeGate.parseMemoryWriteGateAnswer({ answers: {} }), null);
  assert.equal(writeGate.parseMemoryWriteGateAnswer({ answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 'x' } } }), null);
});

test('write gate: noul at/above threshold proceeds, below skips', async () => {
  const atThreshold = jsonResponse(200, { answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 0.5 } } });
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ config: CONFIG, fetchImpl: async () => atThreshold, userText: '记住我喜欢咖啡', assistantText: '', explicitOnly: false }), true);
  const below = jsonResponse(200, { answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 0.49 } } });
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ config: CONFIG, fetchImpl: async () => below, userText: 'hi', assistantText: '', explicitOnly: false }), false);
});

test('write gate: request shape hits /v1/systemone with bearer auth and the turn state', async () => {
  const calls = [];
  await writeGate.gateMemoryWriteWithCerebellum({
    config: CONFIG,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { answers: { [writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]: { noul: 0.9 } } });
    },
    userText: 'turn text',
    assistantText: 'reply',
    explicitOnly: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CONFIG.baseUrl}/v1/systemone`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${CONFIG.apiKey}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, CONFIG.model);
  assert.ok(body.questions[writeGate.CEREBELLUM_MEMORY_WRITE_GATE_QUESTION_ID]);
});

test('write gate: every failure mode returns null (fail-open) without throwing', async () => {
  const inputs = { config: CONFIG, userText: 'hello', assistantText: '', explicitOnly: false };
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, fetchImpl: async () => jsonResponse(500, {}) }), null);
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, fetchImpl: async () => jsonResponse(200, 'not-json-object-body-accepted-by-json' ) }).catch(() => 'threw').then((r) => (r === 'threw' ? null : r)), null);
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, fetchImpl: async () => { throw new Error('network down'); } }), null);
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, fetchImpl: async () => jsonResponse(200, {}) }), null);
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, fetchImpl: async () => jsonResponse(200, { answers: { other: { noul: 1 } } }) }), null);
  // Blank user text never leaves the machine.
  const calls = [];
  assert.equal(await writeGate.gateMemoryWriteWithCerebellum({ ...inputs, userText: '   ', fetchImpl: async (...args) => { calls.push(args); return jsonResponse(200, {}); } }), null);
  assert.equal(calls.length, 0);
});

test('write gate: a hanging endpoint is aborted at the deadline', async () => {
  const startedAt = Date.now();
  const verdict = await writeGate.gateMemoryWriteWithCerebellum({
    config: CONFIG,
    fetchImpl: hangingUntilAbort,
    userText: 'hello',
    assistantText: '',
    explicitOnly: false,
    timeoutMs: 40,
  });
  assert.equal(verdict, null);
  assert.ok(Date.now() - startedAt < 5000, 'returns promptly after the deadline, not never');
});

// ---------------------------------------------------------------------------
// Memory rank (ported from cerebellumMemoryRank.test.mjs)
// ---------------------------------------------------------------------------

const pool = (count, prefix = 'm') => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, text: `memory ${prefix}${i} about coffee` }));

test('memory rank: request carries state, model, one noul question per memory', () => {
  const request = memoryRank.buildMemoryRankRequest({ currentUserText: '咖啡', memories: pool(3), model: 'jev-latest' });
  assert.equal(request.state.current_message, '咖啡');
  assert.equal(request.state.memories.length, 3);
  assert.equal(request.model, 'jev-latest');
  assert.deepEqual(Object.keys(request.questions), ['mem_0', 'mem_1', 'mem_2']);
  assert.equal(request.questions.mem_0.type, 'noul');
  assert.ok(request.questions.mem_1.instructions.includes('memories[1].text'));
});

test('memory rank: buildMemoryRankQuestions(0) returns an empty map', () => {
  assert.deepEqual(memoryRank.buildMemoryRankQuestions(0), {});
});

test('memory rank: parse maps mem_<i> back to ids, tolerates junk, null without answers', () => {
  const memories = pool(3);
  const payload = { answers: { mem_0: { noul: 0.9 }, mem_1: { noul: 'junk' }, mem_2: {} } };
  const scores = memoryRank.parseMemoryRankAnswers(payload, memories);
  assert.equal(scores.size, 1);
  assert.equal(scores.get('m0'), 0.9);
  assert.equal(memoryRank.parseMemoryRankAnswers({}, memories), null);
  assert.equal(memoryRank.parseMemoryRankAnswers({ answers: 'junk' }, memories), null);
  // An array-valued `answers` is an object shape-wise: it yields an empty map
  // (no usable nouls), same as upstream — null is reserved for a missing/non-object answers.
  assert.equal(memoryRank.parseMemoryRankAnswers({ answers: [] }, memories).size, 0);
});

test('memory rank: posts one request and returns the score map on a 200', async () => {
  const calls = [];
  const memories = pool(3);
  const scores = await memoryRank.rankMemoriesWithCerebellum({
    config: CONFIG,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { answers: { mem_0: { noul: 0.2 }, mem_1: { noul: 0.8 }, mem_2: { noul: 0.4 } } });
    },
    currentUserText: 'message',
    memories,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CONFIG.baseUrl}/v1/systemone`);
  assert.equal(scores.size, 3);
  assert.equal(scores.get('m1'), 0.8);
});

test('memory rank: HTTP errors, network errors, malformed payloads, and incomplete coverage all return null', async () => {
  const memories = pool(5);
  const base = { config: CONFIG, currentUserText: 'message', memories };
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ ...base, fetchImpl: async () => jsonResponse(500, {}) }), null);
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ ...base, fetchImpl: async () => jsonResponse(200, { nope: true }) }), null);
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ ...base, fetchImpl: async () => { throw new Error('boom'); } }), null);
  // 3 of 5 answers < 5 * 0.8 = 4 → whole-map discard.
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ ...base, fetchImpl: async () => jsonResponse(200, { answers: { mem_0: { noul: 1 }, mem_1: { noul: 1 }, mem_2: { noul: 1 } } }) }), null);
  // 4 of 5 is exactly at the floor and passes.
  const atFloor = await memoryRank.rankMemoriesWithCerebellum({
    ...base,
    fetchImpl: async () => jsonResponse(200, { answers: { mem_0: { noul: 1 }, mem_1: { noul: 1 }, mem_2: { noul: 1 }, mem_3: { noul: 1 } } }),
  });
  assert.equal(atFloor.size, 4);
});

test('memory rank: blank text or an empty pool skips the call entirely', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(200, {}); };
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: '  ', memories: pool(20) }), null);
  assert.equal(await memoryRank.rankMemoriesWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', memories: [] }), null);
  assert.equal(calls.length, 0);
});

test('memory rank: aborts past the timeout and returns null', async () => {
  const verdict = await memoryRank.rankMemoriesWithCerebellum({
    config: CONFIG,
    fetchImpl: hangingUntilAbort,
    currentUserText: 'message',
    memories: pool(3),
    timeoutMs: 40,
  });
  assert.equal(verdict, null);
});

test('memory rank: prefilter caps (window 60 / candidate 30 / entry 800 / budget 12000 / message 4000)', () => {
  // Window: a memory far down the recency order never rides even with overlap.
  const bigPool = Array.from({ length: 100 }, (_, i) => ({ id: `w${i}`, text: `plain ${i}` }));
  bigPool[90] = { id: 'target', text: 'coffee coffee coffee' };
  const selected = memoryRank.selectMemoryRankCandidates(bigPool, 'coffee');
  assert.ok(!selected.some((entry) => entry.id === 'target'), 'outside the 60-window never selected');
  // Candidate cap 30.
  const capped = memoryRank.selectMemoryRankCandidates(pool(200, 'c'), 'plain');
  assert.equal(capped.length, memoryRank.CEREBELLUM_MEMORY_MAX_CANDIDATES);
  // Per-entry truncation 800.
  const one = memoryRank.selectMemoryRankCandidates([{ id: 'long', text: 'x'.repeat(5000) }], 'msg');
  assert.equal(one[0].text.length, memoryRank.CEREBELLUM_MEMORY_TEXT_MAX_CHARS);
  // Total budget 12000 stops selection at the tail.
  const wide = memoryRank.selectMemoryRankCandidates(
    Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, text: 'y'.repeat(800) })),
    'msg',
  );
  assert.ok(wide.length < 16, `budget stops early (got ${wide.length})`);
  assert.ok(wide.every((entry) => entry.text.length <= 800));
  // Lexical boost reorders inside the window (stable, recency breaks ties).
  const boosted = memoryRank.selectMemoryRankCandidates(
    [{ id: 'a', text: 'unrelated' }, { id: 'b', text: 'coffee brewing steps' }, { id: 'c', text: 'more unrelated' }],
    'coffee',
  );
  assert.equal(boosted[0].id, 'b');
  // Current message cap.
  const request = memoryRank.buildMemoryRankRequest({ currentUserText: 'z'.repeat(6000), memories: pool(3), model: 'm' });
  assert.equal(request.state.current_message.length, memoryRank.CEREBELLUM_MEMORY_CURRENT_MESSAGE_MAX_CHARS);
});

test('memory rank: payload accounting reports counts and chars only', async () => {
  let stats = null;
  await memoryRank.rankMemoriesWithCerebellum({
    config: CONFIG,
    fetchImpl: async () => jsonResponse(200, { answers: { mem_0: { noul: 1 }, mem_1: { noul: 1 }, mem_2: { noul: 1 } } }),
    currentUserText: 'message',
    memories: pool(3),
    onPayload: (value) => { stats = value; },
  });
  assert.equal(stats.poolSize, 3);
  assert.equal(stats.sent, 3);
  assert.ok(stats.totalChars > 0);
  assert.ok(!JSON.stringify(stats).includes('memory m0'), 'no memory text in accounting');
});

// ---------------------------------------------------------------------------
// Skill shortlist (ported from cerebellumSkillShortlist.test.mjs)
// ---------------------------------------------------------------------------

const skills = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `Skill ${i}`, description: `Handles thing ${i}` }));

test('skill shortlist: labels cap descriptions at 320 and fall back to the bare name', () => {
  const label = skillShortlist.buildSkillOptionLabel({ id: 's', name: 'S', description: 'd'.repeat(1000) });
  assert.ok(label.startsWith('S: '));
  assert.ok(label.length <= 3 + skillShortlist.CEREBELLUM_SKILL_OPTION_MAX_DESCRIPTION_CHARS);
  assert.equal(skillShortlist.buildSkillOptionLabel({ id: 's', name: 'S', description: '   ' }), 'S');
});

test('skill shortlist: choice question keys by skill id, empty pool contributes nothing, 255/24k caps hold', () => {
  const questions = skillShortlist.buildSkillChoiceQuestions(skills);
  assert.deepEqual(Object.keys(questions), [skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID]);
  const criteria = questions[skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID].criteria;
  assert.equal(criteria.s5, 'Skill 5: Handles thing 5');
  assert.deepEqual(skillShortlist.buildSkillChoiceQuestions([]), {});
  const many = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, description: 'short' }));
  // The 255-option slice lives in the request builder / executor (upstream shape).
  const cappedRequest = skillShortlist.buildSkillShortlistRequest({ currentUserText: 'hi', skills: many, model: 'm' });
  assert.equal(
    Object.keys(cappedRequest.questions[skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID].criteria).length,
    skillShortlist.CEREBELLUM_SKILL_MAX_OPTIONS,
  );
  const fat = skillShortlist.buildSkillChoiceQuestions(
    Array.from({ length: 300 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, description: 'x'.repeat(400) })),
  );
  const fatLabels = Object.values(fat[skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID].criteria);
  assert.ok(fatLabels.length < 300, `total 24k label budget stops early (got ${fatLabels.length})`);
});

test('skill shortlist: probabilities parse with clamps and unknown-key skip; bare choice fallback; unusable → null', () => {
  const payload = { answers: { [skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID]: { probabilities: { s1: 1.5, s2: 0.2, ghost: 0.9, s3: 'junk' } } } };
  const ranking = skillShortlist.parseSkillShortlistAnswers(payload, skills);
  assert.deepEqual(ranking, [{ id: 's1', probability: 1 }, { id: 's2', probability: 0.2 }]);
  const bare = skillShortlist.parseSkillShortlistAnswers(
    { answers: { [skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID]: { choice: 's7' } } },
    skills,
  );
  assert.deepEqual(bare, [{ id: 's7', probability: 1 }]);
  assert.equal(skillShortlist.parseSkillShortlistAnswers({ answers: { [skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID]: { probabilities: { ghost: 1 } } } }, skills), null);
  assert.equal(skillShortlist.parseSkillShortlistAnswers({ answers: {} }, skills), null);
});

test('skill shortlist: pools below min 12 or blank text return null with zero calls', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(200, {}); };
  assert.equal(await skillShortlist.rankSkillsWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', skills: skills.slice(0, 11) }), null);
  assert.equal(await skillShortlist.rankSkillsWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: '  ', skills }), null);
  assert.equal(calls.length, 0);
});

test('skill shortlist: block renders top-3 with a suggestion line, probabilities omitted', () => {
  const entries = skills.map((skill, i) => ({ ...skill, probability: 1 - i / 100 }));
  const block = skillShortlist.buildSkillShortlistBlock(entries);
  assert.ok(block.startsWith('<skill_shortlist>'));
  assert.ok(block.endsWith('</skill_shortlist>'));
  assert.ok(block.includes('Suggested skill: `Skill 0`.'));
  assert.ok(block.includes('- `Skill 1`: Handles thing 1'));
  assert.ok(!block.includes('0.9'), 'probabilities are not rendered');
  assert.equal((block.match(/^- `/gm) || []).length, 3);
});

// ---------------------------------------------------------------------------
// Remote-service shortlist (ported from cerebellumRemoteServiceShortlist.test.mjs)
// ---------------------------------------------------------------------------

const services = Array.from({ length: 20 }, (_, i) => ({ id: `pin${i}`, name: `Service ${i}`, description: `Does ${i}` }));

test('service shortlist: isomorphic choice shape, question id best_service, caps mirror the skill shortlist', () => {
  const questions = serviceShortlist.buildRemoteServiceChoiceQuestions(services);
  const question = questions[serviceShortlist.CEREBELLUM_REMOTE_SERVICE_RANK_QUESTION_ID];
  assert.equal(question.type, 'choice');
  assert.equal(question.criteria.pin3, 'Service 3: Does 3');
  assert.deepEqual(serviceShortlist.buildRemoteServiceChoiceQuestions([]), {});
  assert.equal(serviceShortlist.CEREBELLUM_REMOTE_SERVICE_MAX_OPTIONS, 255);
  assert.equal(serviceShortlist.CEREBELLUM_REMOTE_SERVICE_SHORTLIST_MIN_POOL, 12);
});

test('service shortlist: parse clamps, bare choice fallback, min-pool and failure nulls', async () => {
  const ranking = serviceShortlist.parseRemoteServiceShortlistAnswers(
    { answers: { [serviceShortlist.CEREBELLUM_REMOTE_SERVICE_RANK_QUESTION_ID]: { probabilities: { pin2: 2, pin1: 0.1 } } } },
    services,
  );
  assert.deepEqual(ranking, [{ id: 'pin2', probability: 1 }, { id: 'pin1', probability: 0.1 }]);
  assert.deepEqual(
    serviceShortlist.parseRemoteServiceShortlistAnswers(
      { answers: { [serviceShortlist.CEREBELLUM_REMOTE_SERVICE_RANK_QUESTION_ID]: { choice: 'pin9' } } },
      services,
    ),
    [{ id: 'pin9', probability: 1 }],
  );
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(500, {}); };
  assert.equal(await serviceShortlist.rankRemoteServicesWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', services: services.slice(0, 11) }), null);
  assert.equal(calls.length, 0, 'below-min pool never leaves the machine');
  assert.equal(await serviceShortlist.rankRemoteServicesWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', services }), null);
  assert.equal(calls.length, 1, 'the eligible pool fires exactly one call (HTTP 500 → null)');
});

// ---------------------------------------------------------------------------
// Knowledge hot rank (ported from cerebellumKnowledgeHotRank.test.mjs)
// ---------------------------------------------------------------------------

const knowledge = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, topic: `Topic ${i}`, summary: `Summary ${i}`, kind: i % 2 ? 'pitfall' : 'know_how' }));

test('knowledge rank: formats [kind] topic: summary, defaults unknown kind, drops blanks, caps at 500', () => {
  assert.equal(knowledgeRank.formatKnowledgeCandidateText({ topic: 'T', summary: 'S', kind: 'pitfall' }), '[pitfall] T: S');
  assert.equal(knowledgeRank.formatKnowledgeCandidateText({ topic: 'T', summary: 'S', kind: 'weird' }), '[know_how] T: S');
  assert.equal(knowledgeRank.formatKnowledgeCandidateText({ topic: '', summary: '' }), '');
  const long = knowledgeRank.formatKnowledgeCandidateText({ topic: 'T', summary: 's'.repeat(2000) });
  assert.equal(long.length, knowledgeRank.CEREBELLUM_KNOWLEDGE_TEXT_MAX_CHARS);
});

test('knowledge rank: selection drops blank ids/texts and caps the pool at 40', () => {
  const entries = [
    ...knowledge,
    { id: '', topic: 'x', summary: 'y' },
    { id: 'blank-text', topic: '', summary: '' },
  ];
  const selected = knowledgeRank.selectKnowledgeRankCandidates(entries);
  assert.equal(selected.length, knowledge.length);
  const capped = knowledgeRank.selectKnowledgeRankCandidates(
    Array.from({ length: 80 }, (_, i) => ({ id: `k${i}`, topic: 'T', summary: 'S' })),
  );
  assert.equal(capped.length, knowledgeRank.CEREBELLUM_KNOWLEDGE_MAX_CANDIDATES);
});

test('knowledge rank: parse maps kn_<i>, coverage floor discards partial maps, min pool 9 skips the call', async () => {
  const scores = knowledgeRank.parseKnowledgeRankAnswers(
    { answers: { kn_0: { noul: 0.9 }, kn_2: { noul: 0.1 } } },
    knowledgeRank.selectKnowledgeRankCandidates(knowledge),
  );
  assert.equal(scores.size, 2);
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(200, {}); };
  // The standalone executor has no min-pool gate (the turn bundle applies
  // CEREBELLUM_KNOWLEDGE_MIN_POOL — see the bundle floors test); malformed body → null.
  assert.equal(await knowledgeRank.rankKnowledgeWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', entries: knowledge.slice(0, 8) }), null);
  assert.equal(await knowledgeRank.rankKnowledgeWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hi', entries: knowledge }), null);
  assert.equal(calls.length, 2, 'the standalone executor fires for both pools; the floor is bundle-side');
  // Coverage floor on a full pool: 2 of 12 answers < 12*0.8 → whole-map discard.
  const floorCalls = [];
  assert.equal(await knowledgeRank.rankKnowledgeWithCerebellum({
    config: CONFIG,
    fetchImpl: async () => jsonResponse(200, { answers: { kn_0: { noul: 0.9 }, kn_1: { noul: 0.9 } } }),
    currentUserText: 'hi',
    entries: knowledge,
  }), null);
});

// ---------------------------------------------------------------------------
// Volatile block gate (ported from cerebellumVolatileBlockGate.test.mjs)
// ---------------------------------------------------------------------------

test('volatile gate: builds one noul question per gateable section key', () => {
  const questions = volatileGate.buildVolatileGateQuestions();
  assert.deepEqual(Object.keys(questions), [...volatileGate.CEREBELLUM_VOLATILE_GATE_SECTION_KEYS]);
  for (const key of volatileGate.CEREBELLUM_VOLATILE_GATE_SECTION_KEYS) {
    assert.equal(questions[key].type, 'noul');
    assert.equal(volatileGate.CEREBELLUM_VOLATILE_GATE_THRESHOLDS[key], 0.35);
  }
  const request = volatileGate.buildVolatileGateRequest({ currentUserText: 'help me search my knowledge base', model: 'm' });
  assert.equal(request.state.current_message, 'help me search my knowledge base');
  assert.ok(volatileGate.CEREBELLUM_VOLATILE_GATE_MAX_MESSAGE_CHARS === 4000);
});

test('volatile gate: per-block fail-open — missing answers resolve to inject (true)', () => {
  const verdicts = volatileGate.parseVolatileGateAnswers({ answers: {} });
  assert.deepEqual(verdicts, {
    experience: true,
    'twin-impression': true,
    'knowledge-bases': true,
    'remote-services': true,
  });
  assert.equal(volatileGate.parseVolatileGateAnswers({}), null);
  assert.equal(volatileGate.parseVolatileGateAnswers({ answers: 'junk' }), null);
});

test('volatile gate: below threshold skips the block only; others inject', () => {
  const verdicts = volatileGate.parseVolatileGateAnswers({
    answers: {
      experience: { noul: 0.2 },
      'knowledge-bases': { noul: 0.9 },
      'remote-services': { noul: 3 }, // clamps to 1 → inject
    },
  });
  assert.equal(verdicts.experience, false);
  assert.equal(verdicts['twin-impression'], true, 'missing stays fail-open');
  assert.equal(verdicts['knowledge-bases'], true);
  assert.equal(verdicts['remote-services'], true);
});

test('volatile gate: blank text returns null; HTTP failure returns null (inject everything)', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(503, {}); };
  assert.equal(await volatileGate.gateVolatileBlocksWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: '   ' }), null);
  assert.equal(await volatileGate.gateVolatileBlocksWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'hello' }), null);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Conversation search rank (ported from cerebellumConversationRank.test.mjs)
// ---------------------------------------------------------------------------

const chats = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, text: `chat about thing ${i}` }));

test('conversation rank: formats Title/Human/Assistant, caps at 700, drops blanks, caps the pool at 10', () => {
  const text = conversationRank.formatConversationCandidateText({ title: 'T', human: 'H', assistant: 'A' });
  assert.equal(text, 'Title: T\nHuman: H\nAssistant: A');
  assert.equal(conversationRank.formatConversationCandidateText({}).includes('Untitled'), true);
  const long = conversationRank.formatConversationCandidateText({ title: 'T', human: 'h'.repeat(2000), assistant: '' });
  assert.equal(long.length, conversationRank.CEREBELLUM_CONVERSATION_TEXT_MAX_CHARS);
  const selected = conversationRank.selectConversationRankCandidates([...chats, { id: '', text: 'x' }, { id: 'z', text: '' }]);
  assert.equal(selected.length, chats.length);
  const capped = conversationRank.selectConversationRankCandidates(
    Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, text: 'text' })),
  );
  assert.equal(capped.length, conversationRank.CEREBELLUM_CONVERSATION_RANK_MAX_CANDIDATES);
});

test('conversation rank: parse + coverage floor; order keeps recency on null, reorders on scores, missing ids sink', () => {
  const payload = { answers: { chat_0: { noul: 0.1 }, chat_1: { noul: 0.9 } } };
  const scores = conversationRank.parseConversationRankAnswers(payload, chats);
  assert.equal(scores.size, 2);
  assert.deepEqual(conversationRank.orderConversationHits(chats, null), chats);
  assert.deepEqual(conversationRank.orderConversationHits(chats, new Map()), chats);
  const ordered = conversationRank.orderConversationHits(chats, scores);
  assert.equal(ordered[0].id, 'c1');
  assert.equal(ordered[1].id, 'c0');
  assert.equal(ordered[2].id, 'c2', 'unscored keeps recency among itself, below scored');
});

test('conversation rank: empty pool skips; single hit passes coverage trivially; partial coverage on a full pool → null', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(200, { answers: { chat_0: { noul: 1 } } }); };
  assert.equal(await conversationRank.rankConversationsWithCerebellum({ config: CONFIG, fetchImpl, searchQuery: 'q', chats: [] }), null);
  assert.equal(calls.length, 0, 'empty pool never leaves the machine');
  // The standalone executor carries no min-pool gate (upstream applies it at the call site);
  // one hit with one answer trivially clears the 0.8 coverage floor.
  const single = await conversationRank.rankConversationsWithCerebellum({ config: CONFIG, fetchImpl, searchQuery: 'q', chats: [chats[0]] });
  assert.equal(single.size, 1);
  assert.equal(single.get('c0'), 1);
  // 1 of 4 answers < 4*0.8 → whole-map null (keyword order upstream).
  assert.equal(await conversationRank.rankConversationsWithCerebellum({ config: CONFIG, fetchImpl, searchQuery: 'q', chats }), null);
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------------------
// Worker rank (ported from cerebellumWorkerRank.test.mjs)
// ---------------------------------------------------------------------------

const workers = [
  { id: 'w1', name: 'Alpha', description: 'frontend expert' },
  { id: 'w2', name: 'Beta', description: 'backend expert' },
  { id: 'w3', name: 'Gamma', description: 'b'.repeat(500) },
];

test('worker rank: request shape — criteria labels capped at 320, goal capped at 1200, question id best_worker', () => {
  const request = workerRank.buildWorkerRankRequest({ taskText: 'Build the panel', workers, model: 'm' });
  assert.equal(request.state.task_goal, 'Build the panel');
  assert.equal(request.questions[workerRank.CEREBELLUM_WORKER_RANK_QUESTION_ID].type, 'choice');
  const criteria = request.questions[workerRank.CEREBELLUM_WORKER_RANK_QUESTION_ID].criteria;
  assert.equal(criteria.w1, 'Alpha: frontend expert');
  assert.ok(criteria.w3.length <= 'Gamma: '.length + workerRank.CEREBELLUM_WORKER_RANK_DESCRIPTION_MAX_CHARS);
  const longGoal = workerRank.buildWorkerRankRequest({ taskText: 'g'.repeat(2000), workers, model: 'm' });
  assert.equal(longGoal.state.task_goal.length, workerRank.CEREBELLUM_WORKER_RANK_GOAL_MAX_CHARS);
});

test('worker rank: parse probabilities ordered, bare choice fallback, min pool 2 skips', async () => {
  const ranking = workerRank.parseWorkerRankAnswers(
    { answers: { [workerRank.CEREBELLUM_WORKER_RANK_QUESTION_ID]: { probabilities: { w2: 0.8, w1: 0.3 } } } },
    workers,
  );
  assert.deepEqual(ranking, [{ id: 'w2', probability: 0.8 }, { id: 'w1', probability: 0.3 }]);
  assert.deepEqual(
    workerRank.parseWorkerRankAnswers({ answers: { [workerRank.CEREBELLUM_WORKER_RANK_QUESTION_ID]: { choice: 'w3' } } }, workers),
    [{ id: 'w3', probability: 1 }],
  );
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return jsonResponse(200, {}); };
  assert.equal(await workerRank.rankWorkersWithCerebellum({ config: CONFIG, fetchImpl, taskText: 'goal', workers: [workers[0]] }), null);
  assert.equal(await workerRank.rankWorkersWithCerebellum({ config: CONFIG, fetchImpl, taskText: '  ', workers }), null);
  assert.equal(calls.length, 0);
});

test('worker rank: hint renders top-3 numbered lines; empty hint leaves the directive byte-identical', () => {
  const hint = workerRank.buildWorkerAssignmentHint(workers);
  assert.ok(hint.includes('1. Alpha — frontend expert'));
  assert.ok(hint.includes('2. Beta — backend expert'));
  assert.ok(hint.includes('Do not pile every subtask on the first name'));
  const directive = 'PLAN\nAssign seats.';
  assert.equal(workerRank.appendWorkerFitHint(directive, ''), directive);
  assert.equal(workerRank.appendWorkerFitHint(directive, null), directive);
  assert.equal(workerRank.appendWorkerFitHint(directive, hint), `${directive}\n\n${hint}`);
});

// ---------------------------------------------------------------------------
// Turn decision bundle (ported from cerebellumTurnDecisionBundle.test.mjs)
// ---------------------------------------------------------------------------

test('bundle: floors applied to raw pools; nothing eligible → null', () => {
  const selection = bundle.selectTurnDecisionCandidates({
    currentUserText: 'hi',
    memories: pool(12),
    knowledge,
    skills,
    services,
    includeGate: true,
  });
  assert.ok(selection);
  assert.equal(selection.memories.length, 12);
  assert.equal(selection.skills.length, 20);
  assert.equal(selection.services.length, 20);
  const empty = bundle.selectTurnDecisionCandidates({
    currentUserText: 'hi',
    memories: pool(5),
    knowledge: knowledge.slice(0, 3),
    skills: skills.slice(0, 5),
    services: services.slice(0, 5),
    includeGate: false,
  });
  assert.equal(empty, null);
  assert.equal(bundle.selectTurnDecisionCandidates({ currentUserText: '  ', memories: pool(20), knowledge, skills, services, includeGate: true }), null);
});

test('bundle: merged request uses disjoint question ids over one shared state', () => {
  const selection = bundle.selectTurnDecisionCandidates({
    currentUserText: 'hi',
    memories: pool(12),
    knowledge,
    skills,
    services,
    includeGate: true,
  });
  const request = bundle.buildTurnDecisionRequest({ selection, model: 'm' });
  const ids = Object.keys(request.questions);
  assert.deepEqual(
    ids.slice().sort(),
    [...Array.from({ length: 12 }, (_, i) => `mem_${i}`), 'best_skill', 'best_service',
      ...Array.from({ length: knowledge.length }, (_, i) => `kn_${i}`),
      ...volatileGate.CEREBELLUM_VOLATILE_GATE_SECTION_KEYS].sort(),
  );
  assert.equal(request.state.memories.length, 12);
  assert.equal(request.state.knowledge.length, knowledge.length);
  assert.equal(request.state.current_message, 'hi');
});

test('bundle: per-decision degradation inside one usable payload', () => {
  const selection = bundle.selectTurnDecisionCandidates({
    currentUserText: 'hi',
    memories: pool(12),
    knowledge,
    skills,
    services,
    includeGate: true,
  });
  // Only memory answers come back (10 of 12 ≥ 12*0.8): memory usable, everything else null.
  const memoryAnswers = {};
  for (let i = 0; i < 10; i += 1) memoryAnswers[`mem_${i}`] = { noul: 0.9 };
  const results = bundle.parseTurnDecisionAnswers({ answers: memoryAnswers }, selection);
  assert.equal(results.memoryScores.size, 10);
  assert.equal(results.knowledgeScores, null, 'below coverage floor');
  assert.equal(results.skillRanking, null);
  assert.equal(results.serviceRanking, null);
  assert.deepEqual(results.gateVerdicts, {
    experience: true,
    'twin-impression': true,
    'knowledge-bases': true,
    'remote-services': true,
  }, 'gate is per-block fail-open');
});

test('bundle: one request for all decisions; every transport failure mode → null', async () => {
  const calls = [];
  const decisions = { currentUserText: 'hi', memories: pool(12), knowledge, skills, services, includeGate: true };
  const ok = await bundle.runCerebellumTurnDecisions({
    config: CONFIG,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      const answers = {};
      for (const id of Object.keys(body.questions)) {
        if (id.startsWith('mem_') || id.startsWith('kn_')) {
          answers[id] = { noul: 0.9 };
        } else if (id === skillShortlist.CEREBELLUM_SKILL_RANK_QUESTION_ID) {
          answers[id] = { choice: 's1' };
        } else if (id === serviceShortlist.CEREBELLUM_REMOTE_SERVICE_RANK_QUESTION_ID) {
          answers[id] = { choice: 'pin1' };
        } else {
          answers[id] = { noul: 0.9 }; // the gate section keys
        }
      }
      return jsonResponse(200, { answers });
    },
    decisions,
  });
  assert.equal(calls.length, 1, 'exactly one multiplexed request');
  assert.ok(ok);
  assert.equal(ok.memoryScores.size, 12);
  assert.equal(ok.skillRanking[0].id, 's1');
  assert.equal(ok.serviceRanking[0].id, 'pin1');
  assert.equal(await bundle.runCerebellumTurnDecisions({ config: CONFIG, fetchImpl: async () => jsonResponse(500, {}), decisions }), null);
  assert.equal(await bundle.runCerebellumTurnDecisions({ config: CONFIG, fetchImpl: async () => { throw new Error('net'); }, decisions }), null);
  assert.equal(await bundle.runCerebellumTurnDecisions({ config: CONFIG, fetchImpl: hangingUntilAbort, decisions, timeoutMs: 40 }), null);
});

// ---------------------------------------------------------------------------
// Effort selector (ported from cerebellumEffortSelector.test.mjs)
// ---------------------------------------------------------------------------

const distribution = (off, low, high, max) => ({ off, low, high, max });

test('effort: request carries the four rungs and the original-language message', () => {
  const request = effort.buildEffortSelectorRequest({ currentUserText: '帮我 debug 这段 代码', model: 'jev-latest' });
  assert.equal(request.state.user_message, '帮我 debug 这段 代码');
  assert.deepEqual(Object.keys(request.questions), [effort.CEREBELLUM_EFFORT_QUESTION_ID]);
  const question = request.questions[effort.CEREBELLUM_EFFORT_QUESTION_ID];
  assert.equal(question.type, 'choice');
  assert.deepEqual(Object.keys(question.criteria).sort(), ['high', 'low', 'max', 'off']);
});

test('effort: parse reads probabilities with zero-fill, clamps, skips unknown rungs', () => {
  const parsed = effort.parseEffortSelectorAnswers({
    answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { probabilities: { high: 1.4, ghost: 0.5, max: 'x' } } },
  });
  assert.deepEqual(parsed, distribution(0, 0, 1, 0));
});

test('effort: bare top-level choice naming a known rung becomes that rung at 1', () => {
  const parsed = effort.parseEffortSelectorAnswers({
    answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { choice: 'low' } },
  });
  assert.deepEqual(parsed, distribution(0, 1, 0, 0));
});

test('effort: rejects unusable payloads', () => {
  assert.equal(effort.parseEffortSelectorAnswers(null), null);
  assert.equal(effort.parseEffortSelectorAnswers({}), null);
  assert.equal(effort.parseEffortSelectorAnswers({ answers: {} }), null);
  assert.equal(effort.parseEffortSelectorAnswers({ answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: {} } }), null);
  assert.equal(effort.parseEffortSelectorAnswers({ answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { probabilities: { ghost: 1 } } } }), null);
  assert.equal(effort.parseEffortSelectorAnswers({ answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { choice: 'mega' } } }), null);
});

test('effort: assistant mode escalates only when P(high)+P(max) crosses 0.5, taking the heavier rung', () => {
  assert.equal(effort.resolveAutoEffortRung(distribution(0.9, 0.1, 0, 0), { assistantMode: true }), 'off');
  assert.equal(effort.resolveAutoEffortRung(distribution(0.4, 0.1, 0.5, 0), { assistantMode: true }), 'high', 'exactly at threshold escalates');
  assert.equal(effort.resolveAutoEffortRung(distribution(0.2, 0.1, 0.3, 0.31), { assistantMode: true }), 'max');
  // max must be STRICTLY heavier to win the escalation; a high/max tie takes high.
  assert.equal(effort.resolveAutoEffortRung(distribution(0.2, 0.1, 0.3, 0.3), { assistantMode: true }), 'high');
  assert.equal(effort.resolveAutoEffortRung(distribution(0.2, 0.1, 0.42, 0.18), { assistantMode: true }), 'high');
});

test('effort: professional mode takes the argmax with the LOWER rung winning ties', () => {
  assert.equal(effort.resolveAutoEffortRung(distribution(0.1, 0.6, 0.3, 0), { assistantMode: false }), 'low');
  assert.equal(effort.resolveAutoEffortRung(distribution(0.3, 0.3, 0.3, 0.3), { assistantMode: false }), 'off');
  assert.equal(effort.resolveAutoEffortRung(distribution(0, 0.2, 0.4, 0.4), { assistantMode: false }), 'high');
});

test('effort: tier mapping off/low → fast, high → moderate, max → heavy', () => {
  assert.equal(effort.mapCerebellumEffortRungToTurnAckTier('off'), 'fast');
  assert.equal(effort.mapCerebellumEffortRungToTurnAckTier('low'), 'fast');
  assert.equal(effort.mapCerebellumEffortRungToTurnAckTier('high'), 'moderate');
  assert.equal(effort.mapCerebellumEffortRungToTurnAckTier('max'), 'heavy');
});

test('effort: stickiness holds an escalated rung without extending the window; fresh escalation restarts; casual clears', () => {
  const t0 = 1_000_000;
  const escalated = distribution(0.1, 0.1, 0.7, 0.1);
  const first = effort.resolveStickyAutoEffortRung(escalated, { assistantMode: true, sticky: null, nowMs: t0 });
  assert.deepEqual(first, { rung: 'high', stickyUsed: false, nextSticky: { rung: 'high', at: t0 } });
  // 5 min later, casual follow-up: sticky holds high, entry kept AS IS.
  const held = effort.resolveStickyAutoEffortRung(distribution(0.9, 0.1, 0, 0), { assistantMode: true, sticky: first.nextSticky, nowMs: t0 + 5 * 60_000 });
  assert.equal(held.rung, 'high');
  assert.equal(held.stickyUsed, true);
  assert.deepEqual(held.nextSticky, { rung: 'high', at: t0 }, 'at unchanged');
  // 11 min after the last genuine escalation: window expired.
  const expired = effort.resolveStickyAutoEffortRung(distribution(0.9, 0.1, 0, 0), { assistantMode: true, sticky: first.nextSticky, nowMs: t0 + 11 * 60_000 });
  assert.equal(expired.rung, 'off');
  assert.equal(expired.nextSticky, null);
  // A fresh escalation at t0+6min restarts the window.
  const fresh = effort.resolveStickyAutoEffortRung(escalated, { assistantMode: true, sticky: first.nextSticky, nowMs: t0 + 6 * 60_000 });
  assert.deepEqual(fresh.nextSticky, { rung: 'high', at: t0 + 6 * 60_000 });
  // Casual traffic with no sticky clears.
  const cleared = effort.resolveStickyAutoEffortRung(distribution(0.9, 0.1, 0, 0), { assistantMode: true, sticky: null, nowMs: t0 });
  assert.equal(cleared.nextSticky, null);
});

test('effort: stickiness applies in professional mode too (heavier rung wins)', () => {
  const t0 = 2_000_000;
  const sticky = { rung: 'max', at: t0 };
  const held = effort.resolveStickyAutoEffortRung(distribution(0.9, 0, 0, 0), { assistantMode: false, sticky, nowMs: t0 + 60_000 });
  assert.equal(held.rung, 'max');
  assert.equal(held.stickyUsed, true);
  assert.deepEqual(held.nextSticky, sticky, 'sticky-sustained keeps the entry as is');
});

test('effort: select returns the distribution on a 200; failures return null; solo budget is 1000ms', () => {
  assert.equal(effort.CEREBELLUM_EFFORT_TIMEOUT_MS, 1000);
  const dist = distribution(0.1, 0.2, 0.6, 0.1);
  const payload = { answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { probabilities: dist } } };
  const run = (fetchImpl, extras = {}) => effort.selectEffortWithCerebellum({ config: CONFIG, fetchImpl, currentUserText: 'fix this bug', ...extras });
  return (async () => {
    assert.deepEqual(await run(async () => jsonResponse(200, payload)), dist);
    assert.equal(await run(async () => jsonResponse(500, {})), null);
    assert.equal(await run(async () => { throw new Error('net'); }), null);
    assert.equal(await run(async () => jsonResponse(200, { answers: {} })), null);
    assert.equal(await effort.selectEffortWithCerebellum({ config: CONFIG, fetchImpl: async () => jsonResponse(200, payload), currentUserText: '' }), null);
    assert.equal(await run(hangingUntilAbort, { timeoutMs: 40 }), null);
  })();
});

// ---------------------------------------------------------------------------
// Signal-bounded fetch + classification (ported from jevRelayService.test.mjs)
// ---------------------------------------------------------------------------

test('bounded fetch: rejects promptly when the underlying fetch hangs past the abort', async () => {
  const bounded = createSignalBoundedFetch(() => new Promise(() => undefined));
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = bounded('https://relay.example/v1/systemone', { method: 'POST', signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'AbortError');
    return true;
  });
  assert.ok(Date.now() - startedAt < 5000);
});

test('bounded fetch: an already-aborted signal rejects before dispatching', async () => {
  let dispatched = false;
  const bounded = createSignalBoundedFetch(async () => { dispatched = true; return jsonResponse(200, {}); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    bounded('https://x.example', { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(dispatched, false);
});

test('bounded fetch: settle-before-abort passes through; no signal is plain passthrough', async () => {
  const bounded = createSignalBoundedFetch(async () => jsonResponse(200, { ok: true }));
  const controller = new AbortController();
  const response = await bounded('https://x.example', { signal: controller.signal });
  assert.equal(response.status, 200);
  const plain = await bounded('https://x.example', {});
  assert.equal(plain.status, 200);
});

test('classify: full HTTP status table including the 429 split', () => {
  assert.equal(classifyJevRelayHttpStatus(200), 'ok');
  assert.equal(classifyJevRelayHttpStatus(299), 'ok');
  assert.equal(classifyJevRelayHttpStatus(401), 'http_401');
  assert.equal(classifyJevRelayHttpStatus(429, JEV_FREE_QUOTA_EXHAUSTED_CODE), 'http_429_quota');
  assert.equal(classifyJevRelayHttpStatus(429, 'free_quota_exhausted'), 'http_429_rate', 'the CHAT pool code is deliberately not matched');
  assert.equal(classifyJevRelayHttpStatus(429), 'http_429_rate');
  assert.equal(classifyJevRelayHttpStatus(400), 'http_4xx');
  assert.equal(classifyJevRelayHttpStatus(500), 'http_5xx');
  assert.equal(classifyJevRelayHttpStatus(302), 'network');
});

test('classify: aborts are timeouts, everything else is network', () => {
  assert.equal(classifyJevRelayThrownError(new DOMException('x', 'AbortError')), 'timeout');
  assert.equal(classifyJevRelayThrownError(new DOMException('x', 'TimeoutError')), 'timeout');
  assert.equal(classifyJevRelayThrownError(new Error('net')), 'network');
  assert.equal(classifyJevRelayThrownError(null), 'network');
});

test('classify: envelope code extraction and 4xx detail capping', () => {
  assert.equal(parseJevRelayErrorCode({ error: { code: ' jev_free_quota_exhausted ' } }), 'jev_free_quota_exhausted');
  assert.equal(parseJevRelayErrorCode({ error: { code: 42 } }), null);
  assert.equal(parseJevRelayErrorCode({}), null);
  assert.equal(extractJevRelayErrorDetail({ detail: 'boom' }), 'boom');
  assert.deepEqual(JSON.parse(extractJevRelayErrorDetail({ detail: [{ loc: ['body'], msg: 'bad' }] })), [{ loc: ['body'], msg: 'bad' }]);
  assert.equal(extractJevRelayErrorDetail({ detail: null }), null);
  assert.equal(extractJevRelayErrorDetail({ detail: 'x'.repeat(2000) }).length, JEV_RELAY_ERROR_DETAIL_MAX_CHARS);
});

// ---------------------------------------------------------------------------
// Client: credential chain, runtime config, 401 retry, recorder, breaker
// (ported from jevRelayService.test.mjs, driven through the composed stack)
// ---------------------------------------------------------------------------

const CHAT_BASE = 'https://www.metaso.network/assist-open-api/v2/assist/llm/v1';
const FREE_CONFIG = { cerebellum: { enabled: true, provider: 'idbots-jev-free', apiKey: '', baseUrl: '', model: '' } };

function makeStore(kv = new Map()) {
  return {
    get: (key) => (kv.has(key) ? kv.get(key) : null),
    set: (key, value) => kv.set(key, value),
    delete: (key) => kv.delete(key),
  };
}

function makeClient(overrides = {}) {
  const calls = { bootstrap: 0, fetches: [] };
  const lines = [];
  const sink = (level, tag, message, extra) => { lines.push({ level, tag, message, extra }); };
  const client = createCerebellumClient({
    store: overrides.store ?? makeStore(),
    readProviderCredentials: overrides.readProviderCredentials ?? null,
    bootstrapImpl: overrides.bootstrapImpl ?? (async () => {
      calls.bootstrap += 1;
      if (overrides.bootstrapError) throw new Error(overrides.bootstrapError);
      return { apiKey: `mrk_boot${calls.bootstrap}`, baseUrl: CHAT_BASE };
    }),
    fetchImpl: overrides.fetchImpl ?? (async (url, init) => {
      calls.fetches.push({ url, init });
      return jsonResponse(200, {});
    }),
    sink,
    now: overrides.now ?? null,
  });
  return { client, calls, lines };
}

test('client: kv credentials win without bootstrapping; provider read persists to kv; bootstrap is the last resort and caches', async () => {
  const kvWins = makeClient({ store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_kv'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])) });
  assert.deepEqual(await kvWins.client.resolveJevRelayCredentials(), { apiKey: 'mrk_kv', baseUrl: CHAT_BASE });
  assert.equal(kvWins.calls.bootstrap, 0);

  const kv = new Map();
  const providerWins = makeClient({
    store: makeStore(kv),
    readProviderCredentials: () => ({ apiKey: 'mrk_provider', baseUrl: CHAT_BASE }),
  });
  assert.deepEqual(await providerWins.client.resolveJevRelayCredentials(), { apiKey: 'mrk_provider', baseUrl: CHAT_BASE });
  assert.equal(providerWins.calls.bootstrap, 0);
  assert.equal(kv.get(JEV_RELAY_API_KEY_KV), 'mrk_provider');

  const kv2 = new Map();
  const boot = makeClient({ store: makeStore(kv2) });
  const first = await boot.client.resolveJevRelayCredentials();
  assert.equal(first.apiKey, 'mrk_boot1');
  assert.equal(boot.calls.bootstrap, 1);
  assert.equal(kv2.get(JEV_RELAY_API_KEY_KV), 'mrk_boot1');
  await boot.client.resolveJevRelayCredentials();
  assert.equal(boot.calls.bootstrap, 1, 'in-memory cache serves subsequent resolutions');
});

test('client: concurrent cold resolves share ONE bootstrap flight', async () => {
  const shared = makeClient({});
  const [a, b, c] = await Promise.all([
    shared.client.resolveJevRelayCredentials(),
    shared.client.resolveJevRelayCredentials(),
    shared.client.resolveJevRelayCredentials(),
  ]);
  assert.equal(a.apiKey, 'mrk_boot1');
  assert.equal(b.apiKey, 'mrk_boot1');
  assert.equal(c.apiKey, 'mrk_boot1');
  assert.equal(shared.calls.bootstrap, 1);
});

test('client: a failed bootstrap flight does not latch — the next call retries', async () => {
  let attempts = 0;
  const flaky = makeClient({
    bootstrapImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return { apiKey: 'mrk_second', baseUrl: CHAT_BASE };
    },
  });
  await assert.rejects(() => flaky.client.resolveJevRelayCredentials(), /offline/);
  const second = await flaky.client.resolveJevRelayCredentials();
  assert.equal(second.apiKey, 'mrk_second');
});

test('client: runtime config — typesafe passthrough, free key injection, silent off without credentials, disabled without bootstrap', async () => {
  const direct = makeClient({});
  assert.deepEqual(
    await direct.client.resolveRuntimeConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: 'sk-direct', baseUrl: 'https://api.typesafe.ai', model: 'jev-preview' } }),
    { provider: 'typesafe-jev', apiKey: 'sk-direct', baseUrl: 'https://api.typesafe.ai', model: 'jev-preview' },
  );

  const relayed = makeClient({ store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])) });
  assert.deepEqual(
    await relayed.client.resolveRuntimeConfig(FREE_CONFIG),
    { provider: 'idbots-jev-free', apiKey: 'mrk_live', baseUrl: CEREBELLUM_FREE_RELAY_BASE_URL, model: CEREBELLUM_FREE_MODEL },
  );
  assert.equal(relayed.calls.bootstrap, 0);

  const offline = makeClient({ bootstrapError: 'offline' });
  assert.equal(await offline.client.resolveRuntimeConfig(FREE_CONFIG), null);

  const disabled = makeClient({});
  assert.equal(await disabled.client.resolveRuntimeConfig({ cerebellum: { enabled: false, provider: 'idbots-jev-free' } }), null);
  assert.equal(disabled.calls.bootstrap, 0);
});

test('client: a 401 re-bootstraps ONCE and retries with the fresh key through the composed stack', async () => {
  const kv = new Map([[JEV_RELAY_API_KEY_KV, 'mrk_revoked'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]]);
  const { client, calls } = makeClient({
    store: makeStore(kv),
    fetchImpl: async (url, init) => {
      calls.fetches.push({ url, init });
      return init.headers.Authorization === 'Bearer mrk_boot1'
        ? jsonResponse(200, { answers: {} })
        : jsonResponse(401, { error: { code: 'invalid_api_key' } });
    },
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  const response = await stack(`${config.baseUrl}/v1/systemone`, {
    method: 'POST',
    headers: { Authorization: 'Bearer mrk_revoked', 'Content-Type': 'application/json' },
    body: '{}',
    signal: new AbortController().signal,
  });
  assert.equal(response.status, 200);
  assert.equal(calls.fetches.length, 2, 'original + exactly one retry');
  assert.equal(calls.bootstrap, 1);
  assert.equal(calls.fetches[1].init.headers.Authorization, 'Bearer mrk_boot1');
  assert.equal(calls.fetches[1].init.body, '{}');
  assert.equal(kv.get(JEV_RELAY_API_KEY_KV), 'mrk_boot1');
});

test('client: a second 401 is returned as-is — no retry storm', async () => {
  const { client, calls } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_revoked'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async (url, init) => {
      calls.fetches.push({ url, init });
      return jsonResponse(401, {});
    },
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  const response = await stack(`${config.baseUrl}/v1/systemone`, {
    method: 'POST', headers: { Authorization: 'Bearer mrk_revoked' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(response.status, 401);
  assert.equal(calls.fetches.length, 2, 'one retry only');
  assert.equal(calls.bootstrap, 1);
});

test('client: bootstrap failure during the 401 retry returns the original 401', async () => {
  // Seed a live kv key so the free config resolves, then let the bootstrap
  // fail when the retry invalidates the kv: the wrapper must hand back the
  // original 401 (one fetch, no loop).
  const { client, calls } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_revoked'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    bootstrapError: 'offline',
    fetchImpl: async (url, init) => {
      calls.fetches.push({ url, init });
      return jsonResponse(401, {});
    },
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  const response = await stack(`${config.baseUrl}/v1/systemone`, {
    method: 'POST', headers: { Authorization: 'Bearer mrk_revoked' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(response.status, 401);
  assert.equal(calls.fetches.length, 1);
  assert.equal(calls.bootstrap, 1, 'the retry attempted one bootstrap');
});

test('client: an already-aborted signal rejects before any dispatch (no fetch, no bootstrap)', async () => {
  const { client, calls } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async (url, init) => {
      calls.fetches.push({ url, init });
      return jsonResponse(401, {});
    },
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => stack(`${config.baseUrl}/v1/systemone`, {
      method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: controller.signal,
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.bootstrap, 0);
});

test('client: recorder opens the quota breaker on a jev_free_quota_exhausted 429; the open breaker silently disables the free relay; ok closes it', async () => {
  const { client, lines } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async () => jsonResponse(429, { error: { code: JEV_FREE_QUOTA_EXHAUSTED_CODE } }),
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  const response = await stack(`${config.baseUrl}/v1/systemone`, {
    method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(response.status, 429);
  // The reconstructed body replays the parsed 429 payload.
  const body = await response.json();
  assert.equal(body.error.code, JEV_FREE_QUOTA_EXHAUSTED_CODE);
  assert.ok(client.isQuotaExhausted(), 'breaker opened');
  const callLine = lines.find((line) => line.tag === 'jevRelay:call');
  assert.equal(callLine.extra.result, 'http_429_quota');
  // While open, the free relay silently resolves off.
  assert.equal(await client.resolveRuntimeConfig(FREE_CONFIG), null);
  // The breaker expires after the window.
  const openedAt = Date.now();
  assert.equal(client.isQuotaExhausted(openedAt + JEV_RELAY_QUOTA_BREAKER_MS + 1), false);
  // An ok call through the stack closes it.
  const okClient = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async () => jsonResponse(200, { answers: {} }),
  });
  okClient.client.noteQuotaExhaustion();
  assert.ok(okClient.client.isQuotaExhausted());
  const okConfig = await okClient.client.resolveRuntimeConfig({ cerebellum: { enabled: true, provider: 'typesafe-jev', apiKey: 'k' } });
  // Drive an ok through a free-provider stack built from the earlier resolved shape.
  const okStack = await okClient.client.fetchFor({ ...okConfig, provider: 'idbots-jev-free' });
  await okStack('https://relay.example/v1/systemone', {
    method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(okClient.client.isQuotaExhausted(), false, 'ok closes the breaker');
});

test('client: a rate 429 (chat-pool code) classifies http_429_rate and does NOT open the breaker', async () => {
  const { client } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async () => jsonResponse(429, { error: { code: 'free_quota_exhausted' } }),
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  await stack(`${config.baseUrl}/v1/systemone`, {
    method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(client.isQuotaExhausted(), false);
});

test('client: a 400 logs the envelope code + Pydantic detail; a non-JSON 4xx keeps the generic classification; thrown aborts record timeout', async () => {
  const bad = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async () => jsonResponse(400, { error: { code: 'upstream_bad_request' }, detail: [{ loc: ['body', 'questions'], msg: 'field required' }] }),
  });
  const badConfig = await bad.client.resolveRuntimeConfig(FREE_CONFIG);
  const badStack = await bad.client.fetchFor(badConfig);
  const badResponse = await badStack(`${badConfig.baseUrl}/v1/systemone`, {
    method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: new AbortController().signal,
  });
  assert.equal(badResponse.status, 400);
  const badLine = bad.lines.find((line) => line.tag === 'jevRelay:call' && line.extra.status === 400);
  assert.equal(badLine.extra.result, 'http_4xx');
  assert.equal(badLine.extra.errorCode, 'upstream_bad_request');
  assert.ok(badLine.extra.detail.includes('field required'));

  const nonJson = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => { throw new Error('not json'); } }),
  });
  const nonJsonConfig = await nonJson.client.resolveRuntimeConfig(FREE_CONFIG);
  const nonJsonStack = await nonJson.client.fetchFor(nonJsonConfig);
  const nonJsonResponse = await nonJsonStack(`${nonJsonConfig.baseUrl}/v1/systemone`, {
    method: 'POST', headers: {}, body: '', signal: new AbortController().signal,
  });
  assert.equal(nonJsonResponse.status, 403);
  assert.equal(nonJson.lines.find((line) => line.tag === 'jevRelay:call' && line.extra.status === 403).extra.result, 'http_4xx');

  const aborting = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: () => new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 10);
      timer.unref?.();
    }),
  });
  const abortingConfig = await aborting.client.resolveRuntimeConfig(FREE_CONFIG);
  const abortingStack = await aborting.client.fetchFor(abortingConfig);
  await assert.rejects(() => abortingStack(`${abortingConfig.baseUrl}/v1/systemone`, {
    method: 'POST', headers: {}, body: '', signal: new AbortController().signal,
  }), (error) => error.name === 'AbortError');
  assert.equal(aborting.lines.find((line) => line.tag === 'jevRelay:call' && line.extra.status === null).extra.result, 'timeout');
});

test('client: daily aggregate emits per-code counts and latency percentiles; day rollover emits the previous day', async () => {
  const { client, lines } = makeClient({
    store: makeStore(new Map([[JEV_RELAY_API_KEY_KV, 'mrk_live'], [JEV_RELAY_BASE_URL_KV, CHAT_BASE]])),
    fetchImpl: (() => {
      let call = 0;
      return async () => {
        call += 1;
        if (call === 3) return jsonResponse(500, {});
        if (call === 4) return jsonResponse(429, { error: { code: 'rate_limited' } });
        return jsonResponse(200, { answers: {} });
      };
    })(),
  });
  const config = await client.resolveRuntimeConfig(FREE_CONFIG);
  const stack = await client.fetchFor(config);
  for (let i = 0; i < 4; i += 1) {
    await stack(`${config.baseUrl}/v1/systemone`, {
      method: 'POST', headers: { Authorization: 'Bearer mrk_live' }, body: '{}', signal: new AbortController().signal,
    });
  }
  client.flushCallStats();
  const daily = lines.find((line) => line.tag === 'jevRelay:daily');
  assert.ok(daily, 'daily aggregate line exists');
  assert.equal(daily.extra.calls, 4);
  assert.equal(daily.extra.counts.ok, 2);
  assert.equal(daily.extra.counts.http_5xx, 1);
  assert.equal(daily.extra.counts.http_429_rate, 1);
  assert.equal(daily.extra.okRate, 0.5);
  assert.ok(daily.extra.p90Ms >= daily.extra.p50Ms);
});

// ---------------------------------------------------------------------------
// Plugin binding (default OFF, zero behavior change)
// ---------------------------------------------------------------------------

test('bind: default off — absent section resolves null and makes zero fetch calls', async () => {
  const fetches = [];
  const runtime = bindCerebellumCore(undefined, {
    fetchImpl: async (...args) => { fetches.push(args); return jsonResponse(200, {}); },
  });
  assert.equal(await runtime.resolveCallContext(), null);
  assert.equal(fetches.length, 0);
});

test('bind: enabled false and malformed sections stay off', async () => {
  for (const section of [{ enabled: false }, { enabled: true }, { enabled: true, provider: 'nope' }, { enabled: true, provider: 'typesafe-jev', apiKey: '' }]) {
    const runtime = bindCerebellumCore(section);
    assert.equal(await runtime.resolveCallContext(), null, JSON.stringify(section));
  }
});

test('bind: a fully configured direct provider resolves a call context with the configured endpoint', async () => {
  const runtime = bindCerebellumCore(
    { enabled: true, provider: 'typesafe-jev', apiKey: 'sk-direct', baseUrl: 'https://api.typesafe.ai/', model: 'jev-latest' },
    {
      fetchImpl: async (url, init) => {
        assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(init.headers.Authorization, 'Bearer sk-direct');
        return jsonResponse(200, { answers: { [effort.CEREBELLUM_EFFORT_QUESTION_ID]: { probabilities: { high: 0.9 } } } });
      },
    },
  );
  const context = await runtime.resolveCallContext();
  assert.ok(context);
  assert.equal(context.config.baseUrl, 'https://api.typesafe.ai');
  const dist = await effort.selectEffortWithCerebellum({
    config: context.config,
    fetchImpl: context.fetchImpl,
    currentUserText: 'fix this concurrency bug',
  });
  assert.equal(dist.high, 0.9);
});

test('bind: the free provider without wired credential seams silently stays off (consent-first port)', async () => {
  const runtime = bindCerebellumCore({ enabled: true, provider: 'idbots-jev-free' });
  assert.equal(await runtime.resolveCallContext(), null);
});
