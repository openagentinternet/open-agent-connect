// Isolated Playwright acceptance for /ui/products.
// Run after a build with:
//   npm run build && node --test tests/playwright/product-commerce-ui.spec.mjs
// The spec serves mocked Product Commerce endpoints locally and never reaches chain or wallet services.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const playwright = await import('playwright').catch(() => null);

const { buildProductsPageDefinition } = require('../../dist/ui/pages/products/app.js');

const LISTING_PIN = `${'e'.repeat(64)}i0`;
const PRODUCT_ORDER_PIN = `${'f'.repeat(64)}i0`;

const profiles = [
  { slug: 'buyer-bot', name: 'Buyer Bot', displayName: 'Buyer Bot' },
  { slug: 'seller-bot', name: 'Seller Bot', displayName: 'Seller Bot' },
];

const product = {
  listingPinId: LISTING_PIN,
  title: 'Mobile Credit Pack',
  description: 'Digital mobile credit delivered through simplemsg.',
  sellerName: 'Seller Bot',
  online: true,
  productType: 'virtual',
  fulfillment: {
    fulfillmentType: 'digital_delivery',
    deliveryEndpoint: 'simplemsg',
    fulfillmentSkills: ['digital-delivery'],
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
      description: 'Medium top-up.',
      price: { amount: '10', currency: 'SPACE' },
      initialStock: 8,
    },
  ],
};

const orderRows = [
  {
    orderId: 'buyer-order-1',
    role: 'buyer',
    state: 'paid',
    listingPinId: LISTING_PIN,
    skuId: 'sku-10',
    paymentTxid: 'payment-buyer-txid',
    orderTxid: 'order-buyer-txid',
    productOrderPinId: PRODUCT_ORDER_PIN,
    delivery: { summary: 'Waiting for delivery.' },
  },
  {
    orderId: 'seller-order-1',
    role: 'seller',
    state: 'delivered',
    listingPinId: LISTING_PIN,
    skuId: 'sku-5',
    paymentTxid: 'payment-seller-txid',
    orderTxid: 'order-seller-txid',
    productOrderPinId: `${'1'.repeat(64)}i0`,
    delivery: { summary: 'Delivered by simplemsg.' },
  },
];

function renderProductsPage() {
  const template = readFileSync(new URL('../../src/ui/pages/products/index.html', import.meta.url), 'utf8');
  const definition = buildProductsPageDefinition();
  return template
    .replaceAll('__PAGE_TITLE__', definition.title)
    .replaceAll('__PAGE_EYEBROW__', definition.eyebrow)
    .replaceAll('__PAGE_NAV__', '')
    .replaceAll('__PAGE_CONTENT__', definition.contentHtml)
    .replaceAll('__PAGE_SCRIPT__', definition.script);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function startMockServer() {
  const requests = [];
  const buyRequests = [];
  const publishRequests = [];
  const html = renderProductsPage();
  const sharedCss = readFileSync(new URL('../../src/ui/shared.css', import.meta.url), 'utf8')
    .replace(/^@import[^\n]+\n\n?/u, '');
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.url === '/ui/shared.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(sharedCss);
      return;
    }
    if (req.url?.startsWith('/ui/products')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url === '/api/bot/profiles') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { profiles } }));
      return;
    }
    if (req.url?.startsWith('/api/network/products')) {
      const url = new URL(req.url, 'http://127.0.0.1');
      assert.equal(url.searchParams.get('online'), 'true');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { products: [product] } }));
      return;
    }
    if (req.url === '/api/products/buy') {
      const body = await readJsonBody(req);
      buyRequests.push(body);
      const spendCap = body.spendCap && typeof body.spendCap === 'object'
        ? body.spendCap
        : { amount: body.spendCap, currency: 'SPACE' };
      res.writeHead(200, { 'content-type': 'application/json' });
      if (body.confirmed === true) {
        res.end(JSON.stringify({
          ok: true,
          state: 'success',
          data: {
            productOrderPinId: PRODUCT_ORDER_PIN,
            paymentTxid: 'payment-confirmed-txid',
            orderTxid: 'order-confirmed-txid',
            traceId: 'trace-products-1',
            localUiUrl: '/ui/traces/trace-products-1',
          },
        }));
      } else {
        res.end(JSON.stringify({
          ok: true,
          state: 'awaiting_confirmation',
          data: {
            product: { listingPinId: body.listingPinId },
            sku: { skuId: body.skuId },
            payment: { amount: spendCap.amount, currency: spendCap.currency },
            seller: { name: 'Seller Bot' },
            confirmRequest: {
              request: {
                listingPinId: body.listingPinId,
                skuId: body.skuId,
                spendCap,
                comment: body.comment,
                policyMode: body.policyMode,
              },
            },
          },
        }));
      }
      return;
    }
    if (req.url?.startsWith('/api/products/skills')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: { skills: [{ name: 'digital-delivery', title: 'Digital delivery' }] },
      }));
      return;
    }
    if (req.url?.startsWith('/api/products/owned')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          items: [{
            listingPinId: LISTING_PIN,
            title: 'Mobile Credit Pack',
            skuCount: 2,
            fulfillmentSkills: ['digital-delivery'],
            available: true,
            payload: product,
          }],
        },
      }));
      return;
    }
    if (req.url?.startsWith('/api/products/orders/inspect')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          order: orderRows[0],
          sku: product.skus[1],
          payment: { verified: true, paymentTxid: 'payment-buyer-txid' },
          fulfillment: { fulfillmentSkills: ['digital-delivery'] },
          trace: { traceId: 'trace-products-1', sessionId: 'session-products-1', localUiUrl: '/ui/traces/trace-products-1' },
          delivery: { deliveryPinId: 'delivery-pin-1', summary: { summary: 'Waiting for delivery.' } },
        },
      }));
      return;
    }
    if (req.url?.startsWith('/api/products/orders')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: { items: orderRows, page: 1, totalPages: 1 },
      }));
      return;
    }
    if (req.url === '/api/products/publish') {
      const body = await readJsonBody(req);
      publishRequests.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { listingPinId: LISTING_PIN, txid: 'publish-txid' } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    buyRequests,
    publishRequests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function assertNoVisibleOverlap(page, selector) {
  const overlaps = await page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    const elements = Array.from(root.querySelectorAll('button, input, select, textarea, a, table, [role="dialog"], [data-products-detail], [data-products-list]'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map((element, index) => ({ index, element, tag: element.tagName, text: element.textContent.trim().slice(0, 60), rect: element.getBoundingClientRect() }));
    const findings = [];
    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        if (
          elements[i].element.contains(elements[j].element)
          || elements[j].element.contains(elements[i].element)
        ) {
          continue;
        }
        const a = elements[i].rect;
        const b = elements[j].rect;
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (x > 3 && y > 3) {
          const { element: _aElement, ...aElement } = elements[i];
          const { element: _bElement, ...bElement } = elements[j];
          findings.push({ a: aElement, b: bElement, area: Math.round(x * y) });
        }
      }
    }
    return findings;
  }, selector);
  assert.deepEqual(overlaps, []);
}

test('product commerce UI uses mocked endpoints for marketplace, sell, orders, and modal acceptance', {
  skip: playwright ? false : 'Playwright is not installed in this repo; install it to run this acceptance spec.',
}, async () => {
  const server = await startMockServer();
  let browser;
  let page;
  try {
    browser = await playwright.chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const allowedOrigin = new URL(server.baseUrl).origin;
    const externalRequests = [];
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === allowedOrigin || ['data:', 'blob:'].includes(requestUrl.protocol)) {
        await route.continue();
        return;
      }
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });

    await page.goto(`${server.baseUrl}/ui/products`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Products' }).waitFor();
    await page.getByRole('tab', { name: 'Marketplace' }).waitFor();
    await page.getByRole('tab', { name: 'Sell' }).waitFor();
    await page.getByRole('tab', { name: 'Orders' }).waitFor();
    await page.getByRole('heading', { name: 'Mobile Credit Pack' }).waitFor();
    await page.getByText('Online').waitFor();

    await page.getByRole('button', { name: /Mobile Credit Pack/ }).click();
    await page.getByRole('button', { name: 'Select' }).nth(1).click();
    await assertNoVisibleOverlap(page, '[data-products-shell]');

    await page.getByRole('button', { name: 'Preview purchase' }).click();
    await page.getByRole('dialog', { name: 'Confirm payment' }).waitFor();
    await page.getByText('sku-10').waitFor();
    assert.equal(server.buyRequests.at(-1).confirmed, false);
    assert.deepEqual(server.buyRequests.at(-1).spendCap, { amount: '10', currency: 'SPACE' });
    assert.equal(server.buyRequests.at(-1).policyMode, 'confirm_paid_only');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Confirm and pay' }).click();
    assert.equal(server.buyRequests.at(-1).confirmed, true);
    assert.deepEqual(server.buyRequests.at(-1).spendCap, { amount: '10', currency: 'SPACE' });
    assert.equal(server.buyRequests.at(-1).policyMode, 'confirm_paid_only');
    await page.getByRole('heading', { name: 'Purchase submitted' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('tab', { name: 'Sell' }).click();
    await page.locator('[data-products-seller]').selectOption('seller-bot');
    await page.getByText('Digital delivery').waitFor();
    await page.getByLabel('Digital delivery').check();
    await page.locator('[data-products-listing-name]').fill('mobile-credit');
    await page.locator('[data-products-listing-title]').fill('Mobile Credit Pack');
    await page.locator('[data-products-cover-image]').fill('metafile://cover');
    await page.locator('[data-products-gallery-images]').fill('metafile://gallery-1');
    await page.locator('[data-products-description]').fill('Digital mobile credit delivered through simplemsg.');
    await page.locator('[data-products-deliverable-description]').fill('Activation code sent by simplemsg');
    await page.locator('[data-products-listing-preview-json]').getByText('"fulfillmentType": "digital_delivery"').waitFor();
    await page.getByRole('button', { name: 'Review publish' }).click();
    await page.getByRole('dialog', { name: 'Confirm listing publish' }).waitFor();
    await page.getByText('/protocols/product-listing').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByLabel('Role').selectOption('all');
    await page.getByText('payment-buyer-txid').waitFor();
    await page.getByText('payment-seller-txid').waitFor();
    await page.getByText(PRODUCT_ORDER_PIN).click();
    await page.getByRole('dialog', { name: 'Product order detail' }).waitFor();
    await page.getByText('Payment verified').waitFor();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.setViewportSize({ width: 390, height: 760 });
    await page.getByRole('tab', { name: 'Marketplace' }).click();
    await page.locator('[data-products-comment]').fill('Mobile modal acceptance check');
    await page.getByRole('button', { name: 'Preview purchase' }).click();
    await page.getByRole('dialog', { name: 'Confirm payment' }).waitFor();
    const mobileModal = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll('[role="dialog"] button')).map((button) => {
        const rect = button.getBoundingClientRect();
        return { text: button.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return { dialog, buttons, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    assert.ok(mobileModal.dialog.left >= 0);
    assert.ok(mobileModal.dialog.right <= mobileModal.viewportWidth);
    for (const button of mobileModal.buttons) {
      assert.ok(button.left >= 0, `${button.text} button is clipped on the left`);
      assert.ok(button.right <= mobileModal.viewportWidth, `${button.text} button is clipped on the right`);
      assert.ok(button.bottom <= mobileModal.viewportHeight, `${button.text} button is clipped below the viewport`);
    }
    await page.keyboard.press('Escape');

    assert.deepEqual(externalRequests, []);
    assert.ok(server.requests.some((request) => request.url?.startsWith('/api/network/products?online=true')));
    assert.ok(server.requests.some((request) => request.url?.startsWith('/api/products/skills?from=seller-bot')));
    assert.ok(server.requests.some((request) => request.url?.startsWith('/api/products/orders?from=buyer-bot')));
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server.close();
  }
});
