import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  collectAndEvaluateMasterTrigger,
  evaluateMasterTrigger,
} = require('../../dist/core/master/masterTriggerEngine.js');

function buildObservation(overrides = {}) {
  const observation = {
    now: 1_776_000_000_000,
    traceId: 'trace-trigger-1',
    hostMode: 'codex',
    workspaceId: 'workspace-trigger-1',
    userIntent: {
      explicitlyAskedForMaster: false,
      explicitlyRejectedSuggestion: false,
    },
    activity: {
      recentUserMessages: 1,
      recentAssistantMessages: 2,
      recentToolCalls: 3,
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: null,
    },
    diagnostics: {
      failingTests: 0,
      failingCommands: 0,
      repeatedErrorSignatures: [],
      uncertaintySignals: [],
    },
    workState: {
      hasPlan: true,
      todoBlocked: false,
      diffChangedRecently: true,
      onlyReadingWithoutConverging: false,
    },
    directory: {
      availableMasters: 1,
      trustedMasters: 0,
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

function buildConfig(overrides = {}) {
  return {
    enabled: true,
    triggerMode: 'manual',
    confirmationMode: 'always',
    contextMode: 'standard',
    trustedMasters: [],
    ...overrides,
  };
}

test('trigger engine returns manual_requested when the user explicitly asks for a master', () => {
  const decision = evaluateMasterTrigger({
    config: buildConfig({ triggerMode: 'manual' }),
    observation: buildObservation({
      userIntent: {
        explicitlyAskedForMaster: true,
      },
    }),
  });

  assert.deepEqual(decision, {
    action: 'manual_requested',
    reason: 'User explicitly requested Ask Master.',
  });
});

test('collectAndEvaluateMasterTrigger skips collection when askMaster is disabled', async () => {
  let collectCalls = 0;

  const result = await collectAndEvaluateMasterTrigger({
    config: buildConfig({ enabled: false, triggerMode: 'suggest' }),
    collectObservation: () => {
      collectCalls += 1;
      return buildObservation();
    },
  });

  assert.equal(collectCalls, 0);
  assert.equal(result.collected, false);
  assert.equal(result.observation, null);
  assert.deepEqual(result.decision, {
    action: 'no_action',
    reason: 'Ask Master is disabled by local config.',
  });
});
