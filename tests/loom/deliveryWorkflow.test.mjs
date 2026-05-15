import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  runLoomDeliverWorkflow,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const deliveryPinId = `${'c'.repeat(64)}i0`;
const developerGlobalMetaId = 'metaid-developer';
const otherDeveloperGlobalMetaId = 'metaid-other-developer';
const workspacePath = '/tmp/metabot-loom-delivery/repo';

function validTaskPayload(overrides = {}) {
  return {
    title: 'Add Loom delivery workflow',
    requirementContentType: 'text/markdown',
    requirement: 'Create a pull request and publish a Loom delivery.',
    criteriaContentType: 'text/markdown',
    criteria: '- Pushes the branch\n1. Creates a PR\n2) Writes delivery state',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
    ...overrides,
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

  const task = cachedRecord('task', taskPinId, options.taskPayload ?? validTaskPayload());
  const claim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: options.claimAuthor ?? developerGlobalMetaId });
  return {
    found: true,
    taskPinId,
    state: 'in_progress',
    task,
    valid: {
      claims: options.claims ?? [claim],
      statuses: [],
      deliveries: options.deliveries ?? [],
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

function workflowState(overrides = {}) {
  return {
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'alice',
    developerGlobalMetaId,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    forkRepo: 'alice/open-agent-connect',
    branchName: 'loom/task-claim',
    workspacePath,
    claim: { pinId: claimPinId },
    statuses: [{
      roundId: 'round-1',
      status: 'completed',
      pinId: `${'d'.repeat(64)}i0`,
      processLogPath: '/tmp/process-log.md',
      processLogUri: 'metafile://process-log.md',
      llmSessionId: 'llm-session-1',
      commits: [{ sha: 'abc123456789', message: 'feat: add delivery workflow', files: ['src/core/loom/deliveryWorkflow.ts'] }],
      checksPassed: true,
    }],
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function commandSuccess(data = {}) {
  return { ok: true, state: 'success', data };
}

function commandFailed(code, message = code) {
  return { ok: false, state: 'failed', code, message };
}

function createWorkflowStore(events, state = workflowState()) {
  return {
    paths: { profileRoot: '/tmp/metabot-loom-delivery/profile' },
    resolve(pinId, resolvedClaimPinId) {
      return {
        loomRuntimeRoot: '/tmp/metabot-loom-delivery/runtime/loom',
        workflowsRoot: '/tmp/metabot-loom-delivery/runtime/loom/workflows',
        stagingRoot: '/tmp/metabot-loom-delivery/runtime/loom/staging',
        workspacesRoot: '/tmp/metabot-loom-delivery/runtime/loom/workspaces',
        logsRoot: '/tmp/metabot-loom-delivery/runtime/loom/logs',
        workflowPath: path.join('/tmp/metabot-loom-delivery/runtime/loom/workflows', pinId, `${resolvedClaimPinId ?? 'pending-claim'}.json`),
        stagingRepoPath: path.join('/tmp/metabot-loom-delivery/runtime/loom/staging', pinId, 'run', 'repo'),
        workspaceRepoPath: workspacePath,
        taskLogsRoot: path.join('/tmp/metabot-loom-delivery/runtime/loom/logs', pinId),
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

function createDeps(overrides = {}) {
  const events = overrides.events ?? [];
  const input = {
    from: 'alice',
    taskPinId,
    claimPinId,
    chain: 'doge',
    prTitle: 'feat: add loom delivery workflow',
    deliverySummary: 'Delivery workflow is ready for review.',
    dryRun: false,
    developerMetaBotSlug: 'alice',
    developerGlobalMetaId,
    state: taskState(),
    workflowStore: overrides.workflowStore ?? createWorkflowStore(events, overrides.workflowState),
    runner: {
      async run(runInput) {
        events.push({ type: 'runner.run', input: runInput });
        return { command: runInput.command, args: runInput.args, cwd: runInput.cwd, exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
      },
    },
    github: {
      async assertToolsReady(toolInput) {
        events.push({ type: 'github.assertToolsReady', input: toolInput });
        return commandSuccess({ gitVersion: 'git version 2', ghVersion: 'gh version 2' });
      },
      async pushLoomBranch(pushInput) {
        events.push({ type: 'github.pushLoomBranch', input: pushInput });
        return commandSuccess({ branchName: pushInput.branchName });
      },
      async createLoomPullRequest(prInput) {
        events.push({ type: 'github.createLoomPullRequest', input: prInput });
        return commandSuccess({ url: 'https://github.com/openagentinternet/open-agent-connect/pull/123' });
      },
    },
    async writeChain(request) {
      events.push({ type: 'writeChain', request });
      return commandSuccess({
        pinId: deliveryPinId,
        txids: ['delivery-tx'],
        network: request.network,
        globalMetaId: developerGlobalMetaId,
      });
    },
    now: () => 1778889600000,
    ...overrides,
  };
  delete input.workflowState;
  delete input.events;
  return { events, input };
}

function deliveryPayloads(events) {
  return events
    .filter((event) => event.type === 'writeChain')
    .map((event) => JSON.parse(event.request.payload));
}

test('runLoomDeliverWorkflow denies a claim owned by another author', async () => {
  const { events, input } = createDeps({
    state: taskState({ claimAuthor: otherDeveloperGlobalMetaId }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
});

test('runLoomDeliverWorkflow requires the latest local status to have passing checks', async () => {
  for (const checksPassed of [false, null, undefined]) {
    const events = [];
    const { input } = createDeps({
      events,
      workflowState: workflowState({
        statuses: [{
          roundId: 'round-1',
          status: 'completed',
          commits: [],
          ...(checksPassed !== undefined ? { checksPassed } : {}),
        }],
      }),
    });

    const result = await runLoomDeliverWorkflow(input);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'check_failed');
    assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
    assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  }
});

test('runLoomDeliverWorkflow rejects a non-GitHub task before delivery side effects', async () => {
  const { events, input } = createDeps({
    state: taskState({
      taskPayload: validTaskPayload({
        projectBase: 'chain',
        project: {},
      }),
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_project_base');
  assert.deepEqual(events.filter((event) => event.type === 'github.assertToolsReady'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
});

test('runLoomDeliverWorkflow rejects a GitHub task with a missing repository before delivery side effects', async () => {
  const { events, input } = createDeps({
    state: taskState({
      taskPayload: validTaskPayload({
        project: {
          baseBranch: 'main',
        },
      }),
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_project');
  assert.match(result.message, /project\.repoUri/);
  assert.deepEqual(events.filter((event) => event.type === 'github.assertToolsReady'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
});

test('runLoomDeliverWorkflow rejects a GitHub task with a missing base branch before delivery side effects', async () => {
  const { events, input } = createDeps({
    state: taskState({
      taskPayload: validTaskPayload({
        project: {
          repoUri: 'https://github.com/openagentinternet/open-agent-connect',
        },
      }),
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_project');
  assert.match(result.message, /project\.baseBranch/);
  assert.deepEqual(events.filter((event) => event.type === 'github.assertToolsReady'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDeliverWorkflow rejects an already persisted local delivery', async () => {
  const { events, input } = createDeps({
    workflowState: workflowState({
      delivery: {
        pinId: deliveryPinId,
        prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/122',
        prTitle: 'feat: previous delivery',
      },
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_delivered');
  assert.equal(result.data.deliveryPinId, deliveryPinId);
  assert.equal(result.data.source, 'local_workflow');
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
});

test('runLoomDeliverWorkflow rejects an existing valid chain delivery for the claim', async () => {
  const chainDelivery = cachedRecord('delivery', deliveryPinId, {
    taskPinId,
    claimPinId,
    deliveryBase: 'github',
    deliverySummary: 'Already delivered.',
    delivery: {
      prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/122',
      prBranch: 'loom/task-claim',
      prBaseBranch: 'main',
      prTitle: 'feat: previous delivery',
    },
    reviewChecklist: [{ item: 'Previous checklist item', status: 'passed' }],
  }, { globalMetaId: developerGlobalMetaId });
  const { events, input } = createDeps({
    state: taskState({ deliveries: [chainDelivery] }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_delivered');
  assert.equal(result.data.deliveryPinId, deliveryPinId);
  assert.equal(result.data.source, 'chain_projection');
  assert.equal(result.data.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/122');
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
});

test('runLoomDeliverWorkflow dry-run returns delivery plan and writes nothing', async () => {
  const { events, input } = createDeps({ dryRun: true });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.dryRun, true);
  assert.deepEqual(result.data.push, {
    workspacePath,
    forkRemote: 'fork',
    branchName: 'loom/task-claim',
  });
  assert.equal(result.data.pullRequest.baseBranch, 'main');
  assert.equal(result.data.pullRequest.head, 'alice:loom/task-claim');
  assert.equal(result.data.pullRequest.title, 'feat: add loom delivery workflow');
  assert.match(result.data.pullRequest.body, /Delivery workflow is ready for review/);
  assert.match(result.data.pullRequest.body, new RegExp(taskPinId));
  assert.equal(result.data.deliveryPayload.delivery.prBranch, 'loom/task-claim');
  assert.equal(result.data.deliveryPayload.delivery.prUrl, '(pending pull request URL)');
  assert.deepEqual(result.data.deliveryPayload.reviewChecklist, [
    { item: 'Pushes the branch', status: 'passed' },
    { item: 'Creates a PR', status: 'passed' },
    { item: 'Writes delivery state', status: 'passed' },
  ]);
  assert.equal(result.data.chainWritePreview.request.network, 'doge');
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDeliverWorkflow pushes, creates PR, writes delivery, and persists state', async () => {
  const { events, input } = createDeps();

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.dryRun, false);
  assert.equal(result.data.deliveryPinId, deliveryPinId);
  assert.equal(result.data.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/123');
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch').map((event) => event.input), [{
    runner: input.runner,
    workspacePath,
    forkRemote: 'fork',
    branchName: 'loom/task-claim',
  }]);
  const prInput = events.find((event) => event.type === 'github.createLoomPullRequest').input;
  assert.equal(prInput.repo, 'openagentinternet/open-agent-connect');
  assert.equal(prInput.baseBranch, 'main');
  assert.equal(prInput.head, 'alice:loom/task-claim');
  assert.match(prInput.body, /Task PIN/);
  assert.match(prInput.body, /Claim PIN/);
  assert.match(prInput.body, /Pushes the branch/);
  const payload = deliveryPayloads(events).at(-1);
  assert.equal(payload.taskPinId, taskPinId);
  assert.equal(payload.claimPinId, claimPinId);
  assert.equal(payload.deliveryBase, 'github');
  assert.equal(payload.delivery.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/123');
  assert.equal(payload.delivery.prBranch, 'loom/task-claim');
  assert.equal(payload.delivery.prBaseBranch, 'main');
  assert.equal(payload.delivery.prTitle, 'feat: add loom delivery workflow');
  const workflowWrite = events.find((event) => event.type === 'workflow.write');
  assert.equal(workflowWrite.state.delivery.pinId, deliveryPinId);
  assert.equal(workflowWrite.state.delivery.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/123');
  assert.equal(workflowWrite.state.delivery.prTitle, 'feat: add loom delivery workflow');
  assert.equal(workflowWrite.state.updatedAt, '2026-05-16T00:00:00.000Z');
});

test('runLoomDeliverWorkflow uses task project base branch instead of stale local workflow base branch', async () => {
  const { events, input } = createDeps({
    state: taskState({
      taskPayload: validTaskPayload({
        project: {
          repoUri: 'https://github.com/openagentinternet/open-agent-connect',
          baseBranch: 'release',
        },
      }),
    }),
    workflowState: workflowState({
      baseBranch: 'stale-local-base',
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, true);
  const prInput = events.find((event) => event.type === 'github.createLoomPullRequest').input;
  assert.equal(prInput.repo, 'openagentinternet/open-agent-connect');
  assert.equal(prInput.baseBranch, 'release');
  assert.equal(deliveryPayloads(events).at(-1).delivery.prBaseBranch, 'release');
  assert.equal(result.data.baseBranch, 'release');
});

test('runLoomDeliverWorkflow preflights GitHub tools before push', async () => {
  const { events, input } = createDeps({
    github: {
      async assertToolsReady(toolInput) {
        events.push({ type: 'github.assertToolsReady', input: toolInput });
        return commandFailed('github_auth_unavailable', 'GitHub CLI authentication is unavailable');
      },
      async pushLoomBranch(pushInput) {
        events.push({ type: 'github.pushLoomBranch', input: pushInput });
        return commandSuccess({ branchName: pushInput.branchName });
      },
      async createLoomPullRequest(prInput) {
        events.push({ type: 'github.createLoomPullRequest', input: prInput });
        return commandSuccess({ url: 'https://github.com/openagentinternet/open-agent-connect/pull/123' });
      },
    },
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_auth_unavailable');
  assert.equal(events.filter((event) => event.type === 'github.assertToolsReady').length, 1);
  assert.deepEqual(events.filter((event) => event.type === 'github.pushLoomBranch'), []);
  assert.deepEqual(events.filter((event) => event.type === 'github.createLoomPullRequest'), []);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDeliverWorkflow does not write delivery when PR creation fails', async () => {
  const { events, input } = createDeps({
    github: {
      async assertToolsReady(toolInput) {
        events.push({ type: 'github.assertToolsReady', input: toolInput });
        return commandSuccess({ gitVersion: 'git version 2', ghVersion: 'gh version 2' });
      },
      async pushLoomBranch(pushInput) {
        events.push({ type: 'github.pushLoomBranch', input: pushInput });
        return commandSuccess({ branchName: pushInput.branchName });
      },
      async createLoomPullRequest(prInput) {
        events.push({ type: 'github.createLoomPullRequest', input: prInput });
        return commandFailed('github_pr_failed', 'PR failed');
      },
    },
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_pr_failed');
  assert.equal(events.filter((event) => event.type === 'github.pushLoomBranch').length, 1);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDeliverWorkflow rejects an empty PR URL before chain write', async () => {
  const { events, input } = createDeps({
    github: {
      async assertToolsReady(toolInput) {
        events.push({ type: 'github.assertToolsReady', input: toolInput });
        return commandSuccess({ gitVersion: 'git version 2', ghVersion: 'gh version 2' });
      },
      async pushLoomBranch(pushInput) {
        events.push({ type: 'github.pushLoomBranch', input: pushInput });
        return commandSuccess({ branchName: pushInput.branchName });
      },
      async createLoomPullRequest(prInput) {
        events.push({ type: 'github.createLoomPullRequest', input: prInput });
        return commandSuccess({ url: '' });
      },
    },
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_pull_request');
  assert.equal(events.filter((event) => event.type === 'github.pushLoomBranch').length, 1);
  assert.equal(events.filter((event) => event.type === 'github.createLoomPullRequest').length, 1);
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDeliverWorkflow falls back to one checklist item from criteria summary', async () => {
  const { events, input } = createDeps({
    state: taskState({
      taskPayload: validTaskPayload({
        criteria: 'Review the finished pull request and verify the delivery manually.',
      }),
    }),
  });

  const result = await runLoomDeliverWorkflow(input);

  assert.equal(result.ok, true);
  assert.deepEqual(deliveryPayloads(events).at(-1).reviewChecklist, [{
    item: 'Review the finished pull request and verify the delivery manually.',
    status: 'passed',
  }]);
});

test('runLoomDeliverWorkflow returns recovery envelope when local delivery marker write fails', async () => {
  const events = [];
  const workflowStore = {
    ...createWorkflowStore(events),
    async write(nextState) {
      events.push({ type: 'workflow.write', state: nextState });
      throw new Error('disk full');
    },
  };
  const { input } = createDeps({ events, workflowStore });
  let result;

  await assert.doesNotReject(async () => {
    result = await runLoomDeliverWorkflow(input);
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'delivery_marker_failed');
  assert.equal(events.filter((event) => event.type === 'writeChain').length, 1);
  assert.equal(result.data.deliveryPinId, deliveryPinId);
  assert.equal(result.data.prUrl, 'https://github.com/openagentinternet/open-agent-connect/pull/123');
  assert.equal(result.data.workflowPath, path.join('/tmp/metabot-loom-delivery/runtime/loom/workflows', taskPinId, `${claimPinId}.json`));
  assert.equal(result.data.workspacePath, workspacePath);
  assert.equal(result.data.syncCommand, 'metabot loom sync');
  assert.equal(Object.hasOwn(result.data, 'retryCommand'), false);
  assert.equal(result.data.cause.message, 'disk full');
});
