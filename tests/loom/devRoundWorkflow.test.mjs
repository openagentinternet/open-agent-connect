import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLoomDevRoundPrompt,
  runLoomDevRoundWorkflow,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const statusPinId = `${'c'.repeat(64)}i0`;
const developerGlobalMetaId = 'metaid-developer';
const otherDeveloperGlobalMetaId = 'metaid-other-developer';
const workspacePath = '/tmp/metabot-loom-dev-round/repo';

function validTaskPayload(overrides = {}) {
  return {
    title: 'Add Loom development rounds',
    requirementContentType: 'text/markdown',
    requirement: 'Implement the development round workflow.',
    criteriaContentType: 'text/markdown',
    criteria: '- Runs LLM\n- Writes loom-status',
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
  const task = cachedRecord('task', taskPinId, options.taskPayload ?? validTaskPayload());
  const claim = cachedRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  }, { globalMetaId: options.claimAuthor ?? developerGlobalMetaId });
  return {
    found: true,
    taskPinId,
    state: 'claimed',
    task,
    valid: {
      claims: options.claims ?? [claim],
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
    branchName: 'loom/task-claim',
    workspacePath,
    claim: { pinId: claimPinId },
    statuses: [{
      roundId: 'start',
      status: 'started',
      pinId: 'started-pin',
      processLogPath: '/tmp/start.md',
      processLogUri: 'metafile://start.md',
      llmSessionId: null,
      commits: [],
      checksPassed: null,
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
    paths: { profileRoot: '/tmp/metabot-loom-dev-round/profile' },
    resolve(pinId, resolvedClaimPinId) {
      return {
        loomRuntimeRoot: '/tmp/metabot-loom-dev-round/runtime/loom',
        workflowsRoot: '/tmp/metabot-loom-dev-round/runtime/loom/workflows',
        stagingRoot: '/tmp/metabot-loom-dev-round/runtime/loom/staging',
        workspacesRoot: '/tmp/metabot-loom-dev-round/runtime/loom/workspaces',
        logsRoot: '/tmp/metabot-loom-dev-round/runtime/loom/logs',
        workflowPath: path.join('/tmp/metabot-loom-dev-round/runtime/loom/workflows', pinId, `${resolvedClaimPinId ?? 'pending-claim'}.json`),
        stagingRepoPath: path.join('/tmp/metabot-loom-dev-round/runtime/loom/staging', pinId, 'run', 'repo'),
        workspaceRepoPath: workspacePath,
        taskLogsRoot: path.join('/tmp/metabot-loom-dev-round/runtime/loom/logs', pinId),
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

function createRunner(events, options = {}) {
  const changedFiles = options.changedFiles ?? ['src/core/loom/devRoundWorkflow.ts'];
  const checkFailures = new Set(options.checkFailures ?? []);
  return {
    async run(input) {
      events.push({ type: 'runner.run', input });
      if (input.command === 'git' && input.args.join(' ') === 'status --porcelain') {
        return commandRun(input, changedFiles.length > 0 ? ` M ${changedFiles[0]}\n` : '');
      }
      if (input.command === 'git' && input.args.join(' ') === 'diff --name-only') {
        return commandRun(input, changedFiles.join('\n'));
      }
      if (input.command === 'git' && input.args.join(' ') === 'add -A') {
        return commandRun(input, '');
      }
      if (input.command === 'git' && input.args[0] === 'commit') {
        return commandRun(input, '[loom/task-claim abc1234] feat: add loom dev round workflow\n');
      }
      if (input.command === 'git' && input.args.join(' ') === 'rev-parse HEAD') {
        return commandRun(input, 'abc123456789\n');
      }
      if (input.command === 'git' && input.args.join(' ') === 'show --name-only --format=%s HEAD') {
        return commandRun(input, 'feat: add loom dev round workflow\n\nsrc/core/loom/devRoundWorkflow.ts\n');
      }
      if (input.shell) {
        const failed = checkFailures.has(input.command);
        return commandRun(input, failed ? '' : 'ok\n', failed ? 'check failed\n' : '', failed ? 1 : 0);
      }
      return commandRun(input, '');
    },
  };
}

function commandRun(input, stdout, stderr = '', exitCode = 0) {
  return {
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: 1,
  };
}

function createDeps(overrides = {}) {
  const events = overrides.events ?? [];
  const workflowStore = overrides.workflowStore ?? createWorkflowStore(events, overrides.workflowState);
  const input = {
    from: 'alice',
    taskPinId,
    claimPinId,
    chain: 'doge',
    checks: ['npm run build'],
    roundNote: 'Keep it scoped.',
    developerMetaBotSlug: 'alice',
    developerGlobalMetaId,
    state: taskState(),
    workflowStore,
    runner: createRunner(events),
    async executeLlmRound(prompt, cwd) {
      events.push({ type: 'executeLlmRound', prompt, cwd });
      return {
        sessionId: 'llm-session-1',
        status: 'completed',
        output: 'Implemented the round.',
      };
    },
    async writeChain(request) {
      events.push({ type: 'writeChain', request });
      return commandSuccess({
        pinId: statusPinId,
        txids: ['status-tx'],
        network: request.network,
        globalMetaId: developerGlobalMetaId,
      });
    },
    async uploadFile(uploadInput) {
      events.push({ type: 'uploadFile', input: uploadInput });
      return {
        metafileUri: 'metafile://process-log.md',
        pinId: 'log-pin',
        network: uploadInput.network,
      };
    },
    async writeLogFile(logInput) {
      events.push({ type: 'writeLogFile', input: logInput });
      return {
        path: path.join(logInput.directory, logInput.fileName),
        content: `${logInput.rawLog ?? ''}\n${logInput.statusDecision?.summary ?? ''}`,
      };
    },
    now: () => 1778889600000,
    ...overrides,
  };
  delete input.workflowState;
  delete input.events;
  return { events, input };
}

function statusPayloads(events) {
  return events
    .filter((event) => event.type === 'writeChain')
    .map((event) => JSON.parse(event.request.payload));
}

function commands(events) {
  return events
    .filter((event) => event.type === 'runner.run')
    .map((event) => `${event.input.command} ${event.input.args.join(' ')}`.trim());
}

test('buildLoomDevRoundPrompt includes task, repo, previous status, checks, and round note', () => {
  const prompt = buildLoomDevRoundPrompt({
    task: validTaskPayload(),
    workflow: workflowState(),
    checks: ['npm run build', 'node --test tests/loom/devRoundWorkflow.test.mjs'],
    roundNote: 'Make the smallest useful slice.',
  });

  assert.match(prompt, /Add Loom development rounds/);
  assert.match(prompt, /Implement the development round workflow/);
  assert.match(prompt, /Runs LLM/);
  assert.match(prompt, new RegExp(workspacePath.replaceAll('/', '\\/')));
  assert.match(prompt, /loom\/task-claim/);
  assert.match(prompt, /started/);
  assert.match(prompt, /npm run build/);
  assert.match(prompt, /Make the smallest useful slice/);
  assert.match(prompt, /one focused implementation round/i);
  assert.match(prompt, /leave the repo committable/i);
});

test('runLoomDevRoundWorkflow denies a claim owned by another author', async () => {
  const { events, input } = createDeps({
    state: taskState({ claimAuthor: otherDeveloperGlobalMetaId }),
  });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.deepEqual(events.filter((event) => event.type === 'executeLlmRound'), []);
});

test('runLoomDevRoundWorkflow reports missing local workflow state', async () => {
  const events = [];
  const workflowStore = createWorkflowStore(events, null);
  const { input } = createDeps({ workflowStore });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, false);
  assert.ok(['claim_not_found', 'invalid_loom_state'].includes(result.code));
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
});

test('runLoomDevRoundWorkflow completes when LLM succeeds, checks pass, and git diff exists', async () => {
  const { events, input } = createDeps();

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'completed');
  assert.deepEqual(commands(events), [
    'git status --porcelain',
    'git diff --name-only',
    'npm run build',
    'git add -A',
    'git commit -m feat: add loom dev round workflow',
    'git rev-parse HEAD',
    'git show --name-only --format=%s HEAD',
  ]);
  assert.equal(events.find((event) => event.type === 'uploadFile').input.network, 'mvc');
  const payload = statusPayloads(events).at(-1);
  assert.equal(payload.status, 'completed');
  assert.equal(payload.commits[0].sha, 'abc123456789');
  assert.deepEqual(payload.processLogs, ['metafile://process-log.md']);
  const workflowWrite = events.find((event) => event.type === 'workflow.write');
  assert.equal(workflowWrite.state.statuses.at(-1).status, 'completed');
  assert.equal(workflowWrite.state.statuses.at(-1).commits[0].sha, 'abc123456789');
});

test('runLoomDevRoundWorkflow stays in progress when a check fails but still commits changes', async () => {
  const events = [];
  const { input } = createDeps({
    events,
    checks: ['npm run build', 'npm test'],
    runner: createRunner(events, { checkFailures: ['npm test'] }),
    workflowStore: createWorkflowStore(events),
  });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'in_progress');
  assert.ok(commands(events).includes('git commit -m feat: add loom dev round workflow'));
  const payload = statusPayloads(events).at(-1);
  assert.equal(payload.status, 'in_progress');
  assert.equal(payload.commits[0].sha, 'abc123456789');
  assert.equal(events.find((event) => event.type === 'workflow.write').state.statuses.at(-1).checksPassed, false);
});

test('runLoomDevRoundWorkflow writes in_progress and logs verification skipped when no checks are configured', async () => {
  const { events, input } = createDeps({ checks: [] });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'in_progress');
  const logInput = events.find((event) => event.type === 'writeLogFile').input;
  assert.equal(logInput.checks[0].status, 'skipped');
  assert.match(logInput.checks[0].summary, /No verification checks were configured/i);
  assert.equal(statusPayloads(events).at(-1).status, 'in_progress');
});

test('runLoomDevRoundWorkflow does not create an empty commit when no git diff exists', async () => {
  const events = [];
  const { input } = createDeps({
    events,
    runner: createRunner(events, { changedFiles: [] }),
    workflowStore: createWorkflowStore(events),
  });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'in_progress');
  assert.ok(!commands(events).includes('git commit -m feat: add loom dev round workflow'));
  const payload = statusPayloads(events).at(-1);
  assert.deepEqual(payload.commits, []);
  const logInput = events.find((event) => event.type === 'writeLogFile').input;
  assert.match(logInput.statusDecision.summary, /No file changes were detected/i);
});

test('runLoomDevRoundWorkflow does not write status when process log upload fails', async () => {
  const { events, input } = createDeps({
    async uploadFile(uploadInput) {
      events.push({ type: 'uploadFile', input: uploadInput });
      throw new Error('upload unavailable');
    },
  });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'process_log_upload_failed');
  assert.deepEqual(events.filter((event) => event.type === 'writeChain'), []);
  assert.deepEqual(events.filter((event) => event.type === 'workflow.write'), []);
});

test('runLoomDevRoundWorkflow writes failed status when the LLM round fails', async () => {
  const { events, input } = createDeps({
    async executeLlmRound(prompt, cwd) {
      events.push({ type: 'executeLlmRound', prompt, cwd });
      return {
        sessionId: 'llm-session-2',
        status: 'failed',
        output: '',
        error: 'model crashed',
      };
    },
  });

  const result = await runLoomDevRoundWorkflow(input);

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'failed');
  const payload = statusPayloads(events).at(-1);
  assert.equal(payload.status, 'failed');
  assert.match(payload.progressSummary, /LLM round failed/i);
  const workflowWrite = events.find((event) => event.type === 'workflow.write');
  assert.equal(workflowWrite.state.statuses.at(-1).status, 'failed');
  assert.equal(workflowWrite.state.statuses.at(-1).llmSessionId, 'llm-session-2');
});
