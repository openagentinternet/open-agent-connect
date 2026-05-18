import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildLoomDashboardViewModel } = require('../../dist/ui/pages/loom/viewModel.js');

const NOW = 1_775_000_000_000;
const LONG_TASK_PIN = 'loom-task-pin-1234567890abcdef1234567890abcdef1234567890abcdef';
const LONG_CLAIM_PIN = 'loom-claim-pin-abcdef1234567890abcdef1234567890abcdef123456';
const LONG_DELIVERY_PIN = 'loom-delivery-pin-1111222233334444555566667777888899990000';
const LONG_ACCEPTANCE_PIN = 'loom-acceptance-pin-9999888877776666555544443333222211110000';
const LONG_TXID = 'txid1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const LONG_ACTOR_GMID = 'gm-actor-1234567890abcdef1234567890abcdef1234567890abcdef';
const LONG_ACTOR_ADDRESS = '1ActorAddress1234567890abcdef1234567890abcdef';

function bot(overrides = {}) {
  return {
    role: 'requester',
    displayName: 'Alice Loom',
    fallbackLabel: 'requester:alice',
    initials: 'AL',
    globalMetaId: 'gm-alice',
    avatarUri: 'metafile://alice-avatar',
    ...overrides,
  };
}

function dashboard(overrides = {}) {
  const taskCard = {
    taskPinId: LONG_TASK_PIN,
    state: 'revision_needed',
    stateTone: 'warning',
    columnId: 'revision',
    title: 'Add deterministic loom dashboard view model',
    requester: bot(),
    developer: bot({
      role: 'developer',
      displayName: '',
      fallbackLabel: 'developer:gmd3v',
      initials: 'DV',
      globalMetaId: 'gm-dev',
      avatarUri: undefined,
    }),
    bounty: { amount: '0.25', currency: 'SPACE' },
    repo: { repoUri: 'https://github.com/openagentinternet/foo.bar.git', baseBranch: 'main' },
    tags: ['ui', 'loom'],
    createdAt: NOW - 200_000,
    updatedAt: NOW - 5_000,
    activeClaimCount: 1,
    latestStatusSummary: 'Tests added; implementation pending.',
    prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/123',
    paymentTxId: LONG_TXID,
    warningCount: 2,
    actorContext: { isRequester: true, isDeveloper: false, needsMyAction: true, role: 'requester' },
  };

  const detail = {
    taskPinId: LONG_TASK_PIN,
    state: 'revision_needed',
    columnId: 'revision',
    title: taskCard.title,
    requirement: 'Create a pure serializable UI view model.',
    criteria: 'Tests cover compact labels and timeline sorting.',
    requester: taskCard.requester,
    claims: [
      {
        pinId: LONG_CLAIM_PIN,
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 180_000,
        active: true,
        message: 'I can take this.',
        developer: taskCard.developer,
      },
    ],
    warnings: [
      {
        taskPinId: LONG_TASK_PIN,
        recordPinId: 'invalid-pin-0000000000000000000000000000000000000000',
        protocol: 'metabot-loom-status',
        code: 'missing-claim',
        message: 'Status references an unknown claim.',
        timestamp: NOW - 160_000,
      },
    ],
    timeline: [
      {
        id: `acceptance:${LONG_ACCEPTANCE_PIN}`,
        kind: 'acceptance',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 120_000,
        title: 'metabot-loom-acceptance',
        pinId: LONG_ACCEPTANCE_PIN,
      },
      {
        id: `delivery:${LONG_DELIVERY_PIN}`,
        kind: 'delivery',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 120_000,
        title: 'metabot-loom-delivery',
        summary: 'Ready for review.',
        pinId: LONG_DELIVERY_PIN,
      },
      {
        id: `claim:${LONG_CLAIM_PIN}`,
        kind: 'claim',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 180_000,
        title: 'metabot-loom-claim',
        pinId: LONG_CLAIM_PIN,
      },
      {
        id: `task:${LONG_TASK_PIN}`,
        kind: 'task',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 200_000,
        title: 'metabot-loom-task',
        pinId: LONG_TASK_PIN,
      },
      {
        id: '',
        kind: '',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 190_000,
        title: 'Malformed empty event',
        pinId: '',
      },
      {
        kind: 'not_a_real_event',
        taskPinId: LONG_TASK_PIN,
        timestamp: NOW - 185_000,
        title: 'Malformed unknown event',
        pinId: 'unknown-kind-pin',
      },
    ],
    localWorkflow: [],
    task: { pinId: LONG_TASK_PIN, timestamp: NOW - 200_000, protocol: 'metabot-loom-task', payload: {} },
    validRecords: { claims: [], statuses: [], deliveries: [], acceptances: [], claimRejects: [] },
  };

  return {
    version: 1,
    updatedAt: NOW - 45 * 60 * 1000,
    rawCacheUpdatedAt: NOW - 46 * 60 * 1000,
    actor: { profileSlug: 'alice', globalMetaId: LONG_ACTOR_GMID, address: LONG_ACTOR_ADDRESS },
    summary: {
      totalTasks: 1234,
      open: 4,
      claimed: 3,
      inProgress: 2,
      delivered: 1,
      revisionNeeded: 5,
      rejected: 6,
      acceptedPaid: 7,
      failed: 8,
      invalidRecords: 9,
      needsMyAction: 10,
      newestActivityAt: NOW - 5_000,
    },
    filters: {},
    columns: [
      { id: 'closed', title: 'Closed', states: ['accepted_paid', 'rejected', 'failed'], cards: [] },
      { id: 'revision', title: 'Revision', states: ['revision_needed'], cards: [taskCard] },
    ],
    tasks: [taskCard],
    details: [detail],
    warnings: detail.warnings,
    refresh: { requested: true, succeeded: false, updatedAt: NOW - 45 * 60 * 1000, warning: 'Refresh failed.' },
    ...overrides,
  };
}

test('buildLoomDashboardViewModel formats summary metrics and stale refresh state', () => {
  const model = buildLoomDashboardViewModel({ dashboard: dashboard() }, NOW);

  assert.deepEqual(
    model.summary.metrics.map((metric) => [metric.id, metric.label, metric.value]),
    [
      ['totalTasks', 'Total tasks', '1,234'],
      ['needsMyAction', 'Needs my action', '10'],
      ['open', 'Open', '4'],
      ['working', 'Working', '2'],
      ['review', 'In review', '1'],
      ['revision', 'Needs revision', '5'],
      ['closed', 'Closed', '21'],
      ['invalidRecords', 'Invalid records', '9'],
    ],
  );
  assert.equal(model.refresh.isStale, true);
  assert.equal(model.refresh.tone, 'warning');
  assert.match(model.refresh.warningLabel, /Refresh failed/i);
  assert.match(model.refresh.updatedLabel, /45m ago/);
});

test('buildLoomDashboardViewModel exposes active actor identity for toolbar display', () => {
  const model = buildLoomDashboardViewModel({ dashboard: dashboard() }, NOW);

  assert.equal(model.actor.profileSlug, 'alice');
  assert.equal(model.actor.displayLabel, 'alice');
  assert.equal(model.actor.globalMetaId.copyValue, LONG_ACTOR_GMID);
  assert.match(model.actor.globalMetaId.label, /^gm-actor/);
  assert.match(model.actor.globalMetaId.label, /cdef$/);
  assert.equal(model.actor.address.copyValue, LONG_ACTOR_ADDRESS);
  assert.match(model.actor.address.label, /^1ActorA/);
  assert.match(model.actor.address.label, /cdef$/);

  const anonymous = buildLoomDashboardViewModel({ dashboard: { actor: {} } }, NOW);
  assert.equal(anonymous.actor.profileSlug, '');
  assert.equal(anonymous.actor.displayLabel, 'Global Loom');
  assert.equal(anonymous.actor.globalMetaId.copyValue, '');
  assert.equal(anonymous.actor.address, null);
});

test('buildLoomDashboardViewModel preserves stable board order and builds compact card labels', () => {
  const model = buildLoomDashboardViewModel(dashboard(), NOW);

  assert.deepEqual(model.columns.map((column) => column.id), [
    'open',
    'claimed',
    'working',
    'review',
    'revision',
    'closed',
  ]);
  assert.deepEqual(model.columns.map((column) => column.title), [
    'Open',
    'Claimed',
    'Working',
    'Review',
    'Revision',
    'Closed',
  ]);

  const [card] = model.columns[4].cards;
  assert.equal(card.title, 'Add deterministic loom dashboard view model');
  assert.equal(card.stateLabel, 'Needs revision');
  assert.equal(card.stateTone, 'warning');
  assert.equal(card.summaryPreview, 'Tests added; implementation pending.');
  assert.equal(card.activityLabel, 'updated just now');
  assert.equal(card.bountyLabel, '0.25 SPACE');
  assert.equal(card.repoLabel, 'openagentinternet/foo.bar @ main');
  assert.equal(card.warningTone, 'warning');
  assert.equal(card.warningLabel, '2 warnings');
  assert.equal(card.actionLabel, 'Needs my action');
  assert.equal(card.requester.displayName, 'Alice Loom');
  assert.equal(card.requester.initials, 'AL');
  assert.equal(card.requester.avatarUri, 'metafile://alice-avatar');
  assert.equal(card.developer.displayName, 'developer:gmd3v');
  assert.equal(card.taskPin.copyValue, LONG_TASK_PIN);
  assert.match(card.taskPin.label, /^loom-tas/);
  assert.match(card.taskPin.label, /cdef$/);
  assert.equal(card.paymentTxId.copyValue, LONG_TXID);
  assert.match(card.paymentTxId.label, /^txid123/);
  assert.match(card.paymentTxId.label, /cdef$/);
});

test('buildLoomDashboardViewModel hides actor-specific action labels in global mode', () => {
  const model = buildLoomDashboardViewModel(dashboard({ actor: {} }), NOW);
  const [card] = model.columns[4].cards;

  assert.equal(model.actor.displayLabel, 'Global Loom');
  assert.equal(card.actionLabel, '');
});

test('buildLoomDashboardViewModel sorts task detail timeline and exposes full copy values', () => {
  const model = buildLoomDashboardViewModel({ dashboard: dashboard() }, NOW);
  const [detail] = model.details;

  assert.deepEqual(detail.timeline.map((event) => event.kind), [
    'task',
    'claim',
    'delivery',
    'acceptance',
  ]);
  assert.equal(detail.taskPin.copyValue, LONG_TASK_PIN);
  assert.equal(detail.claims[0].pin.copyValue, LONG_CLAIM_PIN);
  assert.equal(detail.timeline[2].pin?.copyValue, LONG_DELIVERY_PIN);
  assert.equal(detail.timeline[3].pin?.copyValue, LONG_ACCEPTANCE_PIN);
  assert.equal(detail.warnings[0].tone, 'warning');
  assert.equal(detail.warnings[0].pin.copyValue, 'invalid-pin-0000000000000000000000000000000000000000');
});

test('buildLoomDashboardViewModel returns a useful empty state for missing dashboard data', () => {
  const model = buildLoomDashboardViewModel({}, NOW);

  assert.equal(model.summary.metrics[0].value, '0');
  assert.equal(model.columns.length, 6);
  assert.equal(model.cards.length, 0);
  assert.equal(model.details.length, 0);
  assert.equal(model.emptyState.title, 'No Loom tasks yet');
  assert.match(model.emptyState.body, /published task/i);
  assert.equal(model.refresh.isStale, false);
  assert.equal(model.refresh.tone, 'neutral');
});
