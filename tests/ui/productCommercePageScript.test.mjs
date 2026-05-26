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
    this.hidden = false;
    this.listeners = new Map();
    this.attrs = {};
    this.nodes = [];
    this.children = [];
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
    '[data-products-error]': new FakeElement(),
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
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildProductsPageDefinition().script, context);
  await waitFor(
    () => elements['[data-products-list]'].innerHTML.includes('Mobile Top-up') || elements['[data-products-error]'].textContent,
    'initial products render',
  );
  return { elements, fetchCalls };
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

test('products marketplace keeps purchase preview disabled until the preview step is wired', async () => {
  const { elements } = await runProductsScript({
    buyer: 'buyer-bot',
    spendCap: '5',
  });

  assert.match(elements['[data-products-detail]'].innerHTML, /Mobile Top-up/);
  assert.equal(elements['[data-products-preview]'].disabled, true);
  assert.match(elements['[data-products-purchase-reason]'].textContent, /preview purchase is not wired|next step/i);
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
