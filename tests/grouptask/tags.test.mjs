import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideGroupTaskResponders,
  isEnforceableDependencyToken,
  isHostNotice,
  isMentioned,
  isNoReplyResponse,
  parseDeliverableCandidates,
  parseGroupTaskTags,
  parseWorkingAck,
} from '../../dist/core/grouptask/tags.js';

const PIN_A = `${'a'.repeat(64)}i0`;
const TXID_B = 'b'.repeat(64);

test('parseDeliverableCandidates: strict URIs, text fallback, fabrication guard', () => {
  const content = [
    `[DELIVERABLE] metafile://${PIN_A} final report`,
    '[DELIVERABLE] https://example.com/result',
    `[DELIVERABLE] ${PIN_A}`,
    '[DELIVERABLE] research summary: three key findings',
    '[DELIVERABLE] metafile://abc123 fabricated id',
    '[DELIVERABLE] metaapp://…placeholder',
    'no tag on this line',
  ].join('\n');
  const rows = parseDeliverableCandidates(content);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    kind: 'metafile',
    uri: `metafile://${PIN_A}`,
    payload: `metafile://${PIN_A} final report`,
    correction: false,
  });
  assert.equal(rows[1].kind, 'link');
  assert.equal(rows[1].uri, 'https://example.com/result');
  assert.equal(rows[2].kind, 'pin');
  assert.equal(rows[2].uri, PIN_A);
  assert.equal(rows[3].kind, 'text');
  assert.equal(rows[3].uri, null);
});

test('parseDeliverableCandidates: multiple tags on one line and corrections', () => {
  const rows = parseDeliverableCandidates(
    `更正 [DELIVERABLE] metafile://${PIN_A} v2 [DELIVERABLE] https://example.com/x`,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.correction === true));
  assert.equal(rows[0].kind, 'metafile');
  assert.equal(rows[1].kind, 'link');
});

test('parseWorkingAck: note capping and ETA in zh/en', () => {
  assert.deepEqual(parseWorkingAck('[WORKING] 正在整理数据，预计 30 分钟'), {
    note: '正在整理数据，预计 30 分钟',
    etaMinutes: 30,
  });
  assert.equal(parseWorkingAck('[WORKING] crunching, done in 45 min').etaMinutes, 45);
  assert.equal(parseWorkingAck('[WORKING]').note, '');
  assert.equal(parseWorkingAck('[WORKING]').etaMinutes, null);
  assert.equal(parseWorkingAck('no tag'), null);
  assert.equal(parseWorkingAck(`[WORKING] ${'x'.repeat(200)}`).note.length, 120);
});

test('parseGroupTaskTags: full grammar in one message', () => {
  const parsed = parseGroupTaskTags([
    '[STATUS:REVIEW] wrapping up.',
    '[PLAN_CHANGE: indexer A down -> switched to indexer B]',
    '[PLAN_CHANGE: indexer A down -> switched to indexer B]',
    `[DEPENDS_ON: ${PIN_A}]`,
    '[DELIVERABLE] https://example.com/final',
  ].join('\n'));
  assert.equal(parsed.status, 'review');
  assert.deepEqual(parsed.planChanges, ['indexer A down -> switched to indexer B']);
  assert.equal(parsed.dependsOn, PIN_A);
  assert.equal(parsed.deliverables.length, 1);
  assert.equal(parsed.checkpointTopic, null);
  assert.equal(parsed.checkpointResolved, false);
});

test('parseGroupTaskTags: status tags only count at protocol positions; the last one wins', () => {
  // The exact live-incident shape (2026-09-05 task 42): a prose mention of
  // [STATUS:REVIEW] before the real final-line tag must not flip to review.
  const proseMention = parseGroupTaskTags([
    '分工如下，完成后我会汇总 [STATUS:REVIEW] 给 owner；',
    '现在开始执行。',
    '[STATUS:EXECUTING]',
  ].join('\n'));
  assert.equal(proseMention.status, 'executing');

  const proseOnly = parseGroupTaskTags('稍后我会汇总 [STATUS:REVIEW]；上链留 owner 拍板。');
  assert.equal(proseOnly.status, null, 'a mid-line mention with no real tag transitions nothing');

  const trailing = parseGroupTaskTags('All acceptance criteria met. [STATUS:REVIEW]');
  assert.equal(trailing.status, 'review', 'a tag ending the final line is honored');

  const lineStart = parseGroupTaskTags('[STATUS:REVIEW] wrapping up.');
  assert.equal(lineStart.status, 'review');

  const lastWins = parseGroupTaskTags([
    '[STATUS:EXECUTING]',
    '…work done…',
    '[STATUS:REVIEW]',
  ].join('\n'));
  assert.equal(lastWins.status, 'review');
});

test('parseGroupTaskTags: checkpoint open vs resolved are distinct', () => {
  const open = parseGroupTaskTags('[CHECKPOINT: budget approval needed]');
  assert.equal(open.checkpointTopic, 'budget approval needed');
  assert.equal(open.checkpointResolved, false);

  const resolved = parseGroupTaskTags('[CHECKPOINT_RESOLVED: owner picked plan B]');
  assert.equal(resolved.checkpointTopic, null);
  assert.equal(resolved.checkpointResolved, true);
  assert.equal(resolved.checkpointDecision, 'owner picked plan B');

  const bare = parseGroupTaskTags('[CHECKPOINT_RESOLVED]');
  assert.equal(bare.checkpointResolved, true);
  assert.equal(bare.checkpointDecision, null);
});

test('isNoReplyResponse: only line-start counts', () => {
  assert.equal(isNoReplyResponse('[NO_REPLY]'), true);
  assert.equal(isNoReplyResponse('  [no_reply] nothing to add'), true);
  assert.equal(isNoReplyResponse('I said [NO_REPLY] mid-sentence'), false);
});

test('dependency tokens: pin/txid enforceable, free text advisory', () => {
  assert.equal(isEnforceableDependencyToken(PIN_A), true);
  assert.equal(isEnforceableDependencyToken(TXID_B), true);
  assert.equal(isEnforceableDependencyToken('the market research step'), false);
});

test('host notices are recognized', () => {
  assert.equal(isHostNotice('[GROUP_TASK_NOTICE:welcome] hello'), true);
  assert.equal(isHostNotice('regular message'), false);
});

test('isMentioned: mention array by id and explicit @name with boundaries', () => {
  const target = { name: 'DataBot', globalMetaId: 'GMID-1', metaId: 'legacy-1' };
  assert.equal(isMentioned({ content: '', mention: ['gmid-1'] }, target), true);
  assert.equal(isMentioned({ content: '', mention: ['LEGACY-1'] }, target), true);
  assert.equal(isMentioned({ content: '@DataBot please run it', mention: [] }, target), true);
  assert.equal(isMentioned({ content: '@DataBotX is someone else', mention: [] }, target), false);
  assert.equal(isMentioned({ content: 'DataBot without at-sign', mention: [] }, target), false);
});

const SEATS = [
  { slug: 'twin', role: 'chair', name: 'Twin', globalMetaId: 'gmid-chair' },
  { slug: 'alpha', role: 'worker', name: 'Alpha', globalMetaId: 'gmid-alpha' },
  { slug: 'beta', role: 'worker', name: 'Beta', globalMetaId: 'gmid-beta' },
];

function decide(overrides) {
  return decideGroupTaskResponders({
    message: { content: 'hello', mention: [], senderGlobalMetaId: 'gmid-owner', senderSuspect: false },
    taskStatus: 'executing',
    hasOpenCheckpoint: false,
    seats: SEATS,
    ownerGlobalMetaId: 'gmid-owner',
    ...overrides,
    ...(overrides.message
      ? { message: { content: 'hello', mention: [], senderGlobalMetaId: 'gmid-owner', senderSuspect: false, ...overrides.message } }
      : {}),
  });
}

test('decide: owner message goes to the chair', () => {
  assert.deepEqual(decide({}), [{ slug: 'twin', role: 'chair', reason: 'chair_owner_message' }]);
});

test('decide: mentioned worker replies; chair stays silent when someone specific was addressed', () => {
  const decisions = decide({
    message: { content: '@Alpha take this over', senderGlobalMetaId: 'gmid-beta' },
  });
  assert.deepEqual(decisions, [{ slug: 'alpha', role: 'worker', reason: 'worker_mentioned' }]);
});

test('decide: chair mention wins over owner reason', () => {
  const decisions = decide({ message: { content: '@Twin status?', mention: [] } });
  assert.deepEqual(decisions, [{ slug: 'twin', role: 'chair', reason: 'chair_mentioned' }]);
});

test('decide: worker deliverable pulls a chair verification turn', () => {
  const decisions = decide({
    message: { content: '[DELIVERABLE] https://example.com/x', senderGlobalMetaId: 'gmid-alpha' },
  });
  assert.deepEqual(decisions, [{ slug: 'twin', role: 'chair', reason: 'chair_deliverable' }]);
});

test('decide: unaddressed worker chatter gives the chair floor control', () => {
  const decisions = decide({
    message: { content: 'I think we should split the work', senderGlobalMetaId: 'gmid-alpha' },
  });
  assert.deepEqual(decisions, [{ slug: 'twin', role: 'chair', reason: 'chair_floor_control' }]);
});

test('decide: human gate silences workers and non-owner chair turns', () => {
  const mentionedInReview = decide({
    taskStatus: 'review',
    message: { content: '@Alpha please continue', senderGlobalMetaId: 'gmid-beta' },
  });
  assert.deepEqual(mentionedInReview, []);

  const ownerInReview = decide({ taskStatus: 'review' });
  assert.deepEqual(ownerInReview, [{ slug: 'twin', role: 'chair', reason: 'chair_owner_message' }]);

  const ownerWithCheckpoint = decide({ hasOpenCheckpoint: true });
  assert.deepEqual(ownerWithCheckpoint, [{ slug: 'twin', role: 'chair', reason: 'chair_owner_message' }]);
});

test('decide: skips self, suspects, terminal tasks, empty bodies, and host notices', () => {
  assert.deepEqual(decide({ message: { senderGlobalMetaId: 'gmid-chair' } }), []);
  assert.deepEqual(decide({ message: { senderSuspect: true } }), []);
  assert.deepEqual(decide({ taskStatus: 'done' }), []);
  assert.deepEqual(decide({ message: { content: '   ' } }), []);
  assert.deepEqual(decide({ message: { content: '[GROUP_TASK_NOTICE:welcome] hi' } }), []);
});
