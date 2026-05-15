import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  runLoomClaimAndStartWorkflow,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const otherClaimPinId = `${'c'.repeat(64)}i0`;
const statusPinId = `${'d'.repeat(64)}i0`;
const developerGlobalMetaId = 'metaid-developer';
const otherDeveloperGlobalMetaId = 'metaid-other-developer';

function validTaskPayload(overrides = {}) {
  return {
    title: 'Implement a Loom workflow',
    requirementContentType: 'text/markdown',
    requirement: 'Claim the task and prepare a working branch.',
    criteriaContentType: 'text/markdown',
    criteria: 'The claim and started status are written on chain.',
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
  const claims = options.claims ?? [];
  return {
    found: true,
    taskPinId,
    state: 'open',
    task,
    valid: {
      claims,
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

function createWorkflowStore(events = [], options = {}) {
  const root = '/tmp/metabot-loom-test';
  const writes = options.writes ?? [];
  return {
    writes,
    paths: { profileRoot: '/tmp/metabot-loom-test/profile' },
    resolve(pinId, resolvedClaimPinId, localRunId) {
      const taskSegment = pinId;
      const claimSegment = resolvedClaimPinId ?? 'pending-claim';
      const runSegment = localRunId ?? 'run';
      return {
        loomRuntimeRoot: path.join(root, 'runtime', 'loom'),
        workflowsRoot: path.join(root, 'runtime', 'loom', 'workflows'),
        stagingRoot: path.join(root, 'runtime', 'loom', 'staging'),
        workspacesRoot: path.join(root, 'runtime', 'loom', 'workspaces'),
        logsRoot: path.join(root, 'runtime', 'loom', 'logs'),
        workflowPath: path.join(root, 'runtime', 'loom', 'workflows', taskSegment, `${claimSegment}.json`),
        stagingRepoPath: path.join(root, 'runtime', 'loom', 'staging', taskSegment, runSegment, 'repo'),
        workspaceRepoPath: path.join(root, 'runtime', 'loom', 'workspaces', taskSegment, claimSegment, 'repo'),
        taskLogsRoot: path.join(root, 'runtime', 'loom', 'logs', taskSegment),
      };
    },
    async read(pinId, resolvedClaimPinId) {
      events.push({ type: 'workflow.read', taskPinId: pinId, claimPinId: resolvedClaimPinId });
      return writes.find((state) => state.taskPinId === pinId && state.claimPinId === resolvedClaimPinId) ?? null;
    },
    async write(state) {
      events.push({ type: 'workflow.write', state });
      writes.push(state);
      return state;
    },
  };
}

function commandSuccess(data = {}) {
  return { ok: true, state: 'success', data };
}

function commandFailed(code, message = code) {
  return { ok: false, state: 'failed', code, message };
}

function createDeps(overrides = {}) {
  const events = overrides.events ?? [];
  const workflowStore = overrides.workflowStore ?? createWorkflowStore(events);
  const runner = {
    async run(input) {
      events.push({ type: 'runner.run', input });
      return {
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
      };
    },
  };
  const deps = {
    events,
    input: {
      from: 'alice',
      taskPinId,
      payoutAddress: '1DeveloperPayoutAddress',
      chain: 'mvc',
      developerMetaBotSlug: 'alice',
      developerGlobalMetaId,
      state: taskState(),
      workflowStore,
      runner,
      github: {
        async assertToolsReady() {
          events.push({ type: 'github.assertToolsReady' });
          return commandSuccess({ gitVersion: 'git version 2', ghVersion: 'gh version 2' });
        },
        async prepareForkWorkspace(input) {
          events.push({ type: 'github.prepareForkWorkspace', input });
          return commandSuccess({
            upstreamRepo: { owner: 'openagentinternet', repo: 'open-agent-connect', fullName: 'openagentinternet/open-agent-connect' },
            forkRepo: { owner: 'alice', repo: 'open-agent-connect', fullName: 'alice/open-agent-connect' },
            branchName: input.branchName,
            workspacePath: input.workspaceRepoPath,
          });
        },
      },
      async writeChain(request) {
        events.push({ type: 'writeChain', request });
        const payload = JSON.parse(request.payload);
        return commandSuccess({
          pinId: payload.status === 'started' ? statusPinId : claimPinId,
          txids: [payload.status === 'started' ? 'status-tx' : 'claim-tx'],
          network: request.network,
          globalMetaId: developerGlobalMetaId,
        });
      },
      async uploadFile(input) {
        events.push({ type: 'uploadFile', input });
        return {
          metafileUri: 'metafile://process-log.md',
          pinId: 'process-log-pin',
          network: input.network,
        };
      },
      async writeLogFile(input) {
        events.push({ type: 'writeLogFile', input });
        return {
          path: path.join(input.directory, input.fileName),
          content: '# log\n',
        };
      },
      async removePath(targetPath) {
        events.push({ type: 'removePath', path: targetPath });
      },
      async renamePath(from, to) {
        events.push({ type: 'renamePath', from, to });
      },
      async pathExists(targetPath) {
        events.push({ type: 'pathExists', path: targetPath });
        return false;
      },
      now: () => 1750000000000,
      localRunId: 'run-1',
    },
  };

  deps.input = {
    ...deps.input,
    ...overrides,
    github: {
      ...deps.input.github,
      ...overrides.github,
    },
  };
  delete deps.input.events;
  return deps;
}

function payloadsFromWrites(events) {
  return events
    .filter((event) => event.type === 'writeChain')
    .map((event) => JSON.parse(event.request.payload));
}

function expectedLocalPaths() {
  return {
    stagingRepoPath: '/tmp/metabot-loom-test/runtime/loom/staging/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0/run-1/repo',
    workspaceRepoPath: '/tmp/metabot-loom-test/runtime/loom/workspaces/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbi0/repo',
  };
}

function assertRetryableClaimFailureData(data) {
  assert.equal(data.claimPinId, claimPinId);
  assert.match(data.retryCommand, /loom claim-and-start/);
  assert.match(data.retryCommand, new RegExp(`--claim-pin-id ${claimPinId}`));
  assert.equal(data.stagingRepoPath, expectedLocalPaths().stagingRepoPath);
  assert.equal(data.workspaceRepoPath, expectedLocalPaths().workspaceRepoPath);
}

test('non-GitHub task returns unsupported_project_base', async () => {
  const { input, events } = createDeps({
    state: taskState({ taskPayload: validTaskPayload({ projectBase: 'chain', project: {} }) }),
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_project_base');
  assert.deepEqual(events, []);
});

test('missing task returns task_not_found', async () => {
  const { input, events } = createDeps({ state: taskState({ found: false }) });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'task_not_found');
  assert.deepEqual(events, []);
});

test('missing git or gh returns tool_missing before chain writes', async () => {
  const { input, events } = createDeps({
    github: {
      async assertToolsReady() {
        events.push({ type: 'github.assertToolsReady' });
        return commandFailed('tool_missing', 'git is not available');
      },
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'tool_missing');
  assert.deepEqual(events.map((event) => event.type), ['github.assertToolsReady']);
});

test('dry-run returns planned payloads and pending previews without side effects', async () => {
  const { input, events } = createDeps({ dryRun: true });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.dryRun, true);
  assert.equal(result.data.claimPayload.taskPinId, taskPinId);
  assert.equal(result.data.claimPayload.payoutAddress, '1DeveloperPayoutAddress');
  assert.equal(result.data.statusPayload.status, 'started');
  assert.equal(result.data.preview.claimPinId, 'pending-claim');
  assert.match(result.data.preview.branchName, /^loom\/aaaaaaaa-pending-/);
  assert.match(result.data.preview.stagingRepoPath, /\/staging\/.+\/run-1\/repo$/);
  assert.match(result.data.preview.workspaceRepoPath, /\/workspaces\/.+\/pending-claim\/repo$/);
  assert.deepEqual(result.data.github, {
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    upstreamRepo: {
      owner: 'openagentinternet',
      repo: 'open-agent-connect',
      fullName: 'openagentinternet/open-agent-connect',
    },
  });
  assert.equal(result.data.chainWritePreviews.claim.skipped, false);
  assert.deepEqual(result.data.chainWritePreviews.claim.request, {
    operation: 'create',
    path: '/protocols/loom-claim',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(result.data.claimPayload),
    from: 'alice',
    network: 'mvc',
  });
  assert.equal(result.data.chainWritePreviews.status.skipped, false);
  assert.deepEqual(result.data.chainWritePreviews.status.request, {
    operation: 'create',
    path: '/protocols/loom-status',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(result.data.statusPayload),
    from: 'alice',
    network: 'mvc',
  });
  assert.deepEqual(events.map((event) => event.type), ['github.assertToolsReady']);
});

test('recovery dry-run skips claim write preview but includes started status chain preview', async () => {
  const { input, events } = createDeps({
    dryRun: true,
    payoutAddress: undefined,
    claimPinId,
    chain: 'doge',
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.dryRun, true);
  assert.equal(result.data.preview.claimPinId, claimPinId);
  assert.equal(result.data.chainWritePreviews.claim.skipped, true);
  assert.equal(result.data.chainWritePreviews.claim.claimPinId, claimPinId);
  assert.equal(result.data.chainWritePreviews.status.skipped, false);
  assert.equal(result.data.chainWritePreviews.status.request.path, '/protocols/loom-status');
  assert.equal(result.data.chainWritePreviews.status.request.network, 'doge');
  assert.equal(JSON.parse(result.data.chainWritePreviews.status.request.payload).claimPinId, claimPinId);
  assert.deepEqual(result.data.github.upstreamRepo, {
    owner: 'openagentinternet',
    repo: 'open-agent-connect',
    fullName: 'openagentinternet/open-agent-connect',
  });
  assert.deepEqual(events.map((event) => event.type), ['github.assertToolsReady']);
});

test('normal flow prepares staging, writes claim, moves workspace, uploads log, and writes started status', async () => {
  const { input, events } = createDeps();

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.claimPinId, claimPinId);
  assert.equal(result.data.statusPinId, statusPinId);
  assert.deepEqual(events.map((event) => event.type), [
    'github.assertToolsReady',
    'github.prepareForkWorkspace',
    'writeChain',
    'workflow.write',
    'renamePath',
    'runner.run',
    'writeLogFile',
    'uploadFile',
    'writeChain',
    'workflow.write',
  ]);
  assert.match(events[1].input.workspaceRepoPath, /\/staging\/.+\/run-1\/repo$/);
  assert.equal(events[2].request.path, '/protocols/loom-claim');
  assert.equal(events[3].state.claimPinId, claimPinId);
  assert.deepEqual(events[3].state.statuses, []);
  assert.match(events[4].to, /\/workspaces\/.+\/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbi0\/repo$/);
  assert.deepEqual(events[5].input.args, ['checkout', '-B', 'loom/aaaaaaaa-bbbbbbbb']);
  assert.equal(events[7].input.network, 'mvc');
  assert.equal(events[8].request.path, '/protocols/loom-status');
  const [claimPayload, statusPayload] = payloadsFromWrites(events);
  assert.equal(claimPayload.taskPinId, taskPinId);
  assert.equal(statusPayload.claimPinId, claimPinId);
  assert.deepEqual(statusPayload.commits, []);
  assert.deepEqual(statusPayload.processLogs, ['metafile://process-log.md']);
});

test('--reset-workspace in normal mode deletes only the current staging workspace', async () => {
  const { input, events } = createDeps({ resetWorkspace: true });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  const removed = events.filter((event) => event.type === 'removePath').map((event) => event.path);
  assert.deepEqual(removed, [expectedLocalPaths().stagingRepoPath]);
});

test('--reset-workspace in recovery mode deletes only that claim final workspace', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    resetWorkspace: true,
    state: taskState({ claims: [existingClaim] }),
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  const removed = events.filter((event) => event.type === 'removePath').map((event) => event.path);
  assert.deepEqual(removed, [expectedLocalPaths().workspaceRepoPath]);
});

test('recovery flow resolves existing developer claim and does not write duplicate claim', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.claimPinId, claimPinId);
  assert.deepEqual(
    events.filter((event) => event.type === 'writeChain').map((event) => event.request.path),
    ['/protocols/loom-status'],
  );
});

test('immediate recovery uses local workflow claim when raw cache has not caught up', async () => {
  const writes = [];
  const { input, events } = createDeps({
    workflowStore: createWorkflowStore([], { writes }),
    async uploadFile(input) {
      events.push({ type: 'uploadFile', input });
      throw new Error('first upload failed');
    },
  });

  const first = await runLoomClaimAndStartWorkflow(input);

  assert.equal(first.ok, false);
  assert.equal(first.code, 'claim_written_start_failed');
  assert.equal(first.data.claimPinId, claimPinId);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].claimPinId, claimPinId);
  assert.deepEqual(writes[0].statuses, []);

  const retryEvents = [];
  const retryWorkflowStore = createWorkflowStore(retryEvents, { writes });
  const retry = await runLoomClaimAndStartWorkflow({
    ...createDeps({
      events: retryEvents,
      workflowStore: retryWorkflowStore,
      payoutAddress: undefined,
      claimPinId,
      state: taskState({ claims: [] }),
      async pathExists(targetPath) {
        retryEvents.push({ type: 'pathExists', path: targetPath });
        return true;
      },
    }).input,
  });

  assert.equal(retry.ok, true);
  assert.equal(retry.data.claimPinId, claimPinId);
  assert.deepEqual(
    retryEvents.filter((event) => event.type === 'writeChain').map((event) => event.request.path),
    ['/protocols/loom-status'],
  );
  assert.equal(
    retryEvents.some((event) => event.type === 'github.prepareForkWorkspace'),
    false,
  );
});

test('recovery flow reuses existing final workspace without cloning again', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
    async pathExists(targetPath) {
      events.push({ type: 'pathExists', path: targetPath });
      return true;
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(
    events.some((event) => event.type === 'github.prepareForkWorkspace'),
    false,
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'pathExists').map((event) => event.path),
    [expectedLocalPaths().workspaceRepoPath],
  );
});

test('recovery flow returns permission_denied when claim belongs to another developer', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: otherDeveloperGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.deepEqual(events.map((event) => event.type), ['github.assertToolsReady']);
});

test('recovery status write failure returns retryable claim envelope', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
    async writeChain(request) {
      events.push({ type: 'writeChain', request });
      return commandFailed('chain_write_failed', 'status write failed');
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
});

test('recovery pathExists failure returns retryable claim envelope with local paths', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
    async pathExists(targetPath) {
      events.push({ type: 'pathExists', path: targetPath });
      throw new Error('workspace access denied');
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
  assert.match(result.data.cause.message, /workspace access denied/);
});

test('recovery reset removePath failure returns retryable claim envelope with local paths', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    resetWorkspace: true,
    state: taskState({ claims: [existingClaim] }),
    async removePath(targetPath) {
      events.push({ type: 'removePath', path: targetPath });
      throw new Error('workspace removal denied');
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
  assert.match(result.data.cause.message, /workspace removal denied/);
});

test('recovery thrown upload failure returns retryable claim envelope', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
    async uploadFile(input) {
      events.push({ type: 'uploadFile', input });
      throw new Error('retry upload failed');
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
  assert.match(result.data.cause.message, /retry upload failed/);
});

test('recovery thrown workflow persistence failure returns retryable claim envelope', async () => {
  const existingClaim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
    workflowStore: {
      ...createWorkflowStore([]),
      async write() {
        throw new Error('workflow write failed');
      },
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
  assert.match(result.data.cause.message, /workflow write failed/);
});

test('process log upload failure after claim write returns claim_written_start_failed with retry command', async () => {
  const { input, events } = createDeps({
    async uploadFile(input) {
      events.push({ type: 'uploadFile', input });
      throw new Error('upload failed');
    },
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_written_start_failed');
  assertRetryableClaimFailureData(result.data);
  assert.equal(
    events.filter((event) => event.type === 'writeChain').length,
    1,
  );
});

test('--chain doge without --file-chain uploads log on mvc but writes records on doge', async () => {
  const { input, events } = createDeps({ chain: 'doge' });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, true);
  assert.deepEqual(
    events.filter((event) => event.type === 'writeChain').map((event) => event.request.network),
    ['doge', 'doge'],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'uploadFile').map((event) => event.input.network),
    ['mvc'],
  );
});

test('recovery flow returns claim_not_found when claim pin is absent', async () => {
  const existingClaim = cachedRecord('claim', otherClaimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: developerGlobalMetaId });
  const { input, events } = createDeps({
    payoutAddress: undefined,
    claimPinId,
    state: taskState({ claims: [existingClaim] }),
  });

  const result = await runLoomClaimAndStartWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_not_found');
  assert.deepEqual(events.map((event) => event.type), ['github.assertToolsReady', 'workflow.read']);
});
