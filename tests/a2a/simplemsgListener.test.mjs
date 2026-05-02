import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const {
  createA2ASimplemsgListenerManager,
  normalizeSimplemsgSocketMessage,
} = require('../../dist/core/a2a/simplemsgListener.js');
const { deriveIdentity } = require('../../dist/core/identity/deriveIdentity.js');
const { sendPrivateChat } = require('../../dist/core/chat/privateChat.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');

function createIdentityPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

async function createSystemHome(t) {
  const systemHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-simplemsg-listener-'));
  t.after(async () => {
    await fs.rm(systemHomeDir, { recursive: true, force: true });
  });
  return systemHomeDir;
}

async function createProfile(systemHomeDir, input) {
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', input.slug);
  await fs.mkdir(homeDir, { recursive: true });
  await upsertIdentityProfile({
    systemHomeDir,
    name: input.name,
    homeDir,
    globalMetaId: input.globalMetaId,
    mvcAddress: input.mvcAddress ?? `mvc-${input.slug}`,
    now: () => input.createdAt ?? 1_777_000_000_000,
  });
  if (input.keys) {
    await createFileSecretStore(homeDir).writeIdentitySecrets({
      globalMetaId: input.globalMetaId,
      privateKeyHex: input.keys.privateKeyHex,
      chatPublicKey: input.keys.publicKeyHex,
      mvcAddress: input.mvcAddress ?? `mvc-${input.slug}`,
    });
  }
  return { homeDir };
}

async function createMnemonicProfile(systemHomeDir, input) {
  const derived = await deriveIdentity({
    mnemonic: input.mnemonic,
    path: input.derivationPath,
  });
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', input.slug);
  await fs.mkdir(homeDir, { recursive: true });
  await upsertIdentityProfile({
    systemHomeDir,
    name: input.name,
    homeDir,
    globalMetaId: derived.globalMetaId,
    mvcAddress: derived.mvcAddress,
    now: () => input.createdAt ?? 1_777_000_000_000,
  });
  await createFileSecretStore(homeDir).writeIdentitySecrets({
    mnemonic: input.mnemonic,
    path: input.derivationPath,
  });
  return { homeDir, derived };
}

function createSocketHarness() {
  const sockets = [];
  const socketClientFactory = (endpoint, options) => {
    const handlers = new Map();
    const socket = {
      endpoint,
      options,
      disconnected: false,
      on(event, handler) {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
        return socket;
      },
      removeAllListeners() {
        handlers.clear();
        return socket;
      },
      disconnect() {
        socket.disconnected = true;
        return socket;
      },
      async emitServer(event, payload) {
        for (const handler of handlers.get(event) ?? []) {
          await handler(payload);
        }
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, socketClientFactory };
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
    txId: input.txId ?? input.pinId?.replace(/i0$/, '') ?? null,
    pinId: input.pinId,
    content: wire.content,
    timestamp: input.timestamp ?? 1_777_000_000_000,
    fromGlobalMetaId: input.fromGlobalMetaId,
    toGlobalMetaId: input.toGlobalMetaId,
    replyPin: input.replyPin ?? null,
    fromUserInfo: {
      name: input.fromName ?? 'Peer Bot',
      avatar: input.fromAvatar ?? null,
      chatPublicKey: input.fromKeys.publicKeyHex,
    },
  };
}

async function waitForMessages(store, count) {
  let latest = await store.readConversation();
  for (let attempt = 0; attempt < 100 && latest.messages.length < count; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
    latest = await store.readConversation();
  }
  return latest;
}

test('simplemsg listener manager creates one listener identity per local profile', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const alphaKeys = createIdentityPair();
  const betaKeys = createIdentityPair();
  await createProfile(systemHomeDir, {
    name: 'Alpha Bot',
    slug: 'alpha-bot',
    globalMetaId: 'idq1alpha0000000000000000000000000000',
    keys: alphaKeys,
    createdAt: 1_777_000_000_000,
  });
  await createProfile(systemHomeDir, {
    name: 'Beta Bot',
    slug: 'beta-bot',
    globalMetaId: 'idq1beta00000000000000000000000000000',
    keys: betaKeys,
    createdAt: 1_777_000_000_001,
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });

  const started = await manager.start();

  assert.equal(started.started.length, 2);
  assert.deepEqual(
    harness.sockets.map((socket) => socket.options.query.metaid).sort(),
    ['idq1alpha0000000000000000000000000000', 'idq1beta00000000000000000000000000000'].sort(),
  );
  manager.stop();
  assert.equal(harness.sockets.every((socket) => socket.disconnected), true);
});

test('simplemsg listener manager skips profiles with missing secrets without blocking valid profiles', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const alphaKeys = createIdentityPair();
  await createProfile(systemHomeDir, {
    name: 'Alpha Bot',
    slug: 'alpha-bot',
    globalMetaId: 'idq1alpha0000000000000000000000000000',
    keys: alphaKeys,
  });
  await createProfile(systemHomeDir, {
    name: 'No Secrets Bot',
    slug: 'no-secrets-bot',
    globalMetaId: 'idq1nosecrets0000000000000000000000',
    keys: null,
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });

  const started = await manager.start();

  assert.equal(started.started.length, 1);
  assert.equal(started.started[0].globalMetaId, 'idq1alpha0000000000000000000000000000');
  assert.equal(started.skipped.length, 1);
  assert.equal(started.skipped[0].slug, 'no-secrets-bot');
  assert.equal(harness.sockets.length, 1);
});

test('simplemsg listener manager derives listener identity from mnemonic-backed profile secrets', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const fixtureMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const { derived } = await createMnemonicProfile(systemHomeDir, {
    name: 'Mnemonic Bot',
    slug: 'mnemonic-bot',
    mnemonic: fixtureMnemonic,
    derivationPath: "m/44'/10001'/0'/0/0",
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });

  const started = await manager.start();

  assert.equal(started.started.length, 1);
  assert.equal(started.skipped.length, 0);
  assert.equal(started.started[0].globalMetaId, derived.globalMetaId);
  assert.equal(harness.sockets[0].options.query.metaid, derived.globalMetaId);
});

test('simplemsg listener normalizes idchat and show.now socket payload envelopes', () => {
  const baseMessage = {
    txId: 'tx-1',
    pinId: 'pin-1',
    content: 'encrypted-content',
    fromGlobalMetaId: 'idq1peer00000000000000000000000000000',
    toGlobalMetaId: 'idq1local0000000000000000000000000000',
    fromUserInfo: {
      chatPublicKey: 'peer-chat-public-key',
    },
  };

  assert.deepEqual(
    normalizeSimplemsgSocketMessage(['WS_SERVER_NOTIFY_PRIVATE_CHAT', baseMessage]),
    normalizeSimplemsgSocketMessage({ M: 'WS_SERVER_NOTIFY_PRIVATE_CHAT', D: baseMessage }),
  );
  assert.deepEqual(
    normalizeSimplemsgSocketMessage(['WS_SERVER_NOTIFY_PRIVATE_CHAT', baseMessage]),
    normalizeSimplemsgSocketMessage(['WS_RESPONSE_SUCCESS', { data: baseMessage }]),
  );
});

test('simplemsg listener decrypts inbound ciphertext into per-peer A2A storage and deduplicates by pinId', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1local0000000000000000000000000000';
  const peerGlobalMetaId = 'idq1peer00000000000000000000000000000';
  const { homeDir } = await createProfile(systemHomeDir, {
    name: 'Local Bot',
    slug: 'local-bot',
    globalMetaId: localGlobalMetaId,
    keys: localKeys,
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });
  await manager.start();

  const payload = buildEncryptedSocketPayload({
    fromGlobalMetaId: peerGlobalMetaId,
    fromKeys: peerKeys,
    toGlobalMetaId: localGlobalMetaId,
    toChatPublicKey: localKeys.publicKeyHex,
    content: 'hello from peer',
    pinId: 'incoming-pin-1',
  });
  await harness.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);
  await harness.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  const store = createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  });
  const conversation = await waitForMessages(store, 1);

  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].direction, 'incoming');
  assert.equal(conversation.messages[0].kind, 'private_chat');
  assert.equal(conversation.messages[0].content, 'hello from peer');
  assert.equal(conversation.messages[0].pinId, 'incoming-pin-1');
  assert.equal(conversation.messages[0].raw.pinId, 'incoming-pin-1');
  assert.equal(Object.hasOwn(conversation.messages[0].raw, 'content'), false);
});

test('simplemsg listener ignores messages addressed to another local profile', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1local0000000000000000000000000000';
  const peerGlobalMetaId = 'idq1peer00000000000000000000000000000';
  const { homeDir } = await createProfile(systemHomeDir, {
    name: 'Local Bot',
    slug: 'local-bot',
    globalMetaId: localGlobalMetaId,
    keys: localKeys,
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });
  await manager.start();

  const payload = buildEncryptedSocketPayload({
    fromGlobalMetaId: peerGlobalMetaId,
    fromKeys: peerKeys,
    toGlobalMetaId: 'idq1other0000000000000000000000000000',
    toChatPublicKey: localKeys.publicKeyHex,
    content: 'not for local',
    pinId: 'incoming-pin-ignored',
  });
  await harness.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  const conversation = await createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  }).readConversation();

  assert.equal(conversation.messages.length, 0);
});

test('simplemsg listener accepts socket messages without an explicit recipient on the subscribed identity stream', async (t) => {
  const systemHomeDir = await createSystemHome(t);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const localGlobalMetaId = 'idq1local0000000000000000000000000000';
  const peerGlobalMetaId = 'idq1peer00000000000000000000000000000';
  const { homeDir } = await createProfile(systemHomeDir, {
    name: 'Local Bot',
    slug: 'local-bot',
    globalMetaId: localGlobalMetaId,
    keys: localKeys,
  });

  const harness = createSocketHarness();
  const manager = createA2ASimplemsgListenerManager({
    systemHomeDir,
    socketClientFactory: harness.socketClientFactory,
    socketEndpoints: [{ url: 'wss://idchat.test', path: '/socket/socket.io' }],
  });
  await manager.start();

  const payload = buildEncryptedSocketPayload({
    fromGlobalMetaId: peerGlobalMetaId,
    fromKeys: peerKeys,
    toGlobalMetaId: localGlobalMetaId,
    toChatPublicKey: localKeys.publicKeyHex,
    content: 'missing recipient should still persist',
    pinId: 'incoming-pin-no-recipient',
  });
  delete payload.toGlobalMetaId;
  await harness.sockets[0].emitServer('WS_SERVER_NOTIFY_PRIVATE_CHAT', payload);

  const conversation = await createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: localGlobalMetaId,
      chatPublicKey: localKeys.publicKeyHex,
    },
    peer: {
      globalMetaId: peerGlobalMetaId,
      chatPublicKey: peerKeys.publicKeyHex,
    },
  }).readConversation();

  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].direction, 'incoming');
  assert.equal(conversation.messages[0].content, 'missing recipient should still persist');
  assert.equal(conversation.messages[0].pinId, 'incoming-pin-no-recipient');
});
