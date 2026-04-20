import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');

function createIdentity() {
  return {
    metabotId: 1,
    name: 'Caller Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'pubkey',
    chatPublicKey: 'chat-pubkey',
    mvcAddress: 'mvc-address',
    btcAddress: 'btc-address',
    dogeAddress: 'doge-address',
    metaId: 'metaid-caller',
    globalMetaId: 'idq1caller',
  };
}

function createDebugMasterRecord(overrides = {}) {
  return {
    id: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    currentPinId: 'master-pin-1',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'idq1caller',
    providerAddress: 'mvc-provider-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfoJson: '{"provider":"metaweb","model":"official-debug-master-v1"}',
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: 1,
    trustedTier: 'official',
    payloadJson: '{}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_776_000_000_000,
    ...overrides,
  };
}

async function createSuggestHarness(options = {}) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-suggest-phase2-'));
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const masters = Array.isArray(options.masters) && options.masters.length > 0
    ? options.masters
    : [createDebugMasterRecord()];

  await runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [],
    traces: [],
  });
  await masterStateStore.write({
    masters,
  });
  await configStore.set({
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true,
    },
    askMaster: {
      enabled: true,
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
      ...(options.askMasterConfig ?? {}),
    },
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
    ...(options.providerPresence ?? {}),
  });

  return {
    homeDir,
    masterStateStore,
    configStore,
    providerPresenceStore,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      getDaemonRecord: () => null,
    }),
  };
}

function buildSuggestInput(traceId, overrides = {}) {
  const input = {
    draft: {
      userTask: 'Diagnose a repeated failing test before the local agent loops again.',
      question: 'Should I ask the Debug Master for a tighter diagnosis and next steps?',
      workspaceSummary: 'Caller-side suggest integration test for Ask Master.',
      errorSummary: 'Repeated ERR_DEBUG_MASTER_LOOP failures across the same task.',
      relevantFiles: ['tests/master/masterSuggestFlowPhase2.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: {
      now: 1_776_000_000_000,
      traceId,
      hostMode: 'codex',
      userIntent: {
        explicitlyAskedForMaster: false,
        explicitlyRejectedSuggestion: false,
      },
      activity: {
        recentUserMessages: 2,
        recentAssistantMessages: 6,
        recentToolCalls: 7,
        recentFailures: 3,
        repeatedFailureCount: 2,
        noProgressWindowMs: 1_200_000,
      },
      diagnostics: {
        failingTests: 1,
        failingCommands: 1,
        repeatedErrorSignatures: ['ERR_DEBUG_MASTER_LOOP'],
        uncertaintySignals: ['stuck'],
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
    },
  };

  if (overrides.draft) {
    input.draft = {
      ...input.draft,
      ...overrides.draft,
    };
  }
  if (overrides.observation) {
    input.observation = {
      ...input.observation,
      ...overrides.observation,
      userIntent: {
        ...input.observation.userIntent,
        ...(overrides.observation.userIntent ?? {}),
      },
      activity: {
        ...input.observation.activity,
        ...(overrides.observation.activity ?? {}),
      },
      diagnostics: {
        ...input.observation.diagnostics,
        ...(overrides.observation.diagnostics ?? {}),
      },
      workState: {
        ...input.observation.workState,
        ...(overrides.observation.workState ?? {}),
      },
      directory: {
        ...input.observation.directory,
        ...(overrides.observation.directory ?? {}),
      },
    };
  }

  return input;
}

test('master suggest materializes a suggested trace instead of jumping directly to preview', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-1'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.suggestion.traceId, 'trace-master-suggest-phase2-1');
  assert.equal(result.data.suggestion.candidateDisplayName, 'Official Debug Master');
  assert.match(result.data.suggestion.suggestionId, /^master-suggest-/);
  assert.equal(result.data.preview, undefined);

  const traceView = await harness.handlers.master.trace({ traceId: 'trace-master-suggest-phase2-1' });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'suggested');
  assert.equal(traceView.data.display.statusText, 'Suggested');
});

test('accept_suggest enters the same preview flow as manual ask and still requires confirmation', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const suggestResult = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-accept'));
  assert.equal(suggestResult.ok, true);

  const acceptResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'accept_suggest',
      traceId: suggestResult.data.suggestion.traceId,
      suggestionId: suggestResult.data.suggestion.suggestionId,
    },
  });

  assert.equal(acceptResult.ok, true);
  assert.equal(acceptResult.state, 'awaiting_confirmation');
  assert.equal(acceptResult.data.hostAction, 'accept_suggest');
  assert.equal(acceptResult.data.suggestionId, suggestResult.data.suggestion.suggestionId);
  assert.equal(acceptResult.data.preview.request.trigger.mode, 'suggest');
  assert.match(acceptResult.data.confirmation.confirmCommand, /^metabot master ask --trace-id /);
});

test('reject_suggest records suppression so the same kind is not suggested again immediately', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const firstSuggestion = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-reject-1'));
  assert.equal(firstSuggestion.ok, true);

  const rejectResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'reject_suggest',
      traceId: firstSuggestion.data.suggestion.traceId,
      suggestionId: firstSuggestion.data.suggestion.suggestionId,
      reason: 'Not now.',
    },
  });

  assert.equal(rejectResult.ok, true);
  assert.equal(rejectResult.state, 'success');
  assert.equal(rejectResult.data.hostAction, 'reject_suggest');
  assert.equal(rejectResult.data.rejected, true);

  const secondAttempt = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-reject-2', {
    observation: {
      diagnostics: {
        repeatedErrorSignatures: ['ERR_DEBUG_MASTER_FOLLOWUP'],
      },
    },
  }));

  assert.equal(secondAttempt.ok, true);
  assert.equal(secondAttempt.state, 'success');
  assert.deepEqual(secondAttempt.data.decision, {
    action: 'no_action',
    reason: 'The same Master kind was rejected recently.',
  });
});

test('reject_suggest updates the trace so it no longer looks like an active suggestion', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const suggestion = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-reject-trace'));
  assert.equal(suggestion.ok, true);

  const rejectResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'reject_suggest',
      traceId: suggestion.data.suggestion.traceId,
      suggestionId: suggestion.data.suggestion.suggestionId,
      reason: 'Not helpful right now.',
    },
  });

  assert.equal(rejectResult.ok, true);

  const traceView = await harness.handlers.master.trace({
    traceId: suggestion.data.suggestion.traceId,
  });

  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'discovered');
  assert.equal(traceView.data.latestEvent, 'master_suggestion_rejected');
  assert.equal(traceView.data.display.statusText, 'Discovered');
});

test('accept_suggest fails once the suggested master is offline and the suggestion expires', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const suggestion = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-offline'));
  assert.equal(suggestion.ok, true);

  await harness.providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: 0,
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
  });

  const acceptResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'accept_suggest',
      traceId: suggestion.data.suggestion.traceId,
      suggestionId: suggestion.data.suggestion.suggestionId,
    },
  });

  assert.equal(acceptResult.ok, false);
  assert.equal(acceptResult.code, 'master_offline');
  assert.match(acceptResult.message, /offline/i);
});

test('master suggest does not surface a suggestion when no online matching master can be resolved', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-no-target', {
    observation: {
      hostMode: 'claude',
      directory: {
        availableMasters: 1,
        trustedMasters: 1,
        onlineMasters: 1,
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.deepEqual(result.data.decision, {
    action: 'no_action',
    reason: 'No matching online Master could be resolved for this suggestion.',
  });
  assert.equal(result.data.suggestion, undefined);
});

test('master suggest resolves the target using the current host mode instead of defaulting to codex', async (t) => {
  const harness = await createSuggestHarness({
    masters: [
      createDebugMasterRecord({
        id: 'master-pin-codex',
        sourceMasterPinId: 'master-pin-codex',
        currentPinId: 'master-pin-codex',
        serviceName: 'official-debug-master-codex',
        displayName: 'Codex Debug Master',
        hostModes: ['codex'],
        updatedAt: 1_776_000_000_100,
      }),
      createDebugMasterRecord({
        id: 'master-pin-claude',
        sourceMasterPinId: 'master-pin-claude',
        currentPinId: 'master-pin-claude',
        serviceName: 'official-debug-master-claude',
        displayName: 'Claude Debug Master',
        hostModes: ['claude'],
        updatedAt: 1_776_000_000_050,
      }),
    ],
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-host-mode', {
    observation: {
      hostMode: 'claude',
      directory: {
        availableMasters: 2,
        trustedMasters: 1,
        onlineMasters: 2,
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.suggestion.candidateDisplayName, 'Claude Debug Master');
});

test('master suggest reports trigger_mode_disallows_suggest when runtime config is manual', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      triggerMode: 'manual',
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-manual-mode'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.deepEqual(result.data.decision, {
    action: 'no_action',
    reason: 'Ask Master trigger mode is manual.',
  });
  assert.deepEqual(result.data.blocked, {
    code: 'trigger_mode_disallows_suggest',
    message: 'Ask Master trigger mode is manual.',
  });
});

test('manual hostAction reports ask_master_disabled when Ask Master is disabled in config', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      enabled: false,
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.hostAction({
    action: {
      kind: 'manual_ask',
      utterance: 'Please ask Debug Master about this bug.',
    },
    context: {
      hostMode: 'codex',
      traceId: 'trace-master-host-action-disabled',
      conversation: {
        currentUserRequest: 'Please ask Debug Master about this bug.',
        recentMessages: [
          { role: 'user', content: 'The confirmation preview never moves to a response.' },
        ],
      },
      tools: {
        recentToolResults: [],
      },
      workspace: {
        goal: 'Diagnose the blocked Ask Master runtime.',
        constraints: ['Keep context minimal.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Testing disabled policy handling.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: false,
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ask_master_disabled');
});

test('reject_suggest still succeeds after Ask Master is disabled locally', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const suggestion = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-reject-disabled'));
  assert.equal(suggestion.ok, true);

  await harness.configStore.set({
    evolution_network: {
      enabled: true,
      autoAdoptSameSkillSameScope: false,
      autoRecordExecutions: true,
    },
    askMaster: {
      enabled: false,
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  });

  const rejectResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'reject_suggest',
      traceId: suggestion.data.suggestion.traceId,
      suggestionId: suggestion.data.suggestion.suggestionId,
      reason: 'Disable flow and dismiss this suggestion.',
    },
  });

  assert.equal(rejectResult.ok, true);
  assert.equal(rejectResult.data.hostAction, 'reject_suggest');
});

test('master suggest exposes the phase-2 auto-mode blocked reason when triggerMode is auto', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      triggerMode: 'auto',
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-suggest-phase2-auto-mode'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.deepEqual(result.data.decision, {
    action: 'no_action',
    reason: 'Auto Ask Master is not exposed in the phase-2 host flow.',
  });
  assert.deepEqual(result.data.blocked, {
    code: null,
    message: 'Auto Ask Master is not exposed in the phase-2 host flow.',
  });
});
