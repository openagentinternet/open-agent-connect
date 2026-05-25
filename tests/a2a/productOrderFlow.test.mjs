import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildA2ASimplemsgInboundDispatcher } = require('../../dist/cli/runtime.js');
const {
  buildA2APeerSessionId,
  persistA2AConversationMessage,
} = require('../../dist/core/a2a/conversationPersistence.js');
const {
  getUnifiedA2ATraceSessionForProfile,
} = require('../../dist/core/a2a/traceProjection.js');
const { buildDeliveryMessage } = require('../../dist/core/a2a/protocol/orderProtocol.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { createProductStateStore } = require('../../dist/core/products/productStateStore.js');
const {
  buildProductOrderNotification,
} = require('../../dist/core/products/productOrderMessages.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const {
  setActiveMetabotHome,
  upsertIdentityProfile,
} = require('../../dist/core/identity/identityProfiles.js');

const ALICE_GLOBAL_META_ID = 'idq1aliceproduct000000000000000000000';
const BOB_GLOBAL_META_ID = 'idq1bobproduct00000000000000000000000';
const ORDER_TXID = 'b'.repeat(64);
const PRODUCT_ORDER_PIN_ID = 'product-order-pin-1';
const LISTING_PIN_ID = 'listing-pin-1';
const SKU_ID = 'space-00005';
const PAYMENT_TXID = 'payment-txid-1';
const BASE_TIME = 1_777_000_000_000;

async function createProfileFixture(name, slug, globalMetaId) {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), `metabot-product-flow-${slug}-`));
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  const profile = await upsertIdentityProfile({
    systemHomeDir,
    name,
    homeDir,
    globalMetaId,
    mvcAddress: `mvc-${slug}`,
    now: () => BASE_TIME,
  });
  await setActiveMetabotHome({
    systemHomeDir,
    homeDir: profile.homeDir,
    now: () => BASE_TIME,
  });
  return { systemHomeDir, homeDir: profile.homeDir, profile };
}

function productOrderContent() {
  return buildProductOrderNotification({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId: SKU_ID,
    paymentTxid: PAYMENT_TXID,
  });
}

function productDeliveryContent() {
  return buildDeliveryMessage({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId: SKU_ID,
    paymentTxid: PAYMENT_TXID,
    result: 'Top-up card: XXXX-XXXX',
    deliveredAt: BASE_TIME + 500,
  }, ORDER_TXID);
}

test('A2A dispatcher routes product orders to order handling before generic private chat', async () => {
  const calls = [];
  const dispatcher = buildA2ASimplemsgInboundDispatcher({
    handleOrderProtocolMessage: async (message) => {
      calls.push(['order', message.content]);
      return { ok: true, data: { handled: true, protocol: 'product-order' } };
    },
    handleGenericPrivateChatMessage: async (message) => {
      calls.push(['generic', message.content]);
    },
  });

  await dispatcher({
    fromGlobalMetaId: BOB_GLOBAL_META_ID,
    content: productOrderContent(),
    messagePinId: `${ORDER_TXID}i0`,
    timestamp: BASE_TIME,
  });

  assert.deepEqual(calls.map(([kind]) => kind), ['order']);
  assert.match(calls[0][1], /\[PRODUCT_ORDER\]/);
});

test('buyer receives product delivery into cache, A2A transcript, and trace projection', async () => {
  const bob = await createProfileFixture('Bob', 'bob', BOB_GLOBAL_META_ID);
  const productStateStore = createProductStateStore(bob.homeDir);
  await productStateStore.upsertBuyerOrder({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId: SKU_ID,
    paymentTxid: PAYMENT_TXID,
    orderTxid: ORDER_TXID,
    sellerGlobalMetaId: ALICE_GLOBAL_META_ID,
    buyerGlobalMetaId: BOB_GLOBAL_META_ID,
    state: 'notified',
    localUpdatedAt: BASE_TIME,
  });

  await persistA2AConversationMessage({
    homeDir: bob.homeDir,
    local: {
      profileSlug: 'bob',
      globalMetaId: BOB_GLOBAL_META_ID,
      name: 'Bob',
      chatPublicKey: 'bob-chat-public-key',
    },
    peer: {
      globalMetaId: ALICE_GLOBAL_META_ID,
      name: 'Alice',
      chatPublicKey: 'alice-chat-public-key',
    },
    message: {
      direction: 'outgoing',
      content: productOrderContent(),
      pinId: `${ORDER_TXID}i0`,
      txid: ORDER_TXID,
      txids: [ORDER_TXID],
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      timestamp: BASE_TIME,
    },
    orderSession: {
      role: 'caller',
      state: 'awaiting_delivery',
      orderTxid: ORDER_TXID,
      paymentTxid: PAYMENT_TXID,
      serviceName: 'Mobile Top-up Card',
    },
  });
  await persistA2AConversationMessage({
    homeDir: bob.homeDir,
    local: {
      profileSlug: 'bob',
      globalMetaId: BOB_GLOBAL_META_ID,
      name: 'Bob',
      chatPublicKey: 'bob-chat-public-key',
    },
    peer: {
      globalMetaId: ALICE_GLOBAL_META_ID,
      name: 'Alice',
      chatPublicKey: 'alice-chat-public-key',
    },
    message: {
      direction: 'incoming',
      content: productDeliveryContent(),
      pinId: 'delivery-pin-1',
      txid: 'delivery-tx-1',
      txids: ['delivery-tx-1'],
      timestamp: BASE_TIME + 600,
    },
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: bob.homeDir,
    systemHomeDir: bob.systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:38245' }),
  });
  const handled = await handlers.services.handleInboundOrderProtocolMessage({
    fromGlobalMetaId: ALICE_GLOBAL_META_ID,
    content: productDeliveryContent(),
    messagePinId: 'delivery-pin-1',
    timestamp: BASE_TIME + 600,
  });
  const productState = await productStateStore.readState();
  const [buyerOrder] = productState.buyerOrders;
  const detail = await getUnifiedA2ATraceSessionForProfile({
    profile: bob.profile,
    sessionId: `a2a-order-${ORDER_TXID}`,
  });
  const conversation = await createA2AConversationStore({
    homeDir: bob.homeDir,
    local: {
      globalMetaId: BOB_GLOBAL_META_ID,
      chatPublicKey: 'bob-chat-public-key',
    },
    peer: {
      globalMetaId: ALICE_GLOBAL_META_ID,
      chatPublicKey: 'alice-chat-public-key',
    },
  }).readConversation();
  const peerSessionId = buildA2APeerSessionId(BOB_GLOBAL_META_ID, ALICE_GLOBAL_META_ID);

  assert.equal(handled.ok, true);
  assert.equal(handled.data.handled, true);
  assert.equal(handled.data.protocol, 'product-order');
  assert.equal(buyerOrder.state, 'delivered');
  assert.equal(buyerOrder.deliverySummary.result, 'Top-up card: XXXX-XXXX');
  assert.equal(buyerOrder.deliverySummary.deliveryPinId, 'delivery-pin-1');
  assert.equal(buyerOrder.deliverySummary.deliveredAt, BASE_TIME + 500);
  assert.equal(conversation.sessions.some((session) => session.sessionId === peerSessionId), true);
  assert.equal(conversation.messages.some((message) => message.pinId === 'delivery-pin-1'), true);
  assert.ok(detail);
  assert.equal(detail.resultText, 'Top-up card: XXXX-XXXX');
  assert.equal(detail.responseText, 'Top-up card: XXXX-XXXX');
  const delivery = detail.transcriptItems.find((item) => item.type === 'delivery');
  assert.ok(delivery);
  assert.equal(delivery.content, 'Top-up card: XXXX-XXXX');
  assert.equal(delivery.metadata.productOrderPinId, PRODUCT_ORDER_PIN_ID);
  assert.equal(delivery.metadata.listingPinId, LISTING_PIN_ID);
  assert.equal(delivery.metadata.skuId, SKU_ID);
  assert.equal(delivery.metadata.paymentTxid, PAYMENT_TXID);
  assert.equal(delivery.metadata.deliveredAt, BASE_TIME + 500);
});
