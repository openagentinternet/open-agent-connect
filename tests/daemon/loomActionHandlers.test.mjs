import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  createLoomDaemonActionDependencies,
  createLoomDaemonActionHandler,
} = require('../../dist/daemon/defaultHandlers.js');

function success(data = {}) {
  return { ok: true, state: 'success', data };
}

function failed(code, message, data) {
  return { ok: false, state: 'failed', code, message, ...(data ? { data } : {}) };
}

function createWorkflowHarness(overrides = {}) {
  const calls = [];
  const signerWrites = [];
  const uploads = [];
  const walletTransfers = [];
  const resolvedStates = [];
  const actor = {
    homeDir: '/tmp/oac-loom-dev',
    paths: { profileRoot: '/tmp/oac-loom-dev' },
    signer: {
      writePin: async (request) => {
        signerWrites.push(request);
        return {
          pinId: 'pin-write-1',
          txids: ['tx-write-1'],
          network: request.network ?? 'mvc',
          globalMetaId: 'gm-dev',
          mvcAddress: 'addr-dev',
        };
      },
    },
    workflowStore: { kind: 'workflow-store' },
    rawCacheStore: { kind: 'raw-cache-store' },
    metaBotSlug: 'dev',
    globalMetaId: 'gm-dev',
  };
  const taskState = {
    found: true,
    taskPinId: 'task-1',
    task: {
      pinId: 'task-1',
      payload: {
        title: 'Task',
        bounty: { amount: '1', currency: 'SPACE' },
      },
    },
    claims: [],
    deliveries: [],
    acceptances: [],
    reviews: [],
    events: [],
  };
  const workflow = (name, result = success({ workflow: name })) => async (input) => {
    calls.push({ name, input });
    return result;
  };
  const dependencies = createLoomDaemonActionDependencies({
    resolveActor: async () => actor,
    resolveTaskState: async (_actor, taskPinId, options = {}) => {
      resolvedStates.push({ taskPinId, options });
      return taskState;
    },
    readPayloadFile: async () => ({ title: 'From file' }),
    draftTask: async () => success({ payload: { title: 'Drafted' } }),
    ensureDevRoundLlmAvailable: async () => undefined,
    executeDevRoundLlm: async () => ({ status: 'completed', output: 'done' }),
    walletTransfer: async (_actor, rawActor, transferInput) => {
      walletTransfers.push({ rawActor, transferInput });
      return success({ txid: 'payment-tx-1' });
    },
    writeChain: (resolvedActor) => async (request) => resolvedActor.signer.writePin(request).then((result) => success(result)),
    uploadFile: () => async (uploadInput) => {
      uploads.push(uploadInput);
      return { metafileUri: 'metafile://log' };
    },
    runnerFactory: () => ({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    github: {
      assertToolsReady: async () => success({ ready: true }),
      prepareForkWorkspace: async () => success({ workspacePath: '/tmp/workspace' }),
      pushLoomBranch: async () => success({ pushed: true }),
      createLoomPullRequest: async () => success({ prUrl: 'https://github.test/pr/1' }),
    },
    writeLogFile: async () => ({ filePath: '/tmp/log.md', contentType: 'text/markdown' }),
    removePath: async () => {},
    renamePath: async () => {},
    pathExists: async () => false,
    workflows: {
      postTask: workflow('postTask'),
      claimAndStart: workflow('claimAndStart'),
      runDevRound: workflow('runDevRound'),
      deliver: workflow('deliver'),
      acceptAndPay: workflow('acceptAndPay'),
      reviewDelivery: workflow('reviewDelivery'),
      ...overrides.workflows,
    },
    ...overrides.boundaries,
  });
  return {
    actor,
    calls,
    signerWrites,
    uploads,
    walletTransfers,
    resolvedStates,
    handler: createLoomDaemonActionHandler(dependencies),
  };
}

test('postTask confirm true reaches post-task workflow semantics with payload and dryRun false', async () => {
  const { calls, handler } = createWorkflowHarness();
  const payload = {
    title: 'Build the route',
    requirementContentType: 'text/markdown',
    requirement: 'Wire daemon action endpoint.',
    criteriaContentType: 'text/markdown',
    criteria: '- Action is posted',
    projectBase: 'chain',
    project: {},
    bounty: { amount: '1', currency: 'SPACE' },
  };

  const result = await handler({
    action: 'postTask',
    confirm: true,
    from: 'requester',
    payload,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.name), ['postTask']);
  assert.equal(calls[0].input.dryRun, false);
  assert.deepEqual(calls[0].input.payload, payload);
});

test('claimAndStart confirm true reaches claim/start workflow layer and workflow-provided writeChain', async () => {
  const { calls, handler, signerWrites } = createWorkflowHarness({
    workflows: {
      claimAndStart: async (input) => {
        calls.push({ name: 'claimAndStart', input });
        const writeResult = await input.writeChain({ path: '/protocols/loom-claim', payload: '{}' });
        return success({ writeResult });
      },
    },
  });

  const result = await handler({
    action: 'claimAndStart',
    confirm: true,
    from: 'dev',
    taskPinId: 'task-1',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.name), ['claimAndStart']);
  assert.equal(calls[0].input.dryRun, false);
  assert.equal(calls[0].input.taskPinId, 'task-1');
  assert.deepEqual(signerWrites, [{ path: '/protocols/loom-claim', payload: '{}' }]);
});

test('runDevRound preflights LLM before mutating workflow and reaches dev-round wiring when available', async () => {
  const available = createWorkflowHarness();

  await available.handler({
    action: 'runDevRound',
    confirm: true,
    from: 'dev',
    taskPinId: 'task-1',
    claimPinId: 'claim-1',
  });

  assert.deepEqual(available.calls.map((call) => call.name), ['runDevRound']);
  assert.equal(available.calls[0].input.claimPinId, 'claim-1');
  assert.equal(typeof available.calls[0].input.executeLlmRound, 'function');

  const unavailable = createWorkflowHarness({
    boundaries: {
      ensureDevRoundLlmAvailable: async () => failed('llm_runtime_unavailable', 'No healthy LLM runtime is available.'),
    },
  });
  const result = await unavailable.handler({
    action: 'runDevRound',
    confirm: true,
    from: 'dev',
    taskPinId: 'task-1',
    claimPinId: 'claim-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'llm_runtime_unavailable');
  assert.equal(unavailable.calls.length, 0);
});

test('deliver confirm true reaches delivery workflow wiring', async () => {
  const { calls, handler } = createWorkflowHarness();

  await handler({
    action: 'deliver',
    confirm: true,
    from: 'dev',
    taskPinId: 'task-1',
    claimPinId: 'claim-1',
  });

  assert.deepEqual(calls.map((call) => call.name), ['deliver']);
  assert.equal(calls[0].input.dryRun, false);
  assert.equal(calls[0].input.github.createLoomPullRequest instanceof Function, true);
});

test('acceptAndPay confirm true reaches accept/pay workflow and preserves recovery output', async () => {
  const recovery = {
    paymentTxId: 'payment-tx-1',
    retryGuidance: 'Retry acceptance write after payment confirmation.',
    acceptancePayload: { verdict: 'accepted' },
  };
  const { calls, handler, resolvedStates } = createWorkflowHarness({
    workflows: {
      acceptAndPay: async (input) => {
        calls.push({ name: 'acceptAndPay', input });
        return failed('acceptance_write_failed_after_payment', 'Acceptance write failed after payment.', recovery);
      },
    },
  });

  const result = await handler({
    action: 'acceptAndPay',
    confirm: true,
    from: 'requester',
    taskPinId: 'task-1',
    deliveryPinId: 'delivery-1',
  });

  assert.deepEqual(calls.map((call) => call.name), ['acceptAndPay']);
  assert.equal(calls[0].input.confirmPayment, true);
  assert.deepEqual(resolvedStates.at(-1), { taskPinId: 'task-1', options: { requireFresh: true } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'acceptance_write_failed_after_payment');
  assert.deepEqual(result.data, recovery);
});

test('requestRevision and reject confirm true reach reviewDelivery with expected verdicts', async () => {
  const { calls, handler } = createWorkflowHarness();

  await handler({
    action: 'requestRevision',
    confirm: true,
    from: 'requester',
    taskPinId: 'task-1',
    deliveryPinId: 'delivery-1',
  });
  await handler({
    action: 'reject',
    confirm: true,
    from: 'requester',
    taskPinId: 'task-1',
    deliveryPinId: 'delivery-2',
  });

  assert.deepEqual(calls.map((call) => call.name), ['reviewDelivery', 'reviewDelivery']);
  assert.equal(calls[0].input.verdict, 'revision_needed');
  assert.equal(calls[1].input.verdict, 'rejected');
});

test('confirm false for requestRevision, reject, and runDevRound does not call mutating workflow dependencies', async () => {
  const { calls, handler } = createWorkflowHarness();

  const revision = await handler({
    action: 'requestRevision',
    confirm: false,
    from: 'requester',
    taskPinId: 'task-1',
    deliveryPinId: 'delivery-1',
  });
  const rejection = await handler({
    action: 'reject',
    confirm: false,
    from: 'requester',
    taskPinId: 'task-1',
    deliveryPinId: 'delivery-1',
  });
  const devRound = await handler({
    action: 'runDevRound',
    confirm: false,
    from: 'dev',
    taskPinId: 'task-1',
    claimPinId: 'claim-1',
  });

  assert.equal(revision.state, 'awaiting_confirmation');
  assert.equal(rejection.state, 'awaiting_confirmation');
  assert.equal(devRound.state, 'awaiting_confirmation');
  assert.equal(calls.length, 0);
});
