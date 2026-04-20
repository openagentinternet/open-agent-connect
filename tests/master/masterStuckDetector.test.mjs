import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assessMasterAskWorthiness,
} = require('../../dist/core/master/masterStuckDetector.js');

function buildObservation(overrides = {}) {
  const observation = {
    now: 1_776_400_000_000,
    traceId: 'trace-detector-1',
    hostMode: 'codex',
    workspaceId: 'workspace-detector-1',
    userIntent: {
      explicitlyAskedForMaster: false,
      explicitlyRejectedSuggestion: false,
      explicitlyRejectedAutoAsk: false,
    },
    activity: {
      recentUserMessages: 2,
      recentAssistantMessages: 5,
      recentToolCalls: 6,
      recentFailures: 3,
      repeatedFailureCount: 2,
      noProgressWindowMs: 900_000,
      lastMeaningfulDiffAt: null,
    },
    diagnostics: {
      failingTests: 1,
      failingCommands: 1,
      repeatedErrorSignatures: ['ERR_DEBUG_LOOP'],
      uncertaintySignals: ['still_stuck'],
      lastFailureSummary: 'AssertionError: expected preview to complete',
    },
    workState: {
      hasPlan: true,
      todoBlocked: true,
      diffChangedRecently: false,
      onlyReadingWithoutConverging: true,
      activeFileCount: 3,
    },
    directory: {
      availableMasters: 1,
      trustedMasters: 1,
      onlineMasters: 1,
    },
    hints: {
      candidateMasterKindHint: null,
      preferredMasterName: null,
      reviewCheckpointRisk: false,
    },
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
  if (overrides.hints) {
    observation.hints = {
      ...observation.hints,
      ...overrides.hints,
    };
  }

  return observation;
}

test('assessMasterAskWorthiness marks repeated failing debug loops as a strong stuck opportunity', () => {
  const assessment = assessMasterAskWorthiness(buildObservation());

  assert.equal(assessment.opportunityType, 'stuck');
  assert.equal(assessment.stuckLevel, 'critical');
  assert.equal(assessment.candidateMasterKind, 'debug');
  assert.equal(assessment.autoEligible, true);
  assert.match(assessment.reasons.join(' '), /Repeated failures/i);
  assert.match(assessment.reasons.join(' '), /No progress/i);
});

test('assessMasterAskWorthiness recognizes review checkpoints without forcing a fake stuck diagnosis', () => {
  const assessment = assessMasterAskWorthiness(buildObservation({
    activity: {
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: 60_000,
    },
    diagnostics: {
      failingTests: 0,
      failingCommands: 0,
      repeatedErrorSignatures: [],
      uncertaintySignals: ['patch_risk'],
      lastFailureSummary: null,
    },
    workState: {
      todoBlocked: false,
      onlyReadingWithoutConverging: false,
      diffChangedRecently: true,
    },
    hints: {
      reviewCheckpointRisk: true,
      candidateMasterKindHint: 'review',
    },
  }));

  assert.equal(assessment.opportunityType, 'review_checkpoint');
  assert.equal(assessment.stuckLevel, 'none');
  assert.equal(assessment.candidateMasterKind, 'review');
  assert.equal(assessment.autoEligible, true);
  assert.match(assessment.reasons.join(' '), /review checkpoint/i);
});

test('assessMasterAskWorthiness respects the configured no-progress threshold', () => {
  const assessment = assessMasterAskWorthiness(buildObservation({
    activity: {
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: 240_000,
    },
    diagnostics: {
      failingTests: 0,
      failingCommands: 0,
      repeatedErrorSignatures: [],
      uncertaintySignals: [],
      lastFailureSummary: null,
    },
    workState: {
      todoBlocked: false,
      onlyReadingWithoutConverging: true,
      diffChangedRecently: false,
    },
  }), {
    minNoProgressWindowMs: 300_000,
  });

  assert.equal(assessment.autoEligible, false);
  assert.equal(assessment.opportunityType, 'none');
  assert.equal(assessment.candidateMasterKind, null);
});

test('assessMasterAskWorthiness disables auto eligibility after an explicit auto-ask rejection', () => {
  const assessment = assessMasterAskWorthiness(buildObservation({
    userIntent: {
      explicitlyRejectedAutoAsk: true,
    },
  }));

  assert.equal(assessment.opportunityType, 'stuck');
  assert.equal(assessment.autoEligible, false);
});
