import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMasterTriggerMemoryState,
  evaluateMasterTrigger,
  recordMasterTriggerOutcome,
} = require('../../dist/core/master/masterTriggerEngine.js');

function buildConfig(overrides = {}) {
  return {
    enabled: true,
    triggerMode: 'suggest',
    confirmationMode: 'always',
    contextMode: 'standard',
    trustedMasters: [],
    ...overrides,
  };
}

function buildObservation(overrides = {}) {
  const observation = {
    now: 1_776_000_000_000,
    traceId: 'trace-suggest-1',
    hostMode: 'codex',
    workspaceId: 'workspace-suggest-1',
    userIntent: {
      explicitlyAskedForMaster: false,
      explicitlyRejectedSuggestion: false,
    },
    activity: {
      recentUserMessages: 2,
      recentAssistantMessages: 4,
      recentToolCalls: 6,
      recentFailures: 3,
      repeatedFailureCount: 2,
      noProgressWindowMs: 900_000,
    },
    diagnostics: {
      failingTests: 1,
      failingCommands: 1,
      repeatedErrorSignatures: ['ERR_DEBUG_TIMEOUT'],
      uncertaintySignals: ['still_stuck'],
    },
    workState: {
      hasPlan: true,
      todoBlocked: true,
      diffChangedRecently: false,
      onlyReadingWithoutConverging: true,
    },
    directory: {
      availableMasters: 1,
      trustedMasters: 1,
      onlineMasters: 1,
    },
    candidateMasterKindHint: 'debug',
    ...overrides,
  };

  if (overrides.userIntent) {
    observation.userIntent = {
      ...observation.userIntent,
      ...overrides.userIntent,
    };
  }
  if (overrides.activity) {
    observation.activity = {
      ...observation.activity,
      ...overrides.activity,
    };
  }
  if (overrides.diagnostics) {
    observation.diagnostics = {
      ...observation.diagnostics,
      ...overrides.diagnostics,
    };
  }
  if (overrides.workState) {
    observation.workState = {
      ...observation.workState,
      ...overrides.workState,
    };
  }
  if (overrides.directory) {
    observation.directory = {
      ...observation.directory,
      ...overrides.directory,
    };
  }

  return observation;
}

test('suggest mode emits suggest once for repeated failures and then suppresses duplicates on the same trace', () => {
  const suppression = createMasterTriggerMemoryState();
  const observation = buildObservation();

  const first = evaluateMasterTrigger({
    config: buildConfig(),
    observation,
    suppression,
  });

  assert.equal(first.action, 'suggest');
  assert.equal(first.candidateMasterKind, 'debug');

  const afterFirstSuggest = recordMasterTriggerOutcome({
    state: suppression,
    observation,
    decision: first,
  });

  const second = evaluateMasterTrigger({
    config: buildConfig(),
    observation,
    suppression: afterFirstSuggest,
  });

  assert.deepEqual(second, {
    action: 'no_action',
    reason: 'This trace was already suggested for Ask Master.',
  });
});

test('recent rejection for the same master kind suppresses another suggest', () => {
  const rejectionState = recordMasterTriggerOutcome({
    state: createMasterTriggerMemoryState(),
    observation: buildObservation({
      userIntent: {
        explicitlyRejectedSuggestion: true,
      },
    }),
    decision: {
      action: 'no_action',
      reason: 'User rejected the previous suggestion.',
    },
  });

  const decision = evaluateMasterTrigger({
    config: buildConfig(),
    observation: buildObservation({
      traceId: 'trace-suggest-2',
      diagnostics: {
        repeatedErrorSignatures: ['ERR_DEBUG_FOLLOWUP'],
      },
    }),
    suppression: rejectionState,
  });

  assert.deepEqual(decision, {
    action: 'no_action',
    reason: 'The same Master kind was rejected recently.',
  });
});

test('recent identical failure signatures suppress another suggest even on a new trace', () => {
  const state = recordMasterTriggerOutcome({
    state: createMasterTriggerMemoryState(),
    observation: buildObservation({
      traceId: 'trace-suggest-3',
      diagnostics: {
        repeatedErrorSignatures: ['ERR_REPEATED_SIGNATURE'],
      },
    }),
    decision: {
      action: 'suggest',
      reason: 'Repeated failures make Ask Master worthwhile.',
      confidence: 0.88,
      candidateMasterKind: 'debug',
    },
  });

  const nextDecision = evaluateMasterTrigger({
    config: buildConfig(),
    observation: buildObservation({
      traceId: 'trace-suggest-4',
      diagnostics: {
        repeatedErrorSignatures: ['ERR_REPEATED_SIGNATURE'],
      },
    }),
    suppression: state,
  });

  assert.deepEqual(nextDecision, {
    action: 'no_action',
    reason: 'This failure signature was already suggested recently.',
  });
});
