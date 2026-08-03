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
  extractPrivateChatPeerGlobalMetaIds,
  fetchPrivateChatHistoryPage,
  fetchPrivateChatPeerGlobalMetaIds,
} = require('../../dist/core/chat/privateConversation.js');

function createIdentityPair(privateKeyHex) {
  const ecdh = createECDH('prime256v1');
  if (privateKeyHex) {
    ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
  } else {
    ecdh.generateKeys();
  }
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

test('private chat peer directory discovers modern peers and maps legacy addresses by chat public key', () => {
  const selfGlobalMetaId = 'idq1local0000000000000000000000000000';
  const remoteGlobalMetaId = 'idq1remote000000000000000000000000000';
  const mappedGlobalMetaId = 'idq1mapped000000000000000000000000000';
  const mappedChatPublicKey = '04mapped-chat-public-key';

  const peers = extractPrivateChatPeerGlobalMetaIds({
    data: {
      list: [
        {
          type: '2',
          globalMetaId: remoteGlobalMetaId,
          lastMessage: { toGlobalMetaId: selfGlobalMetaId },
        },
        {
          type: '2',
          globalMetaId: '1LegacyMvcAddress',
          userInfo: { chatPublicKey: mappedChatPublicKey },
          lastMessage: { toGlobalMetaId: selfGlobalMetaId },
        },
        {
          type: '1',
          globalMetaId: 'idq1group0000000000000000000000000000',
        },
      ],
    },
  }, selfGlobalMetaId, [{
    globalMetaId: mappedGlobalMetaId,
    chatPublicKey: mappedChatPublicKey,
  }]);

  assert.deepEqual(peers, [remoteGlobalMetaId, mappedGlobalMetaId]);
});

test('fetchPrivateChatPeerGlobalMetaIds uses the MetaSO conversation directory endpoint', async () => {
  const requestedUrls = [];
  const selfGlobalMetaId = 'idq1local0000000000000000000000000000';
  const peerGlobalMetaId = 'idq1peer00000000000000000000000000000';

  const peers = await fetchPrivateChatPeerGlobalMetaIds({
    selfGlobalMetaId,
    chatApiBaseUrl: 'https://metaso.test/chat-api/group-chat/',
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({
        code: 0,
        data: {
          list: [{ type: '2', globalMetaId: peerGlobalMetaId }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(peers, [peerGlobalMetaId]);
  assert.equal(requestedUrls.length, 1);
  const requestedUrl = new URL(requestedUrls[0]);
  assert.equal(requestedUrl.pathname, '/chat-api/group-chat/user/latest-chat-info-list');
  assert.equal(requestedUrl.searchParams.get('metaId'), selfGlobalMetaId);
  assert.equal(requestedUrl.searchParams.has('metaid'), false);
});

test('fetchPrivateChatPeerGlobalMetaIds rejects MetaSO business errors returned with HTTP 200', async () => {
  await assert.rejects(
    fetchPrivateChatPeerGlobalMetaIds({
      selfGlobalMetaId: 'idq1local0000000000000000000000000000',
      fetchImpl: async () => new Response(JSON.stringify({
        code: 1,
        message: 'metaId is required',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }),
    /peer_directory_fetch_api_1/,
  );
});

test('fetchPrivateChatHistoryPage aborts a hung history request after timeoutMs', async () => {
  let capturedSignal = null;
  const startedAt = Date.now();

  await assert.rejects(
    fetchPrivateChatHistoryPage({
      selfGlobalMetaId: 'idq1local0000000000000000000000000000',
      peerGlobalMetaId: 'idq1peer00000000000000000000000000000',
      limit: 20,
      timeoutMs: 20,
      chatApiBaseUrl: 'https://metaso.test/chat-api/group-chat/',
      fetchImpl: (_url, options) => {
        capturedSignal = options?.signal ?? null;
        // A request that never settles on its own; only the abort frees it.
        return new Promise((_resolve, reject) => {
          capturedSignal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      },
    }),
    (error) => error.name === 'AbortError',
  );

  assert.ok(Date.now() - startedAt < 2_000, 'history fetch should abort well under 2s');
  assert.ok(capturedSignal instanceof AbortSignal);
  assert.equal(capturedSignal.aborted, true);
});

test('fetchPrivateChatHistoryPage passes an AbortSignal to fetch and returns parsed history rows', async () => {
  let capturedSignal = null;

  const page = await fetchPrivateChatHistoryPage({
    selfGlobalMetaId: 'idq1local0000000000000000000000000000',
    peerGlobalMetaId: 'idq1peer00000000000000000000000000000',
    limit: 20,
    chatApiBaseUrl: 'https://metaso.test/chat-api/group-chat/',
    fetchImpl: async (_url, options) => {
      capturedSignal = options?.signal ?? null;
      return new Response(JSON.stringify({
        code: 0,
        data: {
          total: 1,
          list: [{ pinId: 'pin-1', index: 3 }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.ok(capturedSignal instanceof AbortSignal);
  assert.equal(capturedSignal.aborted, false);
  assert.equal(page.total, 1);
  assert.deepEqual(page.rows, [{ pinId: 'pin-1', index: 3 }]);
});

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
  const alice = createIdentityPair('1'.padStart(64, '0'));
  const bob = createIdentityPair('2'.padStart(64, '0'));
  const wrongPeer = createIdentityPair('3'.padStart(64, '0'));

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

test('buildPrivateConversationResponse repairs Metaso address-shaped sender fields within the requested conversation', async () => {
  const local = createIdentityPair();
  const peer = createIdentityPair();
  const selfGlobalMetaId = 'idq1local0000000000000000000000000000';
  const peerGlobalMetaId = 'idq1peer00000000000000000000000000000';
  const txId = '2e9ff38e092ff5bf1b565bfa9091bc4197b682e34be8c2dc01c514dfe37ed525';
  const pinId = `${txId}i0`;
  const outbound = sendPrivateChat({
    fromIdentity: {
      globalMetaId: peerGlobalMetaId,
      privateKeyHex: peer.privateKeyHex,
    },
    toGlobalMetaId: selfGlobalMetaId,
    peerChatPublicKey: local.publicKeyHex,
    content: 'just say hi',
    timestamp: 1_784_797_191,
  });

  const response = await buildPrivateConversationResponse({
    selfGlobalMetaId,
    peerGlobalMetaId,
    localPrivateKeyHex: local.privateKeyHex,
    peerChatPublicKey: peer.publicKeyHex,
    fetchHistory: async () => [{
      pinId,
      txId: pinId,
      path: '/protocols/simplemsg',
      content: outbound.payload,
      from: '1BNesCuvJeW2DAF42xkyCU1ifZVuNZ61mv',
      fromAddress: '1BNesCuvJeW2DAF42xkyCU1ifZVuNZ61mv',
      fromGlobalMetaId: '1BNesCuvJeW2DAF42xkyCU1ifZVuNZ61mv',
      globalMetaId: null,
      toGlobalMetaId: selfGlobalMetaId,
      timestamp: 1_784_797_191,
      index: 9,
    }],
  });

  assert.equal(response.messages.length, 1);
  assert.equal(response.messages[0].content, 'just say hi');
  assert.equal(response.messages[0].fromGlobalMetaId, peerGlobalMetaId);
  assert.equal(response.messages[0].toGlobalMetaId, selfGlobalMetaId);
  assert.equal(response.messages[0].pinId, pinId);
  assert.equal(response.messages[0].txId, txId);
});
