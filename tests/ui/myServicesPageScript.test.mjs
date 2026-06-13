import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildMyServicesPageDefinition } = require('../../dist/ui/pages/my-services/app.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
  }

  addEventListener() {}

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(',').map((part) => part.trim()).some((part) => {
      const match = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u);
      if (!match) return false;
      const actual = this.getAttribute(match[1]);
      return match[2] === undefined ? actual !== null : actual === match[2];
    });
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }
}

function response(data) {
  return {
    json: async () => ({ ok: true, data }),
  };
}

function service(id, displayName) {
  return {
    id,
    currentPinId: id,
    sourceServicePinId: `${id}-source`,
    serviceName: displayName.toLowerCase().replace(/\s+/gu, '-'),
    displayName,
    description: `${displayName} description`,
    price: '0',
    currency: 'SPACE',
    paymentTiming: 'free',
    outputType: 'text',
    creatorMetabotName: 'Provider Bot',
    creatorMetabotSlug: 'provider-bot',
    updatedAt: 1775000010000,
    canModify: true,
    canRevoke: true,
  };
}

function order(id, paymentTxid) {
  return {
    id,
    status: 'completed',
    traceId: `trace-${id}`,
    paymentTxid,
    orderMessageTxid: `message-${id}`,
    paymentAmount: '0',
    paymentCurrency: 'SPACE',
    createdAt: 1775000020000,
    deliveredAt: 1775000030000,
    counterpartyGlobalMetaid: `buyer-${id}`,
    coworkSessionId: `session-${id}`,
    runtimeId: 'runtime-codex',
    runtimeProvider: 'codex',
  };
}

function createContext() {
  const clickListeners = [];
  const elements = {
    '[data-my-services-page-label]': new FakeElement(),
    '[data-my-services-refresh]': new FakeElement({ 'data-my-services-refresh': '' }),
    '[data-my-services-notice]': new FakeElement(),
    '[data-services-bot-picker]': new FakeElement(),
    '[data-services-bot-trigger]': new FakeElement(),
    '[data-services-bot-current]': new FakeElement(),
    '[data-services-bot-menu]': new FakeElement(),
    '[data-my-services-list]': new FakeElement(),
    '[data-my-services-list-count]': new FakeElement(),
    '[data-services-page-prev]': new FakeElement({ 'data-services-page-prev': '' }),
    '[data-services-page-next]': new FakeElement({ 'data-services-page-next': '' }),
    '[data-orders-page-prev]': new FakeElement({ 'data-orders-page-prev': '' }),
    '[data-orders-page-next]': new FakeElement({ 'data-orders-page-next': '' }),
    '[data-my-service-order-page-label]': new FakeElement(),
    '[data-my-service-detail-modal]': new FakeElement(),
    '[data-my-service-detail-modal-body]': new FakeElement(),
    '[data-my-service-edit-modal]': new FakeElement(),
    '[data-my-service-revoke-modal]': new FakeElement(),
    '[data-my-service-revoke-copy]': new FakeElement(),
    '[data-my-service-revoke-confirm]': new FakeElement(),
  };
  const orderRequestsByService = new Map();
  const servicesPage = {
    page: 1,
    pageSize: 20,
    total: 2,
    totalPages: 1,
    items: [service('service-a', 'Service A'), service('service-b', 'Service B')],
  };
  const context = {
    Element: FakeElement,
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      addEventListener: (eventName, handler) => {
        if (eventName === 'click') clickListeners.push(handler);
      },
    },
    fetch: (url) => {
      if (String(url).startsWith('/api/services/owned?')) {
        return Promise.resolve(response(servicesPage));
      }
      if (String(url).startsWith('/api/services/owned/orders?')) {
        const serviceId = new URL(String(url), 'http://localhost').searchParams.get('serviceId');
        const pending = deferred();
        const requests = orderRequestsByService.get(serviceId) ?? [];
        requests.push(pending);
        orderRequestsByService.set(serviceId, requests);
        return pending.promise.then((data) => response(data));
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    navigator: {},
    setTimeout,
    clearTimeout,
  };
  return { context, elements, clickListeners, orderRequestsByService };
}

function clickDetails(clickListeners, serviceId) {
  const target = new FakeElement({
    'data-service-action': 'details',
    'data-service-id': serviceId,
  });
  for (const listener of clickListeners) {
    listener({ target });
  }
}

test('my-services detail modal ignores stale order responses after switching services', async () => {
  const { context, elements, clickListeners, orderRequestsByService } = createContext();
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);

  await waitFor(() => orderRequestsByService.has('service-a'), 'initial service A order request');
  orderRequestsByService.get('service-a')[0].resolve({
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    items: [order('initial-a', 'payment-A-initial')],
  });
  await waitFor(() => elements['[data-my-service-detail-modal-body]'].innerHTML.includes('payment-A-initial'), 'initial order render');

  clickDetails(clickListeners, 'service-a');
  await waitFor(() => orderRequestsByService.get('service-a')?.length === 2, 'service A detail request');
  const serviceARequest = orderRequestsByService.get('service-a')[1];

  clickDetails(clickListeners, 'service-b');
  await waitFor(() => orderRequestsByService.has('service-b'), 'service B detail request');

  const loadingDetailHtml = elements['[data-my-service-detail-modal-body]'].innerHTML;
  assert.match(loadingDetailHtml, /Service B/);
  assert.doesNotMatch(loadingDetailHtml, /payment-A-initial/);

  serviceARequest.resolve({
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    items: [order('order-a', 'payment-A-race')],
  });
  await new Promise((resolve) => setImmediate(resolve));

  const detailHtml = elements['[data-my-service-detail-modal-body]'].innerHTML;
  assert.match(detailHtml, /Service B/);
  assert.doesNotMatch(detailHtml, /payment-A-race/);
});
