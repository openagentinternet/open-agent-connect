import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { sendPrivateChat } = require('../../dist/core/chat/privateChat.js');

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

function installSocketIoMock() {
  const socketModulePath = require.resolve('socket.io-client');
  const listenerModulePath = require.resolve('../../dist/core/chat/privateChatListener.js');
  const previousSocketModule = require.cache[socketModulePath];
  const sockets = [];

  require.cache[socketModulePath] = {
    id: socketModulePath,
    filename: socketModulePath,
    loaded: true,
    exports: {
      io() {
        const listeners = new Map();
        const socket = {
          on(eventName, listener) {
            listeners.set(eventName, listener);
            return socket;
          },
          removeAllListeners() {
            listeners.clear();
          },
          disconnect() {},
          emitServer(eventName, data) {
            const listener = listeners.get(eventName);
            if (listener) {
              listener(data);
            }
          },
        };
        sockets.push(socket);
        return socket;
      },
    },
  };
  delete require.cache[listenerModulePath];

  return {
    sockets,
    restore() {
      delete require.cache[listenerModulePath];
      if (previousSocketModule) {
        require.cache[socketModulePath] = previousSocketModule;
      } else {
        delete require.cache[socketModulePath];
      }
    },
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

async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(condition(), 'timed out waiting for the private chat listener');
}

async function createStartedListener(t, options = {}) {
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const socketMock = installSocketIoMock();
  t.after(() => socketMock.restore());

  const { createPrivateChatListener } = require('../../dist/core/chat/privateChatListener.js');
  const messages = [];
  const errors = [];
  const listener = createPrivateChatListener({
    getIdentity: async () => ({
      globalMetaId: LOCAL_GLOBAL_META_ID,
      privateKeyHex: localKeys.privateKeyHex,
      chatPublicKey: localKeys.publicKeyHex,
    }),
    callbacks: {
      onMessage: (message) => {
        messages.push(message);
      },
      onError: (error) => {
        errors.push(error);
      },
    },
    resolvePeerChatPublicKey: options.resolvePeerChatPublicKey,
    socketEndpoints: [{ url: 'wss://metaso.test', path: '/socket/socket.io' }],
  });
  t.after(() => listener.stop());

  listener.start();
  await waitFor(() => socketMock.sockets.length > 0);

  return {
    listener,
    socketMock,
    localKeys,
    peerKeys,
    messages,
    errors,
    buildPeerPayload(input) {
      return buildEncryptedSocketPayload({
        fromGlobalMetaId: PEER_GLOBAL_META_ID,
        fromKeys: peerKeys,
        toGlobalMetaId: LOCAL_GLOBAL_META_ID,
        toChatPublicKey: localKeys.publicKeyHex,
        ...input,
      });
    },
  };
}

test('private chat listener normalizes Unix-second socket timestamps to milliseconds', async (t) => {
  const harness = await createStartedListener(t);

  const payload = harness.buildPeerPayload({
    content: 'seconds timestamp push',
    pinId: 'listener-pin-seconds-timestamp',
    timestamp: 1_784_910_335,
  });
  harness.socketMock.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  await waitFor(() => harness.messages.length === 1);
  assert.equal(harness.errors.length, 0);
  assert.equal(harness.messages[0].content, 'seconds timestamp push');
  assert.equal(harness.messages[0].timestamp, 1_784_910_335_000);
  assert.equal(harness.messages[0].messagePinId, 'listener-pin-seconds-timestamp');
});

test('private chat listener reports undecryptable pushes and processes their redelivery once the peer key resolves', async (t) => {
  let peerKeyAvailable = false;
  const harness = await createStartedListener(t, {
    resolvePeerChatPublicKey: async () => (
      peerKeyAvailable ? harness.peerKeys.publicKeyHex : null
    ),
  });

  const payload = harness.buildPeerPayload({
    content: 'redelivered after key lookup recovered',
    pinId: 'listener-pin-redelivered',
  });
  delete payload.fromUserInfo.chatPublicKey;
  harness.socketMock.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  await waitFor(() => harness.errors.length === 1);
  assert.match(harness.errors[0].message, /dropped undecryptable private chat push/);
  assert.match(harness.errors[0].message, /listener-pin-redelivered/);
  assert.equal(harness.messages.length, 0);

  // The failed delivery must not stay pinned as seen: the redelivery of the
  // same pinId is processed once the peer chat key becomes resolvable.
  peerKeyAvailable = true;
  harness.socketMock.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  await waitFor(() => harness.messages.length === 1);
  assert.equal(harness.messages[0].content, 'redelivered after key lookup recovered');
  assert.equal(harness.messages[0].messagePinId, 'listener-pin-redelivered');
});
