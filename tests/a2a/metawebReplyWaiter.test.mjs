import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const CALLER_GLOBAL_META_ID = 'idq1caller';
const PROVIDER_GLOBAL_META_ID = 'idq1provider';
const ORDER_TXID = 'a'.repeat(64);
const PAYMENT_TXID = 'b'.repeat(64);
const SERVICE_PIN_ID = 'service-pin-1';
const BASE_TIME = 1_777_000_000_000;

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
  const waiterModulePath = require.resolve('../../dist/core/a2a/metawebReplyWaiter.js');
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
          emitMessage(data) {
            const listener = listeners.get('message');
            if (listener) {
              listener(data);
            }
          },
          emitEvent(eventName, data) {
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
  delete require.cache[waiterModulePath];

  return {
    sockets,
    restore() {
      delete require.cache[waiterModulePath];
      if (previousSocketModule) {
        require.cache[socketModulePath] = previousSocketModule;
      } else {
        delete require.cache[socketModulePath];
      }
    },
  };
}

function encryptProviderMessage({ content, callerPair, providerPair, pinId, timestamp = BASE_TIME }) {
  const { sendPrivateChat } = require('../../dist/core/chat/privateChat.js');
  const sent = sendPrivateChat({
    fromIdentity: {
      globalMetaId: PROVIDER_GLOBAL_META_ID,
      privateKeyHex: providerPair.privateKeyHex,
    },
    toGlobalMetaId: CALLER_GLOBAL_META_ID,
    peerChatPublicKey: callerPair.publicKeyHex,
    content,
    timestamp: Math.floor(timestamp / 1000),
  });

  return {
    txId: pinId.replace(/i\d+$/u, ''),
    pinId,
    content: sent.encryptedContent,
    timestamp,
    replyPin: null,
    fromGlobalMetaId: PROVIDER_GLOBAL_META_ID,
    toGlobalMetaId: CALLER_GLOBAL_META_ID,
    fromUserInfo: {
      chatPublicKey: providerPair.publicKeyHex,
    },
  };
}

async function awaitReplyFromEncryptedMessages(messages) {
  const callerPair = createIdentityPair();
  const providerPair = createIdentityPair();
  const socketMock = installSocketIoMock();
  try {
    const { createSocketIoMetaWebReplyWaiter } = require('../../dist/core/a2a/metawebReplyWaiter.js');
    const waiter = createSocketIoMetaWebReplyWaiter();
    const replyPromise = waiter.awaitServiceReply({
      callerGlobalMetaId: CALLER_GLOBAL_META_ID,
      callerPrivateKeyHex: callerPair.privateKeyHex,
      providerGlobalMetaId: PROVIDER_GLOBAL_META_ID,
      providerChatPublicKey: providerPair.publicKeyHex,
      servicePinId: SERVICE_PIN_ID,
      paymentTxid: PAYMENT_TXID,
      orderTxid: ORDER_TXID,
      timeoutMs: 1000,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(socketMock.sockets.length > 0, 'expected reply waiter to open socket listeners');

    messages.forEach((content, index) => {
      socketMock.sockets[0].emitMessage([
        'WS_SERVER_NOTIFY_PRIVATE_CHAT',
        encryptProviderMessage({
          content,
          callerPair,
          providerPair,
          pinId: `${String(index + 1).repeat(64)}i0`,
          timestamp: BASE_TIME + index,
        }),
      ]);
    });

    return await replyPromise;
  } finally {
    socketMock.restore();
  }
}

test('metaweb reply waiter resolves delivery replies emitted as named socket events', async () => {
  const callerPair = createIdentityPair();
  const providerPair = createIdentityPair();
  const socketMock = installSocketIoMock();
  try {
    const { createSocketIoMetaWebReplyWaiter } = require('../../dist/core/a2a/metawebReplyWaiter.js');
    const waiter = createSocketIoMetaWebReplyWaiter();
    const replyPromise = waiter.awaitServiceReply({
      callerGlobalMetaId: CALLER_GLOBAL_META_ID,
      callerPrivateKeyHex: callerPair.privateKeyHex,
      providerGlobalMetaId: PROVIDER_GLOBAL_META_ID,
      providerChatPublicKey: providerPair.publicKeyHex,
      servicePinId: SERVICE_PIN_ID,
      paymentTxid: PAYMENT_TXID,
      orderTxid: ORDER_TXID,
      timeoutMs: 1000,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(socketMock.sockets.length > 0, 'expected reply waiter to open socket listeners');

    const deliveryContent = `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
      paymentTxid: PAYMENT_TXID,
      servicePinId: SERVICE_PIN_ID,
      result: 'Named event delivery is ready.',
    })}`;
    socketMock.sockets[0].emitEvent(
      'WS_SERVER_NOTIFY_PRIVATE_CHAT',
      encryptProviderMessage({
        content: deliveryContent,
        callerPair,
        providerPair,
        pinId: `${'3'.repeat(64)}i0`,
        timestamp: BASE_TIME,
      }),
    );
    socketMock.sockets[0].emitEvent('WS_RESPONSE_SUCCESS', {
      data: encryptProviderMessage({
        content: `[NeedsRating:${ORDER_TXID}] Please rate this service.`,
        callerPair,
        providerPair,
        pinId: `${'4'.repeat(64)}i0`,
        timestamp: BASE_TIME + 1,
      }),
    });

    const reply = await replyPromise;

    assert.equal(reply.state, 'completed');
    assert.equal(reply.responseText, 'Named event delivery is ready.');
    assert.equal(reply.deliveryPinId, `${'3'.repeat(64)}i0`);
    assert.equal(reply.ratingRequestText, 'Please rate this service.');
    assert.equal(reply.ratingRequestPinId, `${'4'.repeat(64)}i0`);
  } finally {
    socketMock.restore();
  }
});

test('metaweb reply waiter returns artifacts from structured delivery payloads', async () => {
  const deliveryContent = `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
    paymentTxid: PAYMENT_TXID,
    servicePinId: SERVICE_PIN_ID,
    result: 'Video is ready.',
    artifacts: [
      {
        uri: 'metafile://video-pin-1.mp4',
        fileName: '/tmp/provider/leaked/clip.mp4',
        contentType: 'video/mp4',
        byteLength: 1234,
        localPath: '/tmp/provider/leaked/clip.mp4',
      },
    ],
  })}`;
  const ratingContent = `[NeedsRating:${ORDER_TXID}] Please rate this service.`;

  const reply = await awaitReplyFromEncryptedMessages([deliveryContent, ratingContent]);

  assert.equal(reply.state, 'completed');
  assert.equal(reply.responseText, 'Video is ready.');
  assert.equal(reply.ratingRequestText, 'Please rate this service.');
  assert.equal(reply.artifacts.length, 1);
  assert.equal(reply.artifacts[0].uri, 'metafile://video-pin-1.mp4');
  assert.equal(reply.artifacts[0].kind, 'video');
  assert.equal(reply.artifacts[0].contentType, 'video/mp4');
  assert.equal(reply.artifacts[0].fileName, 'clip.mp4');
  assert.equal(Object.hasOwn(reply.artifacts[0], 'localPath'), false);
});

test('metaweb reply waiter parses artifacts from result text when structured payload is absent', async () => {
  const deliveryContent = `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
    paymentTxid: PAYMENT_TXID,
    servicePinId: SERVICE_PIN_ID,
    result: 'Image is ready: metafile://image-pin-1.png',
  })}`;
  const ratingContent = `[NeedsRating:${ORDER_TXID}] Please rate this service.`;

  const reply = await awaitReplyFromEncryptedMessages([deliveryContent, ratingContent]);

  assert.equal(reply.state, 'completed');
  assert.equal(reply.artifacts.length, 1);
  assert.equal(reply.artifacts[0].uri, 'metafile://image-pin-1.png');
  assert.equal(reply.artifacts[0].kind, 'image');
});

test('metaweb reply waiter preserves delivery artifacts when NeedsRating arrives during grace', async () => {
  const deliveryContent = `[DELIVERY:${ORDER_TXID}] ${JSON.stringify({
    paymentTxid: PAYMENT_TXID,
    servicePinId: SERVICE_PIN_ID,
    result: 'Audio is ready: metafile://audio-pin-1.mp3',
  })}`;
  const ratingContent = `[NeedsRating:${ORDER_TXID}] Please rate this service.`;

  const reply = await awaitReplyFromEncryptedMessages([deliveryContent, ratingContent]);

  assert.equal(reply.state, 'completed');
  assert.equal(reply.responseText, 'Audio is ready: metafile://audio-pin-1.mp3');
  assert.equal(reply.ratingRequestText, 'Please rate this service.');
  assert.equal(reply.ratingRequestPinId, `${'2'.repeat(64)}i0`);
  assert.equal(reply.ratingRequestObservedAt, BASE_TIME + 1);
  assert.equal(reply.ratingRawMessage.pinId, `${'2'.repeat(64)}i0`);
  assert.equal(reply.ratingRawMessage.txId, '2'.repeat(64));
  assert.equal(reply.ratingRawMessage.timestamp, BASE_TIME + 1);
  assert.equal(reply.artifacts.length, 1);
  assert.equal(reply.artifacts[0].uri, 'metafile://audio-pin-1.mp3');
  assert.equal(reply.artifacts[0].kind, 'audio');
});

test('scoped delivery correlation does not fall back to service id for a different order', () => {
  const {
    normalizeOrderProtocolReference,
    shouldAcceptServiceDeliveryForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const expectedOrderTxid = 'a'.repeat(64);
  const otherOrderTxid = 'b'.repeat(64);
  const expectedPaymentTxid = 'c'.repeat(64);
  const otherPaymentTxid = 'd'.repeat(64);

  assert.equal(normalizeOrderProtocolReference(`${expectedOrderTxid}i0`), expectedOrderTxid);
  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: otherOrderTxid,
      paymentTxid: otherPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: expectedOrderTxid,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), false);
});

test('scoped delivery requires order or payment correlation when no expected order txid is known', () => {
  const {
    shouldAcceptServiceDeliveryForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const scopedOrderTxid = 'a'.repeat(64);
  const expectedPaymentTxid = 'c'.repeat(64);
  const otherPaymentTxid = 'd'.repeat(64);

  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: scopedOrderTxid,
      paymentTxid: otherPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: null,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), false);

  assert.equal(shouldAcceptServiceDeliveryForReplyWaiter({
    delivery: {
      orderTxid: scopedOrderTxid,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
    expected: {
      orderTxid: null,
      paymentTxid: expectedPaymentTxid,
      servicePinId: 'service-pin-1',
    },
  }), true);
});

test('rating request scope must match expected or pending delivery order scope', () => {
  const {
    shouldAcceptServiceRatingRequestForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const expectedOrderTxid = 'a'.repeat(64);
  const otherOrderTxid = 'b'.repeat(64);

  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: otherOrderTxid,
    expectedOrderTxid,
    pendingDeliveryOrderTxid: expectedOrderTxid,
  }), false);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid,
    pendingDeliveryOrderTxid: null,
  }), true);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid: null,
    pendingDeliveryOrderTxid: expectedOrderTxid,
  }), true);
  assert.equal(shouldAcceptServiceRatingRequestForReplyWaiter({
    ratingOrderTxid: expectedOrderTxid,
    expectedOrderTxid: null,
    pendingDeliveryOrderTxid: null,
  }), false);
});

test('metaweb reply waiter resolves promptly with failed state when ORDER_END arrives', async () => {
  const callerPair = createIdentityPair();
  const providerPair = createIdentityPair();
  const socketMock = installSocketIoMock();
  try {
    const { createSocketIoMetaWebReplyWaiter } = require('../../dist/core/a2a/metawebReplyWaiter.js');
    const waiter = createSocketIoMetaWebReplyWaiter();
    const startedAt = Date.now();
    const replyPromise = waiter.awaitServiceReply({
      callerGlobalMetaId: CALLER_GLOBAL_META_ID,
      callerPrivateKeyHex: callerPair.privateKeyHex,
      providerGlobalMetaId: PROVIDER_GLOBAL_META_ID,
      providerChatPublicKey: providerPair.publicKeyHex,
      servicePinId: SERVICE_PIN_ID,
      paymentTxid: PAYMENT_TXID,
      orderTxid: ORDER_TXID,
      timeoutMs: 60_000,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(socketMock.sockets.length > 0, 'expected reply waiter to open socket listeners');

    socketMock.sockets[0].emitMessage([
      'WS_SERVER_NOTIFY_PRIVATE_CHAT',
      encryptProviderMessage({
        content: `[ORDER_END:${ORDER_TXID} provider_skill_missing] Provider does not have the requested skill.`,
        callerPair,
        providerPair,
        pinId: `${'5'.repeat(64)}i0`,
        timestamp: BASE_TIME,
      }),
    ]);

    const reply = await replyPromise;

    assert.equal(reply.state, 'failed');
    assert.equal(reply.failureCode, 'provider_skill_missing');
    assert.equal(reply.failureReason, 'Provider does not have the requested skill.');
    assert.equal(reply.orderEndPinId, `${'5'.repeat(64)}i0`);
    assert.equal(reply.observedAt, BASE_TIME);
    assert.ok(
      Date.now() - startedAt < 30_000,
      'expected ORDER_END to settle the waiter immediately instead of waiting for the full timeout',
    );
  } finally {
    socketMock.restore();
  }
});

test('metaweb reply waiter accepts legacy ORDER_END without a txid from the expected peer', async () => {
  const reply = await awaitReplyFromEncryptedMessages([
    '[ORDER_END provider_busy] Provider is busy, order ended.',
  ]);

  assert.equal(reply.state, 'failed');
  assert.equal(reply.failureCode, 'provider_busy');
  assert.equal(reply.failureReason, 'Provider is busy, order ended.');
});

test('metaweb reply waiter ignores ORDER_END scoped to a different order txid', async () => {
  const callerPair = createIdentityPair();
  const providerPair = createIdentityPair();
  const socketMock = installSocketIoMock();
  try {
    const { createSocketIoMetaWebReplyWaiter } = require('../../dist/core/a2a/metawebReplyWaiter.js');
    const waiter = createSocketIoMetaWebReplyWaiter();
    const replyPromise = waiter.awaitServiceReply({
      callerGlobalMetaId: CALLER_GLOBAL_META_ID,
      callerPrivateKeyHex: callerPair.privateKeyHex,
      providerGlobalMetaId: PROVIDER_GLOBAL_META_ID,
      providerChatPublicKey: providerPair.publicKeyHex,
      servicePinId: SERVICE_PIN_ID,
      paymentTxid: PAYMENT_TXID,
      orderTxid: ORDER_TXID,
      timeoutMs: 300,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(socketMock.sockets.length > 0, 'expected reply waiter to open socket listeners');

    socketMock.sockets[0].emitMessage([
      'WS_SERVER_NOTIFY_PRIVATE_CHAT',
      encryptProviderMessage({
        content: `[ORDER_END:${'9'.repeat(64)} provider_skill_missing] Other order ended.`,
        callerPair,
        providerPair,
        pinId: `${'6'.repeat(64)}i0`,
        timestamp: BASE_TIME,
      }),
    ]);

    const reply = await replyPromise;

    assert.equal(reply.state, 'timeout');
  } finally {
    socketMock.restore();
  }
});

test('order end scope must match the expected order txid when both are known', () => {
  const {
    shouldAcceptServiceOrderEndForReplyWaiter,
  } = require('../../dist/core/a2a/metawebReplyWaiter.js');

  const expectedOrderTxid = 'a'.repeat(64);
  const otherOrderTxid = 'b'.repeat(64);

  assert.equal(shouldAcceptServiceOrderEndForReplyWaiter({
    orderEndOrderTxid: otherOrderTxid,
    expectedOrderTxid,
  }), false);
  assert.equal(shouldAcceptServiceOrderEndForReplyWaiter({
    orderEndOrderTxid: expectedOrderTxid,
    expectedOrderTxid,
  }), true);
  assert.equal(shouldAcceptServiceOrderEndForReplyWaiter({
    orderEndOrderTxid: `${expectedOrderTxid}i0`,
    expectedOrderTxid,
  }), true);
  assert.equal(shouldAcceptServiceOrderEndForReplyWaiter({
    orderEndOrderTxid: null,
    expectedOrderTxid,
  }), true);
  assert.equal(shouldAcceptServiceOrderEndForReplyWaiter({
    orderEndOrderTxid: otherOrderTxid,
    expectedOrderTxid: null,
  }), true);
});
