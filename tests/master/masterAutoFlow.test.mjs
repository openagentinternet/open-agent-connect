import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { createPendingMasterAskStateStore } = require('../../dist/core/master/masterPendingAskState.js');
const { createMasterAutoFeedbackStateStore } = require('../../dist/core/master/masterAutoFeedbackState.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { buildMasterResponseJson } = require('../../dist/core/master/masterMessageSchema.js');

const previousInternalAuto = process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
test.before(() => {
  process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = '1';
});
test.after(() => {
  if (previousInternalAuto === undefined) {
    delete process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
    return;
  }
  process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = previousInternalAuto;
});

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function createIdentity(chatPublicKey) {
  return {
    metabotId: 1,
    name: 'Caller Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'pubkey',
    chatPublicKey,
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

function buildSuggestInput(traceId, overrides = {}) {
  const input = {
    draft: {
      userTask: 'Diagnose a repeated failing test before the local agent loops again.',
      question: 'Should I ask the Debug Master for a tighter diagnosis and next steps?',
      workspaceSummary: 'Caller-side auto suggest integration test for Ask Master.',
      errorSummary: 'Repeated ERR_DEBUG_MASTER_LOOP failures across the same task.',
      relevantFiles: ['tests/master/masterAutoFlow.test.mjs'],
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
        explicitlyRejectedAutoAsk: false,
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

async function createAutoHarness(options = {}) {
  const homeDir = await createProfileHome('metabot-master-auto-flow-');
  const identityPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const pendingMasterAskStateStore = createPendingMasterAskStateStore(homeDir);
  const autoFeedbackStateStore = createMasterAutoFeedbackStateStore(homeDir);
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const writes = [];
  const masters = Array.isArray(options.masters) && options.masters.length > 0
    ? options.masters
    : [createDebugMasterRecord()];

  await runtimeStateStore.writeState({
    identity: createIdentity(identityPair.publicKeyHex),
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
      triggerMode: 'auto',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
      autoPolicy: {
        minConfidence: 0.75,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 2,
        globalCooldownMs: 0,
        allowTrustedAutoSend: false,
      },
      ...(options.askMasterConfig ?? {}),
    },
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-auto',
    lastHeartbeatTxid: 'heartbeat-tx-auto',
  });

  const defaultSigner = {
    async getPrivateChatIdentity() {
      return {
        globalMetaId: 'idq1caller',
        privateKeyHex: identityPair.privateKeyHex,
      };
    },
    async writePin(input) {
      writes.push(input);
      return {
        txids: ['simplemsg-tx-auto-1'],
        pinId: 'simplemsg-pin-auto-1',
        totalCost: 1,
        network: 'mvc',
        operation: 'create',
        path: '/protocols/simplemsg',
        contentType: 'application/json',
        encoding: 'utf-8',
        globalMetaId: 'idq1caller',
        mvcAddress: 'mvc-address',
      };
    },
  };
  const defaultMasterReplyWaiter = {
    async awaitMasterReply(input) {
      const responseJson = buildMasterResponseJson({
        type: 'master_response',
        version: '1.0.0',
        requestId: input.requestId,
        traceId: input.traceId,
        responder: {
          providerGlobalMetaId: input.providerGlobalMetaId,
          masterServicePinId: input.masterServicePinId,
          masterKind: 'debug',
        },
        status: 'completed',
        summary: 'Auto Ask completed with structured debugging advice.',
        structuredData: {
          diagnosis: ['The caller reached a repeated blocked state.'],
          nextSteps: ['Inspect the latest failing assertion.'],
          risks: ['Skipping preview can hide weak context packaging.'],
        },
      });
      return {
        state: 'completed',
        response: JSON.parse(responseJson),
        responseJson,
        deliveryPinId: 'simplemsg-reply-pin-auto-1',
        observedAt: Date.now(),
        rawMessage: null,
      };
    },
  };

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    signer: options.signerOverride ?? defaultSigner,
    masterReplyWaiter: options.masterReplyWaiterOverride ?? defaultMasterReplyWaiter,
  });

  return {
    homeDir,
    handlers,
    writes,
    identityPair,
    pendingMasterAskStateStore,
    autoFeedbackStateStore,
  };
}

test('master suggest in auto mode materializes a preview instead of returning bare auto_candidate metadata', async (t) => {
  const harness = await createAutoHarness();
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-preview-1'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.decision.action, 'auto_candidate');
  assert.equal(result.data.triggerMode, 'auto');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'preview_confirm');
  assert.equal(result.data.autoPolicy.requiresConfirmation, true);
  assert.equal(result.data.preview.confirmation.requiresConfirmation, true);
  assert.equal(result.data.preview.confirmation.frictionMode, 'preview_confirm');
  assert.equal(result.data.preview.request.trigger.mode, 'auto');

  const pendingAsk = await harness.pendingMasterAskStateStore.get(result.data.traceId);
  assert.equal(pendingAsk.confirmationState, 'awaiting_confirmation');
  assert.equal(pendingAsk.request.trigger.mode, 'auto');
  assert.equal(pendingAsk.preview.confirmation.frictionMode, 'preview_confirm');

  const traceView = await harness.handlers.master.trace({ traceId: result.data.traceId });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'awaiting_confirmation');
  assert.equal(traceView.data.triggerMode, 'auto');
});

test('master suggest in auto mode can direct send for trusted non-sensitive payloads while still persisting the preview snapshot', async (t) => {
  const harness = await createAutoHarness({
    askMasterConfig: {
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    },
  });
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-direct-send-1', {
    draft: {
      userTask: 'Diagnose the latest repeated assertion failure in the auto flow.',
      question: 'What is the tightest next fix for the current blocked flow?',
      workspaceSummary: 'Current task is a repeated caller-side flow regression.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'latest_failure',
          content: 'AssertionError: expected auto flow to continue after preview materialization.',
        },
      ],
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.decision.action, 'auto_candidate');
  assert.equal(result.data.triggerMode, 'auto');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'direct_send');
  assert.equal(result.data.autoPolicy.requiresConfirmation, false);
  assert.equal(result.data.session.publicStatus, 'completed');
  assert.equal(result.data.preview.confirmation.requiresConfirmation, false);
  assert.equal(result.data.preview.confirmation.frictionMode, 'direct_send');
  assert.equal(harness.writes.length, 1);

  const pendingAsk = await harness.pendingMasterAskStateStore.get(result.data.traceId);
  assert.equal(pendingAsk.confirmationState, 'sent');
  assert.equal(pendingAsk.request.trigger.mode, 'auto');
  assert.equal(pendingAsk.preview.confirmation.requiresConfirmation, false);
  assert.equal(pendingAsk.preview.confirmation.frictionMode, 'direct_send');

  const traceView = await harness.handlers.master.trace({ traceId: result.data.traceId });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'completed');
  assert.equal(traceView.data.triggerMode, 'auto');

  const feedback = await harness.autoFeedbackStateStore.get(result.data.traceId);
  assert.equal(feedback.status, 'completed');

  const followUp = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-direct-send-1', {
    observation: {
      diagnostics: {
        repeatedErrorSignatures: ['ERR_DEBUG_MASTER_LOOP_FOLLOWUP'],
      },
    },
  }));
  assert.equal(followUp.ok, true);
  assert.deepEqual(followUp.data.decision, {
    action: 'no_action',
    reason: 'This trace was already suggested for Ask Master.',
  });
});

test('master suggest in auto mode falls back to preview when the packaged payload still looks sensitive', async (t) => {
  const harness = await createAutoHarness({
    askMasterConfig: {
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    },
  });
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-sensitive-1', {
    draft: {
      userTask: 'Diagnose why the session token recovery path keeps leaking state.',
      question: 'What should I change in the token fallback path next?',
      workspaceSummary: 'The current blocked task is around token handling in the caller runtime.',
      artifacts: [
        {
          kind: 'text',
          label: 'token_context',
          content: 'The current request still mentions token handling and secret rotation.',
        },
      ],
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'preview_confirm');
  assert.equal(result.data.autoPolicy.requiresConfirmation, true);
  assert.equal(result.data.autoPolicy.sensitivity.isSensitive, true);
  assert.match(result.data.autoPolicy.sensitivity.reasons.join(' '), /sensitive auth material/i);
  assert.equal(result.data.preview.confirmation.requiresConfirmation, true);
  assert.equal(result.data.preview.confirmation.frictionMode, 'preview_confirm');
  assert.equal(harness.writes.length, 0);
});

test('master suggest in auto mode falls back to plain suggest when confidence never reaches the auto threshold', async (t) => {
  const harness = await createAutoHarness({
    askMasterConfig: {
      autoPolicy: {
        minConfidence: 0.95,
      },
    },
  });
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-low-confidence', {
    observation: {
      activity: {
        recentFailures: 0,
        repeatedFailureCount: 0,
        noProgressWindowMs: null,
      },
      diagnostics: {
        repeatedErrorSignatures: ['ERR_DEBUG_MASTER_LOOP'],
        uncertaintySignals: [],
      },
      workState: {
        todoBlocked: false,
        onlyReadingWithoutConverging: false,
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.decision.action, 'suggest');
  await assert.rejects(() => harness.pendingMasterAskStateStore.get('trace-master-auto-low-confidence'));
});

test('master suggest in auto mode does not persist preview state when throttling policy blocks auto preparation', async (t) => {
  const cases = [
    {
      name: 'per-trace limit',
      harnessOptions: {
        askMasterConfig: {
          autoPolicy: {
            perTraceLimit: 1,
          },
        },
      },
      input: buildSuggestInput('trace-master-auto-blocked-limit'),
      beforeSuggest: async (harness, input) => {
        await harness.handlers.master.suggest(input);
      },
    },
    {
      name: 'global cooldown',
      harnessOptions: {
        askMasterConfig: {
          autoPolicy: {
            globalCooldownMs: 60_000,
          },
        },
      },
      input: buildSuggestInput('trace-master-auto-blocked-cooldown'),
      beforeSuggest: async (harness) => {
        await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-blocked-cooldown-primer'));
      },
    },
  ];

  for (const entry of cases) {
    const harness = await createAutoHarness(entry.harnessOptions);
    t.after(async () => {
      await cleanupProfileHome(harness.homeDir);
    });
    const beforeState = await harness.pendingMasterAskStateStore.read();
    if (entry.beforeSuggest) {
      await entry.beforeSuggest(harness, entry.input);
    }
    const preparedState = await harness.pendingMasterAskStateStore.read();

    const result = await harness.handlers.master.suggest(entry.input);

    assert.equal(result.ok, true, entry.name);
    assert.equal(result.state, 'success', entry.name);
    assert.equal(result.data.decision.action, 'no_action', entry.name);
    if (entry.expectedCode) {
      assert.equal(result.data.blocked?.code, entry.expectedCode, entry.name);
    }
    const afterState = await harness.pendingMasterAskStateStore.read();
    assert.equal(afterState.items.length, preparedState.items.length, entry.name);
    if (preparedState.items.length === beforeState.items.length) {
      await assert.rejects(() => harness.pendingMasterAskStateStore.get(entry.input.observation.traceId));
    }
  }
});

test('direct-send transport failures update the trace out of awaiting_confirmation and return the trace id in the error message', async (t) => {
  const harness = await createAutoHarness({
    askMasterConfig: {
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    },
    signerOverride: {
      async getPrivateChatIdentity() {
        throw new Error('private chat key is unavailable');
      },
      async writePin() {
        throw new Error('writePin should not be called after signer failure');
      },
    },
  });
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-send-failure', {
    draft: {
      userTask: 'Diagnose the latest blocked direct-send flow.',
      question: 'What is the tightest next fix for the current blocked flow?',
      workspaceSummary: 'Direct-send failure regression coverage for auto flow.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'failing_assertion',
          content: 'AssertionError: expected the auto path to continue after preview materialization.',
        },
      ],
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'identity_secret_missing');
  assert.match(result.message ?? '', /trace-master-auto-send-failure/);
  assert.equal(harness.writes.length, 0);

  const pendingAsk = await harness.pendingMasterAskStateStore.get('trace-master-auto-send-failure');
  assert.equal(pendingAsk.confirmationState, 'awaiting_confirmation');

  const traceView = await harness.handlers.master.trace({ traceId: 'trace-master-auto-send-failure' });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'failed');
  assert.equal(traceView.data.failure.code, 'identity_secret_missing');

  const transcriptMarkdown = await readFile(traceView.data.artifacts.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Preview prepared for Official Debug Master/);
});
