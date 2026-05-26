import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildProductsPageDefinition } = require('../../dist/ui/pages/products/app.js');

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

class FakeElement {
  constructor(value = '') {
    this.textContent = '';
    this.value = value;
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.listeners = new Map();
    this.attrs = {};
    this.nodes = [];
    this.children = [];
    this.focused = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.nodes = [];
    const tagPattern = /<(button|input|select|textarea|option|tr)\b([^>]*)>/gu;
    for (const match of this._innerHTML.matchAll(tagPattern)) {
      const node = new FakeElement();
      node.tagName = match[1].toUpperCase();
      const attrs = match[2] || '';
      for (const attrMatch of attrs.matchAll(/\s([a-zA-Z0-9_-]+)(?:="([^"]*)")?/gu)) {
        node.attrs[attrMatch[1]] = decodeHtmlAttribute(attrMatch[2] || '');
        if (attrMatch[1] === 'disabled') node.disabled = true;
        if (attrMatch[1] === 'checked') node.checked = true;
        if (attrMatch[1] === 'value') node.value = node.attrs[attrMatch[1]];
        if (attrMatch[1].startsWith('data-')) {
          const key = attrMatch[1]
            .slice(5)
            .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
          node.dataset[key] = node.attrs[attrMatch[1]];
        }
      }
      this.nodes.push(node);
    }
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return this.attrs[name] || '';
  }

  toggleAttribute(name, force) {
    if (force) this.attrs[name] = '';
    else delete this.attrs[name];
  }

  appendChild(child) {
    this.children.push(child);
    if (child.tagName === 'OPTION' && !this.value) this.value = child.value;
    return child;
  }

  focus() {
    this.focused = true;
  }

  querySelectorAll(selector) {
    if (selector === '[data-product-row]') {
      return this.nodes.filter((node) => node.attrs['data-product-row'] !== undefined);
    }
    if (selector === '[data-product-sku-choice]') {
      return this.nodes.filter((node) => node.attrs['data-product-sku-choice'] !== undefined);
    }
    if (selector === '[data-product-purchase-control]') {
      return this.nodes.filter((node) => node.attrs['data-product-purchase-control'] !== undefined);
    }
    if (selector === '[data-product-sell-skill]') {
      return this.nodes.filter((node) => node.attrs['data-product-sell-skill'] !== undefined);
    }
    if (selector === '[data-product-sell-sku-remove]') {
      return this.nodes.filter((node) => node.attrs['data-product-sell-sku-remove'] !== undefined);
    }
    if (selector === '[data-product-sell-sku-field]') {
      return this.nodes.filter((node) => node.attrs['data-product-sell-sku-field'] !== undefined);
    }
    return [];
  }
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function profile(overrides = {}) {
  return {
    slug: 'buyer-bot',
    name: 'Buyer Bot',
    globalMetaId: 'gm-buyer',
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    listingPinId: 'listing-mobile-top-up',
    title: 'Mobile Top-up',
    sellerName: 'Carrier Seller',
    online: true,
    productType: 'virtual',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['deliver-mobile-code'],
    },
    skus: [
      {
        skuId: 'sku-5',
        name: '5 SPACE credit',
        description: 'Mobile credit code',
        initialStock: 8,
        price: { amount: '5', currency: 'SPACE' },
      },
      {
        skuId: 'sku-10',
        name: '10 SPACE credit',
        description: 'Larger mobile credit code',
        initialStock: 4,
        price: { amount: '10', currency: 'SPACE' },
      },
    ],
    ...overrides,
  };
}

async function runProductsScript(options = {}) {
  const elements = {
    '[data-products-tab]': null,
    '[data-products-panel]': null,
    '[data-products-status]': new FakeElement(),
    '[data-products-query]': new FakeElement(options.query || ''),
    '[data-products-refresh]': new FakeElement(),
    '[data-products-list]': new FakeElement(),
    '[data-products-detail]': new FakeElement(),
    '[data-products-skus]': new FakeElement(),
    '[data-products-buyer]': new FakeElement(options.buyer || ''),
    '[data-products-spend-cap]': new FakeElement(options.spendCap || ''),
    '[data-products-comment]': new FakeElement(options.comment || ''),
    '[data-products-preview]': new FakeElement(),
    '[data-products-purchase-reason]': new FakeElement(),
    '[data-products-confirmation-modal]': new FakeElement(),
    '[data-products-confirmation-summary]': new FakeElement(),
    '[data-products-confirmation-json]': new FakeElement(),
    '[data-products-confirm]': new FakeElement(),
    '[data-products-cancel-confirmation]': new FakeElement(),
    '[data-products-error]': new FakeElement(),
    '[data-products-seller]': new FakeElement(options.seller || ''),
    '[data-products-sell-skills]': new FakeElement(),
    '[data-products-sell-error]': new FakeElement(),
    '[data-products-listing-name]': new FakeElement(),
    '[data-products-listing-title]': new FakeElement(),
    '[data-products-cover-image]': new FakeElement(),
    '[data-products-gallery-images]': new FakeElement(),
    '[data-products-description-content-type]': new FakeElement('text/markdown'),
    '[data-products-description]': new FakeElement(),
    '[data-products-estimated-delivery-seconds]': new FakeElement(),
    '[data-products-deliverable-description]': new FakeElement(),
    '[data-products-sku-list]': new FakeElement(),
    '[data-products-add-sku]': new FakeElement(),
    '[data-products-network]': new FakeElement(options.network || 'mvc'),
    '[data-products-listing-preview-json]': new FakeElement(),
    '[data-products-publish]': new FakeElement(),
    '[data-products-publish-reason]': new FakeElement(),
    '[data-products-publish-confirmation-modal]': new FakeElement(),
    '[data-products-publish-confirmation-summary]': new FakeElement(),
    '[data-products-publish-confirmation-json]': new FakeElement(),
    '[data-products-confirm-publish]': new FakeElement(),
    '[data-products-cancel-publish]': new FakeElement(),
    '[data-products-publish-success]': new FakeElement(),
  };
  const tabs = ['marketplace', 'sell', 'orders'].map((name) => {
    const tab = new FakeElement();
    tab.attrs['data-products-tab'] = name;
    tab.dataset.productsTab = name;
    return tab;
  });
  const panels = ['marketplace', 'sell', 'orders'].map((name) => {
    const panel = new FakeElement();
    panel.attrs['data-products-panel'] = name;
    panel.dataset.productsPanel = name;
    return panel;
  });
  const fetchCalls = [];
  const productsPayload = options.products || [product()];

  const context = {
    console,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Number,
    String,
    Error,
    Array,
    document: {
      readyState: 'complete',
      createElement(tagName) {
        const element = new FakeElement();
        element.tagName = String(tagName).toUpperCase();
        return element;
      },
      querySelector(selector) {
        return elements[selector] || null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-products-tab]') return tabs;
        if (selector === '[data-products-panel]') return panels;
        return [];
      },
      addEventListener() {},
    },
    window: {
      location: { hash: options.hash || '' },
      addEventListener() {},
    },
    fetch: async (url, requestOptions = {}) => {
      fetchCalls.push({ url: String(url), options: requestOptions });
      if (options.fail) {
        return {
          ok: true,
          json: async () => ({ ok: false, code: 'network_products_failed', message: 'Directory exploded.' }),
        };
      }
      if (String(url) === '/api/bot/profiles') {
        if (options.profilesFail) {
          return {
            ok: true,
            json: async () => ({ ok: false, code: 'metabot_profiles_failed', message: 'Failed to load profiles.' }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true, data: { profiles: options.profiles || [profile()] } }),
        };
      }
      if (String(url).startsWith('/api/network/products')) {
        return {
          ok: true,
          json: async () => ({ ok: true, data: { products: productsPayload, total: productsPayload.length } }),
        };
      }
      if (String(url).startsWith('/api/products/skills')) {
        if (options.skillsFail) {
          return {
            ok: true,
            json: async () => ({ ok: false, code: 'products_skills_failed', message: 'Skill catalog exploded.' }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              skills: options.skills || [
                { name: 'deliver-code', title: 'Deliver Code' },
                { name: 'notify-buyer', title: 'Notify Buyer' },
              ],
            },
          }),
        };
      }
      if (String(url) === '/api/products/publish') {
        const body = requestOptions && requestOptions.body ? JSON.parse(String(requestOptions.body)) : {};
        return {
          ok: true,
          json: async () => options.publishResponse || {
            ok: true,
            state: 'success',
            data: {
              listingPinId: 'listing-pin-published',
              txids: ['listing-txid-1', 'listing-txid-2'],
              echo: body,
            },
          },
        };
      }
      if (String(url) === '/api/products/buy') {
        const body = requestOptions && requestOptions.body ? JSON.parse(String(requestOptions.body)) : {};
        if (body.confirmed === true) {
          return {
            ok: true,
            json: async () => options.confirmResponse || {
              ok: true,
              state: 'success',
              data: {
                productOrderPinId: 'product-order-pin-1',
                paymentTxid: 'payment-txid-1',
                orderTxid: 'order-txid-1',
                traceId: 'trace-product-order-1',
                localUiUrl: 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1',
              },
            },
          };
        }
        return {
          ok: true,
          json: async () => options.previewResponse || {
            ok: true,
            state: 'awaiting_confirmation',
            data: {
              product: {
                listingPinId: 'listing-mobile-top-up',
                title: 'Mobile Top-up',
              },
              sku: {
                skuId: 'sku-5',
                name: '5 SPACE credit',
              },
              payment: {
                amount: '5',
                currency: 'SPACE',
              },
              seller: {
                globalMetaId: 'gm-seller',
                name: 'Carrier Seller',
              },
              confirmRequest: {
                request: {
                  listingPinId: 'listing-mobile-top-up',
                  skuId: 'sku-5',
                  spendCap: { amount: '5', currency: 'SPACE' },
                  comment: 'send after 6pm',
                  policyMode: 'confirm_paid_only',
                  confirmed: true,
                },
              },
            },
          },
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildProductsPageDefinition().script, context);
  await waitFor(
    () => elements['[data-products-list]'].innerHTML.includes('Mobile Top-up') || elements['[data-products-error]'].textContent,
    'initial products render',
  );
  return { elements, fetchCalls, tabs, panels };
}

function fillListingForm(elements, overrides = {}) {
  elements['[data-products-listing-name]'].value = overrides.name ?? 'mobile-credit';
  elements['[data-products-listing-title]'].value = overrides.title ?? 'Mobile Credit';
  elements['[data-products-cover-image]'].value = overrides.coverImage ?? 'metafile://cover-pin';
  elements['[data-products-gallery-images]'].value = overrides.galleryImages ?? 'metafile://gallery-a\nmetafile://gallery-b';
  elements['[data-products-description-content-type]'].value = overrides.descriptionContentType ?? 'text/markdown';
  elements['[data-products-description]'].value = overrides.description ?? 'Digital mobile credit.';
  elements['[data-products-estimated-delivery-seconds]'].value = overrides.estimatedDeliverySeconds ?? '60';
  elements['[data-products-deliverable-description]'].value = overrides.deliverableDescription ?? 'Activation code sent by simplemsg.';
  elements['[data-products-network]'].value = overrides.network ?? 'mvc';
}

async function openSellTab(options = {}) {
  const result = await runProductsScript({
    ...options,
    profiles: options.profiles || [
      profile({ slug: 'alice', name: 'Alice Seller' }),
      profile({ slug: 'buyer-bot', name: 'Buyer Bot' }),
    ],
  });
  const sellTab = result.tabs.find((tab) => tab.dataset.productsTab === 'sell');
  await sellTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => result.elements['[data-products-sell-skills]'].innerHTML.includes('deliver-code') ||
      result.elements['[data-products-sell-error]'].textContent.includes('products_skills_failed'),
    'seller skills load',
  );
  return result;
}

test('products marketplace script loads profiles and online marketplace rows by default', async () => {
  const { elements, fetchCalls } = await runProductsScript();

  assert.equal(fetchCalls[0].url, '/api/bot/profiles');
  assert.equal(fetchCalls[1].url, '/api/network/products?online=true&limit=20');
  assert.match(elements['[data-products-list]'].innerHTML, /Carrier Seller/);
  assert.match(elements['[data-products-list]'].innerHTML, /2 SKUs/);
  assert.match(elements['[data-products-list]'].innerHTML, /5 SPACE/);
  assert.match(elements['[data-products-list]'].innerHTML, /Online/);
});

test('products marketplace query reloads online products with encoded query', async () => {
  const { elements, fetchCalls } = await runProductsScript();

  elements['[data-products-query]'].value = 'mobile top-up';
  await elements['[data-products-query]'].listeners.get('input')();
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/network/products?online=true&query=mobile%20top-up&limit=20'),
    'query fetch',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/network/products?online=true&query=mobile%20top-up&limit=20'));
});

test('products marketplace enables purchase preview when buyer, SKU, and spend cap are valid', async () => {
  const { elements } = await runProductsScript({
    buyer: 'buyer-bot',
    spendCap: '5',
  });

  assert.match(elements['[data-products-detail]'].innerHTML, /Mobile Top-up/);
  assert.equal(elements['[data-products-preview]'].disabled, false);
  assert.match(elements['[data-products-purchase-reason]'].textContent, /preview required before payment/i);
});

test('products marketplace preview posts unconfirmed request and opens confirmation modal without payment ids', async () => {
  const { elements, fetchCalls } = await runProductsScript({
    buyer: 'buyer-bot',
    spendCap: '5',
    comment: 'send after 6pm',
  });

  await elements['[data-products-preview]'].listeners.get('click')();
  await waitFor(
    () => elements['[data-products-confirmation-modal]'].hidden === false,
    'confirmation modal open',
  );

  const buyCall = fetchCalls.find((call) => call.url === '/api/products/buy');
  assert.ok(buyCall);
  assert.deepEqual(JSON.parse(buyCall.options.body), {
    from: 'buyer-bot',
    confirmed: false,
    listingPinId: 'listing-mobile-top-up',
    skuId: 'sku-5',
    spendCap: '5',
    comment: 'send after 6pm',
  });
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /Buyer Bot/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /listing-mobile-top-up/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /sku-5/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /5/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /SPACE/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /Carrier Seller|gm-seller/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /metabot products buy --from buyer-bot --request-file/);
  assert.doesNotMatch(elements['[data-products-confirmation-summary]'].innerHTML, /payment-txid-1|product-order-pin-1/);
  assert.equal(elements['[data-products-confirm]'].focused, true);
});

test('products marketplace confirm posts returned request, shows success, and never repeats on refresh', async () => {
  const { elements, fetchCalls } = await runProductsScript({
    buyer: 'buyer-bot',
    spendCap: '5',
    comment: 'send after 6pm',
  });

  await elements['[data-products-preview]'].listeners.get('click')();
  await waitFor(
    () => elements['[data-products-confirmation-modal]'].hidden === false,
    'confirmation modal open',
  );

  const confirmPromise = elements['[data-products-confirm]'].listeners.get('click')();
  assert.equal(elements['[data-products-confirm]'].disabled, true);
  await confirmPromise;
  await waitFor(
    () => elements['[data-products-confirmation-summary]'].innerHTML.includes('product-order-pin-1'),
    'purchase success render',
  );

  const buyCalls = fetchCalls.filter((call) => call.url === '/api/products/buy');
  assert.equal(buyCalls.length, 2);
  assert.deepEqual(JSON.parse(buyCalls[1].options.body), {
    from: 'buyer-bot',
    listingPinId: 'listing-mobile-top-up',
    skuId: 'sku-5',
    spendCap: { amount: '5', currency: 'SPACE' },
    comment: 'send after 6pm',
    policyMode: 'confirm_paid_only',
    confirmed: true,
  });
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /product-order-pin-1/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /payment-txid-1/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /order-txid-1/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /trace-product-order-1/);
  assert.match(elements['[data-products-confirmation-summary]'].innerHTML, /http:\/\/127\.0\.0\.1:25200\/ui\/trace\?traceId=trace-product-order-1/);
  assert.equal(elements['[data-products-confirm]'].hidden, true);

  await elements['[data-products-refresh]'].listeners.get('click')();
  await waitFor(
    () => fetchCalls.filter((call) => call.url.startsWith('/api/network/products')).length >= 2,
    'marketplace refresh',
  );
  assert.equal(fetchCalls.filter((call) => call.url === '/api/products/buy').length, 2);
  assert.equal(elements['[data-products-preview]'].disabled, true);
  assert.match(elements['[data-products-purchase-reason]'].textContent, /purchase submitted/i);

  await elements['[data-products-preview]'].listeners.get('click')();
  assert.equal(fetchCalls.filter((call) => call.url === '/api/products/buy').length, 2);
});

test('products marketplace cancellation closes confirmation modal without confirmed post', async () => {
  const { elements, fetchCalls } = await runProductsScript({
    buyer: 'buyer-bot',
    spendCap: '5',
  });

  await elements['[data-products-preview]'].listeners.get('click')();
  await waitFor(
    () => elements['[data-products-confirmation-modal]'].hidden === false,
    'confirmation modal open',
  );

  await elements['[data-products-cancel-confirmation]'].listeners.get('click')();

  assert.equal(elements['[data-products-confirmation-modal]'].hidden, true);
  assert.equal(fetchCalls.filter((call) => call.url === '/api/products/buy').length, 1);
});

test('products marketplace profile load failure remains visible after marketplace load succeeds', async () => {
  const { elements, fetchCalls } = await runProductsScript({
    profilesFail: true,
  });

  assert.equal(fetchCalls[0].url, '/api/bot/profiles');
  assert.equal(fetchCalls[1].url, '/api/network/products?online=true&limit=20');
  assert.match(elements['[data-products-error]'].textContent, /metabot_profiles_failed/);
  assert.match(elements['[data-products-error]'].textContent, /Directory exploded|failed to load profiles/i);
  assert.match(elements['[data-products-list]'].innerHTML, /Mobile Top-up/);
});

test('products marketplace selection renders detail, SKU choices, and disabled offline purchase controls', async () => {
  const { elements } = await runProductsScript({
    products: [
      product({
        listingPinId: 'listing-offline',
        title: 'Offline Mobile Top-up',
        online: false,
      }),
    ],
  });

  const [row] = elements['[data-products-list]'].querySelectorAll('[data-product-row]');
  await row.listeners.get('click')();

  assert.match(elements['[data-products-detail]'].innerHTML, /Offline Mobile Top-up/);
  assert.match(elements['[data-products-detail]'].innerHTML, /Carrier Seller/);
  assert.match(elements['[data-products-skus]'].innerHTML, /sku-5/);
  assert.match(elements['[data-products-skus]'].innerHTML, /5 SPACE/);
  assert.equal(elements['[data-products-preview]'].disabled, true);
  assert.match(elements['[data-products-purchase-reason]'].textContent, /offline/i);
  assert.match(elements['[data-products-detail]'].innerHTML, /disabled/);
});

test('products marketplace fetch failure renders command envelope code and message', async () => {
  const { elements } = await runProductsScript({ fail: true });

  assert.match(elements['[data-products-error]'].textContent, /network_products_failed/);
  assert.match(elements['[data-products-error]'].textContent, /Directory exploded/);
});

test('products sell tab loads seller profiles, loads selected seller skills, and allows multiple returned skills', async () => {
  const { elements, fetchCalls } = await openSellTab();

  assert.equal(fetchCalls[0].url, '/api/bot/profiles');
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/skills?from=alice'));
  assert.match(elements['[data-products-sell-skills]'].innerHTML, /deliver-code/);
  assert.match(elements['[data-products-sell-skills]'].innerHTML, /notify-buyer/);
  assert.doesNotMatch(elements['[data-products-sell-skills]'].innerHTML, /not-returned/);

  const skills = elements['[data-products-sell-skills]'].querySelectorAll('[data-product-sell-skill]');
  assert.equal(skills.length, 2);
  skills[0].checked = true;
  await skills[0].listeners.get('change')();
  skills[1].checked = true;
  await skills[1].listeners.get('change')();

  fillListingForm(elements);
  await elements['[data-products-listing-title]'].listeners.get('input')();

  const payload = JSON.parse(elements['[data-products-listing-preview-json]'].textContent);
  assert.deepEqual(payload.fulfillment.fulfillmentSkills, ['deliver-code', 'notify-buyer']);
});

test('products sell tab disables publish controls and shows code/message when skill loading fails', async () => {
  const { elements } = await openSellTab({ skillsFail: true });

  assert.equal(elements['[data-products-publish]'].disabled, true);
  assert.match(elements['[data-products-sell-error]'].textContent, /products_skills_failed/);
  assert.match(elements['[data-products-sell-error]'].textContent, /Skill catalog exploded/);
});

test('products sell publish preview renders exact Product V1 JSON payload', async () => {
  const { elements } = await openSellTab();

  const skills = elements['[data-products-sell-skills]'].querySelectorAll('[data-product-sell-skill]');
  skills[0].checked = true;
  await skills[0].listeners.get('change')();
  skills[1].checked = true;
  await skills[1].listeners.get('change')();
  fillListingForm(elements);
  await elements['[data-products-add-sku]'].listeners.get('click')();
  const skuFields = elements['[data-products-sku-list]'].querySelectorAll('[data-product-sell-sku-field]');
  const secondSku = Object.fromEntries(
    skuFields
      .filter((field) => field.attrs['data-sku-index'] === '1')
      .map((field) => [field.attrs['data-product-sell-sku-field'], field]),
  );
  secondSku.skuId.value = 'sku-10';
  secondSku.name.value = '10 SPACE credit';
  secondSku.image.value = 'metafile://sku-ten';
  secondSku.description.value = 'Larger top-up.';
  secondSku.priceAmount.value = '10';
  secondSku.priceCurrency.value = 'SPACE';
  secondSku.initialStock.value = '3';
  await secondSku.skuId.listeners.get('input')();

  const payload = JSON.parse(elements['[data-products-listing-preview-json]'].textContent);
  assert.deepEqual(payload, {
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
        descriptionContentType: 'text/markdown',
        description: 'Larger top-up.',
        price: { amount: '10', currency: 'SPACE' },
        initialStock: 3,
      },
    ],
  });
});

test('products sell publish confirmation posts previewed payload and shows listing pin and txids', async () => {
  const { elements, fetchCalls } = await openSellTab();

  const skills = elements['[data-products-sell-skills]'].querySelectorAll('[data-product-sell-skill]');
  skills[0].checked = true;
  await skills[0].listeners.get('change')();
  fillListingForm(elements);
  await elements['[data-products-listing-name]'].listeners.get('input')();

  await elements['[data-products-publish]'].listeners.get('click')();
  assert.equal(elements['[data-products-publish-confirmation-modal]'].hidden, false);
  assert.match(elements['[data-products-publish-confirmation-summary]'].innerHTML, /Alice Seller/);
  assert.match(elements['[data-products-publish-confirmation-summary]'].innerHTML, /mvc/);
  assert.match(elements['[data-products-publish-confirmation-summary]'].innerHTML, /1 SKU/);
  assert.match(elements['[data-products-publish-confirmation-summary]'].innerHTML, /deliver-code/);
  assert.match(elements['[data-products-publish-confirmation-summary]'].innerHTML, /\/protocols\/product-listing/);

  const previewedPayload = JSON.parse(elements['[data-products-publish-confirmation-json]'].textContent);
  await elements['[data-products-confirm-publish]'].listeners.get('click')();
  await waitFor(
    () => elements['[data-products-publish-success]'].innerHTML.includes('listing-pin-published'),
    'publish success render',
  );

  const publishCall = fetchCalls.find((call) => call.url === '/api/products/publish');
  assert.ok(publishCall);
  assert.deepEqual(JSON.parse(publishCall.options.body), {
    from: 'alice',
    network: 'mvc',
    payload: previewedPayload,
  });
  assert.match(elements['[data-products-publish-success]'].innerHTML, /listing-pin-published/);
  assert.match(elements['[data-products-publish-success]'].innerHTML, /listing-txid-1/);
  assert.match(elements['[data-products-publish-success]'].innerHTML, /listing-txid-2/);
});

test('products sell publish cancellation does not post', async () => {
  const { elements, fetchCalls } = await openSellTab();

  const [skill] = elements['[data-products-sell-skills]'].querySelectorAll('[data-product-sell-skill]');
  skill.checked = true;
  await skill.listeners.get('change')();
  fillListingForm(elements);
  await elements['[data-products-listing-title]'].listeners.get('input')();

  await elements['[data-products-publish]'].listeners.get('click')();
  await elements['[data-products-cancel-publish]'].listeners.get('click')();

  assert.equal(elements['[data-products-publish-confirmation-modal]'].hidden, true);
  assert.equal(fetchCalls.some((call) => call.url === '/api/products/publish'), false);
});
