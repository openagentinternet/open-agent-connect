import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLoomDashboard,
  findLoomDashboardTaskDetail,
} = require('../../dist/core/loom/index.js');

const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';
const secondDeveloperGlobalMetaId = 'second-developer-global';

function pin(seed) {
  return `${seed.repeat(64).slice(0, 64)}i0`;
}

function taskPin(seed) {
  return pin(seed);
}

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
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
    payload,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
    raw: { id: pinId, content: JSON.stringify(payload) },
  };
}

function taskRecord(seed, options = {}) {
  const taskPinId = taskPin(seed);
  return record('task', taskPinId, {
    title: options.title ?? `Task ${seed}`,
    requirementContentType: 'text/markdown',
    requirement: `Requirement ${seed}`,
    criteriaContentType: 'text/markdown',
    criteria: `Criteria ${seed}`,
    projectBase: 'github',
    project: {
      repoUri: options.repoUri ?? 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: options.baseBranch ?? 'main',
    },
    bounty: { amount: '10', currency: 'SPACE' },
    tags: options.tags ?? ['loom', seed],
  }, {
    timestamp: options.timestamp ?? 1750000000000,
    creatorAddress: options.creatorAddress ?? '1RequesterAddress',
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
  });
}

function claimRecord(taskPinId, claimPinId, options = {}) {
  return record('claim', claimPinId, {
    taskPinId,
    payoutAddress: options.payoutAddress ?? 'developer-payout-address',
    message: options.message ?? 'I can build this.',
  }, {
    timestamp: options.timestamp ?? 1750000001000,
    creatorAddress: options.creatorAddress ?? '1DeveloperAddress',
    globalMetaId: options.globalMetaId ?? developerGlobalMetaId,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
  });
}

function statusRecord(taskPinId, claimPinId, status, options = {}) {
  return record('status', options.pinId ?? pin('s'), {
    taskPinId,
    claimPinId,
    status,
    progressSummary: options.progressSummary ?? `Status is ${status}.`,
    branchName: options.branchName ?? 'codex/metabot-loom-cli',
    commits: options.commits ?? [{ sha: 'abc1234', message: 'feat: work', files: ['src/file.ts'] }],
    processLogs: options.processLogs ?? ['metafile://status-log'],
  }, {
    timestamp: options.timestamp ?? 1750000002000,
    creatorAddress: options.creatorAddress ?? '1DeveloperAddress',
    globalMetaId: options.globalMetaId ?? developerGlobalMetaId,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
  });
}

function deliveryRecord(taskPinId, claimPinId, deliveryPinId, options = {}) {
  return record('delivery', deliveryPinId, {
    taskPinId,
    claimPinId,
    deliveryBase: 'github',
    deliverySummary: options.deliverySummary ?? 'Ready for review.',
    delivery: {
      prUrl: options.prUrl ?? 'https://github.com/openagentinternet/open-agent-connect/pull/1',
      prBranch: options.prBranch ?? 'codex/metabot-loom-cli',
      prBaseBranch: options.prBaseBranch ?? 'main',
      prTitle: options.prTitle ?? 'feat: add loom dashboard',
    },
    reviewChecklist: [{ item: 'Projection works.', status: 'passed' }],
  }, {
    timestamp: options.timestamp ?? 1750000003000,
    creatorAddress: options.creatorAddress ?? '1DeveloperAddress',
    globalMetaId: options.globalMetaId ?? developerGlobalMetaId,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
  });
}

function acceptanceRecord(taskPinId, deliveryPinId, verdict, options = {}) {
  const paymentFields = verdict === 'passed'
    ? { releasePayment: true, paymentTxId: 'payment-txid' }
    : { releasePayment: false };
  return record('acceptance', options.pinId ?? pin('a'), {
    taskPinId,
    deliveryPinId,
    verdict,
    score: verdict === 'passed' ? 5 : 2,
    comment: `Acceptance verdict is ${verdict}.`,
    ...paymentFields,
    ...options.payload,
  }, {
    timestamp: options.timestamp ?? 1750000004000,
    creatorAddress: options.creatorAddress ?? '1RequesterAddress',
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
    payloadValid: options.payloadValid ?? true,
    validationErrors: options.validationErrors ?? [],
  });
}

function claimRejectRecord(taskPinId, claimPinId, options = {}) {
  return record('claim-reject', options.pinId ?? pin('r'), {
    taskPinId,
    claimPinId,
    reason: options.reason ?? 'Requester chose a different developer.',
  }, {
    timestamp: options.timestamp ?? 1750000005000,
    creatorAddress: options.creatorAddress ?? '1RequesterAddress',
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
  });
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

function cache(records) {
  return {
    version: 1,
    updatedAt: 1750000010000,
    records,
  };
}

function addScenario(records, seed, scenario) {
  const task = taskRecord(seed, { title: scenario.title ?? scenario.expectedState });
  const taskPinId = task.pinId;
  const claimPinId = pin(`${seed}c`);
  const deliveryPinId = pin(`${seed}d`);
  records.task.push(task);
  if (scenario.claim !== false) {
    records.claim.push(claimRecord(taskPinId, claimPinId, {
      timestamp: task.timestamp + 100,
    }));
  }
  if (scenario.status) {
    records.status.push(statusRecord(taskPinId, claimPinId, scenario.status, {
      timestamp: task.timestamp + 200,
      pinId: pin(`${seed}s`),
    }));
  }
  if (scenario.delivery) {
    records.delivery.push(deliveryRecord(taskPinId, claimPinId, deliveryPinId, {
      timestamp: task.timestamp + 300,
    }));
  }
  if (scenario.acceptance) {
    records.acceptance.push(acceptanceRecord(taskPinId, deliveryPinId, scenario.acceptance, {
      timestamp: task.timestamp + 400,
    }));
  }
  if (scenario.claimReject) {
    records['claim-reject'].push(claimRejectRecord(taskPinId, claimPinId, {
      timestamp: task.timestamp + 500,
    }));
  }
  return taskPinId;
}

test('groups all derived states into dashboard board columns', () => {
  const records = emptyRecords();
  const scenarios = [
    ['1', 'open', 'open', { claim: false }],
    ['2', 'claimed', 'claimed', {}],
    ['3', 'in_progress', 'working', { status: 'in_progress' }],
    ['4', 'delivered', 'review', { status: 'completed', delivery: true }],
    ['5', 'revision_needed', 'revision', { delivery: true, acceptance: 'revision_needed' }],
    ['6', 'accepted_paid', 'closed', { delivery: true, acceptance: 'passed' }],
    ['7', 'rejected', 'closed', { delivery: true, acceptance: 'rejected' }],
    ['8', 'failed', 'closed', { status: 'failed' }],
  ];
  const expected = new Map();
  for (const [seed, expectedState, expectedColumn, scenario] of scenarios) {
    const taskPinId = addScenario(records, seed, { ...scenario, expectedState });
    expected.set(taskPinId, { expectedState, expectedColumn });
  }

  const dashboard = buildLoomDashboard(cache(records));

  assert.equal(dashboard.summary.totalTasks, scenarios.length);
  for (const card of dashboard.tasks) {
    const expectation = expected.get(card.taskPinId);
    assert.equal(card.state, expectation.expectedState);
    assert.equal(card.columnId, expectation.expectedColumn);
    assert.ok(dashboard.columns.find((column) => column.id === expectation.expectedColumn).cards.some((item) => item.taskPinId === card.taskPinId));
  }
});

test('passed acceptance without paymentTxId does not become accepted_paid', () => {
  const records = emptyRecords();
  const task = taskRecord('p');
  const claimPinId = pin('pc');
  const deliveryPinId = pin('pd');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.delivery.push(deliveryRecord(task.pinId, claimPinId, deliveryPinId));
  records.acceptance.push(acceptanceRecord(task.pinId, deliveryPinId, 'passed', {
    payload: { releasePayment: true, paymentTxId: '' },
  }));

  const dashboard = buildLoomDashboard(cache(records));
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(card.state, 'delivered');
  assert.equal(card.columnId, 'review');
  assert.equal(card.paymentTxId, undefined);
});

test('invalid status author does not move task to Working and creates warning plus invalid timeline event', () => {
  const records = emptyRecords();
  const task = taskRecord('x');
  const claimPinId = pin('xc');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.status.push(statusRecord(task.pinId, claimPinId, 'in_progress', {
    globalMetaId: 'impostor-global',
    creatorAddress: '1ImpostorAddress',
  }));

  const dashboard = buildLoomDashboard(cache(records));
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);
  const detail = findLoomDashboardTaskDetail(dashboard, task.pinId);

  assert.equal(card.state, 'claimed');
  assert.equal(card.columnId, 'claimed');
  assert.equal(card.warningCount, 1);
  assert.ok(detail.warnings.some((warning) => warning.code === 'permission_denied' && warning.protocol === 'status'));
  assert.ok(detail.timeline.some((event) => event.kind === 'invalid_record' && event.protocol === 'status'));
});

test('multiple active claims are summarized on card and listed in detail', () => {
  const records = emptyRecords();
  const task = taskRecord('m');
  const firstClaimPinId = pin('mc');
  const secondClaimPinId = pin('md');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, firstClaimPinId, {
    timestamp: 1750000001000,
    globalMetaId: developerGlobalMetaId,
    creatorAddress: '1FirstDeveloperAddress',
  }));
  records.claim.push(claimRecord(task.pinId, secondClaimPinId, {
    timestamp: 1750000002000,
    globalMetaId: secondDeveloperGlobalMetaId,
    creatorAddress: '1SecondDeveloperAddress',
  }));

  const dashboard = buildLoomDashboard(cache(records), {
    identityMap: {
      [secondDeveloperGlobalMetaId]: { displayName: 'Second Developer', avatarUri: 'metafile://second-avatar' },
    },
  });
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);
  const detail = findLoomDashboardTaskDetail(dashboard, task.pinId);

  assert.equal(card.activeClaimCount, 2);
  assert.equal(card.developer.displayName, 'Second Developer');
  assert.equal(card.developer.avatarUri, 'metafile://second-avatar');
  assert.equal(detail.claims.length, 2);
  assert.deepEqual(detail.claims.map((claim) => claim.pinId), [firstClaimPinId, secondClaimPinId]);
});

test('rejected claim author is not considered current developer for actor context', () => {
  const records = emptyRecords();
  const task = taskRecord('j');
  const claimPinId = pin('jc');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId, {
    globalMetaId: developerGlobalMetaId,
    creatorAddress: '1RejectedDeveloperAddress',
  }));
  records['claim-reject'].push(claimRejectRecord(task.pinId, claimPinId));

  const dashboard = buildLoomDashboard(cache(records), {
    actorContext: { globalMetaId: developerGlobalMetaId },
  });
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(card.state, 'rejected');
  assert.equal(card.activeClaimCount, 0);
  assert.equal(card.actorContext.isDeveloper, false);
  assert.equal(card.actorContext.needsMyAction, false);
  assert.equal(card.actorContext.role, 'none');
});

test('column state arrays are isolated between dashboard builds', () => {
  const records = emptyRecords();
  addScenario(records, 'q', { expectedState: 'open', claim: false });

  const firstDashboard = buildLoomDashboard(cache(records));
  firstDashboard.columns[0].states.push('accepted_paid');

  const secondDashboard = buildLoomDashboard(cache(records));

  assert.deepEqual(secondDashboard.columns[0].states, ['open']);
});

test('actor address fallback marks requester and developer context without globalMetaId', () => {
  const requesterRecords = emptyRecords();
  const requesterTask = taskRecord('u', {
    globalMetaId: requesterGlobalMetaId,
    creatorAddress: '1RequesterAddressOnly',
  });
  requesterRecords.task.push(requesterTask);
  const requesterDashboard = buildLoomDashboard(cache(requesterRecords), {
    actorContext: { address: '1RequesterAddressOnly' },
  });
  const requesterCard = requesterDashboard.tasks.find((taskCard) => taskCard.taskPinId === requesterTask.pinId);

  assert.equal(requesterCard.actorContext.isRequester, true);
  assert.equal(requesterCard.actorContext.isDeveloper, false);
  assert.equal(requesterCard.actorContext.role, 'requester');

  const developerRecords = emptyRecords();
  const developerTask = taskRecord('v');
  const claimPinId = pin('vc');
  developerRecords.task.push(developerTask);
  developerRecords.claim.push(claimRecord(developerTask.pinId, claimPinId, {
    globalMetaId: developerGlobalMetaId,
    creatorAddress: '1DeveloperAddressOnly',
  }));
  const developerDashboard = buildLoomDashboard(cache(developerRecords), {
    actorContext: { address: '1DeveloperAddressOnly' },
  });
  const developerCard = developerDashboard.tasks.find((taskCard) => taskCard.taskPinId === developerTask.pinId);

  assert.equal(developerCard.actorContext.isRequester, false);
  assert.equal(developerCard.actorContext.isDeveloper, true);
  assert.equal(developerCard.actorContext.needsMyAction, true);
  assert.equal(developerCard.actorContext.role, 'developer');
});

test('revision_needed tasks need developer action, not requester action', () => {
  const records = emptyRecords();
  const task = taskRecord('n');
  const claimPinId = pin('nc');
  const deliveryPinId = pin('nd');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.delivery.push(deliveryRecord(task.pinId, claimPinId, deliveryPinId));
  records.acceptance.push(acceptanceRecord(task.pinId, deliveryPinId, 'revision_needed'));

  const requesterDashboard = buildLoomDashboard(cache(records), {
    actorContext: { globalMetaId: requesterGlobalMetaId, address: '1RequesterAddress' },
  });
  const requesterCard = requesterDashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(requesterCard.state, 'revision_needed');
  assert.equal(requesterCard.actorContext.isRequester, true);
  assert.equal(requesterCard.actorContext.isDeveloper, false);
  assert.equal(requesterCard.actorContext.needsMyAction, false);
  assert.equal(requesterDashboard.summary.needsMyAction, 0);
  assert.equal(requesterCard.nextAction.id, 'runDevRound');
  assert.match(requesterCard.nextAction.disabledReason, /developer actor/);

  const developerDashboard = buildLoomDashboard(cache(records), {
    actorContext: { globalMetaId: developerGlobalMetaId, address: '1DeveloperAddress' },
  });
  const developerCard = developerDashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(developerCard.actorContext.isRequester, false);
  assert.equal(developerCard.actorContext.isDeveloper, true);
  assert.equal(developerCard.actorContext.needsMyAction, true);
  assert.equal(developerDashboard.summary.needsMyAction, 1);
  assert.equal(developerCard.nextAction.id, 'runDevRound');
});

test('requester and developer identities use supplied profiles and stable fallbacks', () => {
  const records = emptyRecords();
  const task = taskRecord('i', { globalMetaId: requesterGlobalMetaId, creatorAddress: '1RequesterAddress' });
  const claimPinId = pin('ic');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId, {
    globalMetaId: developerGlobalMetaId,
    creatorAddress: '1DeveloperAddress',
  }));

  const dashboard = buildLoomDashboard(cache(records), {
    identityMap: {
      [requesterGlobalMetaId]: { displayName: 'Requester Bot', avatarUri: 'metafile://requester-avatar' },
    },
  });
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(card.requester.displayName, 'Requester Bot');
  assert.equal(card.requester.avatarUri, 'metafile://requester-avatar');
  assert.equal(card.requester.globalMetaId, requesterGlobalMetaId);
  assert.equal(card.requester.address, '1RequesterAddress');
  assert.equal(card.developer.globalMetaId, developerGlobalMetaId);
  assert.equal(card.developer.address, '1DeveloperAddress');
  assert.equal(card.developer.avatarUri, undefined);
  assert.ok(card.developer.displayName.length > 0);
});

test('local workflow enrichment is included without overriding chain state', () => {
  const records = emptyRecords();
  const task = taskRecord('l');
  const claimPinId = pin('lc');
  const deliveryPinId = pin('ld');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.delivery.push(deliveryRecord(task.pinId, claimPinId, deliveryPinId));

  const dashboard = buildLoomDashboard(cache(records), {
    workflowStates: [{
      version: 1,
      taskPinId: task.pinId,
      claimPinId,
      developerMetaBotSlug: 'builder',
      requesterGlobalMetaId,
      developerGlobalMetaId,
      repoUri: 'https://github.com/local/override-should-not-win',
      baseBranch: 'develop',
      upstreamRemote: 'origin',
      forkRemote: 'fork',
      branchName: 'local/dashboard-work',
      workspacePath: '/tmp/local-workspace',
      statuses: [{
        roundId: 'round-1',
        status: 'in_progress',
        pinId: pin('ls'),
        processLogPath: '/tmp/process.log',
        processLogUri: 'metafile://local-process-log',
        llmSessionId: 'llm-session-1',
        commits: [{ sha: 'local123', message: 'feat: local evidence', files: ['src/local.ts'] }],
        checksPassed: true,
      }],
      delivery: { pinId: deliveryPinId, prUrl: 'https://github.com/local/pr/99', prTitle: 'local pr' },
      acceptance: { paymentTxId: 'local-payment-should-not-win' },
      updatedAt: '2026-05-16T12:00:00.000Z',
    }],
  });
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);
  const detail = findLoomDashboardTaskDetail(dashboard, task.pinId);

  assert.equal(card.state, 'delivered');
  assert.equal(card.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/1');
  assert.equal(card.paymentTxId, undefined);
  assert.equal(card.local?.branchName, 'local/dashboard-work');
  assert.equal(card.local?.workspacePath, '/tmp/local-workspace');
  assert.deepEqual(card.local?.llmSessionIds, ['llm-session-1']);
  assert.deepEqual(card.local?.processLogUris, ['metafile://local-process-log']);
  assert.deepEqual(card.local?.commits.map((commit) => commit.sha), ['local123']);
  assert.ok(detail.timeline.some((event) => event.kind === 'local_workflow'));
});

test('compact summaries and state-aware actions are attached to cards and detail', () => {
  const records = emptyRecords();
  const task = taskRecord('u');
  const claimPinId = pin('uc');
  const deliveryPinId = pin('ud');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.delivery.push(deliveryRecord(task.pinId, claimPinId, deliveryPinId, {
    deliverySummary: 'Ready for requester review with tests passing.',
  }));

  const dashboard = buildLoomDashboard(cache(records), {
    actorContext: { profileSlug: 'requester', globalMetaId: requesterGlobalMetaId, address: '1RequesterAddress' },
  });
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);
  const detail = findLoomDashboardTaskDetail(dashboard, task.pinId);

  assert.equal(card.summaryPreview, 'Ready for requester review with tests passing.');
  assert.equal(card.nextAction.id, 'acceptAndPay');
  assert.equal(card.nextAction.label, 'Accept and pay');
  assert.deepEqual(detail.nextActions.map((action) => action.id), ['acceptAndPay', 'requestRevision', 'reject', 'openPr']);
});

test('global dashboard mode does not mark delivered tasks as needsMyAction', () => {
  const records = emptyRecords();
  const task = taskRecord('g');
  const claimPinId = pin('gc');
  const deliveryPinId = pin('gd');
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.delivery.push(deliveryRecord(task.pinId, claimPinId, deliveryPinId));

  const dashboard = buildLoomDashboard(cache(records));
  const card = dashboard.tasks.find((taskCard) => taskCard.taskPinId === task.pinId);

  assert.equal(card.actorContext.needsMyAction, false);
  assert.equal(dashboard.summary.needsMyAction, 0);
  assert.equal(card.nextAction.label, 'Review required');
  assert.equal(card.nextAction.requiresActor, true);
});
