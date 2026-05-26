import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
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
  const physicalModel = buildProductCommercePageViewModel({
    products: [
      {
        listingPinId: 'listing-pin-physical',
        title: 'Paper Manual',
        sellerName: 'Alice Bot',
        productType: 'physical',
        fulfillment: {
          fulfillmentType: 'physical_shipping',
          deliveryEndpoint: 'logistics',
        },
        online: true,
        skus: [{ skuId: 'sku-physical', price: { amount: '0.5', currency: 'SPACE' } }],
      },
    ],
  });

  assert.equal(physicalModel.productRows[0].canPurchase, false);
  assert.match(physicalModel.productRows[0].blockedReason, /physical/i);

  const logisticsModel = buildProductCommercePageViewModel({
    products: [
      {
        listingPinId: 'listing-pin-logistics',
        title: 'Courier Bundle',
        sellerName: 'Alice Bot',
        productType: 'virtual',
        fulfillment: {
          fulfillmentType: 'digital_delivery',
          deliveryEndpoint: 'logistics',
        },
        online: true,
        skus: [{ skuId: 'sku-logistics', price: { amount: '0.5', currency: 'SPACE' } }],
      },
    ],
  });

  assert.equal(logisticsModel.productRows[0].canPurchase, false);
  assert.match(logisticsModel.productRows[0].blockedReason, /simplemsg/i);
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
      galleryImages: ['metafile://gallery-pin-1', 'https://example.com/gallery.png'],
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
  }), /galleryImages.*metafile/i);
  assert.throws(() => buildProductCommercePageViewModel({
    skillCatalog: ['skill-a'],
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
      skuImage: 'https://example.com/sku.png',
      skuDescriptionContentType: 'text/markdown',
      skuDescription: 'Fast',
      priceAmount: '0.005',
      priceCurrency: 'SPACE',
      initialStock: '5',
    },
  }), /SKU image.*metafile/i);
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
      initialStock: '-1',
    },
  }), /stock/i);
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
      initialStock: '',
    },
  }), /stock/i);
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

test('buildProductCommercePageViewModelRuntimeSource executes in a vm context and builds a listing preview payload', () => {
  const source = buildProductCommercePageViewModelRuntimeSource();
  const sandbox = {
    Array,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Set,
    String,
    URL,
    decodeURIComponent,
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.buildProductCommercePageViewModel = buildProductCommercePageViewModel;`, sandbox);
  const model = sandbox.buildProductCommercePageViewModel({
    skillCatalog: ['skill-a', 'skill-b'],
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

  assert.equal(model.listingPreviewPayload.fulfillment.fulfillmentType, 'digital_delivery');
  assert.equal(model.listingPreviewPayload.skus[0].initialStock, 5);
});

test('buildProductCommercePageViewModel builds Product V1 listing payload with multiple selected fulfillment skills and SKUs', () => {
  const model = buildProductCommercePageViewModel({
    skillCatalog: ['deliver-code', 'notify-buyer', 'ignore-me'],
    listingForm: {
      name: 'mobile-credit',
      title: 'Mobile Credit',
      coverImage: 'metafile://cover-pin',
      galleryImages: ['metafile://gallery-a', 'metafile://gallery-b'],
      descriptionContentType: 'text/markdown',
      description: 'Digital mobile credit.',
      fulfillmentSkills: ['deliver-code', 'notify-buyer'],
      fulfillmentType: 'physical_shipping',
      deliveryEndpoint: 'logistics',
      estimatedDeliverySeconds: '60',
      deliverableDescription: 'Activation code sent by simplemsg.',
      skus: [
        {
          skuId: 'sku-5',
          name: '5 SPACE credit',
          image: 'metafile://sku-five',
          descriptionContentType: 'text/markdown',
          description: 'Small top-up.',
          price: { amount: '5', currency: 'space' },
          initialStock: '10',
        },
        {
          skuId: 'sku-10',
          name: '10 SPACE credit',
          image: 'metafile://sku-ten',
          descriptionContentType: 'text/html',
          description: '<p>Larger top-up.</p>',
          price: { amount: '10', currency: 'SPACE' },
          initialStock: 3,
        },
      ],
    },
  });

  assert.deepEqual(model.listingPreviewPayload, {
    name: 'mobile-credit',
    title: 'Mobile Credit',
    productType: 'virtual',
    coverImage: 'metafile://cover-pin',
    galleryImages: ['metafile://gallery-a', 'metafile://gallery-b'],
    descriptionContentType: 'text/markdown',
    description: 'Digital mobile credit.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['deliver-code', 'notify-buyer'],
      estimatedDeliverySeconds: 60,
      deliverableDescription: 'Activation code sent by simplemsg.',
    },
    skus: [
      {
        skuId: 'sku-5',
        name: '5 SPACE credit',
        image: 'metafile://sku-five',
        descriptionContentType: 'text/markdown',
        description: 'Small top-up.',
        price: { amount: '5', currency: 'SPACE' },
        initialStock: 10,
      },
      {
        skuId: 'sku-10',
        name: '10 SPACE credit',
        image: 'metafile://sku-ten',
        descriptionContentType: 'text/html',
        description: '<p>Larger top-up.</p>',
        price: { amount: '10', currency: 'SPACE' },
        initialStock: 3,
      },
    ],
  });
});

test('buildProductCommercePageViewModel enforces listing form validation and excludes non-Product-V1 fields', () => {
  const baseListingForm = {
    name: 'mobile-credit',
    title: 'Mobile Credit',
    coverImage: 'metafile://cover-pin',
    galleryImages: ['metafile://gallery-a'],
    descriptionContentType: 'text/markdown',
    description: 'Digital mobile credit.',
    fulfillmentSkills: ['deliver-code'],
    fulfillmentType: 'digital_delivery',
    deliveryEndpoint: 'simplemsg',
    skus: [
      {
        skuId: 'sku-5',
        name: '5 SPACE credit',
        image: 'metafile://sku-five',
        descriptionContentType: 'text/markdown',
        description: 'Small top-up.',
        price: { amount: '5', currency: 'SPACE' },
        initialStock: '10',
        sellerPaymentAddress: 'forbidden',
        shippingPolicy: 'forbidden',
        reviewPolicy: 'forbidden',
        mrc20: { tick: 'BAD' },
      },
    ],
    sellerGlobalMetaId: 'forbidden',
    paymentAddress: 'forbidden',
    createdAt: 123,
    shipping: { method: 'forbidden' },
    review: { enabled: true },
    mrc20: { tick: 'BAD' },
  };
  const build = (override) => buildProductCommercePageViewModel({
    skillCatalog: ['deliver-code'],
    listingForm: { ...baseListingForm, ...override },
  });

  for (const field of ['name', 'title', 'description']) {
    assert.throws(() => build({ [field]: '' }), new RegExp(field));
  }
  assert.throws(() => build({ coverImage: 'https://example.com/cover.png' }), /coverImage.*metafile/i);
  assert.throws(() => build({ galleryImages: ['metafile://gallery-a', 'https://example.com/bad.png'] }), /galleryImages.*metafile/i);
  assert.throws(() => build({ descriptionContentType: 'application/json' }), /descriptionContentType.*text\/markdown.*text\/html/i);
  assert.throws(() => build({ skus: [] }), /skus.*at least one SKU/i);
  assert.throws(() => build({ skus: [{ ...baseListingForm.skus[0], price: { amount: '', currency: 'SPACE' } }] }), /price.*amount.*currency/i);
  assert.throws(() => build({ skus: [{ ...baseListingForm.skus[0], price: { amount: '5', currency: '' } }] }), /price.*amount.*currency/i);
  assert.throws(() => build({ skus: [{ ...baseListingForm.skus[0], image: 'https://example.com/sku.png' }] }), /SKU image.*metafile/i);
  assert.throws(() => build({ skus: [{ ...baseListingForm.skus[0], initialStock: 'Infinity' }] }), /stock/i);
  assert.throws(() => build({ skus: [{ ...baseListingForm.skus[0], initialStock: '0' }] }), /stock/i);

  const payload = build({
    productType: 'physical',
    fulfillmentType: 'physical_shipping',
    deliveryEndpoint: 'logistics',
  }).listingPreviewPayload;
  assert.equal(payload.productType, 'virtual');
  assert.equal(payload.fulfillment.fulfillmentType, 'digital_delivery');
  assert.equal(payload.fulfillment.deliveryEndpoint, 'simplemsg');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'sellerGlobalMetaId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'paymentAddress'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'createdAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'shipping'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'review'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'mrc20'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.skus[0], 'sellerPaymentAddress'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.skus[0], 'shippingPolicy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.skus[0], 'reviewPolicy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.skus[0], 'mrc20'), false);
});
