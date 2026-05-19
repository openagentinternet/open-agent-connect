import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const { createLoomUiActionService } = require('../../dist/core/loom/index.js');

function success(data = {}) {
  return { ok: true, state: 'success', data };
}

function failed(code, message, data) {
  return { ok: false, state: 'failed', code, message, ...(data ? { data } : {}) };
}

function createHarness(overrides = {}) {
  const calls = [];
  const dependency = (name, result = success({ dependency: name })) => async (input) => {
    calls.push({ name, input });
    return result;
  };
  const dependencies = {
    postTask: dependency('postTask', success({ posted: true })),
    claimAndStart: dependency('claimAndStart', success({ claimed: true })),
    runDevRound: dependency('runDevRound', success({ rounded: true })),
    deliver: dependency('deliver', success({ delivered: true })),
    acceptAndPay: dependency('acceptAndPay', success({ accepted: true })),
    reviewDelivery: dependency('reviewDelivery', success({ reviewed: true })),
    ...overrides,
  };
  return {
    calls,
    service: createLoomUiActionService(dependencies),
  };
}

function assertPreview(result, action) {
  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.action, action);
  assert.equal(result.data.confirmed, false);
  assert.equal(result.data.requiresConfirmation, true);
  assert.equal(result.data.dashboardRefreshRecommended, false);
  assert.equal(typeof result.data.cliFallback, 'string');
}

test('postTask previews with dryRun and confirms with dryRun false', async () => {
  const { service, calls } = createHarness({
    postTask: async (input) => {
      calls.push({ name: 'postTask', input });
      return success({ dryRun: input.dryRun, payload: input.payload });
    },
  });

  const preview = await service.run({ action: 'postTask', confirm: false, from: 'requester', payload: { title: 'Task' } });
  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.action, 'postTask');
  assert.equal(preview.data.confirmed, false);
  assert.equal(preview.data.preview.dryRun, true);
  assert.match(preview.data.cliFallback, /metabot loom post-task/);

  const confirmed = await service.run({ action: 'postTask', confirm: true, from: 'requester', payload: { title: 'Task' } });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.dryRun, false);
  assert.equal(confirmed.data.dashboardRefreshRecommended, true);
  assert.deepEqual(calls.map((call) => call.input.dryRun), [true, false]);
});

test('acceptAndPay previews payment and confirms with confirmPayment true', async () => {
  const { service, calls } = createHarness({
    acceptAndPay: async (input) => {
      calls.push({ name: 'acceptAndPay', input });
      return input.confirmPayment
        ? success({ paymentTxId: 'tx1' })
        : { ok: true, state: 'awaiting_confirmation', data: { amountRaw: '1000' } };
    },
  });

  const preview = await service.run({
    action: 'acceptAndPay',
    confirm: false,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assertPreview(preview, 'acceptAndPay');
  assert.equal(preview.data.preview.amountRaw, '1000');
  assert.doesNotMatch(preview.data.cliFallback, /--confirm-payment/);

  const confirmed = await service.run({
    action: 'acceptAndPay',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.paymentTxId, 'tx1');
  assert.deepEqual(calls.map((call) => call.input.confirmPayment), [false, true]);
});

test('acceptAndPay preview failure uses non-confirming CLI fallback', async () => {
  const { service } = createHarness({
    acceptAndPay: async () => failed('payment_preview_failed', 'Unable to preview payment.'),
  });

  const result = await service.run({
    action: 'acceptAndPay',
    confirm: false,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payment_preview_failed');
  assert.match(result.data.cliFallback, /metabot loom accept-and-pay/);
  assert.doesNotMatch(result.data.cliFallback, /--confirm-payment/);
});

test('requestRevision previews locally and confirms through reviewDelivery revision verdict', async () => {
  const { service, calls } = createHarness();

  const preview = await service.run({
    action: 'requestRevision',
    confirm: false,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assertPreview(preview, 'requestRevision');
  assert.equal(preview.data.verdict, 'revision_needed');
  assert.equal(calls.length, 0);

  const confirmed = await service.run({
    action: 'requestRevision',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assert.equal(confirmed.ok, true);
  assert.equal(calls[0].name, 'reviewDelivery');
  assert.equal(calls[0].input.verdict, 'revision_needed');
});

test('reject previews locally and confirms through reviewDelivery rejected verdict', async () => {
  const { service, calls } = createHarness();

  const preview = await service.run({
    action: 'reject',
    confirm: false,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assertPreview(preview, 'reject');
  assert.equal(preview.data.verdict, 'rejected');
  assert.equal(calls.length, 0);

  await service.run({
    action: 'reject',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assert.equal(calls[0].name, 'reviewDelivery');
  assert.equal(calls[0].input.verdict, 'rejected');
});

test('claimAndStart previews with dryRun and confirms through workflow', async () => {
  const { service, calls } = createHarness({
    claimAndStart: async (input) => {
      calls.push({ name: 'claimAndStart', input });
      return success({ dryRun: input.dryRun, taskPinId: input.taskPinId });
    },
  });

  const preview = await service.run({ action: 'claimAndStart', confirm: false, from: 'dev', taskPinId: 'task1' });
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.preview.dryRun, true);

  const confirmed = await service.run({ action: 'claimAndStart', confirm: true, from: 'dev', taskPinId: 'task1' });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(calls.map((call) => call.input.dryRun), [true, false]);
});

test('runDevRound previews locally and confirms through workflow', async () => {
  const { service, calls } = createHarness();

  const preview = await service.run({
    action: 'runDevRound',
    confirm: false,
    from: 'dev',
    taskPinId: 'task1',
    claimPinId: 'claim1',
  });
  assertPreview(preview, 'runDevRound');
  assert.equal(preview.data.taskPinId, 'task1');
  assert.equal(preview.data.claimPinId, 'claim1');
  assert.equal(calls.length, 0);

  await service.run({
    action: 'runDevRound',
    confirm: true,
    from: 'dev',
    taskPinId: 'task1',
    claimPinId: 'claim1',
  });
  assert.equal(calls[0].name, 'runDevRound');
});

test('deliver previews with dryRun and confirms through workflow', async () => {
  const { service, calls } = createHarness({
    deliver: async (input) => {
      calls.push({ name: 'deliver', input });
      return success({ dryRun: input.dryRun, claimPinId: input.claimPinId });
    },
  });

  const preview = await service.run({
    action: 'deliver',
    confirm: false,
    from: 'dev',
    taskPinId: 'task1',
    claimPinId: 'claim1',
  });
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.preview.dryRun, true);

  await service.run({
    action: 'deliver',
    confirm: true,
    from: 'dev',
    taskPinId: 'task1',
    claimPinId: 'claim1',
  });
  assert.deepEqual(calls.map((call) => call.input.dryRun), [true, false]);
});

test('missing IDs fail before dependencies and include CLI fallback when possible', async () => {
  const { service, calls } = createHarness();

  const cases = [
    { action: 'claimAndStart', confirm: true, from: 'dev', code: 'loom_task_pin_id_required' },
    { action: 'runDevRound', confirm: true, from: 'dev', taskPinId: 'task1', code: 'loom_claim_pin_id_required' },
    { action: 'deliver', confirm: true, from: 'dev', taskPinId: 'task1', code: 'loom_claim_pin_id_required' },
    { action: 'acceptAndPay', confirm: true, from: 'requester', taskPinId: 'task1', code: 'loom_delivery_pin_id_required' },
    { action: 'requestRevision', confirm: true, from: 'requester', taskPinId: 'task1', code: 'loom_delivery_pin_id_required' },
  ];

  for (const input of cases) {
    const result = await service.run(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, input.code);
    assert.equal(typeof result.data.cliFallback, 'string');
  }
  assert.equal(calls.length, 0);
});

test('confirming actor-bound actions requires from and includes CLI fallback', async () => {
  const { service, calls } = createHarness();

  const result = await service.run({ action: 'deliver', confirm: true, taskPinId: 'task1', claimPinId: 'claim1' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'loom_actor_required');
  assert.match(result.data.cliFallback, /--from '<actor>'/);
  assert.equal(calls.length, 0);
});

test('unsupported action returns loom_action_invalid', async () => {
  const { service } = createHarness();

  const result = await service.run({ action: 'reviewDelivery', confirm: true });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'loom_action_invalid');
});

test('duplicate or finalized payment failures propagate original data and add CLI fallback', async () => {
  const { service } = createHarness({
    acceptAndPay: async () => failed('already_accepted_paid', 'Already paid.', {
      deliveryPinId: 'delivery1',
      paymentTxId: 'existing-tx',
      cliFallback: 'original fallback',
    }),
  });

  const result = await service.run({
    action: 'acceptAndPay',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_accepted_paid');
  assert.equal(result.data.deliveryPinId, 'delivery1');
  assert.equal(result.data.paymentTxId, 'existing-tx');
  assert.equal(result.data.cliFallback, 'original fallback');

  const { service: serviceWithoutFallback } = createHarness({
    acceptAndPay: async () => failed('already_accepted_paid', 'Already paid.', { paymentTxId: 'existing-tx' }),
  });
  const enriched = await serviceWithoutFallback.run({
    action: 'acceptAndPay',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });
  assert.equal(enriched.data.paymentTxId, 'existing-tx');
  assert.equal(Object.hasOwn(enriched.data, 'cliFallback'), false);
});

test('post-payment acceptance write failures preserve recovery data without payment retry fallback', async () => {
  const recoveryData = {
    paymentTxId: 'payment-tx-1',
    acceptancePayload: { taskPinId: 'task1', deliveryPinId: 'delivery1' },
    retryGuidance: 'Publish the saved acceptance request without calling wallet transfer again.',
  };
  const { service } = createHarness({
    acceptAndPay: async () => failed(
      'acceptance_write_failed_after_payment',
      'Payment succeeded but acceptance write failed.',
      recoveryData,
    ),
  });

  const result = await service.run({
    action: 'acceptAndPay',
    confirm: true,
    from: 'requester',
    taskPinId: 'task1',
    deliveryPinId: 'delivery1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'acceptance_write_failed_after_payment');
  assert.equal(result.data.paymentTxId, recoveryData.paymentTxId);
  assert.deepEqual(result.data.acceptancePayload, recoveryData.acceptancePayload);
  assert.equal(result.data.retryGuidance, recoveryData.retryGuidance);
  assert.equal(Object.hasOwn(result.data, 'cliFallback'), false);
});

test('dashboard refresh hook failure does not mask confirmed success', async () => {
  const { service } = createHarness({
    postTask: async () => success({ pinId: 'task-pin-1' }),
    dashboardAfterAction: async () => {
      throw new Error('dashboard refresh failed');
    },
  });

  const result = await service.run({
    action: 'postTask',
    confirm: true,
    from: 'requester',
    payload: { title: 'Task' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, 'task-pin-1');
  assert.equal(result.data.dashboardRefreshRecommended, true);
  assert.match(result.data.dashboardRefreshWarning.message, /dashboard refresh failed/);
});
