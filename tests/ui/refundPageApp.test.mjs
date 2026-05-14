import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildRefundPageDefinition } = require('../../dist/ui/pages/refund/app.js');

class FakeElement {
  constructor() {
    this.textContent = '';
    this.dataset = {};
    this.disabled = false;
    this.buttons = [];
    this.listeners = new Map();
    this.attrs = {};
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.buttons = [];
    const buttonPattern = /<button\b([^>]*)>/gu;
    for (const match of this._innerHTML.matchAll(buttonPattern)) {
      const button = new FakeElement();
      const attrs = match[1] || '';
      for (const attrMatch of attrs.matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/gu)) {
        button.attrs[attrMatch[1]] = attrMatch[2];
      }
      this.buttons.push(button);
    }
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  querySelectorAll(selector) {
    return selector === '[data-settle-refund]' ? this.buttons : [];
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  getAttribute(name) {
    return this.attrs[name] || '';
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

test('refund page settle button posts the seller actor from the rendered row', async () => {
  const elements = {
    '[data-refund-status]': new FakeElement(),
    '[data-refund-total-count]': new FakeElement(),
    '[data-refund-pending-count]': new FakeElement(),
    '[data-refund-manual-count]': new FakeElement(),
    '[data-refund-buyer-count]': new FakeElement(),
    '[data-refund-seller-count]': new FakeElement(),
    '[data-refund-buyer-list]': new FakeElement(),
    '[data-refund-seller-list]': new FakeElement(),
  };
  const fetchCalls = [];
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).startsWith('/api/services/refunds?all=true')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            initiatedByMe: [],
            receivedByMe: [{
              orderId: 'seller-order-1',
              role: 'seller',
              serviceName: 'Weather Oracle',
              paymentTxid: 'payment-1',
              paymentAmount: '0.00001',
              paymentCurrency: 'SPACE',
              status: 'refund_pending',
              counterpartyGlobalMetaId: 'idq1buyer',
              counterpartyName: 'Buyer Bot',
              localMetabotSlug: 'seller-bot',
              manualActionRequired: true,
              updatedAt: 1_775_000_000_000,
            }],
            totalCount: 1,
            pendingCount: 1,
          },
        }),
      };
    }
    if (String(url) === '/api/services/refunds/settle') {
      return {
        ok: true,
        json: async () => ({ ok: true, data: { orderId: 'seller-order-1' } }),
      };
    }
    return {
      ok: false,
      json: async () => ({}),
    };
  };

  vm.runInNewContext(buildRefundPageDefinition().script, {
    document: {
      querySelector: (selector) => elements[selector] || null,
    },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    String,
    Number,
    Map,
    Promise,
    encodeURIComponent,
    Error,
    Array,
  });

  const sellerList = elements['[data-refund-seller-list]'];
  await waitFor(() => sellerList.buttons.length === 1, 'seller refund button render');
  const button = sellerList.buttons[0];
  const click = button.listeners.get('click');
  assert.equal(typeof click, 'function');

  await click();

  const settleCall = fetchCalls.find((entry) => entry.url === '/api/services/refunds/settle');
  assert.ok(settleCall, 'expected settle endpoint to be called');
  assert.deepEqual(JSON.parse(settleCall.options.body), {
    orderId: 'seller-order-1',
    from: 'seller-bot',
  });
});
