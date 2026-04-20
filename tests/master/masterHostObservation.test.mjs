import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildMasterHostObservation,
} = require('../../dist/core/master/masterHostObservation.js');
const {
  buildTriggerObservationFromHostContext,
} = require('../../dist/core/master/masterHostSignalBridge.js');

function createHostContext(overrides = {}) {
  const context = {
    now: 1_776_400_000_000,
    hostMode: 'codex',
    traceId: 'trace-host-observation-1',
    conversation: {
      currentUserRequest: 'Please review this patch before I land it.',
      recentMessages: [
        { role: 'user', content: 'Please review this patch before I land it.' },
        { role: 'assistant', content: 'I inspected the diff and the affected tests.' },
      ],
    },
    tools: {
      recentToolResults: [
        {
          toolName: 'npm test',
          exitCode: 0,
          stdout: 'ok 1 - unit tests remain green',
          stderr: '',
        },
      ],
    },
    workspace: {
      goal: 'Ship the current patch without introducing regressions.',
      constraints: ['Do not upload the full repository.'],
      relevantFiles: [
        'src/core/master/masterHostAdapter.ts',
        '.env',
        'tests/master/masterHostAdapter.test.mjs',
      ],
      diffSummary: 'Touched the host adapter and trace export paths for the current patch.',
      fileExcerpts: [
        {
          path: '.env',
          content: 'OPENAI_API_KEY=super-secret',
        },
      ],
    },
    planner: {
      hasPlan: true,
      todoBlocked: false,
      onlyReadingWithoutConverging: false,
    },
    hostSignals: {
      workspaceId: 'workspace-review-1',
      noProgressWindowMs: 120_000,
      lastMeaningfulDiffAt: 1_776_399_940_000,
      activeFileCount: 4,
      reviewCheckpointRisk: true,
      uncertaintySignals: ['patch_risk'],
      directory: {
        availableMasters: 2,
        trustedMasters: 1,
        onlineMasters: 2,
      },
    },
    ...overrides,
  };

  if (overrides.conversation) {
    context.conversation = {
      ...context.conversation,
      ...overrides.conversation,
    };
  }
  if (overrides.tools) {
    context.tools = {
      ...context.tools,
      ...overrides.tools,
    };
  }
  if (overrides.workspace) {
    context.workspace = {
      ...context.workspace,
      ...overrides.workspace,
    };
  }
  if (overrides.planner) {
    context.planner = {
      ...context.planner,
      ...overrides.planner,
    };
  }
  if (overrides.hostSignals) {
    context.hostSignals = {
      ...context.hostSignals,
      ...overrides.hostSignals,
      directory: {
        ...context.hostSignals.directory,
        ...(overrides.hostSignals.directory ?? {}),
      },
    };
  }

  return context;
}

test('buildMasterHostObservation derives a sanitized review-checkpoint observation frame from host-visible context', () => {
  const observation = buildMasterHostObservation(createHostContext());

  assert.equal(observation.now, 1_776_400_000_000);
  assert.equal(observation.hostMode, 'codex');
  assert.equal(observation.traceId, 'trace-host-observation-1');
  assert.equal(observation.workspaceId, 'workspace-review-1');
  assert.deepEqual(observation.activity, {
    recentUserMessages: 1,
    recentAssistantMessages: 1,
    recentToolCalls: 1,
    recentFailures: 0,
    repeatedFailureCount: 0,
    noProgressWindowMs: 120_000,
    lastMeaningfulDiffAt: 1_776_399_940_000,
  });
  assert.equal(observation.workState.activeFileCount, 4);
  assert.equal(observation.workState.diffChangedRecently, true);
  assert.equal(observation.hints.reviewCheckpointRisk, true);
  assert.equal(observation.hints.candidateMasterKindHint, 'review');
  assert.deepEqual(observation.directory, {
    availableMasters: 2,
    trustedMasters: 1,
    onlineMasters: 2,
  });
  assert.doesNotMatch(JSON.stringify(observation), /OPENAI_API_KEY/i);
  assert.doesNotMatch(JSON.stringify(observation), /\.env/i);
});

test('buildMasterHostObservation counts two identical failing signatures as two repeated failures', () => {
  const observation = buildMasterHostObservation(createHostContext({
    tools: {
      recentToolResults: [
        {
          toolName: 'npm test',
          exitCode: 1,
          stdout: '',
          stderr: 'Error: ERR_REPEAT_HOST_SIGNAL',
        },
        {
          toolName: 'node scripts/check-repeat.mjs',
          exitCode: 1,
          stdout: '',
          stderr: 'Error: ERR_REPEAT_HOST_SIGNAL',
        },
      ],
    },
    hostSignals: {
      reviewCheckpointRisk: false,
      candidateMasterKindHint: null,
      uncertaintySignals: ['still_stuck'],
    },
  }));

  assert.equal(observation.activity.recentFailures, 2);
  assert.equal(observation.activity.repeatedFailureCount, 2);
});

test('buildTriggerObservationFromHostContext converts review-checkpoint host context into trigger-engine input', () => {
  const triggerObservation = buildTriggerObservationFromHostContext(createHostContext());

  assert.equal(triggerObservation.hostMode, 'codex');
  assert.equal(triggerObservation.workspaceId, 'workspace-review-1');
  assert.equal(triggerObservation.activity.recentToolCalls, 1);
  assert.equal(triggerObservation.workState.hasPlan, true);
  assert.equal(triggerObservation.candidateMasterKindHint, 'review');
  assert.deepEqual(triggerObservation.diagnostics.uncertaintySignals, ['patch_risk', 'review_checkpoint_risk']);
  assert.deepEqual(triggerObservation.directory, {
    availableMasters: 2,
    trustedMasters: 1,
    onlineMasters: 2,
  });
});

test('buildTriggerObservationFromHostContext treats patch-risk-only checkpoints as review-oriented opportunities', () => {
  const triggerObservation = buildTriggerObservationFromHostContext(createHostContext({
    hostSignals: {
      reviewCheckpointRisk: false,
      candidateMasterKindHint: null,
      uncertaintySignals: ['patch_risk'],
    },
  }));

  assert.equal(triggerObservation.candidateMasterKindHint, 'review');
  assert.deepEqual(triggerObservation.diagnostics.uncertaintySignals, ['patch_risk', 'review_checkpoint_risk']);
});
