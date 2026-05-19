import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLoomWorkflowTaskState,
  findLatestValidDelivery,
  findValidClaimForDelivery,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const deliveryPinId = `${'c'.repeat(64)}i0`;
const secondClaimPinId = `${'2'.repeat(64)}i0`;
const secondDeliveryPinId = `${'3'.repeat(64)}i0`;
const unrelatedTaskPinId = `${'8'.repeat(64)}i0`;
const unrelatedClaimPinId = `${'7'.repeat(64)}i0`;
const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';
const secondDeveloperGlobalMetaId = 'second-developer-global';

function record(protocol, pinId, payload, options = {}) {
  return {
    pinId,
    protocol,
    path: `/protocols/loom-${protocol}`,
    operation: 'create',
    contentType: 'application/json',
    timestamp: options.timestamp ?? 1750000000000,
    creatorAddress: options.creatorAddress ?? `${protocol}-creator-address`,
    creatorMetaId: options.creatorMetaId ?? `${protocol}-creator-metaid`,
    globalMetaId: options.globalMetaId ?? 'record-global',
    payload,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
    raw: { id: pinId, content: JSON.stringify(payload) },
  };
}

function taskRecord(globalMetaId = requesterGlobalMetaId, options = {}) {
  return record('task', taskPinId, {
    title: 'Add Loom workflow state',
    requirementContentType: 'text/markdown',
    requirement: 'Build the aggregation projection.',
    criteriaContentType: 'text/markdown',
    criteria: 'The state machine derives workflow states from valid records.',
    projectBase: 'github',
    project: { repoUri: 'https://github.com/openagentinternet/open-agent-connect', baseBranch: 'main' },
    bounty: { amount: '10', currency: 'SPACE' },
  }, { globalMetaId, ...options });
}

function claimRecord(globalMetaId = developerGlobalMetaId, options = {}) {
  return record('claim', options.pinId ?? claimPinId, {
    taskPinId,
    payoutAddress: 'developer-payout-address',
    message: 'I can build this.',
    ...options.payload,
  }, { globalMetaId, timestamp: 1750000001000, ...options });
}

function statusRecord(globalMetaId = developerGlobalMetaId, status = 'in_progress', options = {}) {
  return record('status', options.pinId ?? `${'d'.repeat(64)}i0`, {
    taskPinId,
    claimPinId,
    status,
    progressSummary: `Status is ${status}.`,
    ...options.payload,
  }, { globalMetaId, timestamp: 1750000002000, ...options });
}

function deliveryRecord(globalMetaId = developerGlobalMetaId, options = {}) {
  return record('delivery', options.pinId ?? deliveryPinId, {
    taskPinId,
    claimPinId,
    deliveryBase: 'github',
    deliverySummary: 'Ready for review.',
    delivery: {
      prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/1',
      prBranch: 'codex/metabot-loom-cli',
      prBaseBranch: 'main',
      prTitle: 'feat: add workflow state',
    },
    reviewChecklist: [{ item: 'Projection works.', status: 'passed' }],
    ...options.payload,
  }, { globalMetaId, timestamp: 1750000003000, ...options });
}

function acceptanceRecord(globalMetaId = requesterGlobalMetaId, verdict = 'passed', options = {}) {
  const paymentFields = verdict === 'passed'
    ? { releasePayment: true, paymentTxId: 'payment-txid' }
    : { releasePayment: false };
  return record('acceptance', options.pinId ?? `${'e'.repeat(64)}i0`, {
    taskPinId,
    deliveryPinId: options.deliveryPinId ?? deliveryPinId,
    verdict,
    score: verdict === 'passed' ? 5 : 2,
    comment: `Acceptance verdict is ${verdict}.`,
    ...paymentFields,
    ...options.payload,
  }, { globalMetaId, timestamp: 1750000004000, ...options });
}

function claimRejectRecord(globalMetaId = requesterGlobalMetaId, options = {}) {
  return record('claim-reject', options.pinId ?? `${'f'.repeat(64)}i0`, {
    taskPinId,
    claimPinId,
    reason: 'Requester chose a different developer.',
    ...options.payload,
  }, { globalMetaId, timestamp: 1750000005000, ...options });
}

function emptyRecords() {
  return {
    task: [],
    claim: [],
    status: [],
    delivery: [],
    acceptance: [],
    'claim-reject': [],
  };
}

function cacheStateWith(options = {}) {
  const records = emptyRecords();
  records.task.push(taskRecord(options.taskAuthor ?? requesterGlobalMetaId, options.taskOptions));

  if (options.includeClaim !== false) {
    records.claim.push(claimRecord(options.claimAuthor ?? developerGlobalMetaId, options.claimOptions));
  }
  if (options.status) {
    records.status.push(statusRecord(options.statusAuthor ?? developerGlobalMetaId, options.status, options.statusOptions));
  }
  if (options.includeDelivery || options.deliveryAuthor) {
    records.delivery.push(deliveryRecord(options.deliveryAuthor ?? developerGlobalMetaId, options.deliveryOptions));
  }
  if (options.acceptanceVerdict || options.acceptanceAuthor) {
    records.acceptance.push(acceptanceRecord(
      options.acceptanceAuthor ?? requesterGlobalMetaId,
      options.acceptanceVerdict ?? 'passed',
      options.acceptanceOptions,
    ));
  }
  if (options.includeClaimReject) {
    records['claim-reject'].push(claimRejectRecord(options.claimRejectAuthor ?? requesterGlobalMetaId, options.claimRejectOptions));
  }

  for (const extra of options.extraRecords ?? []) {
    records[extra.protocol].push(extra);
  }

  return {
    version: 1,
    updatedAt: 1750000000000,
    records,
  };
}

test('derives in_progress from valid task claim and latest status', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    statusAuthor: developerGlobalMetaId,
    status: 'in_progress',
  }), taskPinId);
  assert.equal(state.found, true);
  assert.equal(state.state, 'in_progress');
  assert.equal(state.valid.claims[0].pinId, claimPinId);
});

test('marks status from non-claim author invalid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    statusAuthor: 'other-global',
    status: 'completed',
  }), taskPinId);
  assert.equal(state.state, 'claimed');
  assert.ok(state.invalid.statuses.some((entry) => entry.reason.code === 'permission_denied'));
});

test('derives accepted_paid from requester acceptance with payment txid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    deliveryAuthor: developerGlobalMetaId,
    acceptanceAuthor: requesterGlobalMetaId,
    acceptanceVerdict: 'passed',
  }), taskPinId);
  assert.equal(state.state, 'accepted_paid');
  assert.equal(state.paymentTxId, 'payment-txid');
});

test('categorizes invalid payload records and ignores them for derived state', () => {
  const invalidDelivery = deliveryRecord(developerGlobalMetaId, {
    payloadValid: false,
    validationErrors: [{ path: 'deliverySummary', code: 'required', message: 'deliverySummary is required.' }],
  });
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [invalidDelivery],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.equal(state.valid.deliveries.length, 0);
  assert.ok(state.invalid.deliveries.some((entry) => entry.reason.code === 'invalid_payload'));
});

test('marks delivery from non-claim author invalid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    deliveryAuthor: 'other-global',
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.equal(state.valid.deliveries.length, 0);
  assert.ok(state.invalid.deliveries.some((entry) => entry.reason.code === 'permission_denied'));
});

test('marks acceptance referencing a missing delivery invalid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    acceptanceVerdict: 'rejected',
    acceptanceOptions: { deliveryPinId: `${'9'.repeat(64)}i0` },
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.equal(state.valid.acceptances.length, 0);
  assert.ok(state.invalid.acceptances.some((entry) => entry.reason.code === 'missing_delivery'));
});

test('derives rejected from requester claim rejection', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeClaimReject: true,
  }), taskPinId);

  assert.equal(state.state, 'rejected');
  assert.equal(state.valid.claimRejects[0].pinId, `${'f'.repeat(64)}i0`);
});

test('findLatestValidDelivery returns latest delivery or matching delivery', () => {
  const olderDeliveryPinId = `${'1'.repeat(64)}i0`;
  const olderDelivery = deliveryRecord(developerGlobalMetaId, {
    pinId: olderDeliveryPinId,
    timestamp: 1750000002500,
  });
  const latestDelivery = deliveryRecord(developerGlobalMetaId, {
    pinId: deliveryPinId,
    timestamp: 1750000003500,
  });
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [olderDelivery, latestDelivery],
  }), taskPinId);

  assert.equal(findLatestValidDelivery(state)?.pinId, deliveryPinId);
  assert.equal(findLatestValidDelivery(state, olderDeliveryPinId)?.pinId, olderDeliveryPinId);
});

test('findValidClaimForDelivery returns the corresponding claim', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeDelivery: true,
  }), taskPinId);

  assert.equal(findValidClaimForDelivery(state, deliveryPinId)?.pinId, claimPinId);
});

test('marks status with target claim and wrong task reference invalid', () => {
  const badStatus = statusRecord(developerGlobalMetaId, 'completed', {
    payload: { taskPinId: unrelatedTaskPinId },
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [badStatus],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.ok(state.invalid.statuses.some((entry) => entry.reason.code === 'invalid_reference'));
});

test('marks delivery with target claim and wrong task reference invalid', () => {
  const badDelivery = deliveryRecord(developerGlobalMetaId, {
    payload: { taskPinId: unrelatedTaskPinId },
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [badDelivery],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.ok(state.invalid.deliveries.some((entry) => entry.reason.code === 'invalid_reference'));
});

test('marks acceptance with target delivery and wrong task reference invalid', () => {
  const badAcceptance = acceptanceRecord(requesterGlobalMetaId, 'passed', {
    payload: { taskPinId: unrelatedTaskPinId },
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeDelivery: true,
    extraRecords: [badAcceptance],
  }), taskPinId);

  assert.equal(state.state, 'delivered');
  assert.ok(state.invalid.acceptances.some((entry) => entry.reason.code === 'invalid_reference'));
});

test('marks claim rejection with target claim and wrong task reference invalid', () => {
  const badClaimReject = claimRejectRecord(requesterGlobalMetaId, {
    payload: { taskPinId: unrelatedTaskPinId },
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [badClaimReject],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.ok(state.invalid.claimRejects.some((entry) => entry.reason.code === 'invalid_reference'));
});

test('ignores completely unrelated claim status and delivery records', () => {
  const unrelatedClaim = record('claim', unrelatedClaimPinId, {
    taskPinId: unrelatedTaskPinId,
    payoutAddress: 'unrelated-payout-address',
  }, { globalMetaId: 'unrelated-developer', timestamp: 1750000001100 });
  const unrelatedStatus = record('status', `${'6'.repeat(64)}i0`, {
    taskPinId: unrelatedTaskPinId,
    claimPinId: unrelatedClaimPinId,
    status: 'failed',
    progressSummary: 'Unrelated task failed.',
  }, { globalMetaId: 'unrelated-developer', timestamp: 1750000002100 });
  const unrelatedDelivery = record('delivery', `${'5'.repeat(64)}i0`, {
    taskPinId: unrelatedTaskPinId,
    claimPinId: unrelatedClaimPinId,
    deliveryBase: 'github',
    deliverySummary: 'Unrelated delivery.',
    delivery: { prUrl: 'https://github.com/example/repo/pull/99' },
    reviewChecklist: [{ item: 'Unrelated check.', status: 'passed' }],
  }, { globalMetaId: 'unrelated-developer', timestamp: 1750000003100 });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    extraRecords: [unrelatedClaim, unrelatedStatus, unrelatedDelivery],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
  assert.equal(state.valid.claims.length, 1);
  assert.equal(state.invalid.claims.length, 0);
  assert.equal(state.invalid.statuses.length, 0);
  assert.equal(state.invalid.deliveries.length, 0);
});

test('derives failed when latest status fails after an older delivery', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeDelivery: true,
    status: 'failed',
    statusOptions: { timestamp: 1750000004000 },
  }), taskPinId);

  assert.equal(state.state, 'failed');
});

test('uses latest duplicate task record for requester permissions', () => {
  const oldRequesterGlobalMetaId = 'old-requester-global';
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: oldRequesterGlobalMetaId,
    taskOptions: { timestamp: 1750000000000 },
    includeDelivery: true,
    acceptanceAuthor: requesterGlobalMetaId,
    acceptanceVerdict: 'passed',
    extraRecords: [
      taskRecord(requesterGlobalMetaId, { timestamp: 1750000000500 }),
    ],
  }), taskPinId);

  assert.equal(state.task.globalMetaId, requesterGlobalMetaId);
  assert.equal(state.state, 'accepted_paid');
  assert.equal(state.invalid.acceptances.length, 0);
});

test('derives rejected when single claim is rejected', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeClaimReject: true,
  }), taskPinId);

  assert.equal(state.state, 'rejected');
});

test('derives claimed when older rejected claim has later active claim', () => {
  const secondClaim = claimRecord(secondDeveloperGlobalMetaId, {
    pinId: secondClaimPinId,
    timestamp: 1750000006000,
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeClaimReject: true,
    extraRecords: [secondClaim],
  }), taskPinId);

  assert.equal(state.state, 'claimed');
});

test('derives delivered from later active claim after older claim rejection', () => {
  const secondClaim = claimRecord(secondDeveloperGlobalMetaId, {
    pinId: secondClaimPinId,
    timestamp: 1750000006000,
  });
  const secondDelivery = deliveryRecord(secondDeveloperGlobalMetaId, {
    pinId: secondDeliveryPinId,
    timestamp: 1750000007000,
    payload: { claimPinId: secondClaimPinId },
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeClaimReject: true,
    extraRecords: [secondClaim, secondDelivery],
  }), taskPinId);

  assert.equal(state.state, 'delivered');
});

test('ignores rejected claim activity when deriving active state', () => {
  const rejectedStatus = statusRecord(developerGlobalMetaId, 'in_progress', {
    timestamp: 1750000006000,
  });
  const rejectedDelivery = deliveryRecord(developerGlobalMetaId, {
    timestamp: 1750000007000,
  });

  const state = buildLoomWorkflowTaskState(cacheStateWith({
    includeClaimReject: true,
    extraRecords: [rejectedStatus, rejectedDelivery],
  }), taskPinId);

  assert.equal(state.state, 'rejected');
});
