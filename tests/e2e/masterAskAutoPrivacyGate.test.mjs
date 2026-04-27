import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { createPendingMasterAskStateStore } = require('../../dist/core/master/masterPendingAskState.js');
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

function buildSuggestInput(traceId) {
  return {
    draft: {
      userTask: 'Diagnose the repeated blocked task without leaking local secrets.',
      question: 'What is the shortest safe fix path for this blocked flow?',
      workspaceSummary: 'Auto privacy gate test for Ask Master.',
      errorSummary: 'Repeated ERR_AUTO_PRIVACY failures.',
      relevantFiles: [
        '.env',
        'wallets/dev.key',
        'src/daemon/defaultHandlers.ts',
        'tests/e2e/masterAskAutoPrivacyGate.test.mjs',
      ],
      constraints: ['Do not upload the whole repository.'],
      artifacts: [
        {
          kind: 'text',
          label: 'secret_env',
          content: 'OPENAI_API_KEY=super-secret',
        },
        {
          kind: 'text',
          label: 'safe_failure',
          content: 'AssertionError: expected Ask Master payload to stay minimal.',
        },
        {
          kind: 'text',
          label: 'path_excerpt',
          content: "Error: ENOENT: open '/Users/alice/.env'",
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
        repeatedErrorSignatures: ['ERR_AUTO_PRIVACY'],
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

test('auto direct send still persists and sends a sanitized payload without secret-bearing files or artifacts', async (t) => {
  const homeDir = await createProfileHome('metabot-master-auto-privacy-');
  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const pendingMasterAskStateStore = createPendingMasterAskStateStore(homeDir);
  const writes = [];

  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });

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
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-auto-privacy',
    lastHeartbeatTxid: 'heartbeat-tx-auto-privacy',
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
          txids: ['simplemsg-tx-auto-privacy-1'],
          pinId: 'simplemsg-pin-auto-privacy-1',
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
          summary: 'Payload arrived without leaking implicit secrets.',
          structuredData: {
            diagnosis: ['The payload stayed minimal and structured.'],
            nextSteps: ['Proceed with the sanitized debugging context.'],
            risks: ['Overly broad privacy filters could remove useful context.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-auto-privacy-1',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  const result = await handlers.master.suggest(buildSuggestInput('trace-master-auto-privacy'));

  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.ok(result.data.traceId);
  assert.ok(result.data.requestId);
  assert.equal(writes.length, 1);

  const pendingAsk = await pendingMasterAskStateStore.get(result.data.traceId);
  assert.deepEqual(pendingAsk.request.context.relevantFiles, [
    'src/daemon/defaultHandlers.ts',
    'tests/e2e/masterAskAutoPrivacyGate.test.mjs',
  ]);
  assert.equal(
    pendingAsk.request.context.artifacts.some((artifact) => /OPENAI_API_KEY|\/Users\/alice\/\.env/i.test(artifact.content)),
    false
  );

  const outboundPayload = JSON.parse(writes[0].payload);
  const decrypted = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: identityPair.privateKeyHex,
    },
    peerChatPublicKey: identityPair.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1caller',
      rawData: JSON.stringify({ content: outboundPayload.content }),
      replyPinId: outboundPayload.replyPin,
    },
  });
  const parsedRequest = parseMasterRequest(decrypted.plaintextJson);
  assert.equal(parsedRequest.ok, true);
  assert.deepEqual(parsedRequest.value.context.relevantFiles, [
    'src/daemon/defaultHandlers.ts',
    'tests/e2e/masterAskAutoPrivacyGate.test.mjs',
  ]);
  assert.equal(
    parsedRequest.value.context.artifacts.some((artifact) => /OPENAI_API_KEY|\/Users\/alice\/\.env/i.test(artifact.content)),
    false
  );
  const plaintextJson = JSON.stringify(decrypted.plaintextJson);
  assert.match(plaintextJson, /safe_failure/);
  assert.doesNotMatch(plaintextJson, /\.env|wallets\/dev\.key|OPENAI_API_KEY/);
});
