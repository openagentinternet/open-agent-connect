import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  sendPrivateChat,
  receivePrivateChat,
} = require('../../dist/core/chat/privateChat.js');
const {
  buildMasterRequestJson,
  parseMasterRequest,
  buildMasterResponseJson,
  parseMasterResponse,
} = require('../../dist/core/master/masterMessageSchema.js');

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function createMasterRequest() {
  return {
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-master-rt-1',
    traceId: 'trace-master-rt-1',
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    target: {
      masterServicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      masterKind: 'debug',
    },
    task: {
      userTask: 'Debug a flaky test.',
      question: 'What signal should I capture first?',
    },
    context: {
      workspaceSummary: 'The full test suite is flaky while the isolated test passes.',
      relevantFiles: ['tests/flaky.test.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'suite-output',
          content: 'Observed intermittent timeout after 30s.',
        },
      ],
    },
    trigger: {
      mode: 'manual',
      reason: 'The user requested help.',
    },
    desiredOutput: 'structured_advice',
  };
}

function createMasterResponse() {
  return {
    type: 'master_response',
    version: '1.0.0',
    requestId: 'request-master-rt-1',
    traceId: 'trace-master-rt-1',
    responder: {
      providerGlobalMetaId: 'idq1provider',
      masterServicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    status: 'completed',
    summary: 'The suite likely shares clock-dependent state.',
    responseText: 'Freeze time or reset the fake timer state between tests.',
    structuredData: {
      nextSteps: ['Reset fake timers in afterEach.'],
    },
  };
}

test('master_request JSON survives sendPrivateChat -> receivePrivateChat roundtrip', () => {
  const caller = createIdentityPair();
  const provider = createIdentityPair();

  const outbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: caller.privateKeyHex,
    },
    toGlobalMetaId: 'idq1provider',
    peerChatPublicKey: provider.publicKeyHex,
    content: buildMasterRequestJson(createMasterRequest()),
    replyPinId: 'reply-pin-master-request',
    timestamp: 1_776_000_123,
  });

  const payload = JSON.parse(outbound.payload);
  const inbound = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1provider',
      privateKeyHex: provider.privateKeyHex,
    },
    peerChatPublicKey: caller.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1caller',
      rawData: JSON.stringify({ content: payload.content }),
      replyPinId: payload.replyPin,
    },
  });

  assert.equal(inbound.replyPinId, 'reply-pin-master-request');
  assert.equal(inbound.plaintextJson.type, 'master_request');

  const reparsed = parseMasterRequest(inbound.plaintextJson);
  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.requestId, 'request-master-rt-1');
  assert.equal(reparsed.value.task.question, 'What signal should I capture first?');
});

test('master_response JSON survives sendPrivateChat -> receivePrivateChat roundtrip', () => {
  const provider = createIdentityPair();
  const caller = createIdentityPair();

  const outbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: 'idq1provider',
      privateKeyHex: provider.privateKeyHex,
    },
    toGlobalMetaId: 'idq1caller',
    peerChatPublicKey: caller.publicKeyHex,
    content: buildMasterResponseJson(createMasterResponse()),
    replyPinId: 'reply-pin-master-response',
    timestamp: 1_776_000_456,
  });

  const payload = JSON.parse(outbound.payload);
  const inbound = receivePrivateChat({
    localIdentity: {
      globalMetaId: 'idq1caller',
      privateKeyHex: caller.privateKeyHex,
    },
    peerChatPublicKey: provider.publicKeyHex,
    payload: {
      fromGlobalMetaId: 'idq1provider',
      rawData: JSON.stringify({ content: payload.content }),
      replyPinId: payload.replyPin,
    },
  });

  assert.equal(inbound.replyPinId, 'reply-pin-master-response');
  assert.equal(inbound.plaintextJson.type, 'master_response');

  const reparsed = parseMasterResponse(inbound.plaintextJson);
  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.summary, 'The suite likely shares clock-dependent state.');
});
