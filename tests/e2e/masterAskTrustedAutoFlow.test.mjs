import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { buildMasterResponseJson, parseMasterRequest } = require('../../dist/core/master/masterMessageSchema.js');

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

function createMasterRecord(overrides = {}) {
  return {
    id: 'master-pin-debug-1',
    sourceMasterPinId: 'master-pin-debug-1',
    currentPinId: 'master-pin-debug-1',
    creatorMetabotId: 1,
    providerGlobalMetaId: 'idq1caller',
    providerAddress: 'mvc-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfoJson: JSON.stringify({ provider: 'metaweb', model: 'official-debug-master-v1' }),
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

function buildReviewSuggestInput(traceId) {
  return {
    draft: {
      userTask: 'Review the patch before applying the current auto-ask provider matrix changes.',
      question: 'Which regression risks or review findings matter most before I continue?',
      workspaceSummary: 'Trusted auto Ask Master review flow e2e.',
      diffSummary: 'Patch touches provider routing, selector behavior, and trusted auto send policy.',
      relevantFiles: [
        'src/core/master/masterProviderRuntime.ts',
        'src/daemon/defaultHandlers.ts',
      ],
      constraints: ['Return structured review findings and next actions only.'],
      artifacts: [
        {
          kind: 'text',
          label: 'patch_excerpt',
          content: 'Updated provider matrix handling and auto selection behavior around review checkpoints.',
        },
      ],
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
        recentUserMessages: 1,
        recentAssistantMessages: 3,
        recentToolCalls: 4,
        recentFailures: 2,
        repeatedFailureCount: 2,
        noProgressWindowMs: 1_200_000,
      },
      diagnostics: {
        failingTests: 0,
        failingCommands: 1,
        repeatedErrorSignatures: ['REVIEW_CHECKPOINT_AUTO'],
        uncertaintySignals: ['review_checkpoint_risk'],
      },
      workState: {
        hasPlan: true,
        todoBlocked: true,
        diffChangedRecently: true,
        onlyReadingWithoutConverging: true,
      },
      directory: {
        availableMasters: 2,
        trustedMasters: 2,
        onlineMasters: 2,
      },
      candidateMasterKindHint: 'review',
    },
  };
}

async function createHarness(options = {}) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trusted-auto-review-e2e-'));
  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const writes = [];

  await runtimeStateStore.writeState({
    identity: createIdentity(identityPair.publicKeyHex),
    services: [],
    traces: [],
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
      confirmationMode: 'sensitive_only',
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
  await masterStateStore.write({
    masters: [
      createMasterRecord(),
      createMasterRecord({
        id: 'master-pin-review-1',
        sourceMasterPinId: 'master-pin-review-1',
        currentPinId: 'master-pin-review-1',
        serviceName: 'official-review-master',
        displayName: 'Official Review Master',
        description: 'Structured review help.',
        masterKind: 'review',
        specialties: ['review', 'regression risk'],
        modelInfoJson: JSON.stringify({ provider: 'metaweb', model: 'official-review-master-v1' }),
        ...(options.reviewMasterOverrides ?? {}),
      }),
    ],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-review-auto-e2e',
    lastHeartbeatTxid: 'heartbeat-tx-review-auto-e2e',
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    signer: {
      async getPrivateChatIdentity() {
        return {
          globalMetaId: 'idq1caller',
          privateKeyHex: identityPair.privateKeyHex,
        };
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['simplemsg-tx-review-auto-e2e-1'],
          pinId: 'simplemsg-pin-review-auto-e2e-1',
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
    },
    masterReplyWaiter: {
      async awaitMasterReply(input) {
        const responseJson = buildMasterResponseJson({
          type: 'master_response',
          version: '1.0.0',
          requestId: input.requestId,
          traceId: input.traceId,
          responder: {
            providerGlobalMetaId: input.providerGlobalMetaId,
            masterServicePinId: input.masterServicePinId,
            masterKind: 'review',
          },
          status: 'completed',
          summary: 'The review master returned structured patch guidance.',
          structuredData: {
            findings: ['The patch changes provider selection and should preserve debug fallback behavior.'],
            recommendations: ['Add provider-matrix coverage for review-targeted auto send.'],
            risks: ['Review selection could regress if trusted debug ranking overrides kind filtering.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-review-auto-e2e-1',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  return {
    homeDir,
    identityPair,
    handlers,
    writes,
  };
}

test('trusted non-sensitive auto flow selects the review master for review-checkpoint signals and sends directly', async (t) => {
  const harness = await createHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildReviewSuggestInput('trace-master-auto-review-direct'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'direct_send');
  assert.equal(result.data.preview.confirmation.requiresConfirmation, false);
  assert.equal(result.data.preview.target.displayName, 'Official Review Master');
  assert.equal(result.data.preview.request.target.masterKind, 'review');
  assert.equal(result.data.response.masterKind, 'review');
  assert.equal(harness.writes.length, 1);

  const outboundPayload = JSON.parse(harness.writes[0].payload);
  const decrypted = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: harness.identityPair.privateKeyHex,
    },
    peerChatPublicKey: harness.identityPair.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1caller',
      rawData: JSON.stringify({ content: outboundPayload.content }),
      replyPinId: outboundPayload.replyPin,
    },
  });
  const parsedRequest = parseMasterRequest(decrypted.plaintextJson);
  assert.equal(parsedRequest.ok, true);
  assert.equal(parsedRequest.value.target.masterKind, 'review');
  assert.equal(parsedRequest.value.target.masterServicePinId, 'master-pin-review-1');
});

test('configured trustedMasters can unlock direct send for a non-official review target', async (t) => {
  const harness = await createHarness({
    askMasterConfig: {
      trustedMasters: ['master-pin-review-1'],
    },
    reviewMasterOverrides: {
      serviceName: 'trusted-review-master',
      displayName: 'Trusted Review Master',
      official: 0,
      trustedTier: null,
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildReviewSuggestInput('trace-master-auto-review-trusted-list'));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'direct_send');
  assert.equal(result.data.preview.target.displayName, 'Trusted Review Master');
  assert.equal(result.data.preview.request.target.masterKind, 'review');

  const outboundPayload = JSON.parse(harness.writes[0].payload);
  const decrypted = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: harness.identityPair.privateKeyHex,
    },
    peerChatPublicKey: harness.identityPair.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1caller',
      rawData: JSON.stringify({ content: outboundPayload.content }),
      replyPinId: outboundPayload.replyPin,
    },
  });
  const parsedRequest = parseMasterRequest(decrypted.plaintextJson);
  assert.equal(parsedRequest.ok, true);
  assert.equal(parsedRequest.value.target.masterServicePinId, 'master-pin-review-1');
  assert.equal(parsedRequest.value.target.masterKind, 'review');
});
