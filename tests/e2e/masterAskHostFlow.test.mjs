import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { buildMasterResponseJson, parseMasterRequest } = require('../../dist/core/master/masterMessageSchema.js');

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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-host-flow-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const configStore = createConfigStore(homeDir);
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
