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
const { buildMasterHostObservation } = require('../../dist/core/master/masterHostObservation.js');

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

test('master suggest can derive trigger observation from host context when explicit observation is omitted', async (t) => {
  const harness = await createSuggestHarness({
    masters: [
      createDebugMasterRecord(),
    ],
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Diagnose the repeated preview/confirm loop before asking a Master.',
      question: 'Should I ask the Debug Master about this repeated preview loop?',
      workspaceSummary: 'Suggest flow deriving observation from host context.',
      errorSummary: 'Repeated ERR_HOST_CONTEXT_SUGGEST failures.',
      relevantFiles: ['tests/master/masterSuggestFlowPhase2.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-context-derived',
      conversation: {
        currentUserRequest: 'The preview still never leaves confirmation after I accept it.',
        recentMessages: [
          { role: 'user', content: 'The preview still never leaves confirmation after I accept it.' },
          { role: 'assistant', content: 'I only kept reading trace exports without converging on a fix.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - preview confirm loop remains stuck',
            stderr: 'AssertionError: expected Ask Master preview to progress after confirmation',
          },
          {
            toolName: 'node scripts/check-preview.mjs',
            exitCode: 1,
            stdout: '',
            stderr: 'Error: ERR_HOST_CONTEXT_SUGGEST',
          },
        ],
      },
      workspace: {
        goal: 'Break the repeated Ask Master preview/confirm loop.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Tracing the preview/confirm loop through defaultHandlers.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
        directory: {
          availableMasters: 1,
          trustedMasters: 1,
          onlineMasters: 1,
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.decision.candidateMasterKind, 'debug');
  assert.equal(result.data.suggestion.traceId, 'trace-master-suggest-phase2-context-derived');
});

test('master suggest can derive directory availability from runtime state when host context omits directory counts', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Decide whether Ask Master should trigger from bare host context.',
      question: 'Should I ask the Debug Master about this repeated host-context failure loop?',
      workspaceSummary: 'Suggest flow without caller-supplied directory counts.',
      errorSummary: 'Repeated ERR_HOST_CONTEXT_DIRECTORY failures.',
      relevantFiles: ['tests/master/masterSuggestFlowPhase2.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-context-runtime-directory',
      conversation: {
        currentUserRequest: 'I keep hitting the same failure and need a better diagnosis.',
        recentMessages: [
          { role: 'user', content: 'I keep hitting the same failure and need a better diagnosis.' },
          { role: 'assistant', content: 'I reran the same failing checks without converging.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - host context still fails',
            stderr: 'AssertionError: expected context-derived suggest to survive missing directory counts',
          },
          {
            toolName: 'node scripts/check-host-context.mjs',
            exitCode: 1,
            stdout: '',
            stderr: 'Error: ERR_HOST_CONTEXT_DIRECTORY',
          },
        ],
      },
      workspace: {
        goal: 'Keep context-derived suggest self-sufficient.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Inspecting how suggest derives observation from host context.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.suggestion.traceId, 'trace-master-suggest-phase2-context-runtime-directory');
});

test('master suggest preserves an explicit offline directory signal instead of overwriting it from runtime state', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Respect an explicit offline directory snapshot.',
      question: 'Should Ask Master stay suppressed when the host explicitly reports no online masters?',
      workspaceSummary: 'Suggest flow with an explicit offline directory snapshot.',
      errorSummary: 'Repeated ERR_EXPLICIT_DIRECTORY_OFFLINE failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-explicit-directory-offline',
      conversation: {
        currentUserRequest: 'The host says no masters are online right now.',
        recentMessages: [
          { role: 'user', content: 'The host says no masters are online right now.' },
          { role: 'assistant', content: 'Repeated checks still see the same issue.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - explicit directory offline remains true',
            stderr: 'AssertionError: expected explicit offline directory state to suppress suggest',
          },
        ],
      },
      workspace: {
        goal: 'Preserve explicit directory state from the host.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Reviewing how suggest hydrates directory state.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
        directory: {
          availableMasters: 1,
          trustedMasters: 0,
          onlineMasters: 0,
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.decision, {
    action: 'no_action',
    reason: 'No online Master is currently available.',
  });
});

test('master suggest merges partial trigger observation with host context instead of dropping derived fields', async (t) => {
  const harness = await createSuggestHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Preserve context-derived trigger fields when a wrapper adds partial observation data.',
      question: 'Should I still ask the Debug Master if the wrapper adds a small observation override?',
      workspaceSummary: 'Suggest flow merging partial observation with host context.',
      errorSummary: 'Repeated ERR_PARTIAL_OBSERVATION_MERGE failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: {
      userIntent: {
        explicitlyRejectedSuggestion: false,
      },
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-partial-observation-merge',
      conversation: {
        currentUserRequest: 'The wrapper only added a user-intent flag.',
        recentMessages: [
          { role: 'user', content: 'The wrapper only added a user-intent flag.' },
          { role: 'assistant', content: 'The underlying host context still shows repeated failures.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - merge still fails',
            stderr: 'AssertionError: expected partial observation to merge with derived context',
          },
          {
            toolName: 'node scripts/check-merge.mjs',
            exitCode: 1,
            stdout: '',
            stderr: 'Error: ERR_PARTIAL_OBSERVATION_MERGE',
          },
        ],
      },
      workspace: {
        goal: 'Merge partial observation with host context safely.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Inspecting partial observation precedence for suggest.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.suggestion.traceId, 'trace-master-suggest-phase2-partial-observation-merge');
});

test('master suggest accepts a host observation frame directly under observation', async (t) => {
  const harness = await createSuggestHarness({
    masters: [
      createDebugMasterRecord({
        id: 'master-pin-review',
        sourceMasterPinId: 'master-pin-review',
        currentPinId: 'master-pin-review',
        serviceName: 'official-review-master',
        displayName: 'Official Review Master',
        masterKind: 'review',
        hostModes: ['codex'],
        updatedAt: 1_776_000_000_100,
      }),
    ],
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const hostContext = {
    now: 1_776_000_000_000,
    hostMode: 'codex',
    traceId: 'trace-master-suggest-phase2-host-observation-frame',
    conversation: {
      currentUserRequest: 'Please review this patch before I land it.',
      recentMessages: [
        { role: 'user', content: 'Please review this patch before I land it.' },
        { role: 'assistant', content: 'I inspected the diff but want another review pass.' },
      ],
    },
    tools: {
      recentToolResults: [],
    },
    workspace: {
      goal: 'Land the patch with lower regression risk.',
      constraints: ['Do not upload the whole repository.'],
      relevantFiles: ['src/core/master/masterHostAdapter.ts'],
      diffSummary: 'Patch is ready for a review-style checkpoint.',
      fileExcerpts: [],
    },
    planner: {
      hasPlan: true,
      todoBlocked: false,
      onlyReadingWithoutConverging: false,
    },
    hostSignals: {
      reviewCheckpointRisk: true,
      uncertaintySignals: ['patch_risk'],
      directory: {
        availableMasters: 1,
        trustedMasters: 0,
        onlineMasters: 1,
      },
    },
  };

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Decide whether a review checkpoint should ask the Review Master.',
      question: 'Should I ask the Review Master to review this patch before landing it?',
      workspaceSummary: 'Suggest flow reading a host observation frame directly.',
      errorSummary: null,
      relevantFiles: ['src/core/master/masterHostAdapter.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: buildMasterHostObservation(hostContext),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.decision.candidateMasterKind, 'review');
  assert.equal(result.data.suggestion.candidateDisplayName, 'Official Review Master');
});

test('master suggest in auto mode hydrates missing trusted-master counts before surfacing auto_candidate', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      triggerMode: 'auto',
      trustedMasters: ['master-pin-1'],
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Surface a real auto candidate once trusted counts are hydrated.',
      question: 'Should auto mode surface auto_candidate instead of falling back to a plain suggestion?',
      workspaceSummary: 'Auto-mode suggest flow with partial directory state and trusted hydration.',
      errorSummary: 'Repeated ERR_AUTO_DIRECTORY_TRUST failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-auto-directory-trust',
      conversation: {
        currentUserRequest: 'Auto mode should see this trusted master as eligible.',
        recentMessages: [
          { role: 'user', content: 'Auto mode should see this trusted master as eligible.' },
          { role: 'assistant', content: 'The task is still stuck and trusted routing matters here.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - auto trust hydration still fails',
            stderr: 'AssertionError: expected trusted master counts to hydrate before auto evaluation',
          },
          {
            toolName: 'node scripts/check-auto-trust.mjs',
            exitCode: 1,
            stdout: '',
            stderr: 'Error: ERR_AUTO_DIRECTORY_TRUST',
          },
        ],
      },
      workspace: {
        goal: 'Keep auto-mode directory hydration consistent.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Inspecting directory hydration before auto trigger evaluation.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
        directory: {
          availableMasters: 1,
          onlineMasters: 1,
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision.action, 'auto_candidate');
  assert.equal(result.data.decision.candidateMasterKind, 'debug');
  assert.equal(result.data.decision.confidence, 0.95);
  assert.match(result.data.decision.reason, /trusted Master/i);
  assert.equal(result.data.blocked, null);
  assert.deepEqual(result.data.autoPolicy, {
    selectedFrictionMode: 'preview_confirm',
    requiresConfirmation: true,
    policyReason: 'Confirmation mode always requires a preview confirmation step.',
  });
  assert.deepEqual(result.data.target, {
    masterPinId: 'master-pin-1',
    displayName: 'Official Debug Master',
    masterKind: 'debug',
    providerGlobalMetaId: 'idq1caller',
  });
});

test('master suggest honors explicitlyRejectedAutoAsk before surfacing the phase-2 auto block', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      triggerMode: 'auto',
      trustedMasters: ['master-pin-1'],
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Respect a prior auto-ask rejection.',
      question: 'Should auto mode stop before the phase-2 block when the host already rejected auto ask?',
      workspaceSummary: 'Auto-mode suggest flow honoring explicitlyRejectedAutoAsk.',
      errorSummary: 'Repeated ERR_AUTO_REJECTED failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-auto-rejected',
      conversation: {
        currentUserRequest: 'I already rejected this automatic escalation.',
        recentMessages: [
          { role: 'user', content: 'I already rejected this automatic escalation.' },
          { role: 'assistant', content: 'The host should respect that rejection before trying auto ask again.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - auto rejection still ignored',
            stderr: 'AssertionError: expected explicitlyRejectedAutoAsk to stop auto evaluation',
          },
          {
            toolName: 'node scripts/check-auto-reject.mjs',
            exitCode: 1,
            stdout: '',
            stderr: 'Error: ERR_AUTO_REJECTED',
          },
        ],
      },
      workspace: {
        goal: 'Respect explicit auto-ask rejection.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Inspecting auto rejection handling before trigger evaluation.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        explicitlyRejectedAutoAsk: true,
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.decision, {
    action: 'no_action',
    reason: 'User explicitly rejected automatic Ask Master escalation.',
  });

  const followUp = await harness.handlers.master.suggest({
    draft: {
      userTask: 'Respect the stored rejection on the next auto attempt.',
      question: 'Should the previous auto rejection suppress the next auto candidate?',
      workspaceSummary: 'Auto-mode suggest flow honoring stored explicitlyRejectedAutoAsk suppression.',
      errorSummary: 'Repeated ERR_AUTO_REJECTED_FOLLOWUP failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    context: {
      now: 1_776_000_060_000,
      hostMode: 'codex',
      traceId: 'trace-master-suggest-phase2-auto-rejected-followup',
      conversation: {
        currentUserRequest: 'Try automatic escalation again now that the same loop is still happening.',
        recentMessages: [
          { role: 'user', content: 'Try automatic escalation again now that the same loop is still happening.' },
          { role: 'assistant', content: 'The same debug loop is still active.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - auto rejection follow-up still fails',
            stderr: 'AssertionError: expected stored auto rejection to suppress the next auto candidate',
          },
        ],
      },
      workspace: {
        goal: 'Keep auto-mode rejection suppression stable.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts'],
        diffSummary: 'Re-checking the same auto-rejected debug loop.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: true,
      },
      hostSignals: {
        noProgressWindowMs: 900_000,
        uncertaintySignals: ['still_stuck'],
        directory: {
          availableMasters: 1,
          onlineMasters: 1,
          trustedMasters: 1,
        },
        candidateMasterKindHint: 'debug',
      },
    },
  });

  assert.equal(followUp.ok, true);
  assert.deepEqual(followUp.data.decision, {
    action: 'no_action',
    reason: 'The same Master kind was rejected recently.',
  });
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

test('master suggest surfaces auto_candidate when triggerMode is auto', async (t) => {
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
  assert.equal(result.data.decision.action, 'auto_candidate');
  assert.equal(result.data.decision.candidateMasterKind, 'debug');
  assert.equal(result.data.decision.confidence, 0.99);
  assert.match(result.data.decision.reason, /trusted Master/i);
  assert.equal(result.data.blocked, null);
  assert.deepEqual(result.data.autoPolicy, {
    selectedFrictionMode: 'preview_confirm',
    requiresConfirmation: true,
    policyReason: 'Confirmation mode always requires a preview confirmation step.',
  });
});

test('master suggest enforces the global cooldown on repeated auto candidates across traces', async (t) => {
  const harness = await createSuggestHarness({
    askMasterConfig: {
      triggerMode: 'auto',
      autoPolicy: {
        perTraceLimit: 2,
        globalCooldownMs: 60_000,
      },
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const first = await harness.handlers.master.suggest(buildSuggestInput(
    'trace-master-suggest-phase2-auto-limit-1',
    {
      draft: {
        errorSummary: 'Repeated ERR_AUTO_COOLDOWN_ONE failures.',
      },
      observation: {
        diagnostics: {
          repeatedErrorSignatures: ['ERR_AUTO_COOLDOWN_ONE'],
        },
      },
    }
  ));
  const second = await harness.handlers.master.suggest(buildSuggestInput(
    'trace-master-suggest-phase2-auto-limit-2',
    {
      draft: {
        errorSummary: 'Repeated ERR_AUTO_COOLDOWN_TWO failures.',
      },
      observation: {
        diagnostics: {
          repeatedErrorSignatures: ['ERR_AUTO_COOLDOWN_TWO'],
        },
      },
    }
  ));

  assert.equal(first.ok, true);
  assert.equal(first.data.decision.action, 'auto_candidate');
  assert.equal(second.ok, true);
  assert.deepEqual(second.data.decision, {
    action: 'no_action',
    reason: 'Auto Ask Master is still inside the configured global cooldown window.',
  });
  assert.deepEqual(second.data.blocked, {
    code: 'auto_global_cooldown',
    message: 'Auto Ask Master is still inside the configured global cooldown window.',
  });
  assert.deepEqual(second.data.autoPolicy, {
    selectedFrictionMode: 'preview_confirm',
    requiresConfirmation: true,
    policyReason: 'Recent automatic Ask Master activity is being throttled.',
  });
});
