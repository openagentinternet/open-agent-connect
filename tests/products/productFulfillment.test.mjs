import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createProductStateStore,
} = require('../../dist/core/products/productStateStore.js');
const {
  fulfillProductOrderForSeller,
  resolveProductOrderForSeller,
} = require('../../dist/core/products/productFulfillment.js');

const ORDER_TXID = '1'.repeat(64);
const REPLAY_ORDER_TXID = '2'.repeat(64);
const PAYMENT_TXID = 'a'.repeat(64);
const PRODUCT_ORDER_PIN_ID = 'product-order-pin-1';
const LISTING_PIN_ID = 'listing-pin-1';
const SELLER_GLOBAL_META_ID = 'idq1seller';
const BUYER_GLOBAL_META_ID = 'idq1buyer';
const SELLER_MVC_ADDRESS = 'seller-mvc-address';

async function createTempProfileRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-product-fulfillment-'));
  return path.join(root, '.metabot', 'profiles', 'seller');
}

function productListing(overrides = {}) {
  return {
    name: 'mobile top-up card',
    title: 'Mobile Top-Up Card Pack',
    productType: 'virtual',
    coverImage: 'metafile://cover_pinid.jpg',
    galleryImages: ['metafile://gallery_1.png'],
    descriptionContentType: 'text/markdown',
    description: 'Two virtual card options.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['deliver-topup-card', 'audit-stock'],
      estimatedDeliverySeconds: 300,
      deliverableDescription: 'A top-up card number is sent after payment verification.',
    },
    skus: [
      {
        skuId: 'sku2',
        name: 'Large Top-Up Card',
        image: 'metafile://sku_2.png',
        descriptionContentType: 'text/markdown',
        description: 'Large mobile top-up card.',
        price: {
          amount: '0.00005',
          currency: 'SPACE',
        },
        initialStock: 100,
      },
    ],
    ...overrides,
  };
}

function productOrder(overrides = {}) {
  return {
    listingPinId: LISTING_PIN_ID,
    skuId: 'sku2',
    settlementKind: 'native',
    paymentTxid: PAYMENT_TXID,
    comment: 'Please send the card to my default account.',
    ...overrides,
  };
}

function chainPin({
  pinId,
  path,
  payload,
  creatorGlobalMetaId,
  creatorAddress,
}) {
  return {
    pinId,
    path,
    content: JSON.stringify(payload),
    contentSummary: JSON.stringify(payload),
    creatorGlobalMetaId,
    globalMetaId: creatorGlobalMetaId,
    createAddress: creatorAddress,
    timestamp: 1_770_000_000_000,
  };
}

function createFakeProductStateStore(seed = {}) {
  const state = {
    orders: new Map(seed.orders?.map((entry) => [entry.productOrderPinId, { ...entry }]) ?? []),
    listings: new Map(seed.listings?.map((entry) => [
      entry.listingPinId ?? entry.item?.listingPinId,
      { ...entry },
    ]) ?? []),
    upsertedSellerOrders: [],
    upsertedOwnedListings: [],
    upsertedDirectoryItems: [],
  };
  return {
    state,
    async findOrderByProductOrderPinId(productOrderPinId) {
      const item = state.orders.get(productOrderPinId);
      return item ? { source: 'sellerOrders', item } : null;
    },
    async findSellerOrderByProductOrderPinId(productOrderPinId) {
      const item = state.orders.get(productOrderPinId);
      return item ? { source: 'sellerOrders', item } : null;
    },
    async findListingByPinId(listingPinId) {
      const entry = state.listings.get(listingPinId);
      if (!entry) return null;
      return {
        source: entry.source ?? 'ownedListings',
        item: entry.item ?? entry,
      };
    },
    async upsertSellerOrder(input) {
      const record = {
        role: 'seller',
        ...state.orders.get(input.productOrderPinId),
        ...input,
      };
      state.orders.set(input.productOrderPinId, record);
      state.upsertedSellerOrders.push(record);
      return record;
    },
    async claimSellerOrderFulfillment(input) {
      const existing = state.orders.get(input.productOrderPinId);
      const matches = existing && existing.paymentTxid === input.paymentTxid;
      if (
        matches &&
        existing.state === 'delivered' &&
        (existing.deliveryPinId || existing.deliverySummary?.deliveryPinId)
      ) {
        return { status: 'duplicate_delivered', record: existing };
      }
      if (matches && existing.state === 'fulfilling') {
        return { status: 'in_progress', record: existing };
      }
      const record = {
        role: 'seller',
        ...existing,
        ...input,
        paymentVerified: null,
        fulfillmentState: 'fulfilling',
        deliveryPinId: null,
        deliverySummary: null,
        failureReason: null,
        state: 'fulfilling',
        orderTxid: existing?.orderTxid ?? input.orderTxid,
      };
      state.orders.set(input.productOrderPinId, record);
      state.upsertedSellerOrders.push(record);
      return { status: 'claimed', record };
    },
    async upsertOwnedListing(input) {
      const record = {
        source: 'ownedListings',
        item: {
          listingPinId: input.listingPinId,
          payload: input.payload,
          localMetabotSlug: input.localMetabotSlug ?? null,
          fulfillmentSkills: input.payload.fulfillment.fulfillmentSkills,
        },
      };
      state.listings.set(input.listingPinId, record);
      state.upsertedOwnedListings.push(input);
      return record.item;
    },
    async upsertDirectoryItem(input) {
      const record = {
        source: 'directoryCache',
        item: {
          listingPinId: input.listingPinId,
          payload: input.payload,
          sellerGlobalMetaId: input.sellerGlobalMetaId ?? null,
          sellerMvcAddress: input.sellerMvcAddress ?? null,
          fulfillmentSkills: input.payload.fulfillment.fulfillmentSkills,
        },
      };
      state.listings.set(input.listingPinId, record);
      state.upsertedDirectoryItems.push(input);
      return record.item;
    },
  };
}

function createChainFetcher(overrides = {}) {
  const calls = [];
  return {
    calls,
    async fetchProductOrderPin(pinId) {
      calls.push(['order', pinId]);
      if (Object.hasOwn(overrides, 'orderPin')) return overrides.orderPin;
      return chainPin({
        pinId,
        path: '/protocols/product-order',
        payload: productOrder(),
        creatorGlobalMetaId: BUYER_GLOBAL_META_ID,
      });
    },
    async fetchProductListingPin(pinId) {
      calls.push(['listing', pinId]);
      if (Object.hasOwn(overrides, 'listingPin')) return overrides.listingPin;
      return chainPin({
        pinId,
        path: '/protocols/product-listing',
        payload: productListing(),
        creatorGlobalMetaId: SELLER_GLOBAL_META_ID,
        creatorAddress: SELLER_MVC_ADDRESS,
      });
    },
  };
}

function localSeller(overrides = {}) {
  return {
    globalMetaId: SELLER_GLOBAL_META_ID,
    name: 'Seller Bot',
    mvcAddress: SELLER_MVC_ADDRESS,
    addresses: {
      mvc: SELLER_MVC_ADDRESS,
      btc: 'seller-btc-address',
    },
    ...overrides,
  };
}

function cachedBuyerOrder(overrides = {}) {
  return {
    role: 'buyer',
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId: 'sku2',
    paymentTxid: 'b'.repeat(64),
    orderTxid: '2'.repeat(64),
    sellerGlobalMetaId: SELLER_GLOBAL_META_ID,
    buyerGlobalMetaId: BUYER_GLOBAL_META_ID,
    state: 'notified',
    ...overrides,
  };
}

function cachedSellerOrder(overrides = {}) {
  const skuId = overrides.skuId ?? 'sku2';
  const paymentTxid = overrides.paymentTxid ?? PAYMENT_TXID;
  return {
    role: 'seller',
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId,
    paymentTxid,
    productOrderPayload: productOrder({ skuId, paymentTxid }),
    orderTxid: ORDER_TXID,
    buyerGlobalMetaId: BUYER_GLOBAL_META_ID,
    state: 'created',
    fulfillmentState: 'created',
    fulfillmentSkills: [],
    paymentVerified: null,
    selectedSku: null,
    deliveryPinId: null,
    deliverySummary: null,
    failureReason: null,
    ...overrides,
  };
}

function cachedOwnedListing(payload = productListing()) {
  return {
    source: 'ownedListings',
    item: {
      listingPinId: LISTING_PIN_ID,
      localMetabotSlug: 'seller-bot',
      payload,
      fulfillmentSkills: payload.fulfillment.fulfillmentSkills,
    },
  };
}

function createFulfillmentHarness(seed = {}) {
  const store = createFakeProductStateStore(seed.store);
  const chainFetcher = createChainFetcher(seed.chain ?? {});
  const paymentVerifierCalls = [];
  const runnerCalls = [];
  const sent = [];
  const harness = {
    store,
    chainFetcher,
    paymentVerifierCalls,
    runnerCalls,
    sent,
    input: {
      productOrderPinId: PRODUCT_ORDER_PIN_ID,
      orderTxid: ORDER_TXID,
      buyer: {
        globalMetaId: BUYER_GLOBAL_META_ID,
        chatPublicKey: 'buyer-chat-public-key',
      },
      orderA2AMetadata: {
        messagePinId: `${ORDER_TXID}i0`,
        timestamp: 1_770_000_010_000,
      },
      localSeller: localSeller(),
      productStateStore: store,
      chainFetcher,
      paymentVerifier: async (input) => {
        paymentVerifierCalls.push(input);
        if (seed.paymentVerification) return seed.paymentVerification;
        return {
          verified: true,
          paymentTxid: input.paymentTxid,
          paymentChain: input.paymentChain,
          settlementKind: input.settlementKind,
          paymentAddress: input.paymentAddress,
          amount: input.amount,
          currency: input.currency,
          amountSatoshis: 5_000,
          matchedOutputIndex: 0,
          failureKind: null,
        };
      },
      fulfillmentRunner: async (input) => {
        runnerCalls.push(input);
        if (seed.runnerResult) return seed.runnerResult;
        return {
          state: 'completed',
          responseText: 'Card code: TOPUP-123456',
          metadata: { sessionId: 'fulfillment-session-1' },
        };
      },
      deliverySender: async (input) => {
        sent.push(input);
        return {
          pinId: input.content.startsWith('[DELIVERY:') ? 'delivery-pin-1' : 'needs-rating-pin-1',
          txids: [input.content.startsWith('[DELIVERY:') ? 'delivery-tx-1' : 'needs-rating-tx-1'],
        };
      },
      now: () => 1_770_000_000_000,
    },
  };
  harness.input.deliverySender = {
    send: harness.input.deliverySender,
  };
  return harness;
}

test('resolveProductOrderForSeller uses cached product-order before fetching chain', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder()],
    listings: [cachedOwnedListing()],
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.order.source, 'cache');
  assert.deepEqual(chainFetcher.calls, []);
});

test('resolveProductOrderForSeller uses seller cache when buyer cache has the same product-order pin', async () => {
  const store = createProductStateStore(await createTempProfileRoot());
  const sellerOrderPayload = productOrder({ comment: 'seller cache payload' });
  await store.upsertOwnedListing({
    listingPinId: LISTING_PIN_ID,
    payload: productListing(),
    available: true,
  });
  await store.upsertBuyerOrder(cachedBuyerOrder());
  await store.upsertSellerOrder({
    ...cachedSellerOrder(),
    productOrderPayload: sellerOrderPayload,
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.order.source, 'cache');
  assert.deepEqual(result.order.payload, sellerOrderPayload);
  assert.deepEqual(chainFetcher.calls, []);
});

test('resolveProductOrderForSeller fetches and persists product-order on cache miss', async () => {
  const store = createFakeProductStateStore({
    listings: [cachedOwnedListing()],
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.order.source, 'chain');
  assert.deepEqual(chainFetcher.calls, [['order', PRODUCT_ORDER_PIN_ID]]);
  assert.equal(store.state.upsertedSellerOrders[0].productOrderPinId, PRODUCT_ORDER_PIN_ID);
  assert.equal(store.state.upsertedSellerOrders[0].buyerGlobalMetaId, BUYER_GLOBAL_META_ID);
});

test('resolveProductOrderForSeller uses cached listing before fetching chain listing', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder()],
    listings: [cachedOwnedListing()],
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.listing.source, 'cache');
  assert.deepEqual(chainFetcher.calls, []);
});

test('resolveProductOrderForSeller fetches and persists listing on cache miss', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder()],
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.listing.source, 'chain');
  assert.deepEqual(chainFetcher.calls, [['listing', LISTING_PIN_ID]]);
  assert.equal(store.state.upsertedOwnedListings[0].listingPinId, LISTING_PIN_ID);
});

test('resolveProductOrderForSeller rejects listings not owned by the local seller bot', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder()],
  });
  const chainFetcher = createChainFetcher({
    listingPin: chainPin({
      pinId: LISTING_PIN_ID,
      path: '/protocols/product-listing',
      payload: productListing(),
      creatorGlobalMetaId: 'idq1other-seller',
      creatorAddress: 'other-address',
    }),
  });

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_listing_not_owned');
});

test('resolveProductOrderForSeller rejects missing SKU', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder({ skuId: 'missing-sku' })],
    listings: [cachedOwnedListing()],
  });
  const chainFetcher = createChainFetcher();

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_sku_not_found');
});

test('fulfillProductOrderForSeller verifies payment against seller address and SKU price', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.paymentVerifierCalls.length, 1);
  assert.equal(harness.paymentVerifierCalls[0].paymentTxid, PAYMENT_TXID);
  assert.equal(harness.paymentVerifierCalls[0].paymentAddress, SELLER_MVC_ADDRESS);
  assert.equal(harness.paymentVerifierCalls[0].amount, '0.00005');
  assert.equal(harness.paymentVerifierCalls[0].currency, 'SPACE');
  assert.equal(harness.paymentVerifierCalls[0].paymentChain, 'mvc');
});

test('fulfillProductOrderForSeller passes every fulfillment skill and product-order context into the round', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.runnerCalls.length, 1);
  assert.deepEqual(harness.runnerCalls[0].fulfillmentSkills, ['deliver-topup-card', 'audit-stock']);
  assert.deepEqual(harness.runnerCalls[0].context.fulfillmentSkills, ['deliver-topup-card', 'audit-stock']);
  assert.equal(harness.runnerCalls[0].context.productOrder.pinId, PRODUCT_ORDER_PIN_ID);
  assert.equal(harness.runnerCalls[0].context.productOrder.pin.pinId, PRODUCT_ORDER_PIN_ID);
  assert.equal(harness.runnerCalls[0].context.productOrder.pin.path, '/protocols/product-order');
  assert.deepEqual(harness.runnerCalls[0].context.productOrder.payload, productOrder());
  assert.equal(harness.runnerCalls[0].context.productListing.pinId, LISTING_PIN_ID);
  assert.equal(harness.runnerCalls[0].context.productListing.pin.pinId, LISTING_PIN_ID);
  assert.equal(harness.runnerCalls[0].context.productListing.pin.path, '/protocols/product-listing');
  assert.equal(harness.runnerCalls[0].context.selectedSku.skuId, 'sku2');
  assert.equal(harness.runnerCalls[0].context.buyer.globalMetaId, BUYER_GLOBAL_META_ID);
  assert.equal(harness.runnerCalls[0].context.orderA2AMetadata.messagePinId, `${ORDER_TXID}i0`);
  assert.equal(harness.runnerCalls[0].context.payment.verified, true);
});

test('fulfillProductOrderForSeller sends delivery and persists delivered seller order state', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.sent.length, 2);
  assert.match(harness.sent[0].content, new RegExp(`^\\[DELIVERY:${ORDER_TXID}\\] `));
  const deliveryPayload = JSON.parse(harness.sent[0].content.replace(/^\[[^\]]+\]\s*/, ''));
  assert.deepEqual(deliveryPayload, {
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    listingPinId: LISTING_PIN_ID,
    skuId: 'sku2',
    paymentTxid: PAYMENT_TXID,
    result: 'Card code: TOPUP-123456',
    deliveredAt: 1_770_000_000_000,
  });
  assert.match(harness.sent[1].content, new RegExp(`^\\[NeedsRating:${ORDER_TXID}\\]`));
  const persisted = harness.store.state.upsertedSellerOrders.at(-1);
  assert.equal(persisted.state, 'delivered');
  assert.equal(persisted.fulfillmentState, 'delivered');
  assert.equal(persisted.deliveryPinId, 'delivery-pin-1');
  assert.deepEqual(persisted.deliverySummary, {
    result: 'Card code: TOPUP-123456',
    deliveryPinId: 'delivery-pin-1',
    deliveredAt: 1_770_000_000_000,
  });
  assert.equal(persisted.failureReason, null);
  assert.deepEqual(persisted.fulfillmentSkills, ['deliver-topup-card', 'audit-stock']);
});

test('fulfillProductOrderForSeller rejects inbound buyer mismatch before side effects', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
  });
  harness.input.buyer.globalMetaId = 'idq1attacker';

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_buyer_mismatch');
  assert.deepEqual(harness.paymentVerifierCalls, []);
  assert.deepEqual(harness.runnerCalls, []);
  assert.deepEqual(harness.sent, []);
  assert.equal(harness.store.state.upsertedSellerOrders.length, 0);
});

test('fulfillProductOrderForSeller rejects unsupported V1 fulfillment before side effects', async () => {
  const unsupportedListing = productListing({
    productType: 'physical',
    fulfillment: {
      fulfillmentType: 'physical_shipping',
      deliveryEndpoint: 'logistics',
      fulfillmentSkills: ['ship-physical-goods'],
      deliverableDescription: 'Physical shipping is not supported by product V1 seller fulfillment.',
    },
  });
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing(unsupportedListing)],
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_unsupported_fulfillment');
  assert.deepEqual(harness.paymentVerifierCalls, []);
  assert.deepEqual(harness.runnerCalls, []);
  assert.deepEqual(harness.sent, []);
  assert.equal(harness.store.state.upsertedSellerOrders.length, 0);
});

test('fulfillProductOrderForSeller returns duplicate success for already delivered seller order without side effects', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [
        cachedSellerOrder({
          orderTxid: ORDER_TXID,
          state: 'delivered',
          fulfillmentState: 'delivered',
          paymentVerified: true,
          deliveryPinId: 'existing-delivery-pin',
          deliverySummary: {
            result: 'Card code: EXISTING-123456',
            deliveryPinId: 'existing-delivery-pin',
            deliveredAt: 1_770_000_000_000,
          },
        }),
      ],
      listings: [cachedOwnedListing()],
    },
  });
  harness.input.orderTxid = REPLAY_ORDER_TXID;

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.deliveryPinId, 'existing-delivery-pin');
  assert.equal(result.data.result, 'Card code: EXISTING-123456');
  assert.equal(result.data.orderTxid, ORDER_TXID);
  assert.equal(result.data.ratingMessagePinId, null);
  assert.deepEqual(harness.paymentVerifierCalls, []);
  assert.deepEqual(harness.runnerCalls, []);
  assert.deepEqual(harness.sent, []);
});

test('fulfillProductOrderForSeller serializes concurrent replay fulfillment through seller order claim', async () => {
  const store = createProductStateStore(await createTempProfileRoot());
  await store.upsertOwnedListing({
    listingPinId: LISTING_PIN_ID,
    payload: productListing(),
    available: true,
  });
  await store.upsertSellerOrder(cachedSellerOrder());
  const chainFetcher = createChainFetcher();
  const paymentVerifierCalls = [];
  const runnerCalls = [];
  const sent = [];
  const input = {
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: {
      globalMetaId: BUYER_GLOBAL_META_ID,
      chatPublicKey: 'buyer-chat-public-key',
    },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
    paymentVerifier: async (verificationInput) => {
      paymentVerifierCalls.push(verificationInput);
      return {
        verified: true,
        paymentTxid: verificationInput.paymentTxid,
        paymentChain: verificationInput.paymentChain,
        settlementKind: verificationInput.settlementKind,
        paymentAddress: verificationInput.paymentAddress,
        amount: verificationInput.amount,
        currency: verificationInput.currency,
        amountSatoshis: 5_000,
        matchedOutputIndex: 0,
        failureKind: null,
      };
    },
    fulfillmentRunner: async (roundInput) => {
      runnerCalls.push(roundInput);
      await new Promise(resolve => {
        setTimeout(resolve, 50);
      });
      return {
        state: 'completed',
        responseText: 'Card code: TOPUP-CONCURRENT',
      };
    },
    deliverySender: {
      async send(sendInput) {
        sent.push(sendInput);
        await new Promise(resolve => {
          setTimeout(resolve, 25);
        });
        return {
          pinId: sendInput.content.startsWith('[DELIVERY:') ? 'delivery-pin-concurrent' : 'rating-pin-concurrent',
        };
      },
    },
    now: () => 1_770_000_000_000,
  };

  const results = await Promise.all([
    fulfillProductOrderForSeller(input),
    fulfillProductOrderForSeller({
      ...input,
      orderTxid: REPLAY_ORDER_TXID,
    }),
  ]);

  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(results[1].ok, true, JSON.stringify(results[1]));
  assert.equal(results[0].data.deliveryPinId, 'delivery-pin-concurrent');
  assert.equal(results[1].data.deliveryPinId, 'delivery-pin-concurrent');
  const claimedOrderTxid = results[0].data.orderTxid;
  assert.equal(results[1].data.orderTxid, claimedOrderTxid);
  assert.ok([ORDER_TXID, REPLAY_ORDER_TXID].includes(claimedOrderTxid));
  assert.equal(paymentVerifierCalls.length, 1);
  assert.equal(runnerCalls.length, 1);
  assert.equal(sent.filter(entry => entry.content.startsWith(`[DELIVERY:${claimedOrderTxid}]`)).length, 1);
  assert.equal(sent.filter(entry => entry.content.startsWith(`[NeedsRating:${claimedOrderTxid}]`)).length, 1);
  assert.equal(sent.filter(entry => entry.content.startsWith(`[DELIVERY:${claimedOrderTxid === ORDER_TXID ? REPLAY_ORDER_TXID : ORDER_TXID}]`)).length, 0);
  assert.equal(sent.filter(entry => entry.content.startsWith(`[NeedsRating:${claimedOrderTxid === ORDER_TXID ? REPLAY_ORDER_TXID : ORDER_TXID}]`)).length, 0);
});

test('fulfillProductOrderForSeller rejects invalid order txid before sending delivery', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
  });
  harness.input.orderTxid = 'not-a-valid-order-txid';

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_product_order_protocol');
  assert.deepEqual(harness.sent, []);
});

test('resolveProductOrderForSeller returns product_order_not_found for missing chain product-order pin', async () => {
  const store = createFakeProductStateStore();
  const chainFetcher = createChainFetcher({ orderPin: null });

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_order_not_found');
});

test('resolveProductOrderForSeller returns invalid_product_order_protocol for invalid chain product-order pin', async () => {
  const store = createFakeProductStateStore();
  const chainFetcher = createChainFetcher({
    orderPin: chainPin({
      pinId: PRODUCT_ORDER_PIN_ID,
      path: '/protocols/not-product-order',
      payload: productOrder(),
      creatorGlobalMetaId: BUYER_GLOBAL_META_ID,
    }),
  });

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_product_order_protocol');
});

test('resolveProductOrderForSeller returns product_listing_not_found for missing listing pin', async () => {
  const store = createFakeProductStateStore({
    orders: [cachedSellerOrder()],
  });
  const chainFetcher = createChainFetcher({ listingPin: null });

  const result = await resolveProductOrderForSeller({
    productOrderPinId: PRODUCT_ORDER_PIN_ID,
    orderTxid: ORDER_TXID,
    buyer: { globalMetaId: BUYER_GLOBAL_META_ID },
    localSeller: localSeller(),
    productStateStore: store,
    chainFetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_listing_not_found');
});

test('fulfillProductOrderForSeller returns product_payment_invalid when payment verification fails', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
    paymentVerification: {
      verified: false,
      paymentTxid: PAYMENT_TXID,
      paymentChain: 'mvc',
      settlementKind: 'native',
      paymentAddress: SELLER_MVC_ADDRESS,
      amount: '0.00005',
      currency: 'SPACE',
      amountSatoshis: 5_000,
      matchedOutputIndex: null,
      failureKind: 'output_mismatch',
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_payment_invalid');
  const persisted = harness.store.state.upsertedSellerOrders.at(-1);
  assert.equal(persisted.state, 'failed');
  assert.equal(persisted.failureReason, 'product_payment_invalid');
});

test('fulfillProductOrderForSeller returns product_fulfillment_failed when the fulfillment round fails', async () => {
  const harness = createFulfillmentHarness({
    store: {
      orders: [cachedSellerOrder()],
      listings: [cachedOwnedListing()],
    },
    runnerResult: {
      state: 'failed',
      code: 'runtime_unavailable',
      message: 'No runtime is available.',
    },
  });

  const result = await fulfillProductOrderForSeller(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_fulfillment_failed');
  assert.equal(result.message, 'No runtime is available.');
  const persisted = harness.store.state.upsertedSellerOrders.at(-1);
  assert.equal(persisted.state, 'failed');
  assert.equal(persisted.failureReason, 'product_fulfillment_failed');
});
