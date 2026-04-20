import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { evaluateMasterTrigger } = require('../../dist/core/master/masterTriggerEngine.js');
const { evaluateMasterAutoPolicy } = require('../../dist/core/master/masterAutoPolicy.js');

function createMaster(overrides = {}) {
  return {
    masterPinId: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    chainPinIds: ['master-pin-1'],
    providerGlobalMetaId: 'idq1provider',
    providerMetaId: 'metaid-provider',
    providerAddress: 'mvc-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfo: { provider: 'metaweb', model: 'official-debug-master-v1' },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
    available: true,
    online: true,
    updatedAt: 1_776_300_000_000,
    ...overrides,
  };
}

function createConfig(overrides = {}) {
  return {
    enabled: true,
    triggerMode: 'auto',
    confirmationMode: 'always',
    contextMode: 'standard',
    trustedMasters: [],
    autoPolicy: {
      minConfidence: 0.9,
      minNoProgressWindowMs: 300_000,
      perTraceLimit: 1,
      globalCooldownMs: 1_800_000,
      allowTrustedAutoSend: false,
    },
    ...overrides,
    autoPolicy: {
      minConfidence: 0.9,
      minNoProgressWindowMs: 300_000,
      perTraceLimit: 1,
      globalCooldownMs: 1_800_000,
      allowTrustedAutoSend: false,
      ...(overrides.autoPolicy ?? {}),
    },
  };
}

function createObservation(overrides = {}) {
  const observation = {
    now: 1_776_500_000_000,
    traceId: 'trace-auto-policy-1',
    hostMode: 'codex',
    workspaceId: 'workspace-auto-policy-1',
    userIntent: {
      explicitlyAskedForMaster: false,
      explicitlyRejectedSuggestion: false,
      explicitlyRejectedAutoAsk: false,
    },
    activity: {
      recentUserMessages: 1,
      recentAssistantMessages: 4,
      recentToolCalls: 5,
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: 450_000,
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

test('evaluateMasterTrigger respects autoPolicy.minNoProgressWindowMs when deciding if suggest signals exist', () => {
  const observation = createObservation({
    activity: {
      noProgressWindowMs: 450_000,
    },
  });

  const relaxed = evaluateMasterTrigger({
    config: createConfig({
      triggerMode: 'suggest',
      autoPolicy: {
        minNoProgressWindowMs: 300_000,
      },
    }),
    observation,
  });
  const strict = evaluateMasterTrigger({
    config: createConfig({
      triggerMode: 'suggest',
      autoPolicy: {
        minNoProgressWindowMs: 600_000,
      },
    }),
    observation,
  });

  assert.equal(relaxed.action, 'suggest');
  assert.deepEqual(strict, {
    action: 'no_action',
    reason: 'Current signals do not justify Ask Master yet.',
  });
});

test('evaluateMasterTrigger falls back to suggest when confidence does not reach autoPolicy.minConfidence', () => {
  const observation = createObservation({
    activity: {
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: null,
    },
    diagnostics: {
      repeatedErrorSignatures: ['ERR_DEBUG_LOOP'],
    },
    workState: {
      todoBlocked: false,
      onlyReadingWithoutConverging: false,
    },
  });

  const autoCandidate = evaluateMasterTrigger({
    config: createConfig({
      autoPolicy: {
        minConfidence: 0.45,
      },
    }),
    observation,
  });
  const suggested = evaluateMasterTrigger({
    config: createConfig({
      autoPolicy: {
        minConfidence: 0.75,
      },
    }),
    observation,
  });

  assert.equal(autoCandidate.action, 'auto_candidate');
  assert.equal(suggested.action, 'suggest');
});

test('evaluateMasterAutoPolicy keeps auto asks in preview_confirm mode when confirmationMode is always', () => {
  const decision = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'always',
    }),
    selectedMaster: createMaster(),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.selectedFrictionMode, 'preview_confirm');
  assert.equal(decision.requiresConfirmation, true);
  assert.match(decision.policyReason, /always/i);
});

test('evaluateMasterAutoPolicy allows direct_send for trusted non-sensitive masters under sensitive_only', () => {
  const decision = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-1',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.selectedFrictionMode, 'direct_send');
  assert.equal(decision.requiresConfirmation, false);
});

test('evaluateMasterAutoPolicy falls back to preview_confirm for untrusted targets under sensitive_only', () => {
  const decision = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'sensitive_only',
      trustedMasters: [],
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-untrusted',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.selectedFrictionMode, 'preview_confirm');
  assert.equal(decision.requiresConfirmation, true);
  assert.match(decision.policyReason, /trusted/i);
});

test('evaluateMasterAutoPolicy falls back to preview_confirm for sensitive payloads under sensitive_only', () => {
  const decision = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-1',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: true,
      reasons: ['artifact mentions api token'],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.selectedFrictionMode, 'preview_confirm');
  assert.equal(decision.requiresConfirmation, true);
  assert.match(decision.policyReason, /sensitive/i);
});

test('evaluateMasterAutoPolicy only allows direct_send for never when trusted, safe, and explicitly enabled', () => {
  const blocked = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'never',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        allowTrustedAutoSend: false,
      },
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-1',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });
  const allowed = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'never',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        allowTrustedAutoSend: true,
      },
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-1',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(blocked.selectedFrictionMode, 'preview_confirm');
  assert.equal(blocked.requiresConfirmation, true);
  assert.equal(allowed.selectedFrictionMode, 'direct_send');
  assert.equal(allowed.requiresConfirmation, false);
});

test('evaluateMasterAutoPolicy falls back to preview_confirm for sensitive payloads even when confirmationMode is never', () => {
  const decision = evaluateMasterAutoPolicy({
    config: createConfig({
      confirmationMode: 'never',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        allowTrustedAutoSend: true,
      },
    }),
    selectedMaster: createMaster({
      masterPinId: 'master-pin-1',
      trustedTier: null,
      official: false,
    }),
    sensitivity: {
      isSensitive: true,
      reasons: ['terminal output included a secret-bearing path'],
    },
    confidence: 0.95,
    now: 1_776_500_000_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.selectedFrictionMode, 'preview_confirm');
  assert.equal(decision.requiresConfirmation, true);
  assert.match(decision.policyReason, /sensitive/i);
});

test('evaluateMasterAutoPolicy blocks on per-trace limits and global cooldown before preview/send', () => {
  const traceLimited = evaluateMasterAutoPolicy({
    config: createConfig({
      autoPolicy: {
        perTraceLimit: 1,
      },
    }),
    selectedMaster: createMaster(),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    traceAutoPrepareCount: 1,
    now: 1_776_500_000_000,
  });
  const coolingDown = evaluateMasterAutoPolicy({
    config: createConfig({
      autoPolicy: {
        globalCooldownMs: 60_000,
      },
    }),
    selectedMaster: createMaster(),
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    confidence: 0.95,
    traceAutoPrepareCount: 0,
    lastAutoAt: 1_776_499_970_000,
    now: 1_776_500_000_000,
  });

  assert.equal(traceLimited.allowed, false);
  assert.match(traceLimited.blockedReason, /per-trace limit/i);
  assert.equal(coolingDown.allowed, false);
  assert.match(coolingDown.blockedReason, /cooldown/i);
});
