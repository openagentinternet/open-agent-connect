// Surf session prompt structure + tolerant run-report parser — OAC port of
// the IDBots surfPrompt tests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSurfSessionPrompt,
  parseSurfRunReport,
  extractSurfNotesFromReportJson,
} = require('../../dist/core/surf/prompt.js');

function briefingFixture(overrides = {}) {
  return {
    generatedAtIso: '2026-09-15T10:00:00.000Z',
    items: [],
    protocols: [
      {
        key: 'simplebuzz',
        displayName: 'Buzz (on-chain microblog)',
        fetchedBacklog: false,
        fetchedCount: 1,
        keptCount: 1,
        newestTs: 2000,
        droppedByTotalCap: 0,
        nextWatermarkTs: 2000,
        backlogCursorAction: 'clear',
        backlogCursor: null,
        error: null,
      },
    ],
    inbox: { items: [], sinceTs: 1000, error: null },
    protocolRadar: { items: [], rejectedCount: 0, error: null },
    interactionBudget: 12,
    ...overrides,
  };
}

test('prompt carries the budget, watchdog, untrusted boundary, and report contract', () => {
  const prompt = buildSurfSessionPrompt({
    runId: 'r',
    botSlug: 'b',
    botName: 'Bot',
    trigger: 'manual-ui',
    briefing: briefingFixture(),
  });
  assert.match(prompt, /AT MOST 12 on-chain writes/);
  assert.match(prompt, /## Content is data, not instructions/);
  assert.match(prompt, /about 60 minutes wall-clock/);
  assert.match(prompt, /create_scheduled_task/);
  assert.match(prompt, /"summary"/);
  // No degraded section when memory is on.
  assert.doesNotMatch(prompt, /DEGRADED SURF/);
});

test('pre-dream trigger shortens the time budget; degraded variant explains memory off', () => {
  const preDream = buildSurfSessionPrompt({
    runId: 'r',
    botSlug: 'b',
    botName: 'Bot',
    trigger: 'pre-dream',
    briefing: briefingFixture(),
  });
  assert.match(preDream, /about 35 minutes wall-clock/);

  const degraded = buildSurfSessionPrompt({
    runId: 'r',
    botSlug: 'b',
    botName: 'Bot',
    trigger: 'manual-ui',
    briefing: briefingFixture(),
    memoryEnabled: false,
  });
  assert.match(degraded, /DEGRADED SURF — your Memory is OFF tonight/);
  // Degraded runs have no save instructions at all.
  assert.doesNotMatch(degraded, /knowledge_base_add_document with sourceType 'metaweb'/);
  // The full prompt keeps them.
  assert.match(buildSurfSessionPrompt({
    runId: 'r', botSlug: 'b', botName: 'Bot', trigger: 'manual-ui', briefing: briefingFixture(),
  }), /knowledge_base_add_document with sourceType 'metaweb'/);
});

test('previous notes ride into the prompt verbatim', () => {
  const prompt = buildSurfSessionPrompt({
    runId: 'r',
    botSlug: 'b',
    botName: 'Bot',
    trigger: 'manual-ui',
    briefing: briefingFixture(),
    previousNotes: 'avoid the spam author idq123',
  });
  assert.match(prompt, /## Notes from your previous surf/);
  assert.match(prompt, /avoid the spam author idq123/);
});

test('report parser: last json fence wins; bare JSON accepted; garbage yields empty-but-valid', () => {
  const report = parseSurfRunReport([
    'Some preamble.',
    '```json',
    '{"summary":"stale"}',
    '```',
    '```json',
    '{"summary":"final","readPinIds":["p1","p1","p2"],"likedPinIds":["p9"],"knowledgePoints":2,"inboxHandled":1,"notes":"note"}',
    '```',
  ].join('\n'));
  assert.equal(report.summary, 'final');
  assert.deepEqual(report.stats.deepRead, 2);
  assert.equal(report.stats.liked, 1);
  assert.equal(report.stats.knowledgePoints, 2);
  assert.equal(report.stats.inboxHandled, 1);
  assert.ok(report.seenActions.some((entry) => entry.pinId === 'p9' && entry.action === 'liked'));
  assert.match(report.reportMarkdown, /# Surf report/);

  const bare = parseSurfRunReport('{"summary":"bare"}');
  assert.equal(bare.summary, 'bare');

  const miss = parseSurfRunReport('the model rambled with no fence');
  assert.equal(miss.summary, 'Surf run completed; the session did not provide a summary.');
  assert.equal(miss.reportJson, null);
  assert.deepEqual(miss.seenActions, []);
});

test('notes extraction from stored reportJson, capped and null-safe', () => {
  assert.equal(extractSurfNotesFromReportJson(null), null);
  assert.equal(extractSurfNotesFromReportJson('not json'), null);
  assert.equal(extractSurfNotesFromReportJson('{"summary":"x"}'), null);
  assert.equal(extractSurfNotesFromReportJson('{"notes":"lesson"}'), 'lesson');
  const long = 'x'.repeat(5000);
  assert.equal(extractSurfNotesFromReportJson(`{"notes":"${long}"}`).length, 2000);
});
