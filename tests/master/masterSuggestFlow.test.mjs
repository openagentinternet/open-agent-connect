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

function createDebugMasterRecord() {
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
  };
}

test('master suggest hands off into the existing preview flow when repeated failures justify asking the Debug Master', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-suggest-flow-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: createIdentity(),
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
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const result = await handlers.master.suggest({
    draft: {
      userTask: 'Diagnose a repeated failing test before the local agent loops again.',
      question: 'Should I ask the Debug Master for a tighter diagnosis and next steps?',
      workspaceSummary: 'Caller-side suggest integration test for Ask Master.',
      errorSummary: 'Repeated ERR_DEBUG_MASTER_LOOP failures across the same task.',
      relevantFiles: ['tests/master/masterSuggestFlow.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: {
      now: 1_776_000_000_000,
      traceId: 'trace-master-suggest-1',
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
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.decision.action, 'suggest');
  assert.equal(result.data.preview.target.displayName, 'Official Debug Master');
  assert.equal(result.data.preview.request.trigger.mode, 'suggest');
  assert.equal(result.data.preview.request.target.masterKind, 'debug');
  assert.match(result.data.confirmation.confirmCommand, /^metabot master ask --trace-id trace-master-/);
});
