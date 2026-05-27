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
    if (selector === '[data-product-owned-copy]') {
      return this.nodes.filter((node) => node.attrs['data-product-owned-copy'] !== undefined);
    }
    if (selector === '[data-product-owned-inspect]') {
      return this.nodes.filter((node) => node.attrs['data-product-owned-inspect'] !== undefined);
    }
    if (selector === '[data-product-order-row]') {
      return this.nodes.filter((node) => node.attrs['data-product-order-row'] !== undefined);
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

function ownedListing(overrides = {}) {
  return {
    listingPinId: 'owned-listing-pin-1',
    title: 'Owned Mobile Top-up',
    skuCount: 2,
    fulfillmentSkills: ['deliver-code', 'notify-buyer'],
    available: true,
    payload: {
      title: 'Owned Mobile Top-up',
      fulfillment: { fulfillmentSkills: ['deliver-code', 'notify-buyer'] },
      skus: [{ skuId: 'sku-5' }, { skuId: 'sku-10' }],
    },
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    orderId: 'local-order-1',
    role: 'buyer',
    state: 'delivered',
    productOrderPinId: 'product-order-pin-1',
    listingPinId: 'listing-mobile-top-up',
    skuId: 'sku-5',
    paymentTxid: 'payment-txid-1',
    orderTxid: 'order-txid-1',
    delivery: { label: 'Delivered by simplemsg', deliveryPinId: 'delivery-pin-1' },
    ...overrides,
  };
}

function orderDetail(overrides = {}) {
  return {
    order: order(),
    sku: {
      skuId: 'sku-5',
      name: '5 SPACE credit',
      price: { amount: '5', currency: 'SPACE' },
    },
    payment: {
      paymentTxid: 'payment-txid-1',
      verified: true,
    },
    fulfillment: {
      fulfillmentSkills: ['deliver-code', 'notify-buyer'],
      failureReason: 'fulfillment runtime timeout',
    },
    delivery: {
      summary: { label: 'Delivered by simplemsg', decryptedDeliveryBody: 'secret-code-123' },
      deliveryPinId: 'delivery-pin-1',
      decryptedDeliveryBody: 'secret-code-123',
    },
    trace: {
      traceId: 'trace-product-order-1',
      sessionId: 'session-product-order-1',
      localUiUrl: 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1',
    },
    raw: {
      decryptedDeliveryBody: 'secret-code-123',
      productOrder: { comment: 'safe public comment' },
    },
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
    '[data-products-owned-refresh]': new FakeElement(),
    '[data-products-owned-error]': new FakeElement(),
    '[data-products-owned-list]': new FakeElement(),
    '[data-products-order-actor]': new FakeElement(options.orderActor || ''),
    '[data-products-order-role]': new FakeElement(options.orderRole || 'buyer'),
    '[data-products-order-state]': new FakeElement(options.orderState || ''),
    '[data-products-order-page-size]': new FakeElement(String(options.orderPageSize || 20)),
    '[data-products-order-refresh]': new FakeElement(),
    '[data-products-order-selector]': new FakeElement(options.orderSelector || ''),
    '[data-products-order-selector-kind]': new FakeElement(options.orderSelectorKind || 'auto'),
    '[data-products-order-inspect]': new FakeElement(),
    '[data-products-order-error]': new FakeElement(),
    '[data-products-orders-list]': new FakeElement(),
    '[data-products-order-prev]': new FakeElement(),
    '[data-products-order-next]': new FakeElement(),
    '[data-products-order-page-label]': new FakeElement(),
    '[data-products-order-detail-modal]': new FakeElement(),
    '[data-products-order-detail]': new FakeElement(),
    '[data-products-order-detail-close]': new FakeElement(),
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
  const skillResponseReleases = [];
  const orderResponseReleases = [];
  const skillResponseCounts = new Map();
  let orderResponseCount = 0;
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
        const sellerSlug = new URL(String(url), 'http://127.0.0.1').searchParams.get('from') || '';
        const currentCount = skillResponseCounts.get(sellerSlug) || 0;
        skillResponseCounts.set(sellerSlug, currentCount + 1);
        const scriptedResponses = options.skillResponses && options.skillResponses[sellerSlug] ? options.skillResponses[sellerSlug] : [];
        const scriptedResponse = scriptedResponses[currentCount];
        if (scriptedResponse && scriptedResponse.defer) {
          let release;
          const jsonPromise = new Promise((resolve) => {
            release = () => resolve(scriptedResponse.response);
          });
          skillResponseReleases.push(release);
          return {
            ok: true,
            json: async () => jsonPromise,
          };
        }
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
              skills: scriptedResponse && scriptedResponse.response && scriptedResponse.response.data
                ? scriptedResponse.response.data.skills
                : (options.skills || [
                { name: 'deliver-code', title: 'Deliver Code' },
                { name: 'notify-buyer', title: 'Notify Buyer' },
              ]),
            },
          }),
        };
      }
      if (String(url).startsWith('/api/products/owned')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: options.ownedPage || {
              items: options.ownedListings || [ownedListing()],
              page: 1,
              pageSize: 20,
              total: (options.ownedListings || [ownedListing()]).length,
              totalPages: 1,
            },
          }),
        };
      }
      if (String(url).startsWith('/api/products/orders/inspect')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: options.orderDetail || orderDetail(),
          }),
        };
      }
      if (String(url).startsWith('/api/products/orders')) {
        const currentCount = orderResponseCount;
        orderResponseCount += 1;
        const scriptedResponses = options.orderResponses || [];
        const scriptedResponse = scriptedResponses[currentCount];
        if (scriptedResponse && scriptedResponse.defer) {
          let release;
          const jsonPromise = new Promise((resolve) => {
            release = () => resolve(scriptedResponse.response);
          });
          orderResponseReleases.push(release);
          return {
            ok: true,
            json: async () => jsonPromise,
          };
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: scriptedResponse && scriptedResponse.response && scriptedResponse.response.data
              ? scriptedResponse.response.data
              : options.ordersPage || {
              items: options.orders || [order()],
              page: options.ordersPageNumber || 1,
              pageSize: options.orderPageSize || 20,
              total: options.ordersTotal || 1,
              totalPages: options.ordersTotalPages || 1,
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
  return { elements, fetchCalls, tabs, panels, skillResponseReleases, orderResponseReleases };
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
  const callsBeforeSell = result.fetchCalls.length;
  await sellTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => result.elements['[data-products-sell-skills]'].innerHTML.includes('deliver-code') ||
      result.elements['[data-products-sell-error]'].textContent.includes('products_skills_failed'),
    'seller skills load',
  );
  result.callsBeforeSell = callsBeforeSell;
  return result;
}

async function openOrdersTab(options = {}) {
  const result = await runProductsScript({
    ...options,
    profiles: options.profiles || [
      profile({ slug: 'actor-bot', name: 'Actor Bot' }),
      profile({ slug: 'buyer-bot', name: 'Buyer Bot' }),
    ],
  });
  const ordersTab = result.tabs.find((tab) => tab.dataset.productsTab === 'orders');
  const callsBeforeOrders = result.fetchCalls.length;
  await ordersTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => result.fetchCalls.some((call) => call.url.startsWith('/api/products/orders?')) ||
      result.elements['[data-products-order-error]'].textContent,
    'orders load',
  );
  result.callsBeforeOrders = callsBeforeOrders;
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
  const { elements, fetchCalls, callsBeforeSell } = await openSellTab();
  const sellCalls = fetchCalls.slice(callsBeforeSell);

  assert.equal(fetchCalls[0].url, '/api/bot/profiles');
  assert.equal(sellCalls[0].url, '/api/bot/profiles');
  assert.equal(sellCalls[1].url, '/api/products/skills?from=alice');
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

test('products sell tab loads owned listings for selected seller and renders read-only actions', async () => {
  const { elements, fetchCalls, callsBeforeSell } = await openSellTab();
  const sellCalls = fetchCalls.slice(callsBeforeSell);

  assert.ok(sellCalls.some((call) => call.url === '/api/products/owned?from=alice&page=1&pageSize=20'));
  assert.match(elements['[data-products-owned-list]'].innerHTML, /Owned Mobile Top-up/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /owned-listing-pin-1/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /2 SKUs/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /deliver-code, notify-buyer/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /Available/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /data-product-owned-inspect/);
  assert.match(elements['[data-products-owned-list]'].innerHTML, /data-product-owned-copy/);
  assert.doesNotMatch(elements['[data-products-owned-list]'].innerHTML, /modify|revoke/i);
});

test('products sell tab can load owned listings across all profiles and refreshes with refresh flag', async () => {
  const { elements, tabs, fetchCalls } = await runProductsScript({ profiles: [] });
  const sellTab = tabs.find((tab) => tab.dataset.productsTab === 'sell');

  await sellTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/owned?all=true&page=1&pageSize=20'),
    'all-profile owned listings',
  );
  await elements['[data-products-owned-refresh]'].listeners.get('click')();
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/owned?all=true&page=1&pageSize=20&refresh=true'),
    'owned refresh listings',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/owned?all=true&page=1&pageSize=20'));
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/owned?all=true&page=1&pageSize=20&refresh=true'));
});

test('products sell seller actor change removes all-profile owned query flag', async () => {
  const { elements, tabs, fetchCalls } = await runProductsScript({
    profiles: [
      profile({ slug: 'alice', name: 'Alice Seller' }),
      profile({ slug: 'bob', name: 'Bob Seller' }),
    ],
  });
  const sellTab = tabs.find((tab) => tab.dataset.productsTab === 'sell');
  await sellTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/owned?from=alice&page=1&pageSize=20'),
    'alice owned listings',
  );

  elements['[data-products-seller]'].value = 'bob';
  await elements['[data-products-seller]'].listeners.get('change')();
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/owned?from=bob&page=1&pageSize=20'),
    'bob owned listings',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/owned?from=bob&page=1&pageSize=20'));
  assert.ok(!fetchCalls.some((call) => call.url.includes('from=bob') && call.url.includes('all=true')));
});

test('products sell ignores stale seller skills when responses return out of order', async () => {
  const { elements, tabs, fetchCalls, skillResponseReleases } = await runProductsScript({
    skillResponses: {
      alice: [
        {
          defer: true,
          response: {
            ok: true,
            data: { skills: [{ name: 'alice-skill', title: 'Alice Skill' }] },
          },
        },
      ],
      bob: [
        {
          response: {
            ok: true,
            data: { skills: [{ name: 'bob-skill', title: 'Bob Skill' }] },
          },
        },
      ],
    },
    profiles: [
      profile({ slug: 'alice', name: 'Alice Seller' }),
      profile({ slug: 'bob', name: 'Bob Seller' }),
      profile({ slug: 'buyer-bot', name: 'Buyer Bot' }),
    ],
  });

  const sellTab = tabs.find((tab) => tab.dataset.productsTab === 'sell');
  await sellTab.listeners.get('click')({ preventDefault() {} });
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/skills?from=alice'),
    'alice skills request issued',
  );
  await waitFor(
    () => elements['[data-products-seller]'].children.length > 1,
    'seller select ready',
  );

  const sellerSelect = elements['[data-products-seller]'];
  sellerSelect.value = 'bob';
  await sellerSelect.listeners.get('change')();
  await waitFor(
    () => elements['[data-products-sell-skills]'].innerHTML.includes('Bob Skill'),
    'bob skills render',
  );
  assert.match(elements['[data-products-sell-skills]'].innerHTML, /Bob Skill/);
  assert.doesNotMatch(elements['[data-products-sell-skills]'].innerHTML, /Alice Skill/);

  assert.equal(skillResponseReleases.length, 1);
  skillResponseReleases[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(elements['[data-products-sell-skills]'].innerHTML, /Bob Skill/);
  assert.doesNotMatch(elements['[data-products-sell-skills]'].innerHTML, /Alice Skill/);
});

test('products orders tab loads buyer orders and supports all-profile fallback', async () => {
  const withActor = await openOrdersTab();
  assert.ok(withActor.fetchCalls.some((call) => call.url === '/api/products/orders?from=actor-bot&role=buyer&page=1&pageSize=20'));

  const noActor = await openOrdersTab({ profiles: [] });
  assert.ok(noActor.fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=buyer&page=1&pageSize=20'));
});

test('products orders actor selection removes cross-profile all flag', async () => {
  const { elements, fetchCalls } = await openOrdersTab();

  elements['[data-products-order-actor]'].value = 'buyer-bot';
  await elements['[data-products-order-actor]'].listeners.get('change')();
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/orders?from=buyer-bot&role=buyer&page=1&pageSize=20'),
    'actor order load',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?from=buyer-bot&role=buyer&page=1&pageSize=20'));
  assert.ok(!fetchCalls.some((call) => call.url.includes('from=buyer-bot') && call.url.includes('all=true')));
});

test('products orders filters role state and pagination independently from all-profile flag', async () => {
  const { elements, fetchCalls } = await openOrdersTab({ profiles: [], ordersTotalPages: 3 });

  elements['[data-products-order-role]'].value = 'seller';
  await elements['[data-products-order-role]'].listeners.get('change')();
  elements['[data-products-order-role]'].value = 'all';
  await elements['[data-products-order-role]'].listeners.get('change')();
  elements['[data-products-order-state]'].value = 'delivered';
  await elements['[data-products-order-state]'].listeners.get('change')();
  elements['[data-products-order-page-size]'].value = '10';
  await elements['[data-products-order-page-size]'].listeners.get('change')();
  await elements['[data-products-order-next]'].listeners.get('click')();

  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=all&state=delivered&page=2&pageSize=10'),
    'filtered paginated orders',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=seller&page=1&pageSize=20'));
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=all&page=1&pageSize=20'));
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=all&state=delivered&page=1&pageSize=20'));
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=all&state=delivered&page=2&pageSize=10'));
});

test('products orders rows render copy-friendly order fields and delivery summary', async () => {
  const { elements } = await openOrdersTab();

  assert.match(elements['[data-products-orders-list]'].innerHTML, /Buyer/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /Delivered/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /listing-mobile-top-up/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /sku-5/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /payment-txid-1/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /product-order-pin-1/);
  assert.match(elements['[data-products-orders-list]'].innerHTML, /Delivered by simplemsg/);
});

test('products order row inspection uses best selector and detail hides raw decrypted payloads', async () => {
  const { elements, fetchCalls } = await openOrdersTab({ profiles: [] });

  const [row] = elements['[data-products-orders-list]'].querySelectorAll('[data-product-order-row]');
  await row.listeners.get('click')();
  await waitFor(
    () => fetchCalls.some((call) => call.url === '/api/products/orders/inspect?all=true&productOrderPinId=product-order-pin-1'),
    'row inspect fetch',
  );

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders/inspect?all=true&productOrderPinId=product-order-pin-1'));
  assert.match(elements['[data-products-order-detail]'].innerHTML, /Payment verified/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /Yes/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /deliver-code, notify-buyer/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /5 SPACE credit/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /trace-product-order-1/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /session-product-order-1/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /delivery-pin-1/);
  assert.match(elements['[data-products-order-detail]'].innerHTML, /fulfillment runtime timeout/);
  assert.doesNotMatch(elements['[data-products-order-detail]'].innerHTML, /secret-code-123|decryptedDeliveryBody/);
});

test('products order row inspection preserves orderTxid selector for 64-hex txid fallback', async () => {
  const orderTxid = 'a'.repeat(64);
  const { elements, fetchCalls } = await openOrdersTab({
    profiles: [],
    orders: [
      order({
        productOrderPinId: '',
        paymentTxid: '',
        orderTxid,
      }),
    ],
  });

  const [row] = elements['[data-products-orders-list]'].querySelectorAll('[data-product-order-row]');
  await row.listeners.get('click')();
  await waitFor(
    () => fetchCalls.some((call) => call.url.includes(orderTxid)),
    'order txid row inspect fetch',
  );

  assert.ok(fetchCalls.some((call) => call.url === `/api/products/orders/inspect?all=true&orderTxid=${orderTxid}`));
  assert.ok(!fetchCalls.some((call) => call.url === `/api/products/orders/inspect?all=true&paymentTxid=${orderTxid}`));
});

test('products orders ignores stale list responses when filters change quickly', async () => {
  const { elements, fetchCalls, orderResponseReleases } = await openOrdersTab({
    profiles: [],
    orderResponses: [
      {
        response: {
          ok: true,
          data: {
            items: [order({ productOrderPinId: 'initial-order-pin', state: 'created' })],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
          },
        },
      },
      {
        defer: true,
        response: {
          ok: true,
          data: {
            items: [order({ productOrderPinId: 'stale-order-pin', state: 'paid' })],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
          },
        },
      },
      {
        response: {
          ok: true,
          data: {
            items: [order({ productOrderPinId: 'current-order-pin', state: 'delivered' })],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
          },
        },
      },
    ],
  });

  elements['[data-products-order-role]'].value = 'seller';
  const staleLoad = elements['[data-products-order-role]'].listeners.get('change')();
  await waitFor(
    () => orderResponseReleases.length === 1,
    'deferred stale order response',
  );
  elements['[data-products-order-role]'].value = 'buyer';
  await elements['[data-products-order-role]'].listeners.get('change')();
  await waitFor(
    () => elements['[data-products-orders-list]'].innerHTML.includes('current-order-pin'),
    'current order response render',
  );

  orderResponseReleases[0]();
  await staleLoad;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=seller&page=1&pageSize=20'));
  assert.ok(fetchCalls.some((call) => call.url === '/api/products/orders?all=true&role=buyer&page=1&pageSize=20'));
  assert.match(elements['[data-products-orders-list]'].innerHTML, /current-order-pin/);
  assert.doesNotMatch(elements['[data-products-orders-list]'].innerHTML, /stale-order-pin/);
  assert.match(elements['[data-products-status]'].textContent, /Orders loaded/);
});

test('products direct order inspection supports explicit selector types', async () => {
  const { elements, fetchCalls } = await openOrdersTab({ profiles: [] });

  const cases = [
    ['productOrderPinId', 'product-order-pin-2', 'productOrderPinId=product-order-pin-2'],
    ['paymentTxid', 'payment-txid-2', 'paymentTxid=payment-txid-2'],
    ['orderTxid', 'order-txid-2', 'orderTxid=order-txid-2'],
    ['orderId', 'local-order-2', 'orderId=local-order-2'],
  ];
  for (const [kind, value, expected] of cases) {
    elements['[data-products-order-selector-kind]'].value = kind;
    elements['[data-products-order-selector]'].value = value;
    await elements['[data-products-order-inspect]'].listeners.get('click')();
    await waitFor(
      () => fetchCalls.some((call) => call.url.includes(expected)),
      `${kind} inspect`,
    );
  }

  for (const [, , expected] of cases) {
    assert.ok(fetchCalls.some((call) => call.url === `/api/products/orders/inspect?all=true&${expected}`));
  }
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
