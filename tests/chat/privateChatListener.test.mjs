import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { sendPrivateChat } = require('../../dist/core/chat/privateChat.js');
const {
  decryptPrivateChatSocketMessage,
  normalizePrivateChatSocketMessage,
  pinIdFromPrivateChatSocketMessage,
  senderGlobalMetaIdFromPrivateChatSocketMessage,
} = require('../../dist/core/chat/privateChatListener.js');

const LOCAL_GLOBAL_META_ID = 'idq1local0000000000000000000000000000';
const PEER_GLOBAL_META_ID = 'idq1peer00000000000000000000000000000';

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

function buildEncryptedSocketPayload(input) {
  const sent = sendPrivateChat({
    fromIdentity: {
      globalMetaId: input.fromGlobalMetaId,
      privateKeyHex: input.fromKeys.privateKeyHex,
    },
    toGlobalMetaId: input.toGlobalMetaId,
    peerChatPublicKey: input.toChatPublicKey,
    content: input.content,
  });
  const wire = JSON.parse(sent.payload);
  return {
    txId: input.pinId.replace(/i0$/, ''),
    pinId: input.pinId,
    content: wire.content,
    timestamp: input.timestamp ?? 1_777_000_000_000,
    fromGlobalMetaId: input.fromGlobalMetaId,
    toGlobalMetaId: input.toGlobalMetaId,
    replyPin: null,
    fromUserInfo: {
      globalMetaId: input.fromGlobalMetaId,
      name: 'Peer Bot',
      chatPublicKey: input.fromKeys.publicKeyHex,
    },
  };
}

test('normalizePrivateChatSocketMessage accepts the MetaSO envelope shapes', () => {
  const baseMessage = {
    txId: 'tx-1',
    pinId: 'pin-1',
    content: 'encrypted-content',
    fromGlobalMetaId: PEER_GLOBAL_META_ID,
    toGlobalMetaId: LOCAL_GLOBAL_META_ID,
  };

  assert.deepEqual(
    normalizePrivateChatSocketMessage(['WS_SERVER_NOTIFY_PRIVATE_CHAT', baseMessage]),
    baseMessage,
  );
  assert.deepEqual(
    normalizePrivateChatSocketMessage({ M: 'WS_SERVER_NOTIFY_PRIVATE_CHAT', D: baseMessage }),
    baseMessage,
  );
  assert.deepEqual(
    normalizePrivateChatSocketMessage(['WS_RESPONSE_SUCCESS', { data: baseMessage }]),
    baseMessage,
  );
  assert.deepEqual(
    normalizePrivateChatSocketMessage(JSON.stringify(['WS_SERVER_NOTIFY_PRIVATE_CHAT', baseMessage])),
    baseMessage,
  );
  assert.equal(normalizePrivateChatSocketMessage(['WS_UNKNOWN', baseMessage]), null);
  assert.equal(normalizePrivateChatSocketMessage('not json'), null);
  assert.equal(normalizePrivateChatSocketMessage(null), null);
});

test('pinIdFromPrivateChatSocketMessage prefers pinId and derives it from txId', () => {
  assert.equal(pinIdFromPrivateChatSocketMessage({ pinId: 'pin-1', txId: 'tx-1' }), 'pin-1');
  assert.equal(pinIdFromPrivateChatSocketMessage({ txId: 'tx-1' }), 'tx-1i0');
  assert.equal(pinIdFromPrivateChatSocketMessage({}), null);
});

test('senderGlobalMetaIdFromPrivateChatSocketMessage prefers the user info id over the top-level field', () => {
  assert.equal(
    senderGlobalMetaIdFromPrivateChatSocketMessage({
      fromGlobalMetaId: '1BNesCuvJeW2DAF42xkyCU1ifZVuNZ61mv',
      fromUserInfo: { globalMetaId: PEER_GLOBAL_META_ID },
    }),
    PEER_GLOBAL_META_ID,
  );
  assert.equal(
    senderGlobalMetaIdFromPrivateChatSocketMessage({ fromGlobalMetaId: PEER_GLOBAL_META_ID }),
    PEER_GLOBAL_META_ID,
  );
  assert.equal(senderGlobalMetaIdFromPrivateChatSocketMessage({}), '');
});

test('decryptPrivateChatSocketMessage authenticates via the trusted peer key only', () => {
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const payload = buildEncryptedSocketPayload({
    fromGlobalMetaId: PEER_GLOBAL_META_ID,
    fromKeys: peerKeys,
    toGlobalMetaId: LOCAL_GLOBAL_META_ID,
    toChatPublicKey: localKeys.publicKeyHex,
    content: 'shared helper round trip',
    pinId: 'helper-pin-1',
  });
  const identity = {
    globalMetaId: LOCAL_GLOBAL_META_ID,
    privateKeyHex: localKeys.privateKeyHex,
    chatPublicKey: localKeys.publicKeyHex,
  };

  // The message-carried chat public key is attacker-controlled and never
  // trusted: without a trusted (chain-resolved) key, decryption is refused
  // even though the payload carries a working inline key.
  assert.equal(decryptPrivateChatSocketMessage(payload, identity, null), null);

  // The trusted key decrypts regardless of which key the payload claims.
  assert.equal(
    decryptPrivateChatSocketMessage(payload, identity, peerKeys.publicKeyHex),
    'shared helper round trip',
  );
  const keylessPayload = { ...payload, fromUserInfo: { globalMetaId: PEER_GLOBAL_META_ID } };
  assert.equal(
    decryptPrivateChatSocketMessage(keylessPayload, identity, peerKeys.publicKeyHex),
    'shared helper round trip',
  );

  // A forged payload (encrypted with the attacker's key but claiming the
  // peer's identity) must not decrypt against the peer's registered key.
  const attackerKeys = createIdentityPair();
  const forged = buildEncryptedSocketPayload({
    fromGlobalMetaId: PEER_GLOBAL_META_ID,
    fromKeys: attackerKeys,
    toGlobalMetaId: LOCAL_GLOBAL_META_ID,
    toChatPublicKey: localKeys.publicKeyHex,
    content: 'forged sender identity',
    pinId: 'helper-pin-forged',
  });
  assert.equal(decryptPrivateChatSocketMessage(forged, identity, peerKeys.publicKeyHex), null);

  // Unencrypted content performs no ECDH and carries no proof of identity.
  const plaintextPayload = { ...payload, content: 'plaintext forgery' };
  assert.equal(decryptPrivateChatSocketMessage(plaintextPayload, identity, peerKeys.publicKeyHex), null);
});
