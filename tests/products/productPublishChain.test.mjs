import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  executeProductPurchase,
  publishProductListingToChain,
  publishProductOrderToChain,
} = require('../../dist/core/products/productPublishChain.js');

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
      fulfillmentSkills: ['S1', 'S2'],
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
    sellerMetaBot: 'must-not-leak',
    sellerName: 'must-not-leak',
    sellerPaymentAddress: 'must-not-leak',
    paymentChain: 'mvc',
    settlementKind: 'native',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    descriptionUri: 'metafile://must-not-leak.md',
    reviewPolicy: { required: true },
    ...overrides,
  };
}

function productOrder(overrides = {}) {
  return {
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    settlementKind: 'native',
    paymentTxid: 'a'.repeat(64),
    comment: 'Please send to the default account.',
    price: '0.00005',
    currency: 'SPACE',
    sellerMetaId: 'must-not-leak',
    sellerName: 'must-not-leak',
    buyerMetaId: 'must-not-leak',
    buyerName: 'must-not-leak',
    fulfillmentState: 'pending',
    reviewState: 'pending',
    snapshot: { title: 'must-not-leak' },
    paymentChain: 'mvc',
    sellerPaymentAddress: 'must-not-leak',
    ...overrides,
  };
}

function directoryProduct(overrides = {}) {
  return {
    listingPinId: 'listing-pin-id',
    name: 'mobile top-up card',
    title: 'Mobile Top-Up Card Pack',
    productType: 'virtual',
    skuCount: 2,
    skus: [
      {
        skuId: 'space-00001',
        name: 'Small Top-Up Card',
        image: 'metafile://sku_1.png',
        descriptionContentType: 'text/markdown',
        description: 'Small mobile top-up card.',
        price: { amount: '0.00001', currency: 'SPACE' },
        initialStock: 100,
      },
      {
        skuId: 'space-00005',
        name: 'Large Top-Up Card',
        image: 'metafile://sku_2.png',
        descriptionContentType: 'text/markdown',
        description: 'Large mobile top-up card.',
        price: { amount: '0.00005', currency: 'SPACE' },
        initialStock: 100,
      },
    ],
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['fulfill-card', 'support-card'],
    },
    payload: productListing({
      skus: [
        {
          skuId: 'space-00001',
          name: 'Small Top-Up Card',
          image: 'metafile://sku_1.png',
          descriptionContentType: 'text/markdown',
          description: 'Small mobile top-up card.',
          price: { amount: '0.00001', currency: 'SPACE' },
          initialStock: 100,
        },
        {
          skuId: 'space-00005',
          name: 'Large Top-Up Card',
          image: 'metafile://sku_2.png',
          descriptionContentType: 'text/markdown',
          description: 'Large mobile top-up card.',
          price: { amount: '0.00005', currency: 'SPACE' },
          initialStock: 100,
        },
      ],
    }),
    sellerGlobalMetaId: 'seller-global-metaid',
    sellerName: 'Seller Bot',
    sellerMvcAddress: 'seller-derived-mvc-address',
    sellerChatPublicKey: 'seller-chat-public-key',
    online: true,
    cachedAt: 1770000000000,
    ...overrides,
  };
}

function createExecutionHarness(options = {}) {
  const calls = [];
  const persisted = [];
  return {
    calls,
    persisted,
    input: {
      request: {
        listingPinId: 'listing-pin-id',
        skuId: 'space-00005',
        comment: 'Please deliver to my default account.',
        confirmed: true,
      },
      products: [directoryProduct(options.product ?? {})],
      buyerIdentity: {
        globalMetaId: 'buyer-global-metaid',
        name: 'Buyer Bot',
      },
      resolveSellerIdentity: async ({ product }) => ({
        globalMetaId: product.sellerGlobalMetaId,
        name: product.sellerName,
        mvcAddress: product.sellerMvcAddress,
        chatPublicKey: product.sellerChatPublicKey,
      }),
      paymentExecutor: {
        async execute(paymentInput) {
          calls.push(['payment', paymentInput]);
          if (options.paymentError) throw options.paymentError;
          return {
            paymentTxid: 'payment-txid-1',
            paymentAmount: paymentInput.amount,
            paymentCurrency: paymentInput.currency,
            paymentChain: paymentInput.paymentChain,
            settlementKind: paymentInput.settlementKind,
            network: paymentInput.paymentChain,
          };
        },
      },
      productOrderPublisher: {
        async publish(orderInput) {
          calls.push(['product-order', orderInput]);
          return {
            payload: orderInput.payload,
            chainWrite: {
              txids: ['product-order-write-txid-1'],
              pinId: 'product-order-pin-1',
              totalCost: 1,
              network: orderInput.network,
              operation: 'create',
              path: '/protocols/product-order',
              contentType: 'application/json',
              encoding: 'utf-8',
              globalMetaId: 'buyer-global-metaid',
              mvcAddress: 'buyer-mvc-address',
            },
          };
        },
      },
      simplemsgSender: {
        async send(messageInput) {
          calls.push(['simplemsg', messageInput]);
          return {
            orderTxid: 'simplemsg-order-txid-1',
            txids: ['simplemsg-order-txid-1'],
            pinId: 'simplemsg-pin-1',
          };
        },
      },
      productStateStore: {
        async upsertBuyerOrder(record) {
          persisted.push(record);
          return record;
        },
      },
      traceId: 'trace-product-order-1',
      sessionId: 'session-product-order-1',
      localUiUrl: 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1',
    },
  };
}

test('publishProductListingToChain writes only the product-listing protocol payload', async () => {
  const writes = [];

  const result = await publishProductListingToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['listing-txid'],
          pinId: 'listing-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-listing',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'seller-global-metaid',
          mvcAddress: '1seller',
        };
      },
    },
    payload: productListing(),
    network: 'mvc',
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/product-listing');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].network, 'mvc');

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(payload.fulfillment.fulfillmentSkills, ['S1', 'S2']);
  assert.equal(payload.sellerMetaBot, undefined);
  assert.equal(payload.sellerName, undefined);
  assert.equal(payload.sellerPaymentAddress, undefined);
  assert.equal(payload.paymentChain, undefined);
  assert.equal(payload.createdAt, undefined);
  assert.equal(payload.updatedAt, undefined);
  assert.equal(payload.descriptionUri, undefined);
  assert.equal(payload.reviewPolicy, undefined);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.chainWrite.pinId, 'listing-pin-id');
});

test('publishProductOrderToChain writes only the product-order protocol payload', async () => {
  const writes = [];

  const result = await publishProductOrderToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['order-txid'],
          pinId: 'product-order-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-order',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'buyer-global-metaid',
          mvcAddress: '1buyer',
        };
      },
    },
    payload: productOrder(),
    network: 'mvc',
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/product-order');
  assert.equal(writes[0].contentType, 'application/json');

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(Object.keys(payload), [
    'listingPinId',
    'skuId',
    'settlementKind',
    'paymentTxid',
    'comment',
  ]);
  assert.deepEqual(payload, {
    listingPinId: 'listing-pin-id',
    skuId: 'sku2',
    settlementKind: 'native',
    paymentTxid: 'a'.repeat(64),
    comment: 'Please send to the default account.',
  });
  assert.equal(payload.price, undefined);
  assert.equal(payload.currency, undefined);
  assert.equal(payload.sellerMetaId, undefined);
  assert.equal(payload.buyerMetaId, undefined);
  assert.equal(payload.fulfillmentState, undefined);
  assert.equal(payload.reviewState, undefined);
  assert.equal(payload.snapshot, undefined);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.chainWrite.pinId, 'product-order-pin-id');
});

test('publishProductOrderToChain omits optional fields when they are not provided', async () => {
  const writes = [];

  await publishProductOrderToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['order-txid'],
          pinId: 'product-order-pin-id',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/product-order',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'buyer-global-metaid',
          mvcAddress: '1buyer',
        };
      },
    },
    payload: productOrder({ settlementKind: undefined, comment: undefined }),
  });

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(Object.keys(payload), ['listingPinId', 'skuId', 'paymentTxid']);
});

test('executeProductPurchase pays before product-order publish and notifies seller after publish', async () => {
  const harness = createExecutionHarness();

  const result = await executeProductPurchase(harness.input);

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.map(([name]) => name), ['payment', 'product-order', 'simplemsg']);
  assert.equal(harness.calls[0][1].toAddress, 'seller-derived-mvc-address');
  assert.equal(harness.calls[0][1].amount, '0.00005');
  assert.equal(harness.calls[0][1].currency, 'SPACE');
  assert.equal(harness.calls[0][1].paymentChain, 'mvc');
  assert.equal(harness.calls[0][1].settlementKind, 'native');
  assert.deepEqual(harness.calls[1][1].payload, {
    listingPinId: 'listing-pin-id',
    skuId: 'space-00005',
    settlementKind: 'native',
    paymentTxid: 'payment-txid-1',
    comment: 'Please deliver to my default account.',
  });
  assert.equal(harness.calls[2][1].toGlobalMetaId, 'seller-global-metaid');
  assert.match(harness.calls[2][1].content, /^\[ORDER\]\s+\[PRODUCT_ORDER\]/);
  assert.equal(result.data.traceId, 'trace-product-order-1');
  assert.equal(result.data.productOrderPinId, 'product-order-pin-1');
  assert.equal(result.data.paymentTxid, 'payment-txid-1');
  assert.equal(result.data.orderTxid, 'simplemsg-order-txid-1');
  assert.equal(result.data.localUiUrl, 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1');
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.persisted[0].productOrderPinId, 'product-order-pin-1');
  assert.equal(harness.persisted[0].sellerGlobalMetaId, 'seller-global-metaid');
  assert.equal(harness.persisted[0].buyerGlobalMetaId, 'buyer-global-metaid');
  assert.equal(harness.persisted[0].traceId, 'trace-product-order-1');
  assert.equal(harness.persisted[0].sessionId, 'session-product-order-1');
  assert.equal(harness.persisted[0].state, 'notified');
});

test('executeProductPurchase does not publish product-order when payment fails', async () => {
  const harness = createExecutionHarness({
    paymentError: new Error('insufficient_balance: wallet cannot cover product payment'),
  });

  const result = await executeProductPurchase(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient_balance');
  assert.deepEqual(harness.calls.map(([name]) => name), ['payment']);
  assert.deepEqual(harness.persisted, []);
});

test('executeProductPurchase does not pay when planner rejects an offline product', async () => {
  const harness = createExecutionHarness({
    product: { online: false },
  });

  const result = await executeProductPurchase(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_offline');
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.persisted, []);
});

test('executeProductPurchase rejects unsupported native settlement before payment', async () => {
  const harness = createExecutionHarness({
    product: {
      skus: [
        {
          skuId: 'space-00005',
          name: 'DOGE Top-Up Card',
          image: 'metafile://sku_2.png',
          descriptionContentType: 'text/markdown',
          description: 'DOGE mobile top-up card.',
          price: { amount: '1', currency: 'DOGE' },
          initialStock: 100,
        },
      ],
      payload: productListing({
        skus: [
          {
            skuId: 'space-00005',
            name: 'DOGE Top-Up Card',
            image: 'metafile://sku_2.png',
            descriptionContentType: 'text/markdown',
            description: 'DOGE mobile top-up card.',
            price: { amount: '1', currency: 'DOGE' },
            initialStock: 100,
          },
        ],
      }),
    },
  });

  const result = await executeProductPurchase(harness.input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_payment_unsupported_settlement');
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.persisted, []);
});
