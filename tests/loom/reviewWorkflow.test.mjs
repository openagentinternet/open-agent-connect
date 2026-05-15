import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLoomPaymentAmountRaw,
  runLoomAcceptAndPayWorkflow,
  runLoomReviewDeliveryWorkflow,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const deliveryPinId = `${'c'.repeat(64)}i0`;
const acceptancePinId = `${'d'.repeat(64)}i0`;
const requesterGlobalMetaId = 'metaid-requester';
const otherRequesterGlobalMetaId = 'metaid-other-requester';
const developerGlobalMetaId = 'metaid-developer';

function commandSuccess(data = {}) {
  return { ok: true, state: 'success', data };
}

function commandAwaitingConfirmation(data = {}) {
  return { ok: true, state: 'awaiting_confirmation', data };
}

function commandFailed(code, message = code, data) {
  return {
    ok: false,
    state: 'failed',
    code,
    message,
    ...(data ? { data } : {}),
  };
}

function cachedRecord(protocol, pinId, payload, overrides = {}) {
  return {
    pinId,
    protocol,
    path: `/protocols/loom-${protocol}`,
    operation: 'create',
    contentType: 'application/json',
    timestamp: overrides.timestamp ?? 1,
    creatorAddress: '',
    creatorMetaId: '',
    globalMetaId: overrides.globalMetaId ?? '',
    payload,
    payloadValid: true,
    validationErrors: [],
    raw: {},
    ...overrides,
  };
}

function taskPayload(overrides = {}) {
  return {
    title: 'Add Loom review workflow',
    requirementContentType: 'text/markdown',
    requirement: 'Accept or reject a delivered Loom task.',
    criteriaContentType: 'text/markdown',
    criteria: 'Payment is sent only after acceptance.',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '1.25',
      currency: 'SPACE',
    },
    ...overrides,
  };
}

function taskState(options = {}) {
  if (options.found === false) {
    return {
      found: false,
      code: 'task_not_found',
      message: `Loom task not found in cache: ${taskPinId}`,
      taskPinId,
      valid: {
        claims: [],
        statuses: [],
        deliveries: [],
        acceptances: [],
        claimRejects: [],
      },
      invalid: {
        tasks: [],
        claims: [],
        statuses: [],
        deliveries: [],
        acceptances: [],
        claimRejects: [],
      },
    };
  }

  const task = cachedRecord('task', taskPinId, options.taskPayload ?? taskPayload(), {
    globalMetaId: options.taskAuthor ?? requesterGlobalMetaId,
  });
  const claim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    ...options.claimPayload,
  }, { globalMetaId: developerGlobalMetaId });
  const delivery = cachedRecord('delivery', deliveryPinId, {
    taskPinId,
    claimPinId,
    deliveryBase: 'github',
    deliverySummary: 'Ready for review.',
    delivery: {
      prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/123',
      prBranch: 'codex/metabot-loom-cli',
      prBaseBranch: 'main',
      prTitle: 'feat: add review workflow',
    },
    reviewChecklist: [{ item: 'Review workflow passes.', status: 'passed' }],
  }, { globalMetaId: developerGlobalMetaId });
  const acceptance = cachedRecord('acceptance', acceptancePinId, {
    taskPinId,
    deliveryPinId,
    verdict: 'passed',
    score: 5,
    comment: 'Accepted.',
    releasePayment: true,
    paymentTxId: 'existing-payment-txid',
  }, { globalMetaId: requesterGlobalMetaId });

  return {
    found: true,
    taskPinId,
    state: options.state ?? (options.accepted ? 'accepted_paid' : 'delivered'),
    task,
    valid: {
      claims: options.includeClaim === false ? [] : [claim],
      statuses: [],
      deliveries: options.includeDelivery === false ? [] : [delivery],
      acceptances: options.accepted ? [acceptance] : [],
      claimRejects: [],
    },
    invalid: {
      tasks: [],
      claims: [],
      statuses: [],
      deliveries: [],
      acceptances: [],
      claimRejects: [],
    },
    ...(options.accepted ? { latestAcceptance: acceptance, paymentTxId: 'existing-payment-txid' } : {}),
  };
}

function workflowState(overrides = {}) {
  return {
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'developer',
    requesterGlobalMetaId,
    developerGlobalMetaId,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    forkRepo: 'developer/open-agent-connect',
    branchName: 'loom/task-claim',
    workspacePath: '/tmp/metabot-loom-review/repo',
    claim: { pinId: claimPinId },
    statuses: [],
    delivery: { pinId: deliveryPinId, prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/123' },
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function createWorkflowStore(events, state = workflowState(), root = '/tmp/metabot-loom-review') {
  return {
    paths: { profileRoot: path.join(root, 'profile') },
    resolve(pinId, resolvedClaimPinId) {
      return {
        loomRuntimeRoot: path.join(root, '.runtime', 'loom'),
        workflowsRoot: path.join(root, '.runtime', 'loom', 'workflows'),
        stagingRoot: path.join(root, '.runtime', 'loom', 'staging'),
        workspacesRoot: path.join(root, '.runtime', 'loom', 'workspaces'),
        logsRoot: path.join(root, '.runtime', 'loom', 'logs'),
        workflowPath: path.join(root, '.runtime', 'loom', 'workflows', pinId, `${resolvedClaimPinId ?? 'pending-claim'}.json`),
        stagingRepoPath: path.join(root, '.runtime', 'loom', 'staging', pinId, 'run', 'repo'),
        workspaceRepoPath: path.join(root, '.runtime', 'loom', 'workspaces', pinId, resolvedClaimPinId ?? 'pending-claim', 'repo'),
        taskLogsRoot: path.join(root, '.runtime', 'loom', 'logs', pinId),
      };
    },
    async read(pinId, resolvedClaimPinId) {
      events.push({ type: 'workflow.read', taskPinId: pinId, claimPinId: resolvedClaimPinId });
      return state;
    },
    async write(nextState) {
      events.push({ type: 'workflow.write', state: nextState });
      return nextState;
    },
  };
}

async function createDeps(overrides = {}) {
  const events = overrides.events ?? [];
  const root = overrides.root ?? await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-loom-review-'));
  const input = {
    from: 'requester',
    taskPinId,
    deliveryPinId,
    score: 5,
    comment: 'Delivery satisfies the task criteria.',
    chain: 'mvc',
    confirmPayment: true,
    requesterGlobalMetaId,
    state: overrides.state ?? taskState(),
    workflowStore: overrides.workflowStore ?? createWorkflowStore(events, overrides.workflowState, root),
    ...overrides,
    async walletTransfer(transferInput) {
      events.push({ type: 'wallet.transfer', input: transferInput });
      return overrides.walletTransfer
        ? overrides.walletTransfer(transferInput)
        : commandSuccess({ txid: 'payment-txid' });
    },
    async writeChain(request) {
      events.push({ type: 'writeChain', request });
      return overrides.writeChain
        ? overrides.writeChain(request)
        : commandSuccess({
          pinId: acceptancePinId,
          txids: ['acceptance-txid'],
          network: request.network,
          globalMetaId: requesterGlobalMetaId,
        });
    },
    now: () => 1778889600000,
  };
  delete input.events;
  delete input.root;
  delete input.workflowState;
  return { events, input, root };
}

function writePayloads(events) {
  return events
    .filter((event) => event.type === 'writeChain')
    .map((event) => JSON.parse(event.request.payload));
}

test('buildLoomPaymentAmountRaw maps supported bounty currencies', () => {
  assert.equal(buildLoomPaymentAmountRaw({ amount: '1', currency: 'SPACE' }), '1SPACE');
  assert.equal(buildLoomPaymentAmountRaw({ amount: '0.5', currency: 'BTC' }), '0.5BTC');
  assert.equal(buildLoomPaymentAmountRaw({ amount: '2', currency: 'DOGE' }), '2DOGE');
  assert.equal(buildLoomPaymentAmountRaw({ amount: '3', currency: 'OPCAT' }), '3OPCAT');
});

test('accept-and-pay by non-requester returns permission_denied and does not call wallet, chain, or persist', async () => {
  const { events, input } = await createDeps({ requesterGlobalMetaId: otherRequesterGlobalMetaId });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.deepEqual(events, []);
});

test('accept-and-pay without confirmPayment previews wallet transfer and writes no acceptance', async () => {
  const { events, input } = await createDeps({
    confirmPayment: false,
    walletTransfer: (transferInput) => commandAwaitingConfirmation({
      toAddress: transferInput.toAddress,
      amount: transferInput.amountRaw,
      currency: 'SPACE',
    }),
  });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.taskPinId, taskPinId);
  assert.equal(result.data.claimPinId, claimPinId);
  assert.equal(result.data.deliveryPinId, deliveryPinId);
  assert.deepEqual(events.map((event) => event.type), ['wallet.transfer']);
  assert.deepEqual(events[0].input, {
    from: 'requester',
    toAddress: '1DeveloperPayoutAddress',
    amountRaw: '1.25SPACE',
    confirm: false,
  });
});

test('accept-and-pay with confirmPayment transfers and writes passed acceptance with paymentTxId', async () => {
  const { events, input } = await createDeps();

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.paymentTxId, 'payment-txid');
  assert.equal(result.data.acceptancePinId, acceptancePinId);
  assert.deepEqual(events.map((event) => event.type), ['wallet.transfer', 'writeChain', 'workflow.read', 'workflow.write']);
  assert.deepEqual(events[0].input, {
    from: 'requester',
    toAddress: '1DeveloperPayoutAddress',
    amountRaw: '1.25SPACE',
    confirm: true,
  });
  assert.deepEqual(writePayloads(events), [{
    taskPinId,
    deliveryPinId,
    verdict: 'passed',
    score: 5,
    comment: 'Delivery satisfies the task criteria.',
    releasePayment: true,
    paymentTxId: 'payment-txid',
  }]);
  assert.equal(events[3].state.acceptance.pinId, acceptancePinId);
  assert.equal(events[3].state.acceptance.paymentTxId, 'payment-txid');
});

test('payment failure does not write acceptance', async () => {
  const { events, input } = await createDeps({
    walletTransfer: () => commandFailed('transfer_broadcast_failed', 'transfer failed'),
  });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payment_failed');
  assert.deepEqual(events.map((event) => event.type), ['wallet.transfer']);
});

test('payment success without a txid fails before acceptance write', async () => {
  const { events, input } = await createDeps({
    walletTransfer: () => commandSuccess({ explorerUrl: 'https://example.invalid/tx/missing' }),
  });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payment_failed');
  assert.deepEqual(events.map((event) => event.type), ['wallet.transfer']);
});

test('acceptance write failure after payment returns retry data and saved artifacts without another payment step', async () => {
  const { events, input } = await createDeps({
    writeChain: () => commandFailed('chain_write_failed', 'chain unavailable'),
  });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'acceptance_write_failed_after_payment');
  assert.equal(result.data.paymentTxId, 'payment-txid');
  assert.match(result.data.retryGuidance, /must not call wallet transfer/i);
  assert.match(result.data.retryGuidance, /metabot chain write/i);
  assert.doesNotMatch(result.data.retryGuidance, /accept-and-pay/);
  assert.equal(result.data.acceptancePayload.paymentTxId, 'payment-txid');
  assert.equal(result.data.chainRequest.from, 'requester');
  assert.equal(result.data.chainRequest.network, 'mvc');
  assert.equal(events.filter((event) => event.type === 'wallet.transfer').length, 1);
  assert.equal(events.filter((event) => event.type === 'workflow.write').length, 1);

  const savedPayload = JSON.parse(await fs.readFile(result.data.savedArtifacts.acceptancePayloadPath, 'utf8'));
  const savedRequest = JSON.parse(await fs.readFile(result.data.savedArtifacts.acceptanceRequestPath, 'utf8'));
  assert.deepEqual(savedPayload, result.data.acceptancePayload);
  assert.deepEqual(savedRequest, result.data.chainRequest);
});

test('already accepted paid returns already_accepted_paid and does not pay again', async () => {
  const { events, input } = await createDeps({ state: taskState({ accepted: true }) });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_accepted_paid');
  assert.deepEqual(events, []);
});

test('review-delivery writes rejected and revision_needed with releasePayment false and no paymentTxId', async () => {
  for (const verdict of ['rejected', 'revision_needed']) {
    const { events, input } = await createDeps({
      verdict,
      score: verdict === 'rejected' ? 2 : 3,
      comment: `${verdict} review.`,
      attachments: [`metafile://${verdict}`],
    });

    const result = await runLoomReviewDeliveryWorkflow(input);

    assert.equal(result.ok, true);
    assert.equal(result.state, 'success');
    assert.equal(result.data.acceptancePinId, acceptancePinId);
    assert.deepEqual(events.map((event) => event.type), ['writeChain', 'workflow.read', 'workflow.write']);
    const [payload] = writePayloads(events);
    assert.equal(payload.verdict, verdict);
    assert.equal(payload.releasePayment, false);
    assert.equal(Object.hasOwn(payload, 'paymentTxId'), false);
    assert.deepEqual(payload.attachments, [`metafile://${verdict}`]);
    assert.equal(events.some((event) => event.type === 'wallet.transfer'), false);
  }
});

test('review-delivery invalid verdict is rejected by core before chain write', async () => {
  const { events, input } = await createDeps({ verdict: 'passed' });

  const result = await runLoomReviewDeliveryWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_flag');
  assert.deepEqual(events, []);
});

test('missing delivery returns delivery_not_found before side effects', async () => {
  const { events, input } = await createDeps({ state: taskState({ includeDelivery: false }) });

  const result = await runLoomAcceptAndPayWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'delivery_not_found');
  assert.deepEqual(events, []);
});

test('missing payout or bounty fails before payment', async () => {
  const missingPayout = await createDeps({ state: taskState({ claimPayload: { payoutAddress: '' } }) });
  const missingPayoutResult = await runLoomAcceptAndPayWorkflow(missingPayout.input);

  assert.equal(missingPayoutResult.ok, false);
  assert.equal(missingPayoutResult.code, 'invalid_loom_state');
  assert.deepEqual(missingPayout.events, []);

  const missingBounty = await createDeps({ state: taskState({ taskPayload: taskPayload({ bounty: { amount: '', currency: 'SPACE' } }) }) });
  const missingBountyResult = await runLoomAcceptAndPayWorkflow(missingBounty.input);

  assert.equal(missingBountyResult.ok, false);
  assert.equal(missingBountyResult.code, 'invalid_bounty');
  assert.deepEqual(missingBounty.events, []);

  const invalidBounty = await createDeps({ state: taskState({ taskPayload: taskPayload({ bounty: { amount: 'not-a-number', currency: 'SPACE' } }) }) });
  const invalidBountyResult = await runLoomAcceptAndPayWorkflow(invalidBounty.input);

  assert.equal(invalidBountyResult.ok, false);
  assert.equal(invalidBountyResult.code, 'invalid_bounty');
  assert.deepEqual(invalidBounty.events, []);
});
