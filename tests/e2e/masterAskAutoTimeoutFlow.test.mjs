import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
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

function buildSuggestInput(traceId) {
  return {
    draft: {
      userTask: 'Diagnose the blocked auto escalation path without widening timeout semantics.',
      question: 'What is the shortest safe fix path for this blocked flow?',
      workspaceSummary: 'Auto timeout regression e2e for Ask Master.',
      errorSummary: 'Repeated ERR_AUTO_TIMEOUT failures.',
      relevantFiles: ['src/daemon/defaultHandlers.ts'],
      constraints: ['Do not upload the whole repository.'],
      artifacts: [
        {
          kind: 'text',
          label: 'failing_assertion',
          content: 'AssertionError: expected auto ask timeout state to remain visible before late reply upgrade.',
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
        repeatedErrorSignatures: ['ERR_AUTO_TIMEOUT'],
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
}

async function createHarness() {
  const homeDir = await createProfileHome('metabot-master-auto-timeout-');
  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const replies = [];

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
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        minConfidence: 0.75,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 2,
        globalCooldownMs: 0,
        allowTrustedAutoSend: false,
      },
    },
  });
  await masterStateStore.write({
    masters: [createDebugMasterRecord()],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-auto-timeout',
    lastHeartbeatTxid: 'heartbeat-tx-auto-timeout',
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
      async writePin() {
        return {
          txids: ['simplemsg-tx-auto-timeout-1'],
          pinId: 'simplemsg-pin-auto-timeout-1',
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
        const step = replies.shift();
        if (!step || step.state === 'timeout') {
          return { state: 'timeout' };
        }

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
          summary: 'Late reply arrived after the foreground auto timeout.',
          structuredData: {
            diagnosis: ['Foreground wait ended before the master reply was observed.'],
            nextSteps: ['Inspect the upgraded trace and late-arrival transcript.'],
            risks: ['Timeout semantics must not be silently rewritten before the late reply lands.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-auto-timeout-1',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  return {
    homeDir,
    handlers,
    replies,
  };
}

test('auto flow keeps timeout semantics on the foreground result and later upgrades the trace when a reply arrives', async (t) => {
  const harness = await createHarness();
  t.after(async () => {
    await cleanupProfileHome(harness.homeDir);
  });

  harness.replies.push({ state: 'timeout' }, { state: 'completed' });

  const result = await harness.handlers.master.suggest(buildSuggestInput('trace-master-auto-timeout'));

  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.ok(result.data.traceId);
  assert.ok(result.data.requestId);
});
