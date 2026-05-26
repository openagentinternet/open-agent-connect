import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildProductCommercePageViewModel,
  buildProductCommercePageViewModelRuntimeSource,
} = require('../../dist/ui/pages/products/viewModel.js');

test('buildProductCommercePageViewModel renders product rows with seller, stock, price, and preview data', () => {
  const model = buildProductCommercePageViewModel({
    products: [
      {
        listingPinId: 'listing-pin-1',
        title: 'Signal Pack',
        sellerName: 'Alice Bot',
        online: true,
        skus: [
          {
            skuId: 'sku-basic',
            price: { amount: '0.00010', currency: 'SPACE' },
          },
        ],
        coverImage: 'metafile://cover-pin-1',
      },
    ],
  });

  assert.equal(model.productRows.length, 1);
  assert.equal(model.productRows[0].title, 'Signal Pack');
  assert.equal(model.productRows[0].sellerLabel, 'Alice Bot');
  assert.equal(model.productRows[0].onlineStateLabel, 'Online');
  assert.equal(model.productRows[0].skuCountLabel, '1 SKU');
  assert.equal(model.productRows[0].firstPriceLabel, '0.00010 SPACE');
  assert.equal(model.productRows[0].coverPreviewUri, '/api/file/avatar?ref=cover-pin-1');
});

test('buildProductCommercePageViewModel disables unsupported physical and logistics products for purchase', () => {
  const model = buildProductCommercePageViewModel({
    products: [
      {
        listingPinId: 'listing-pin-physical',
        title: 'Paper Manual',
        sellerName: 'Alice Bot',
        productType: 'physical',
        fulfillmentType: 'shipping',
        online: true,
        skus: [{ skuId: 'sku-physical', price: { amount: '0.5', currency: 'SPACE' } }],
      },
    ],
  });

  assert.equal(model.productRows[0].canPurchase, false);
  assert.match(model.productRows[0].blockedReason, /physical/i);
});

test('buildProductCommercePageViewModel builds purchase preview and listing payload projections', () => {
  const model = buildProductCommercePageViewModel({
    selectedListing: {
      listingPinId: 'listing-pin-1',
      skus: [
        {
          skuId: 'sku-premium',
          price: { amount: '0.002', currency: 'SPACE' },
        },
      ],
    },
    purchaseSelection: {
      listingPinId: 'listing-pin-1',
      skuId: 'sku-premium',
      spendCap: '0.005',
      comment: 'Ship fast',
    },
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'metafile://cover-pin-1',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-a'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '5',
    },
  });

  assert.deepEqual(model.purchasePreviewRequest, {
    confirmed: false,
    listingPinId: 'listing-pin-1',
    skuId: 'sku-premium',
    spendCap: '0.005',
    comment: 'Ship fast',
  });
  assert.equal(model.listingPreviewPayload.productType, 'virtual');
  assert.equal(model.listingPreviewPayload.fulfillment.fulfillmentType, 'digital_delivery');
  assert.equal(model.listingPreviewPayload.fulfillment.deliveryEndpoint, 'simplemsg');
});

test('buildProductCommercePageViewModel rejects invalid listing media and unknown fulfillment skills', () => {
  assert.throws(() => buildProductCommercePageViewModel({
    skillCatalog: ['skill-a'],
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'https://example.com/cover.png',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-b'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '5',
    },
  }), /metafile/i);
  assert.throws(() => buildProductCommercePageViewModel({
    skillCatalog: ['skill-a'],
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'metafile://cover-pin-1',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-b'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '5',
    },
  }), /unknown fulfillment skill/i);
});

test('buildProductCommercePageViewModel rejects invalid SKU stock and accepts large finite stock', () => {
  const invalid = () => buildProductCommercePageViewModel({
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'metafile://cover-pin-1',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-a'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '0',
    },
  });
  assert.throws(invalid, /stock/i);
  assert.throws(() => buildProductCommercePageViewModel({
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'metafile://cover-pin-1',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-a'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '1.5',
    },
  }), /stock/i);
  assert.equal(buildProductCommercePageViewModel({
    listingForm: {
      name: 'signal-pack',
      title: 'Signal Pack',
      coverImage: 'metafile://cover-pin-1',
      galleryImages: ['metafile://gallery-pin-1'],
      descriptionContentType: 'text/markdown',
      description: 'Read me',
      fulfillmentSkills: ['skill-a'],
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      skuId: 'sku-premium',
      skuName: 'Premium',
      skuImage: 'metafile://sku-pin-1',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '99999999',
    },
  }).listingPreviewPayload.skus[0].initialStock, 99999999);
});

test('buildProductCommercePageViewModel strips raw delivery body fields and keeps all fulfillment skills visible', () => {
  const model = buildProductCommercePageViewModel({
    orderRows: [
      {
        orderId: 'order-1',
        state: 'delivered',
        deliveryBody: 'secret',
        decryptedDeliveryBody: 'secret too',
      },
    ],
    skillCatalog: ['skill-a', 'skill-b'],
  });

  assert.equal(Object.prototype.hasOwnProperty.call(model.orderRows[0], 'deliveryBody'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(model.orderRows[0], 'decryptedDeliveryBody'), false);
  assert.equal(model.fulfillmentLabel, 'All fulfillment skills available: skill-a, skill-b');
});

test('buildProductCommercePageViewModelRuntimeSource produces browser-compatible helper source', () => {
  const source = buildProductCommercePageViewModelRuntimeSource();
  assert.match(source, /buildProductCommercePageViewModel/);
  assert.match(source, /normalizeMetafileUri/);
});
