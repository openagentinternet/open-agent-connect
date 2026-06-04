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
    const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gu;
    for (const match of this._innerHTML.matchAll(buttonPattern)) {
      const button = new FakeElement();
      const attrs = match[1] || '';
      button.textContent = stripTags(match[2] || '').trim();
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

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/gu, '');
}

function createElements() {
  return {
    '[data-refund-status]': new FakeElement(),
    '[data-refund-sync-status]': new FakeElement(),
    '[data-refund-refresh]': new FakeElement(),
    '[data-refund-total-count]': new FakeElement(),
    '[data-refund-pending-count]': new FakeElement(),
    '[data-refund-manual-count]': new FakeElement(),
    '[data-refund-buyer-count]': new FakeElement(),
    '[data-refund-seller-count]': new FakeElement(),
    '[data-refund-buyer-list]': new FakeElement(),
    '[data-refund-seller-list]': new FakeElement(),
    '[data-refund-manual-alert]': new FakeElement(),
  };
}

function createRefundItem(overrides = {}) {
  return {
    orderId: 'seller-order-1',
    role: 'seller',
    serviceName: 'Weather Oracle',
    paymentTxid: 'payment-1',
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    status: 'refund_pending',
    failureReason: 'delivery_timeout',
    refundRequestPinId: 'refund-request-pin-1',
    refundTxid: null,
    refundFinalizePinId: null,
    blockingReason: null,
    refundRequestedAt: 1_775_000_010_000,
    refundCompletedAt: null,
    counterpartyGlobalMetaId: 'idq1buyer',
    counterpartyName: 'Buyer Bot',
    localMetabotSlug: 'seller-bot',
    manualActionRequired: true,
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_020_000,
    ...overrides,
  };
}

function createFetch({ sync = [{ ok: true }], lists = [], settle = [{ ok: true, data: { orderId: 'seller-order-1' } }] } = {}) {
  const calls = [];
  const syncResponses = [...sync];
  const listResponses = [...lists];
  const settleResponses = [...settle];
  const fetchImpl = async (url, options = {}) => {
    const entry = { url: String(url), options };
    calls.push(entry);
    if (entry.url === '/api/services/refunds/sync') {
      const payload = syncResponses.length ? syncResponses.shift() : { ok: true };
      if (payload instanceof Error) {
        throw payload;
      }
      return {
        ok: payload.ok !== false,
        json: async () => payload,
      };
    }
    if (entry.url.startsWith('/api/services/refunds?all=true')) {
      const payload = listResponses.length
        ? listResponses.shift()
        : { ok: true, data: { initiatedByMe: [], receivedByMe: [], totalCount: 0, pendingCount: 0 } };
      return {
        ok: payload.ok !== false,
        json: async () => payload,
      };
    }
    if (entry.url === '/api/services/refunds/settle') {
      const payload = settleResponses.length ? settleResponses.shift() : { ok: true };
      return {
        ok: payload.ok !== false,
        json: async () => payload,
      };
    }
    return {
      ok: false,
      json: async () => ({}),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function runRefundPage(fetchImpl, elements = createElements()) {
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
  return elements;
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

test('initial load calls sync before list', async () => {
  const fetchImpl = createFetch();

  runRefundPage(fetchImpl);

  await waitFor(() => fetchImpl.calls.some((entry) => entry.url.startsWith('/api/services/refunds?all=true')), 'refund list call');
  assert.deepEqual(fetchImpl.calls.slice(0, 2).map((entry) => entry.url), [
    '/api/services/refunds/sync',
    '/api/services/refunds?all=true',
  ]);
  assert.equal(JSON.parse(fetchImpl.calls[0].options.body).all, true);
});

test('sync failure still loads rows and shows status error', async () => {
  const fetchImpl = createFetch({
    sync: [{ ok: false, message: 'chain sync failed' }],
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [createRefundItem({ orderId: 'buyer-order-1', role: 'buyer', counterpartyName: 'Seller Bot' })],
        receivedByMe: [],
        totalCount: 1,
        pendingCount: 1,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  await waitFor(() => elements['[data-refund-buyer-list]'].innerHTML.includes('Seller Bot'), 'buyer refund row');
  assert.match(elements['[data-refund-sync-status]'].textContent, /chain sync failed/i);
  assert.equal(elements['[data-refund-sync-status]'].dataset.tone, 'error');
});

test('sync fetch rejection still loads local ledger and explains stale data', async () => {
  const fetchImpl = createFetch({
    sync: [new Error('fetch failed')],
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem({
          status: 'failed',
          refundRequestPinId: null,
          failureReason: 'Provider execution did not complete successfully.',
          manualActionRequired: true,
        })],
        totalCount: 1,
        pendingCount: 0,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  await waitFor(() => elements['[data-refund-seller-list]'].innerHTML.includes('Provider execution did not complete successfully.'), 'seller refund row after sync rejection');
  assert.match(elements['[data-refund-sync-status]'].textContent, /Sync failed: fetch failed/i);
  assert.equal(elements['[data-refund-sync-status]'].dataset.tone, 'error');
  assert.equal(elements['[data-refund-status]'].textContent, 'Refund records loaded from local ledger.');
});

test('seller manual refund work shows a prominent queue alert even before request proof exists', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem({
          status: 'failed',
          refundRequestPinId: null,
          manualActionRequired: true,
          traceHref: '/ui/trace?traceId=trace-provider-1',
        })],
        totalCount: 1,
        pendingCount: 0,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  await waitFor(() => elements['[data-refund-manual-alert]'].innerHTML.includes('1 seller refund needs operator attention'), 'manual refund alert');
  assert.equal(elements['[data-refund-manual-count]'].textContent, '1');
  assert.match(elements['[data-refund-manual-alert]'].innerHTML, /Process seller refunds/);
  assert.match(elements['[data-refund-seller-list]'].innerHTML, /Process refund/);
});

test('refresh button repeats sync and list', async () => {
  const fetchImpl = createFetch();
  const elements = runRefundPage(fetchImpl);

  await waitFor(() => fetchImpl.calls.length === 2, 'initial sync and list');
  const refresh = elements['[data-refund-refresh]'];
  const click = refresh.listeners.get('click');
  assert.equal(typeof click, 'function');

  await click();

  await waitFor(() => fetchImpl.calls.length === 4, 'refresh sync and list');
  assert.deepEqual(fetchImpl.calls.map((entry) => entry.url), [
    '/api/services/refunds/sync',
    '/api/services/refunds?all=true',
    '/api/services/refunds/sync',
    '/api/services/refunds?all=true',
  ]);
});

test('provider manual actionable row renders Process refund button and posts selected seller actor', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem()],
        totalCount: 1,
        pendingCount: 1,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  const sellerList = elements['[data-refund-seller-list]'];
  await waitFor(() => sellerList.buttons.length === 1, 'seller refund button render');
  assert.match(sellerList.innerHTML, new RegExp(escapeRegExp(new Date(1_775_000_010_000).toLocaleString())));
  const button = sellerList.buttons[0];
  assert.equal(button.textContent, 'Process refund');
  const click = button.listeners.get('click');
  assert.equal(typeof click, 'function');

  await click();

  const settleCall = fetchImpl.calls.find((entry) => entry.url === '/api/services/refunds/settle');
  assert.ok(settleCall, 'expected settle endpoint to be called');
  assert.deepEqual(JSON.parse(settleCall.options.body), {
    orderId: 'seller-order-1',
    from: 'seller-bot',
  });
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('caller initiated row does not render a confirm button', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [createRefundItem({
          orderId: 'buyer-order-1',
          role: 'buyer',
          counterpartyName: 'Seller Bot',
          localMetabotSlug: 'buyer-bot',
          manualActionRequired: true,
        })],
        receivedByMe: [],
        totalCount: 1,
        pendingCount: 1,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  await waitFor(() => elements['[data-refund-buyer-list]'].innerHTML.includes('Seller Bot'), 'buyer row render');
  assert.equal(elements['[data-refund-buyer-list]'].buttons.length, 0);
  assert.match(elements['[data-refund-buyer-list]'].innerHTML, /Waiting for provider refund/);
  assert.match(elements['[data-refund-buyer-list]'].innerHTML, /Waiting for the provider to process this refund request/);
});

test('blocked unsupported seller row shows blocker and no confirm button', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem({
          blockingReason: 'refund_settlement_unsupported',
          manualActionRequired: true,
        })],
        totalCount: 1,
        pendingCount: 1,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  const sellerList = elements['[data-refund-seller-list]'];
  await waitFor(() => sellerList.innerHTML.includes('refund_settlement_unsupported'), 'unsupported blocker');
  assert.equal(sellerList.buttons.length, 0);
});

test('finalized row shows refund txid or finalization pin', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem({
          status: 'refunded',
          manualActionRequired: false,
          refundTxid: 'refund-txid-1',
          refundFinalizePinId: 'refund-finalize-pin-1',
          refundCompletedAt: 1_775_000_030_000,
        })],
        totalCount: 1,
        pendingCount: 0,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  const sellerList = elements['[data-refund-seller-list]'];
  await waitFor(() => sellerList.innerHTML.includes('refund-txid-1'), 'final refund txid');
  assert.match(sellerList.innerHTML, /refund-finalize-pin-1/);
});

test('after confirm succeeds page syncs and lists again', async () => {
  const fetchImpl = createFetch({
    lists: [{
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem()],
        totalCount: 1,
        pendingCount: 1,
      },
    }, {
      ok: true,
      data: {
        initiatedByMe: [],
        receivedByMe: [createRefundItem({
          status: 'refunded',
          manualActionRequired: false,
          refundFinalizePinId: 'refund-finalize-pin-1',
          refundCompletedAt: 1_775_000_030_000,
        })],
        totalCount: 1,
        pendingCount: 0,
      },
    }],
  });
  const elements = runRefundPage(fetchImpl);

  const sellerList = elements['[data-refund-seller-list]'];
  await waitFor(() => sellerList.buttons.length === 1, 'confirm button render');
  await sellerList.buttons[0].listeners.get('click')();

  await waitFor(() => sellerList.innerHTML.includes('refund-finalize-pin-1'), 'finalized row reload');
  assert.deepEqual(fetchImpl.calls.map((entry) => entry.url), [
    '/api/services/refunds/sync',
    '/api/services/refunds?all=true',
    '/api/services/refunds/settle',
    '/api/services/refunds/sync',
    '/api/services/refunds?all=true',
  ]);
});
