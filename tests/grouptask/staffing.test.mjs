import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const staffing = require('../../dist/core/grouptask/staffing.js');
const {
  detectSkipConfirmInWish,
  classifyOwnerStaffingReply,
  pickTriggeringWishText,
  splitSessionMessagesForStaffingGate,
  resolveStaffingOwnerGate,
  buildStaffingSlateText,
  isStaffingProposalExpired,
  STAFFING_PROPOSAL_TTL_MS,
  normalizeStaffingPlan,
  validateStaffingPlan,
  assertCreateRosterCap,
  GroupTaskStaffingError,
} = staffing;

const plan = normalizeStaffingPlan({
  stages: [{ id: 's1', title: 'Draft', seatRole: 'content' }],
  seats: [
    { role: 'content', candidateName: 'Writer', candidateSlug: 'writer', source: 'local', reason: 'writes fast' },
    { role: 'design', candidateName: 'Pixel', candidateGlobalMetaId: 'idremote1', source: 'remote' },
  ],
});

test('skip-confirm does not match 开发 or interrogatives', () => {
  assert.equal(detectSkipConfirmInWish('能直接开发吗？'), false);
  assert.equal(detectSkipConfirmInWish('可以直接开会吗'), false);
  assert.equal(detectSkipConfirmInWish('开个群任务做技能介绍，不用确认直接开'), true);
  assert.equal(detectSkipConfirmInWish('just start without confirmation'), true);
});

test('不换人 is confirm; 换人 is revise', () => {
  assert.equal(classifyOwnerStaffingReply('好的，不换人'), 'confirm');
  assert.equal(classifyOwnerStaffingReply('不用换'), 'confirm');
  assert.equal(classifyOwnerStaffingReply('换人，用设计师'), 'revise');
  assert.equal(classifyOwnerStaffingReply('确认人选'), 'confirm');
});

test('bare English instead/drop are not automatic revise', () => {
  assert.equal(classifyOwnerStaffingReply('ok, use B instead of A'), 'unknown');
  assert.equal(classifyOwnerStaffingReply('looks good — use Pixel instead'), 'unknown');
  assert.equal(classifyOwnerStaffingReply('replace the designer'), 'revise');
  assert.equal(classifyOwnerStaffingReply('drop the seat'), 'revise');
});

test('a skip phrase after propose authorizes create without a new propose', () => {
  assert.deepEqual(
    resolveStaffingOwnerGate({
      triggeringWish: '帮我开个群任务做技能介绍',
      repliesAfterPropose: ['不用确认直接开'],
    }),
    { allowed: true, decision: 'skip_authorized' },
  );
  assert.deepEqual(
    resolveStaffingOwnerGate({
      triggeringWish: '帮我开个群任务做技能介绍',
      repliesAfterPropose: ['换人', '不用确认直接开'],
    }),
    { allowed: true, decision: 'skip_authorized' },
  );
});

test('last decisive owner reply wins: skip then 换人 is revise', () => {
  assert.deepEqual(
    resolveStaffingOwnerGate({
      triggeringWish: '帮我开个群任务做技能介绍',
      repliesAfterPropose: ['不用确认直接开', '换人'],
    }),
    { allowed: false, decision: 'owner_revise' },
  );
});

test('owner replies beat a skip wish, and skip is only the triggering wish', () => {
  const messages = [
    { type: 'user', content: '上次那个不用确认直接开', timestamp: 1 },
    { type: 'user', content: '这次开个群任务做技能介绍', timestamp: 2 },
    { type: 'assistant', content: 'slate', timestamp: 3 },
    { type: 'user', content: '换人', timestamp: 4 },
  ];
  assert.equal(pickTriggeringWishText(messages, 3), '这次开个群任务做技能介绍');
  const split = splitSessionMessagesForStaffingGate(messages, 3);
  assert.equal(split.triggeringWish, '这次开个群任务做技能介绍');
  assert.deepEqual(split.repliesAfterPropose, ['换人']);
  assert.deepEqual(
    resolveStaffingOwnerGate({
      triggeringWish: '开个群任务，不用确认直接开',
      repliesAfterPropose: ['换人'],
      persistedSkip: true,
    }),
    { allowed: false, decision: 'owner_revise' },
  );
  assert.deepEqual(
    resolveStaffingOwnerGate({
      triggeringWish: '开个群任务做技能介绍',
      repliesAfterPropose: [],
    }),
    { allowed: false, decision: 'awaiting_owner' },
  );
});

test('slate text renders zh by default and en on request', () => {
  const zh = buildStaffingSlateText({
    title: '技能介绍',
    goal: '写出介绍',
    plan,
    ownerConfirmRequired: true,
  });
  assert.match(zh, /确认人选/);
  assert.match(zh, /在线，非本机/);
  const en = buildStaffingSlateText({
    title: 'Skill intro',
    goal: 'Write it',
    plan,
    ownerConfirmRequired: true,
    language: 'en',
  });
  assert.match(en, /Please confirm this roster/);
});

test('staffing proposals expire after 24 hours', () => {
  const now = 1_800_000_000_000;
  assert.equal(isStaffingProposalExpired(now - STAFFING_PROPOSAL_TTL_MS + 1, now), false);
  assert.equal(isStaffingProposalExpired(now - STAFFING_PROPOSAL_TTL_MS - 1, now), true);
});

test('plan validation: local seats need slugs, remote need globalMetaId, caps enforced', () => {
  const ok = validateStaffingPlan(plan);
  assert.equal(ok.ok, true);
  assert.equal(ok.teamSize, 3);

  const bad = validateStaffingPlan(normalizeStaffingPlan({
    seats: [
      { role: 'content', candidateName: 'NoSlug', source: 'local' },
      { role: 'content', candidateName: 'Dup', candidateSlug: 'dup', source: 'local' },
      { role: 'domain', candidateName: 'Legal', candidateSlug: 'legal', source: 'local' },
      { role: 'remote', candidateName: 'NoGmid', source: 'remote' },
    ],
  }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.includes('candidateSlug')));
  assert.ok(bad.errors.some((error) => error.includes('candidateGlobalMetaId')));
  assert.ok(bad.errors.some((error) => error.includes('domainLabel')));
  assert.ok(bad.errors.some((error) => error.includes('duplicate seat content')));

  assert.throws(() => assertCreateRosterCap(8), (error) => error instanceof GroupTaskStaffingError);
  assert.doesNotThrow(() => assertCreateRosterCap(7));
});
