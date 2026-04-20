import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createPublishedMasterStateStore } = require('../../dist/core/master/masterPublishedState.js');
const { receivePrivateChat } = require('../../dist/core/chat/privateChat.js');
const { parseMasterRequest } = require('../../dist/core/master/masterMessageSchema.js');

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
    name: 'Alice',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'pubkey',
    chatPublicKey,
    mvcAddress: 'mvc-address',
    btcAddress: 'btc-address',
    dogeAddress: 'doge-address',
    metaId: 'metaid-alice',
    globalMetaId: 'idq1alice',
  };
}

function parseOutput(chunks) {
  return JSON.parse(chunks.join('').trim());
}

test('master ask returns awaiting_confirmation and confirm reuses the stored pending request snapshot', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-ask-flow-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const masterStateStore = createPublishedMasterStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: createIdentity(identityPair.publicKeyHex),
    services: [],
    traces: [],
  });
  await masterStateStore.write({
    masters: [
      {
        id: 'master-pin-1',
        sourceMasterPinId: 'master-pin-1',
        currentPinId: 'master-pin-1',
        creatorMetabotId: 1,
        providerGlobalMetaId: 'idq1alice',
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

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    signer: {
      async getPrivateChatIdentity() {
        return {
          globalMetaId: 'idq1alice',
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
          globalMetaId: 'idq1alice',
          mvcAddress: 'mvc-address',
        };
      },
    },
  });

  const requestFile = path.join(homeDir, 'master-ask-draft.json');
  await writeFile(requestFile, JSON.stringify({
    target: {
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1alice',
      masterKind: 'debug',
      displayName: 'Official Debug Master',
    },
    triggerMode: 'manual',
    contextMode: 'standard',
    userTask: 'Investigate whether confirm reuses the stored snapshot.',
    question: 'Will the original preview question survive even if the file changes later?',
    goal: 'Verify preview/confirm stability.',
    workspaceSummary: 'Local caller-side integration test.',
    relevantFiles: ['tests/master/masterAskFlow.test.mjs'],
    artifacts: [],
    desiredOutput: {
      mode: 'structured_help',
    },
  }, null, 2), 'utf8');

  const previewStdout = [];
  const previewExitCode = await runCli(['master', 'ask', '--request-file', requestFile], {
    stdout: { write: (chunk) => { previewStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
      },
    },
  });

  assert.equal(previewExitCode, 0);
  const preview = parseOutput(previewStdout);
  assert.equal(preview.ok, true);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.match(preview.data.traceId, /^trace-master-/);
  assert.match(preview.data.requestId, /^master-req-/);
  assert.equal(
    preview.data.confirmation.confirmCommand,
    `metabot master ask --trace-id ${preview.data.traceId} --confirm`
  );

  await writeFile(requestFile, JSON.stringify({
    target: {
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1alice',
      masterKind: 'debug',
      displayName: 'Official Debug Master',
    },
    triggerMode: 'manual',
    contextMode: 'standard',
    userTask: 'MUTATED TASK',
    question: 'MUTATED QUESTION',
    workspaceSummary: 'mutated',
    relevantFiles: ['mutated.ts'],
    artifacts: [],
  }, null, 2), 'utf8');

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
  assert.equal(confirm.data.traceId, preview.data.traceId);
  assert.equal(confirm.data.requestId, preview.data.requestId);
  assert.equal(confirm.data.session.state, 'requesting_remote');
  assert.equal(writes.length, 1);

  const outboundPayload = JSON.parse(writes[0].payload);
  const decrypted = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1alice',
      privateKeyHex: identityPair.privateKeyHex,
    },
    peerChatPublicKey: identityPair.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1alice',
      rawData: JSON.stringify({ content: outboundPayload.content }),
      replyPinId: outboundPayload.replyPin,
    },
  });
  const parsedRequest = parseMasterRequest(decrypted.plaintextJson);
  assert.equal(parsedRequest.ok, true);
  assert.equal(parsedRequest.value.requestId, preview.data.requestId);
  assert.equal(
    parsedRequest.value.task.question,
    'Will the original preview question survive even if the file changes later?'
  );

  const duplicateConfirmStdout = [];
  const duplicateConfirmExitCode = await runCli(['master', 'ask', '--trace-id', preview.data.traceId, '--confirm'], {
    stdout: { write: (chunk) => { duplicateConfirmStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
      },
    },
  });

  assert.equal(duplicateConfirmExitCode, 1);
  const duplicateConfirm = parseOutput(duplicateConfirmStdout);
  assert.equal(duplicateConfirm.ok, false);
  assert.equal(duplicateConfirm.code, 'master_request_already_sent');
  assert.equal(writes.length, 1);
});

test('master ask sends immediately when confirmationMode is never', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-ask-no-confirm-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const identityPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const configStore = createConfigStore(homeDir);
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
      confirmationMode: 'never',
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
        providerGlobalMetaId: 'idq1alice',
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

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
    signer: {
      async getPrivateChatIdentity() {
        return {
          globalMetaId: 'idq1alice',
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
          globalMetaId: 'idq1alice',
          mvcAddress: 'mvc-address',
        };
      },
    },
  });

  const requestFile = path.join(homeDir, 'master-ask-no-confirm.json');
  await writeFile(requestFile, JSON.stringify({
    target: {
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1alice',
      masterKind: 'debug',
      displayName: 'Official Debug Master',
    },
    triggerMode: 'manual',
    contextMode: 'standard',
    userTask: 'Send without confirmation.',
    question: 'Should this request be sent immediately when confirmationMode is never?',
    workspaceSummary: 'Caller-side integration test.',
    relevantFiles: ['tests/master/masterAskFlow.test.mjs'],
    artifacts: [],
    desiredOutput: {
      mode: 'structured_help',
    },
  }, null, 2), 'utf8');

  const stdout = [];
  const exitCode = await runCli(['master', 'ask', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: handlers.master.ask,
      },
    },
  });

  assert.equal(exitCode, 0);
  const result = parseOutput(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.session.state, 'requesting_remote');
  assert.equal(result.data.session.publicStatus, 'requesting_remote');
  assert.equal(writes.length, 1);
});
