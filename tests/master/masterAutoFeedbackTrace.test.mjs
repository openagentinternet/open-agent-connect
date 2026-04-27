import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
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
      workspaceSummary: 'Caller-side auto feedback integration test for Ask Master.',
      errorSummary: 'Repeated ERR_DEBUG_MASTER_LOOP failures across the same task.',
      relevantFiles: ['tests/master/masterAutoFeedbackTrace.test.mjs'],
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
  const homeDir = await createProfileHome('metabot-master-auto-feedback-');
  const identityPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const pendingMasterAskStateStore = createPendingMasterAskStateStore(homeDir);
  const autoFeedbackStateStore = createMasterAutoFeedbackStateStore(homeDir);
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const writes = [];

  await runtimeStateStore.writeState({
    identity: createIdentity(identityPair.publicKeyHex),
    services: [],
    traces: [],
  });
  await masterStateStore.write({
    masters: [createDebugMasterRecord()],
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
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-auto-feedback',
    lastHeartbeatTxid: 'heartbeat-tx-auto-feedback',
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
        txids: ['simplemsg-tx-auto-feedback-1'],
        pinId: 'simplemsg-pin-auto-feedback-1',
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
        deliveryPinId: 'simplemsg-reply-pin-auto-feedback-1',
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
    autoFeedbackStateStore,
    pendingMasterAskStateStore,
  };
}

test('rejecting an auto preview updates feedback state, trace artifacts, and suppression consistently', async (t) => {
  const harness = await createAutoHarness();
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const preview = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-feedback-reject'));
  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');

  const rejectResult = await harness.handlers.master.hostAction({
    action: {
      kind: 'reject_auto_preview',
      traceId: preview.data.traceId,
      reason: 'Not now.',
    },
  });

  assert.equal(rejectResult.ok, true);
  assert.equal(rejectResult.state, 'success');
  assert.equal(rejectResult.data.hostAction, 'reject_auto_preview');

  const feedback = await harness.autoFeedbackStateStore.get(preview.data.traceId);
  assert.equal(feedback.status, 'rejected');
  assert.equal(feedback.masterKind, 'debug');
  assert.equal(feedback.masterServicePinId, 'master-pin-1');
  assert.equal(feedback.triggerReasonSignature, 'ERR_DEBUG_MASTER_LOOP');

  const traceView = await harness.handlers.master.trace({ traceId: preview.data.traceId });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'failed');
  assert.equal(traceView.data.latestEvent, 'auto_preview_rejected');
  assert.equal(traceView.data.display.statusText, 'Declined');
  assert.equal(traceView.data.auto.reason, 'Repeated failures and a trusted Master make automatic Ask Master entry viable.');
  assert.equal(traceView.data.auto.frictionMode, 'preview_confirm');

  const traceJson = JSON.parse(await readFile(traceView.data.artifacts.traceJsonPath, 'utf8'));
  assert.equal(traceJson.askMaster.auto.reason, 'Repeated failures and a trusted Master make automatic Ask Master entry viable.');
  assert.equal(traceJson.askMaster.failure.code, 'auto_rejected_by_user');
  assert.equal(traceJson.a2a.latestEvent, 'auto_preview_rejected');

  const traceMarkdown = await readFile(traceView.data.artifacts.traceMarkdownPath, 'utf8');
  assert.match(traceMarkdown, /Auto Reason:/);
  assert.match(traceMarkdown, /Declined/);

  const followUp = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-feedback-reject-follow-up', {
    observation: {
      diagnostics: {
        repeatedErrorSignatures: ['ERR_DEBUG_MASTER_REJECT_FOLLOWUP'],
      },
    },
  }));
  assert.equal(followUp.ok, true);
  assert.deepEqual(followUp.data.decision, {
    action: 'no_action',
    reason: 'The same Master target was rejected recently.',
  });
});

test('prepared auto previews do not create persisted cross-trace suppression before feedback lands', async (t) => {
  const harness = await createAutoHarness();
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const preview = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-feedback-prepared-1'));
  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');

  const reloadedHandlers = createDefaultMetabotDaemonHandlers({
    homeDir: harness.homeDir,
    getDaemonRecord: () => null,
  });

  const followUp = await reloadedHandlers.master.suggest(buildSuggestInput('trace-master-auto-feedback-prepared-2'));
  assert.equal(followUp.ok, true);
  assert.equal(followUp.state, 'awaiting_confirmation');
  assert.equal(followUp.data.decision.action, 'auto_candidate');
});

test('auto direct-send timeouts persist timed_out feedback and re-export trace artifacts', async (t) => {
  const harness = await createAutoHarness({
    askMasterConfig: {
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    },
    masterReplyWaiterOverride: {
      async awaitMasterReply() {
        return { state: 'timeout' };
      },
    },
  });
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-feedback-timeout', {
    draft: {
      userTask: 'Diagnose the direct-send timeout loop.',
      question: 'What should change next in the blocked direct-send path?',
      workspaceSummary: 'Direct-send timeout regression coverage for auto feedback.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'timeout_failure',
          content: 'AssertionError: expected the auto direct-send path to finish before the foreground wait ended.',
        },
      ],
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.ok(result.data.traceId);
  assert.ok(result.data.requestId);

  const traceView = await harness.handlers.master.trace({ traceId: 'trace-master-auto-feedback-timeout' });
  assert.equal(traceView.ok, true);
  assert.equal(traceView.data.canonicalStatus, 'requesting_remote');
  assert.equal(traceView.data.auto.frictionMode, 'direct_send');
  assert.equal(traceView.data.auto.selectedMasterTrusted, true);
});
