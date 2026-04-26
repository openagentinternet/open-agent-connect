import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  sendPrivateChat,
} = require('../../dist/core/chat/privateChat.js');
const {
  buildPrivateConversationResponse,
} = require('../../dist/core/chat/privateConversation.js');

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

test('buildPrivateConversationResponse fetches private history and returns decrypted normalized viewer messages', async () => {
  const alice = createIdentityPair();
  const bob = createIdentityPair();

  const aliceOutbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: 'gm-alice',
      privateKeyHex: alice.privateKeyHex,
    },
    toGlobalMetaId: 'gm-bob',
    peerChatPublicKey: bob.publicKeyHex,
    content: 'hello bob',
    timestamp: 1_776_836_100,
  });
  const bobOutbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: 'gm-bob',
      privateKeyHex: bob.privateKeyHex,
    },
    toGlobalMetaId: 'gm-alice',
    peerChatPublicKey: alice.publicKeyHex,
    content: 'hello alice',
    replyPinId: 'pin-a',
    timestamp: 1_776_836_120,
  });

  const rows = [
    {
      pinId: 'pin-a',
      txId: 'tx-a',
      path: '/protocols/simplemsg',
      content: aliceOutbound.payload,
      createGlobalMetaId: 'gm-alice',
      timestamp: 1_776_836_100,
      index: 11,
      fromUserInfo: {
        globalMetaId: 'gm-alice',
        name: 'Alice Bot',
        chatPublicKey: alice.publicKeyHex,
      },
    },
    {
      pin_id: 'pin-b',
      tx_id: 'tx-b',
      protocol: '/protocols/simplemsg',
      rawData: bobOutbound.payload,
      fromGlobalMetaId: 'gm-bob',
      timestamp: 1_776_836_120_000,
      index: 12,
      userInfo: {
        globalMetaId: 'gm-bob',
        name: 'Bob Bot',
        chatpubkey: bob.publicKeyHex,
      },
    },
  ];
  const fetchCalls = [];

  const response = await buildPrivateConversationResponse({
    selfGlobalMetaId: 'gm-alice',
    peerGlobalMetaId: 'gm-bob',
    localPrivateKeyHex: alice.privateKeyHex,
    peerChatPublicKey: bob.publicKeyHex,
    afterIndex: 10,
    limit: 20,
    fetchHistory: async (input) => {
      fetchCalls.push(input);
      return rows;
    },
    now: () => 1_776_836_184_230,
  });

  assert.deepEqual(fetchCalls, [
    {
      selfGlobalMetaId: 'gm-alice',
      peerGlobalMetaId: 'gm-bob',
      afterIndex: 10,
      limit: 20,
    },
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.selfGlobalMetaId, 'gm-alice');
  assert.equal(response.peerGlobalMetaId, 'gm-bob');
  assert.equal(response.nextPollAfterIndex, 12);
  assert.equal(response.serverTime, 1_776_836_184_230);
  assert.deepEqual(response.messages.map((message) => message.content), [
    'hello bob',
    'hello alice',
  ]);
  assert.deepEqual(response.messages.map((message) => message.fromGlobalMetaId), [
    'gm-alice',
    'gm-bob',
  ]);
  assert.deepEqual(response.messages.map((message) => message.toGlobalMetaId), [
    'gm-bob',
    'gm-alice',
  ]);
  assert.equal(response.messages[1].replyPin, 'pin-a');

  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /sharedSecret/i);
  assert.doesNotMatch(serialized, /privateKey/i);
  assert.doesNotMatch(serialized, /chatPublicKey/i);
  assert.doesNotMatch(serialized, /chatpubkey/i);
  assert.doesNotMatch(serialized, new RegExp(alice.publicKeyHex, 'i'));
  assert.doesNotMatch(serialized, new RegExp(bob.publicKeyHex, 'i'));
  assert.doesNotMatch(serialized, /U2FsdGVkX1/);
});

test('buildPrivateConversationResponse keeps decrypt failures visible without returning ciphertext', async () => {
  const alice = createIdentityPair();
  const bob = createIdentityPair();
  const wrongPeer = createIdentityPair();

  const bobOutbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: 'gm-bob',
      privateKeyHex: bob.privateKeyHex,
    },
    toGlobalMetaId: 'gm-alice',
    peerChatPublicKey: alice.publicKeyHex,
    content: 'secret reply',
  });

  const response = await buildPrivateConversationResponse({
    selfGlobalMetaId: 'gm-alice',
    peerGlobalMetaId: 'gm-bob',
    localPrivateKeyHex: alice.privateKeyHex,
    peerChatPublicKey: wrongPeer.publicKeyHex,
    fetchHistory: async () => [
      {
        pinId: 'pin-b',
        content: bobOutbound.payload,
        createGlobalMetaId: 'gm-bob',
        index: 1,
      },
    ],
  });

  assert.equal(response.messages.length, 1);
  assert.equal(response.messages[0].content, '[Unable to decrypt message]');
  assert.doesNotMatch(JSON.stringify(response), /secret reply/);
  assert.doesNotMatch(JSON.stringify(response), /U2FsdGVkX1/);
});
