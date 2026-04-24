import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  return { systemHome, homeDir };
}

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

function parseOutput(chunks) {
  return JSON.parse(chunks.join('').trim());
}

test('manual host-action can preview Ask Master from host-visible context and confirm into the normal caller flow', async (t) => {
  const { systemHome, homeDir } = await createProfileHome('metabot-master-host-flow-');
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
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
      triggerMode: 'manual',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  });
  await masterStateStore.write({
    masters: [
      {
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
        hostModes: ['claude'],
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
      },
    ],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-2',
    lastHeartbeatTxid: 'heartbeat-tx-2',
  });

  const writes = [];
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
          txids: ['simplemsg-tx-1'],
          pinId: 'simplemsg-pin-1',
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
          summary: 'The preview path is stuck because confirmation never transitions into request_sent.',
          structuredData: {
            diagnosis: ['Caller stayed in awaiting_confirmation.'],
            nextSteps: ['Inspect the host-action preview/confirm bridge.'],
            risks: ['Future host adapters could skip the persisted preview snapshot.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-1',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  const requestFile = path.join(homeDir, 'master-host-action.json');
  await writeFile(requestFile, JSON.stringify({
    action: {
      kind: 'manual_ask',
      utterance: 'Go ask Debug Master about this blocked preview flow and show me the preview first.',
    },
    context: {
      now: 1_776_000_000_000,
      hostMode: 'claude',
      traceId: 'trace-host-action-e2e-1',
      conversation: {
        currentUserRequest: 'Go ask Debug Master about this blocked preview flow and show me the preview first.',
        recentMessages: [
          { role: 'user', content: 'The Ask Master preview never leaves confirmation after I accept it.' },
        ],
      },
      tools: {
        recentToolResults: [
          {
            toolName: 'npm test',
            exitCode: 1,
            stdout: 'not ok 1 - manual host-action should preview',
            stderr: 'AssertionError: expected awaiting_confirmation',
          },
        ],
      },
      workspace: {
        goal: 'Get a structured diagnosis and next steps.',
        constraints: ['Do not upload the whole repository.'],
        relevantFiles: ['src/daemon/defaultHandlers.ts', 'tests/e2e/masterAskHostFlow.test.mjs'],
        diffSummary: 'Task 3 host-action wiring is in progress.',
        fileExcerpts: [],
      },
      planner: {
        hasPlan: true,
        todoBlocked: true,
        onlyReadingWithoutConverging: false,
      },
    },
  }, null, 2), 'utf8');

  const previewStdout = [];
  const previewExitCode = await runCli(['master', 'host-action', '--request-file', requestFile], {
    stdout: { write: (chunk) => { previewStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        hostAction: handlers.master.hostAction,
        ask: handlers.master.ask,
      },
    },
  });

  assert.equal(previewExitCode, 0);
  const preview = parseOutput(previewStdout);
  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.hostAction, 'manual_ask');
  assert.equal(preview.data.preview.target.displayName, 'Official Debug Master');
  assert.match(preview.data.preview.request.task.question, /preview never leaves confirmation/i);
  assert.equal(preview.data.preview.request.caller.host, 'claude');

  const confirmStdout = [];
  const confirmExitCode = await runCli(['master', 'ask', '--trace-id', preview.data.traceId, '--confirm'], {
    stdout: { write: (chunk) => { confirmStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
      },
    },
  });

  assert.equal(confirmExitCode, 0);
  const confirm = parseOutput(confirmStdout);
  assert.equal(confirm.ok, true);
  assert.equal(confirm.state, 'success');
  assert.equal(confirm.data.session.publicStatus, 'completed');
  assert.equal(confirm.data.response.status, 'completed');
  assert.deepEqual(confirm.data.response.findings, [
    'Caller stayed in awaiting_confirmation.',
  ]);
  assert.deepEqual(confirm.data.response.recommendations, [
    'Inspect the host-action preview/confirm bridge.',
  ]);
  assert.deepEqual(confirm.data.response.risks, [
    'Future host adapters could skip the persisted preview snapshot.',
  ]);
  assert.equal(writes.length, 1);

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
  assert.equal(parsedRequest.value.traceId, preview.data.traceId);
  assert.equal(parsedRequest.value.requestId, preview.data.requestId);
  assert.equal(parsedRequest.value.caller.host, 'claude');
  assert.equal(
    parsedRequest.value.task.question,
    preview.data.preview.request.task.question
  );
});

test('accepted suggestion can preview, confirm, complete, and keep suggest metadata in master trace', async (t) => {
  const { systemHome, homeDir } = await createProfileHome('metabot-master-host-suggest-flow-');
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
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
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  });
  await masterStateStore.write({
    masters: [
      {
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
        hostModes: ['claude'],
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
      },
    ],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-3',
    lastHeartbeatTxid: 'heartbeat-tx-3',
  });

  const writes = [];
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
          txids: ['simplemsg-tx-2'],
          pinId: 'simplemsg-pin-2',
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
          summary: 'The accepted suggestion completed after the preview snapshot was sent normally.',
          structuredData: {
            diagnosis: ['The suggest path preserved the original preview request.'],
            nextSteps: ['Keep the accepted suggestion on the same preview/confirm/send path as manual ask.'],
            risks: ['Dropping suggest provenance would make trace review harder.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-2',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  const suggestResult = await handlers.master.suggest({
    draft: {
      userTask: 'Diagnose why the accepted suggestion never leaves preview.',
      question: 'Should I ask the Debug Master for help with the blocked suggest flow?',
      workspaceSummary: 'Ask Master suggestion e2e integration test.',
      errorSummary: 'Repeated preview/confirm loop in the same host task.',
      relevantFiles: ['tests/e2e/masterAskHostFlow.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: {
      now: 1_776_000_000_000,
      traceId: 'trace-host-action-e2e-suggest-1',
      hostMode: 'claude',
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
        repeatedErrorSignatures: ['ERR_HOST_SUGGEST_LOOP'],
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
        trustedMasters: 0,
        onlineMasters: 1,
      },
      candidateMasterKindHint: 'debug',
    },
  });

  assert.equal(suggestResult.ok, true);
  assert.equal(suggestResult.data.decision.action, 'suggest');

  const acceptResult = await handlers.master.hostAction({
    action: {
      kind: 'accept_suggest',
      traceId: suggestResult.data.suggestion.traceId,
      suggestionId: suggestResult.data.suggestion.suggestionId,
    },
  });

  assert.equal(acceptResult.ok, true);
  assert.equal(acceptResult.state, 'awaiting_confirmation');
  assert.equal(acceptResult.data.hostAction, 'accept_suggest');
  assert.equal(acceptResult.data.preview.request.trigger.mode, 'suggest');
  assert.equal(acceptResult.data.preview.request.caller.host, 'claude');

  const confirmStdout = [];
  const confirmExitCode = await runCli(['master', 'ask', '--trace-id', acceptResult.data.traceId, '--confirm'], {
    stdout: { write: (chunk) => { confirmStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(confirmExitCode, 0);
  const confirm = parseOutput(confirmStdout);
  assert.equal(confirm.ok, true);
  assert.equal(confirm.state, 'success');
  assert.equal(confirm.data.session.publicStatus, 'completed');
  assert.equal(confirm.data.response.status, 'completed');
  assert.equal(writes.length, 1);

  const traceStdout = [];
  const traceExitCode = await runCli(['master', 'trace', '--id', acceptResult.data.traceId], {
    stdout: { write: (chunk) => { traceStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(traceExitCode, 0);
  const trace = parseOutput(traceStdout);
  assert.equal(trace.ok, true);
  assert.equal(trace.data.flow, 'master');
  assert.equal(trace.data.canonicalStatus, 'completed');
  assert.equal(trace.data.triggerMode, 'suggest');
  assert.equal(trace.data.preview.question, 'Should I ask the Debug Master for help with the blocked suggest flow?');
  assert.match(trace.data.response.summary, /accepted suggestion completed/i);
});

test('suggest host flow can run through CLI entrypoints before accept, preview, confirm, and trace', async (t) => {
  const { systemHome, homeDir } = await createProfileHome('metabot-master-host-suggest-cli-flow-');
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
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
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    },
  });
  await masterStateStore.write({
    masters: [
      {
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
      },
    ],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-4',
    lastHeartbeatTxid: 'heartbeat-tx-4',
  });

  const writes = [];
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
          txids: ['simplemsg-tx-3'],
          pinId: 'simplemsg-pin-3',
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
          summary: 'The CLI-backed suggest flow completed after the accepted suggestion entered preview and confirm normally.',
          structuredData: {
            diagnosis: ['The suggest entrypoint remained on the Ask Master runtime.'],
            nextSteps: ['Keep the CLI suggest bridge aligned with host-action accept flow.'],
            risks: ['A stale host bridge could bypass the structured preview path.'],
          },
        });
        return {
          state: 'completed',
          response: JSON.parse(responseJson),
          responseJson,
          deliveryPinId: 'simplemsg-reply-pin-3',
          observedAt: Date.now(),
          rawMessage: null,
        };
      },
    },
  });

  const suggestRequestFile = path.join(homeDir, 'master-suggest.json');
  await writeFile(suggestRequestFile, JSON.stringify({
    draft: {
      userTask: 'Diagnose why the CLI suggest entrypoint might drift from the host action flow.',
      question: 'Should I ask the Debug Master for help with the blocked suggest bridge?',
      workspaceSummary: 'Ask Master suggest CLI e2e integration test.',
      errorSummary: 'Repeated blocked preview/confirm flow in the same host task.',
      relevantFiles: ['tests/e2e/masterAskHostFlow.test.mjs'],
      constraints: ['Keep the answer structured and concise.'],
      artifacts: [],
    },
    observation: {
      now: 1_776_000_000_000,
      traceId: 'trace-host-action-e2e-suggest-cli-1',
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
        repeatedErrorSignatures: ['ERR_HOST_SUGGEST_CLI_LOOP'],
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
        trustedMasters: 0,
        onlineMasters: 1,
      },
      candidateMasterKindHint: 'debug',
    },
  }, null, 2), 'utf8');

  const suggestStdout = [];
  const suggestExitCode = await runCli(['master', 'suggest', '--request-file', suggestRequestFile], {
    stdout: { write: (chunk) => { suggestStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        suggest: handlers.master.suggest,
      },
    },
  });

  assert.equal(suggestExitCode, 0);
  const suggestResult = parseOutput(suggestStdout);
  assert.equal(suggestResult.ok, true);
  assert.equal(suggestResult.data.decision.action, 'suggest');

  const acceptRequestFile = path.join(homeDir, 'master-accept-suggest.json');
  await writeFile(acceptRequestFile, JSON.stringify({
    action: {
      kind: 'accept_suggest',
      traceId: suggestResult.data.suggestion.traceId,
      suggestionId: suggestResult.data.suggestion.suggestionId,
    },
  }, null, 2), 'utf8');

  const acceptStdout = [];
  const acceptExitCode = await runCli(['master', 'host-action', '--request-file', acceptRequestFile], {
    stdout: { write: (chunk) => { acceptStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        hostAction: handlers.master.hostAction,
      },
    },
  });

  assert.equal(acceptExitCode, 0);
  const acceptResult = parseOutput(acceptStdout);
  assert.equal(acceptResult.ok, true);
  assert.equal(acceptResult.state, 'awaiting_confirmation');
  assert.equal(acceptResult.data.hostAction, 'accept_suggest');
  assert.equal(acceptResult.data.preview.request.trigger.mode, 'suggest');

  const confirmStdout = [];
  const confirmExitCode = await runCli(['master', 'ask', '--trace-id', acceptResult.data.traceId, '--confirm'], {
    stdout: { write: (chunk) => { confirmStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(confirmExitCode, 0);
  const confirm = parseOutput(confirmStdout);
  assert.equal(confirm.ok, true);
  assert.equal(confirm.state, 'success');
  assert.equal(confirm.data.session.publicStatus, 'completed');
  assert.equal(confirm.data.response.status, 'completed');
  assert.equal(writes.length, 1);

  const traceStdout = [];
  const traceExitCode = await runCli(['master', 'trace', '--id', acceptResult.data.traceId], {
    stdout: { write: (chunk) => { traceStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(traceExitCode, 0);
  const trace = parseOutput(traceStdout);
  assert.equal(trace.ok, true);
  assert.equal(trace.data.triggerMode, 'suggest');
  assert.match(trace.data.response.summary, /CLI-backed suggest flow completed/i);
});
