import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
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

function createDebugMasterRecord() {
  return {
    id: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    currentPinId: 'master-pin-1',
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
  };
}

function buildSuggestInput(traceId, overrides = {}) {
  const input = {
    draft: {
      userTask: 'Diagnose the repeated blocked auto escalation path.',
      question: 'Should I ask the Debug Master for the shortest fix path?',
      workspaceSummary: 'End-to-end auto ask test for Ask Master.',
      errorSummary: 'Repeated ERR_AUTO_MASTER_LOOP failures across the same task.',
      relevantFiles: ['tests/e2e/masterAskAutoFlow.test.mjs'],
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
        repeatedErrorSignatures: ['ERR_AUTO_MASTER_LOOP'],
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

  return input;
}

function parseOutput(chunks) {
  return JSON.parse(chunks.join('').trim());
}

async function createHarness(options = {}) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-auto-flow-e2e-'));
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
  await masterStateStore.write({
    masters: [createDebugMasterRecord()],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-auto-e2e',
    lastHeartbeatTxid: 'heartbeat-tx-auto-e2e',
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
          txids: ['simplemsg-tx-auto-e2e-1'],
          pinId: 'simplemsg-pin-auto-e2e-1',
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
            masterKind: 'debug',
          },
          status: 'completed',
          summary: 'The auto ask flow completed successfully.',
          structuredData: {
            diagnosis: ['The runtime hit a repeated blocked state.'],
            nextSteps: ['Inspect the latest failing assertion.'],
            risks: ['Auto escalation can hide weak previews if the trace path diverges.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-auto-e2e-1',
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

test('auto ask preview can be confirmed through the normal master ask continuation path', async (t) => {
  const harness = await createHarness();
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const preview = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-e2e-preview'));

  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.preview.request.trigger.mode, 'auto');
  assert.equal(preview.data.preview.confirmation.requiresConfirmation, true);

  const confirmStdout = [];
  const confirmExitCode = await runCli(['master', 'ask', '--trace-id', preview.data.traceId, '--confirm'], {
    stdout: { write: (chunk) => { confirmStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: harness.handlers.master.ask,
      },
    },
  });

  assert.equal(confirmExitCode, 0);
  const confirm = parseOutput(confirmStdout);
  assert.equal(confirm.ok, true);
  assert.equal(confirm.state, 'success');
  assert.equal(confirm.data.session.publicStatus, 'completed');
  assert.equal(confirm.data.response.status, 'completed');
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
  assert.equal(parsedRequest.value.traceId, preview.data.traceId);
  assert.equal(parsedRequest.value.requestId, preview.data.requestId);
  assert.equal(parsedRequest.value.trigger.mode, 'auto');
});

test('trusted non-sensitive auto flow can direct send and still return the preview snapshot in-band', async (t) => {
  const harness = await createHarness({
    askMasterConfig: {
      confirmationMode: 'sensitive_only',
      trustedMasters: ['master-pin-1'],
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-e2e-direct', {
    draft: {
      userTask: 'Diagnose the latest blocked auto escalation path.',
      question: 'What is the next best fix right now?',
      workspaceSummary: 'The task is a repeated flow regression with minimal debugging context.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'failing_assertion',
          content: 'AssertionError: expected auto path to continue after preview materialization.',
        },
      ],
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.autoPolicy.selectedFrictionMode, 'direct_send');
  assert.equal(result.data.preview.confirmation.requiresConfirmation, false);
  assert.equal(result.data.preview.request.trigger.mode, 'auto');
  assert.equal(harness.writes.length, 1);
});

test('auto flow can still force preview when confirmationMode is never but trusted auto send is not explicitly enabled', async (t) => {
  const harness = await createHarness({
    askMasterConfig: {
      confirmationMode: 'never',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        allowTrustedAutoSend: false,
      },
    },
  });
  t.after(async () => {
    await rm(harness.homeDir, { recursive: true, force: true });
  });

  const preview = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-e2e-never-preview', {
    draft: {
      userTask: 'Diagnose the current token recovery loop safely.',
      question: 'What should I try next for the token fallback path?',
      artifacts: [
        {
          kind: 'text',
          label: 'token_context',
          content: 'The current payload still discusses token handling.',
        },
      ],
    },
  }));

  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.autoPolicy.selectedFrictionMode, 'preview_confirm');
  assert.equal(preview.data.autoPolicy.requiresConfirmation, true);
  assert.equal(preview.data.preview.confirmation.policyMode, 'never');
  assert.equal(preview.data.preview.confirmation.requiresConfirmation, true);
  assert.equal(preview.data.preview.confirmation.frictionMode, 'preview_confirm');
  assert.equal(harness.writes.length, 0);
});
