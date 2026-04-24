import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

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

test('default chat.private stringifies master_request objects and exposes structured metadata', async (t) => {
  const homeDir = await createProfileHome('metabot-master-chat-handler-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });

  const identityPair = createIdentityPair();
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: createIdentity(identityPair.publicKeyHex),
    services: [],
    traces: [],
  });

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
      async writePin() {
        return {
          pinId: '/protocols/simplemsg-pin-1',
          txids: ['tx-simplemsg-1'],
          network: 'mvc',
          totalCost: 1,
        };
      },
    },
  });

  const result = await handlers.chat.private({
    to: 'idq1alice',
    content: {
      type: 'master_request',
      version: '1.0.0',
      requestId: 'request-chat-1',
      traceId: 'trace-chat-1',
      caller: {
        globalMetaId: 'idq1alice',
        host: 'codex',
      },
      target: {
        masterServicePinId: 'master-pin-1',
        providerGlobalMetaId: 'idq1alice',
        masterKind: 'debug',
      },
      task: {
        userTask: 'Investigate a loopback Ask Master request.',
        question: 'Does the structured metadata survive the existing private chat path?',
      },
      context: {
        workspaceSummary: 'Local loopback integration test.',
        relevantFiles: ['tests/master/masterStructuredChatHandler.test.mjs'],
        artifacts: [],
      },
      trigger: {
        mode: 'manual',
      },
    },
    replyPin: 'reply-pin-structured-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.messageType, 'master_request');
  assert.equal(result.data.requestId, 'request-chat-1');
  assert.equal(result.data.correlatedTraceId, 'trace-chat-1');
  assert.equal(result.data.path, '/protocols/simplemsg');
  assert.match(result.data.payload, /"encrypt":"ecdh"/);
});
