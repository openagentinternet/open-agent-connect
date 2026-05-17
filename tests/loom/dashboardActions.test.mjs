import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  projectLoomDashboardNextActions,
  selectLoomDashboardCardAction,
} = require('../../dist/core/loom/index.js');

const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';

function pin(seed) {
  return `${seed.repeat(64).slice(0, 64)}i0`;
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
    payloadValid: true,
    validationErrors: [],
    raw: { id: pinId, content: JSON.stringify(payload) },
  };
}

function taskRecord(options = {}) {
  return record('task', options.pinId ?? pin('t'), {
    title: options.title ?? 'Build the Loom action board',
    requirement: 'Make the dashboard actionable.',
    criteria: 'Projected actions are safe and understandable.',
    project: {
      repoUri: options.repoUri ?? 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    ...(options.bounty === false ? {} : {
      bounty: options.bounty ?? { amount: '25', currency: 'SPACE' },
    }),
  }, {
    creatorAddress: 'requester-address',
    globalMetaId: requesterGlobalMetaId,
  });
}

function claimRecord(taskPinId, options = {}) {
  return record('claim', options.pinId ?? pin('c'), {
    taskPinId,
    ...(options.payoutAddress === false ? {} : {
      payoutAddress: options.payoutAddress ?? 'developer-payout-address',
    }),
    message: 'I can build this.',
  }, {
    timestamp: 1750000001000,
    creatorAddress: 'developer-address',
    globalMetaId: developerGlobalMetaId,
  });
}

function statusRecord(taskPinId, claimPinId, status, options = {}) {
  return record('status', options.pinId ?? pin('s'), {
    taskPinId,
    claimPinId,
    status,
    progressSummary: options.progressSummary ?? `Status is ${status}.`,
  }, {
    timestamp: 1750000002000,
    creatorAddress: 'developer-address',
    globalMetaId: developerGlobalMetaId,
  });
}

function deliveryRecord(taskPinId, claimPinId, options = {}) {
  return record('delivery', options.pinId ?? pin('d'), {
    taskPinId,
    claimPinId,
    deliveryBase: 'github',
    deliverySummary: options.deliverySummary ?? 'Ready for review.',
    delivery: {
      prUrl: options.prUrl ?? "https://github.com/openagentinternet/open-agent-connect/pull/1?review='yes'",
      prBranch: 'codex/metabot-loom-cli',
      prBaseBranch: 'main',
      prTitle: 'feat: action projection',
    },
    reviewChecklist: [{ item: 'Tests pass.', status: 'passed' }],
  }, {
    timestamp: 1750000003000,
    creatorAddress: 'developer-address',
    globalMetaId: developerGlobalMetaId,
  });
}

function acceptanceRecord(taskPinId, deliveryPinId, options = {}) {
  return record('acceptance', options.pinId ?? pin('a'), {
    taskPinId,
    deliveryPinId,
    verdict: 'passed',
    releasePayment: true,
    paymentTxId: 'payment-txid',
    score: 5,
    comment: 'Accepted.',
  }, {
    timestamp: 1750000004000,
    creatorAddress: 'requester-address',
    globalMetaId: requesterGlobalMetaId,
  });
}

function actorContext(role, overrides = {}) {
  return {
    isRequester: role === 'requester' || role === 'both',
    isDeveloper: role === 'developer' || role === 'both',
    needsMyAction: role === 'requester' || role === 'developer' || role === 'both',
    role,
    ...overrides,
  };
}

function cardAndDetail(state, options = {}) {
  const task = options.task ?? taskRecord(options);
  const claim = options.claim === false ? undefined : claimRecord(task.pinId, options.claimOptions);
  const status = options.status
    ? statusRecord(task.pinId, claim?.pinId ?? pin('c'), options.status, options.statusOptions)
    : undefined;
  const delivery = options.delivery === false
    ? undefined
    : options.delivery ?? (['delivered', 'revision_needed', 'accepted_paid'].includes(state)
      ? deliveryRecord(task.pinId, claim?.pinId ?? pin('c'), options.deliveryOptions)
      : undefined);
  const acceptance = state === 'accepted_paid' && delivery
    ? acceptanceRecord(task.pinId, delivery.pinId)
    : undefined;
  const localWorkflow = options.localWorkflow ?? [];
  const card = {
    taskPinId: task.pinId,
    state,
    stateTone: state === 'failed' ? 'danger' : 'neutral',
    columnId: state === 'delivered' ? 'review' : state === 'revision_needed' ? 'revision' : 'working',
    title: task.payload.title,
    requester: { role: 'requester', displayName: 'Requester Bot', fallbackLabel: 'Requester Bot', initials: 'RB', globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
    ...(claim ? {
      developer: { role: 'developer', displayName: 'Developer Bot', fallbackLabel: 'Developer Bot', initials: 'DB', globalMetaId: developerGlobalMetaId, address: 'developer-address' },
    } : {}),
    bounty: task.payload.bounty,
    repo: task.payload.project,
    tags: [],
    createdAt: task.timestamp,
    updatedAt: acceptance?.timestamp ?? delivery?.timestamp ?? status?.timestamp ?? claim?.timestamp ?? task.timestamp,
    activeClaimCount: claim ? 1 : 0,
    latestStatusSummary: status?.payload.progressSummary,
    prUrl: delivery?.payload.delivery.prUrl,
    paymentTxId: state === 'accepted_paid' ? acceptance?.payload.paymentTxId : undefined,
    warningCount: 0,
    actorContext: options.taskActorContext ?? actorContext('none', { needsMyAction: false }),
    ...(localWorkflow.at(-1) ? { local: localWorkflow.at(-1) } : {}),
  };
  const detail = {
    taskPinId: task.pinId,
    state,
    columnId: card.columnId,
    title: card.title,
    requirement: task.payload.requirement,
    criteria: task.payload.criteria,
    requester: card.requester,
    claims: claim ? [{
      pinId: claim.pinId,
      taskPinId: task.pinId,
      timestamp: claim.timestamp,
      active: true,
      payoutAddress: claim.payload.payoutAddress,
      developer: card.developer,
    }] : [],
    warnings: [],
    timeline: [],
    localWorkflow,
    task,
    validRecords: {
      claims: claim ? [claim] : [],
      statuses: status ? [status] : [],
      deliveries: delivery ? [delivery] : [],
      acceptances: acceptance ? [acceptance] : [],
      claimRejects: [],
    },
  };
  return { card, detail };
}

function actionsById(actions) {
  return new Map(actions.map((action) => [action.id, action]));
}

function project(input) {
  return projectLoomDashboardNextActions(input);
}

test('global mode keeps next actions neutral and does not label tasks as needsMyAction', () => {
  const { card, detail } = cardAndDetail('delivered', {
    taskActorContext: actorContext('none', { needsMyAction: false }),
  });

  const actions = project({ card, detail });
  const selected = selectLoomDashboardCardAction(actions);

  assert.equal(card.actorContext.needsMyAction, false);
  assert.equal(selected.label, 'Review required');
  assert.equal(selected.requiresActor, true);
  assert.match(selected.disabledReason, /Select a requester actor/);
});

test('actor mode labels requester and developer next actions only when actor matches', () => {
  const delivered = cardAndDetail('delivered', {
    taskActorContext: actorContext('requester'),
    actor: { profileSlug: "requester slug's", globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
  });
  const requesterActions = actionsById(project({
    ...delivered,
    actor: { profileSlug: "requester slug's", globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
  }));

  assert.equal(requesterActions.get('acceptAndPay').label, 'Accept and pay');
  assert.equal(requesterActions.get('acceptAndPay').requiresActor, false);

  const unrelated = cardAndDetail('delivered', {
    taskActorContext: actorContext('none', { needsMyAction: false }),
  });
  const unrelatedActions = actionsById(project({
    ...unrelated,
    actor: { profileSlug: 'observer', globalMetaId: 'observer-global', address: 'observer-address' },
  }));

  assert.equal(unrelatedActions.get('acceptAndPay').label, 'Review required');
  assert.match(unrelatedActions.get('acceptAndPay').disabledReason, /requester actor/);

  const working = cardAndDetail('in_progress', {
    taskActorContext: actorContext('developer'),
    status: 'in_progress',
    localWorkflow: [{ claimPinId: pin('c'), developerMetaBotSlug: 'builder', branchName: 'loom/work', workspacePath: '/tmp/loom/repo', updatedAt: '2026-05-17T00:00:00.000Z', llmSessionIds: [], processLogPaths: [], processLogUris: [], commits: [] }],
  });
  const developerActions = actionsById(project({
    ...working,
    actor: { profileSlug: 'developer', globalMetaId: developerGlobalMetaId, address: 'developer-address' },
  }));

  assert.equal(developerActions.get('runDevRound').label, 'Run dev round');
  assert.equal(developerActions.get('runDevRound').requiresActor, false);
});

test('delivered requester tasks expose review, payment, and PR actions', () => {
  const { card, detail } = cardAndDetail('delivered', {
    taskActorContext: actorContext('requester'),
  });

  const actions = actionsById(project({
    card,
    detail,
    actor: { profileSlug: "requester slug's", globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
  }));

  assert.deepEqual([...actions.keys()], ['acceptAndPay', 'requestRevision', 'reject', 'openPr']);
  assert.equal(actions.get('acceptAndPay').tone, 'primary');
  assert.equal(actions.get('requestRevision').tone, 'warning');
  assert.equal(actions.get('reject').tone, 'danger');
  assert.equal(actions.get('openPr').requiresConfirmation, false);
  assert.match(actions.get('acceptAndPay').cliFallback, /--from 'requester slug'\\''s'/);
  assert.match(actions.get('openPr').cliFallback, /'https:\/\/github\.com\/openagentinternet\/open-agent-connect\/pull\/1\?review='\\''yes'\\'''/);
});

test('open tasks expose claimAndStart for developer actors and require actor selection in global mode', () => {
  const globalTask = cardAndDetail('open', { claim: false });
  const globalActions = actionsById(project(globalTask));
  assert.equal(globalActions.get('claimAndStart').label, 'Developer needed');
  assert.equal(globalActions.get('claimAndStart').requiresActor, true);
  assert.match(globalActions.get('claimAndStart').disabledReason, /Select a developer actor/);

  const developerTask = cardAndDetail('open', {
    claim: false,
    taskActorContext: actorContext('none', { needsMyAction: false }),
  });
  const developerActions = actionsById(project({
    ...developerTask,
    actor: { profileSlug: 'developer', globalMetaId: developerGlobalMetaId, address: 'developer-address' },
  }));
  assert.equal(developerActions.get('claimAndStart').label, 'Claim and start');
  assert.equal(developerActions.get('claimAndStart').requiresActor, false);
  assert.equal(developerActions.get('claimAndStart').disabledReason, undefined);
});

test('failed, revision_needed, and in_progress produce human-readable next-step labels', () => {
  const failedActions = project(cardAndDetail('failed', { status: 'failed' }));
  assert.equal(selectLoomDashboardCardAction(failedActions).label, 'Review failure');

  const revisionActions = project(cardAndDetail('revision_needed', {
    taskActorContext: actorContext('developer'),
    localWorkflow: [{ claimPinId: pin('c'), developerMetaBotSlug: 'builder', branchName: 'loom/revise', workspacePath: '/tmp/loom/repo', updatedAt: '2026-05-17T00:00:00.000Z', llmSessionIds: [], processLogPaths: [], processLogUris: [], commits: [] }],
  }));
  assert.equal(actionsById(revisionActions).get('runDevRound').label, 'Run revision round');

  const workingActions = project(cardAndDetail('in_progress', {
    taskActorContext: actorContext('developer'),
    status: 'in_progress',
    localWorkflow: [{ claimPinId: pin('c'), developerMetaBotSlug: 'builder', branchName: 'loom/work', workspacePath: '/tmp/loom/repo', updatedAt: '2026-05-17T00:00:00.000Z', llmSessionIds: [], processLogPaths: [], processLogUris: [], commits: [] }],
  }));
  assert.equal(actionsById(workingActions).get('deliver').label, 'Deliver for review');
});

test('critical disabled actions explain missing payout, bounty, delivery, accepted payment, and local workflow', () => {
  const missingPayout = actionsById(project(cardAndDetail('delivered', {
    taskActorContext: actorContext('requester'),
    claimOptions: { payoutAddress: false },
  })));
  assert.match(missingPayout.get('acceptAndPay').disabledReason, /payout address/);

  const missingBounty = actionsById(project(cardAndDetail('delivered', {
    taskActorContext: actorContext('requester'),
    bounty: false,
  })));
  assert.match(missingBounty.get('acceptAndPay').disabledReason, /bounty/);

  const missingDelivery = actionsById(project(cardAndDetail('delivered', {
    taskActorContext: actorContext('requester'),
    delivery: false,
  })));
  assert.match(missingDelivery.get('acceptAndPay').disabledReason, /delivery/);

  const alreadyPaid = actionsById(project(cardAndDetail('accepted_paid', {
    taskActorContext: actorContext('requester'),
  })));
  assert.match(alreadyPaid.get('acceptAndPay').disabledReason, /already accepted and paid/);

  const missingWorkflow = actionsById(project({
    ...cardAndDetail('in_progress', {
      taskActorContext: actorContext('developer'),
      status: 'in_progress',
    }),
    actor: {
      profileSlug: 'developer',
      globalMetaId: developerGlobalMetaId,
      address: 'developer-address',
    },
  }));
  assert.match(missingWorkflow.get('runDevRound').disabledReason, /local workflow/);
  assert.match(missingWorkflow.get('deliver').disabledReason, /local workflow/);
});

test('every mutating action requires confirmation and has a CLI fallback', () => {
  const scenarios = [
    cardAndDetail('open', { claim: false }),
    cardAndDetail('in_progress', {
      taskActorContext: actorContext('developer'),
      status: 'in_progress',
      localWorkflow: [{ claimPinId: pin('c'), developerMetaBotSlug: 'builder', branchName: 'loom/work', workspacePath: '/tmp/loom/repo', updatedAt: '2026-05-17T00:00:00.000Z', llmSessionIds: [], processLogPaths: [], processLogUris: [], commits: [] }],
    }),
    cardAndDetail('delivered', { taskActorContext: actorContext('requester') }),
  ];
  const mutatingIds = new Set(['postTask', 'claimAndStart', 'runDevRound', 'deliver', 'acceptAndPay', 'requestRevision', 'reject']);
  const mutatingActions = scenarios
    .flatMap((scenario) => project({ ...scenario, actor: { profileSlug: "actor's slug", globalMetaId: developerGlobalMetaId, address: 'developer-address' } }))
    .filter((action) => mutatingIds.has(action.id));

  assert.ok(mutatingActions.length > 0);
  for (const action of mutatingActions) {
    assert.equal(action.requiresConfirmation, true, action.id);
    assert.equal(typeof action.cliFallback, 'string', action.id);
    assert.match(action.cliFallback, /'/, action.id);
  }
});

test('CLI fallbacks quote dynamic values that look like flags', () => {
  const maliciousTaskPin = "--bad; touch /tmp/loom-task-pwn";
  const maliciousPrUrl = "--bad; touch /tmp/loom-pr-pwn";
  const { card, detail } = cardAndDetail('delivered', {
    task: taskRecord({ pinId: maliciousTaskPin }),
    deliveryOptions: { prUrl: maliciousPrUrl },
    taskActorContext: actorContext('requester'),
  });

  const actions = actionsById(project({
    card,
    detail,
    actor: { profileSlug: 'requester', globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
  }));

  assert.match(actions.get('acceptAndPay').cliFallback, /--task-pin-id '--bad; touch \/tmp\/loom-task-pwn'/);
  assert.match(actions.get('requestRevision').cliFallback, /--task-pin-id '--bad; touch \/tmp\/loom-task-pwn'/);
  assert.match(actions.get('openPr').cliFallback, /^open '--bad; touch \/tmp\/loom-pr-pwn'$/);

  const failed = cardAndDetail('failed', {
    task: taskRecord({ pinId: maliciousTaskPin }),
    status: 'failed',
  });
  const copyAction = actionsById(project(failed)).get('copyCli');

  assert.equal(copyAction.cliFallback, "metabot loom state '--bad; touch /tmp/loom-task-pwn'");
});
