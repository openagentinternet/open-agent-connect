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
    this.listeners = new Map();
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.href = this.attributes.get('href') ?? '';
  }

  addEventListener(eventName, handler) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(handler);
    this.listeners.set(eventName, listeners);
  }

  dispatchEvent(eventName, event = {}) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      handler({ target: this, currentTarget: this, preventDefault() {}, ...event });
    }
  }

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
    for (let element = this; element; element = element.parentElement ?? null) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'href') this.href = String(value);
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

function createContext(options = {}) {
  const documentListeners = new Map();
  const locationUrl = new URL(options.url ?? 'http://localhost/ui/services');
  const elements = {
    '[data-my-services-page-label]': new FakeElement(),
    '[data-my-services-publish]': new FakeElement({ href: '/ui/publish' }),
    '[data-my-services-refunds]': new FakeElement({ href: '/ui/refund' }),
    '[data-my-services-refresh]': new FakeElement({ 'data-my-services-refresh': '' }),
    '[data-my-services-notice]': new FakeElement(),
    '[data-services-bot-picker]': new FakeElement({ 'data-services-bot-picker': '' }),
    '[data-services-bot-trigger]': new FakeElement({ 'data-services-bot-trigger': '' }),
    '[data-services-bot-current]': new FakeElement(),
    '[data-services-bot-menu]': new FakeElement({ 'data-services-bot-menu': '' }),
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
  const fetchUrls = [];
  const profiles = options.profiles ?? [
    {
      slug: 'provider-bot',
      name: 'Provider Bot',
      isActive: true,
      avatar: { label: 'PB' },
    },
  ];
  const servicesPage = {
    page: 1,
    pageSize: 20,
    total: 2,
    totalPages: 1,
    items: [service('service-a', 'Service A'), service('service-b', 'Service B')],
  };
  const context = {
    Element: FakeElement,
    URL,
    URLSearchParams,
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      addEventListener: (eventName, handler) => {
        const listeners = documentListeners.get(eventName) ?? [];
        listeners.push(handler);
        documentListeners.set(eventName, listeners);
      },
    },
    fetch: (url) => {
      fetchUrls.push(String(url));
      if (String(url) === '/api/bot/profiles') {
        return Promise.resolve(response({ profiles }));
      }
      if (String(url).startsWith('/api/services/owned?')) {
        if (typeof options.fetchServicesPage === 'function') {
          return Promise.resolve(options.fetchServicesPage(String(url))).then((data) => response(data));
        }
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
    history: {
      replaceState: (state, title, url) => {
        locationUrl.href = new URL(String(url), locationUrl).href;
      },
    },
    location: locationUrl,
    window: null,
    navigator: {},
    setTimeout,
    clearTimeout,
  };
  elements['[data-services-bot-trigger]'].parentElement = elements['[data-services-bot-picker]'];
  elements['[data-services-bot-current]'].parentElement = elements['[data-services-bot-trigger]'];
  elements['[data-services-bot-menu]'].parentElement = elements['[data-services-bot-picker]'];
  context.window = context;
  return { context, elements, documentListeners, orderRequestsByService, fetchUrls, locationUrl };
}

function dispatchDocumentEvent(documentListeners, eventName, event) {
  for (const listener of documentListeners.get(eventName) ?? []) {
    listener(event);
  }
}

async function clickDetails(documentListeners, serviceId) {
  const target = new FakeElement({
    'data-service-action': 'details',
    'data-service-id': serviceId,
  });
  dispatchDocumentEvent(documentListeners, 'click', { target });
}

async function clickBotOption(documentListeners, slug) {
  const target = new FakeElement({
    'data-services-bot-option': '',
    'data-bot-slug': slug,
  });
  dispatchDocumentEvent(documentListeners, 'click', { target });
}

test('my-services detail modal ignores stale order responses after switching services', async () => {
  const { context, elements, documentListeners, orderRequestsByService } = createContext();
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

  await clickDetails(documentListeners, 'service-a');
  await waitFor(() => orderRequestsByService.get('service-a')?.length === 2, 'service A detail request');
  const serviceARequest = orderRequestsByService.get('service-a')[1];

  await clickDetails(documentListeners, 'service-b');
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

test('my-services defaults to the active bot and scopes startup links and reads', async () => {
  const { context, elements, fetchUrls, locationUrl } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: false },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: true },
    ],
  });
  vm.runInNewContext(
    buildMyServicesPageDefinition({ includePublishAction: true, includeRefundsAction: true }).script,
    context,
  );

  await waitFor(() => fetchUrls.some((url) => url.startsWith('/api/services/owned?')), 'scoped services request');

  assert.equal(fetchUrls[0], '/api/bot/profiles');
  const servicesUrl = fetchUrls.find((url) => url.startsWith('/api/services/owned?'));
  assert.ok(servicesUrl, 'expected services request');
  const params = new URL(servicesUrl, 'http://localhost').searchParams;
  assert.equal(params.get('from'), 'bob-bot');
  assert.equal(params.get('all'), null);
  assert.equal(locationUrl.search, '?from=bob-bot');
  assert.equal(elements['[data-my-services-publish]'].href, '/ui/publish?from=bob-bot');
  assert.equal(elements['[data-my-services-refunds]'].href, '/ui/refund?from=bob-bot');
  assert.match(elements['[data-services-bot-current]'].innerHTML, /Bob/);
  assert.match(elements['[data-services-bot-current]'].innerHTML, /BO/);
});

test('my-services honors a valid from query over the active bot', async () => {
  const { context, fetchUrls } = createContext({
    url: 'http://localhost/ui/services?from=alice-bot',
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: false },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: true },
    ],
  });
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);

  await waitFor(() => fetchUrls.some((url) => url.startsWith('/api/services/owned?')), 'scoped services request');

  const servicesUrl = fetchUrls.find((url) => url.startsWith('/api/services/owned?'));
  assert.ok(servicesUrl, 'expected services request');
  const params = new URL(servicesUrl, 'http://localhost').searchParams;
  assert.equal(params.get('from'), 'alice-bot');
  assert.equal(params.get('all'), null);
});

test('my-services service and order reads do not request all bots', async () => {
  const { context, documentListeners, fetchUrls, orderRequestsByService } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: true },
    ],
  });
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);

  await waitFor(() => orderRequestsByService.has('service-a'), 'initial scoped order request');
  await clickDetails(documentListeners, 'service-b');
  await waitFor(() => orderRequestsByService.has('service-b'), 'detail scoped order request');

  const scopedUrls = fetchUrls.filter((url) => url.startsWith('/api/services/owned'));
  assert.ok(scopedUrls.length >= 2, 'expected service and order requests');
  for (const url of scopedUrls) {
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('from'), 'alice-bot');
    assert.equal(parsed.searchParams.get('all'), null);
  }
});

test('my-services bot picker renders loaded profiles without an all-bots option', async () => {
  const { context, elements, fetchUrls } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: true },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: false },
    ],
  });
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);

  await waitFor(() => fetchUrls.some((url) => url.startsWith('/api/services/owned?')), 'startup services request');

  const menuHtml = elements['[data-services-bot-menu]'].innerHTML;
  assert.equal((menuHtml.match(/data-services-bot-option/gu) ?? []).length, 2);
  assert.match(menuHtml, /data-bot-slug="alice-bot"/);
  assert.match(menuHtml, /data-bot-slug="bob-bot"/);
  assert.match(menuHtml, /Alice/);
  assert.match(menuHtml, /BO/);
  assert.doesNotMatch(menuHtml, /All Bots/i);
});

test('my-services bot picker trigger, outside click, and Escape close the menu', async () => {
  const { context, elements, documentListeners, fetchUrls } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: true },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: false },
    ],
  });
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);
  await waitFor(() => fetchUrls.some((url) => url.startsWith('/api/services/owned?')), 'startup services request');

  const trigger = elements['[data-services-bot-trigger]'];
  const menu = elements['[data-services-bot-menu]'];
  assert.equal(menu.hidden, true);

  await dispatchDocumentEvent(documentListeners, 'click', { target: trigger });
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  await dispatchDocumentEvent(documentListeners, 'click', { target: trigger });
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  await dispatchDocumentEvent(documentListeners, 'click', { target: trigger });
  assert.equal(menu.hidden, false);
  await dispatchDocumentEvent(documentListeners, 'click', { target: new FakeElement() });
  assert.equal(menu.hidden, true);

  await dispatchDocumentEvent(documentListeners, 'click', { target: trigger });
  assert.equal(menu.hidden, false);
  await dispatchDocumentEvent(documentListeners, 'click', { target: elements['[data-my-services-refresh]'] });
  assert.equal(menu.hidden, true);

  await dispatchDocumentEvent(documentListeners, 'click', { target: trigger });
  assert.equal(menu.hidden, false);
  await dispatchDocumentEvent(documentListeners, 'keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('my-services bot option selection scopes URL, links, services, and clears stale detail state', async () => {
  const { context, elements, documentListeners, fetchUrls, locationUrl, orderRequestsByService } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: true },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: false },
    ],
  });
  vm.runInNewContext(
    buildMyServicesPageDefinition({ includePublishAction: true, includeRefundsAction: true }).script,
    context,
  );

  await waitFor(() => orderRequestsByService.has('service-a'), 'initial order request');
  orderRequestsByService.get('service-a')[0].resolve({
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    items: [order('initial-a', 'payment-A-initial')],
  });
  await waitFor(() => elements['[data-my-service-detail-modal-body]'].innerHTML.includes('payment-A-initial'), 'initial order render');

  await clickDetails(documentListeners, 'service-b');
  await waitFor(() => orderRequestsByService.has('service-b'), 'service B detail request');
  const staleServiceBRequest = orderRequestsByService.get('service-b')[0];

  await dispatchDocumentEvent(documentListeners, 'click', { target: elements['[data-services-bot-trigger]'] });
  await clickBotOption(documentListeners, 'bob-bot');
  await waitFor(
    () => fetchUrls.filter((url) => url.startsWith('/api/services/owned?') && new URL(url, 'http://localhost').searchParams.get('from') === 'bob-bot').length === 1,
    'bob scoped services reload',
  );

  assert.equal(elements['[data-services-bot-menu]'].hidden, true);
  assert.equal(locationUrl.search, '?from=bob-bot');
  assert.equal(elements['[data-my-services-publish]'].href, '/ui/publish?from=bob-bot');
  assert.equal(elements['[data-my-services-refunds]'].href, '/ui/refund?from=bob-bot');
  assert.match(elements['[data-services-bot-current]'].innerHTML, /Bob/);
  assert.match(elements['[data-services-bot-current]'].innerHTML, /BO/);

  const bobServicesUrl = fetchUrls.findLast((url) => url.startsWith('/api/services/owned?'));
  const params = new URL(bobServicesUrl, 'http://localhost').searchParams;
  assert.equal(params.get('from'), 'bob-bot');
  assert.equal(params.get('page'), '1');
  assert.equal(params.get('all'), null);

  const loadingDetailHtml = elements['[data-my-service-detail-modal-body]'].innerHTML;
  assert.doesNotMatch(loadingDetailHtml, /Service B/);
  assert.doesNotMatch(loadingDetailHtml, /payment-A-initial/);

  staleServiceBRequest.resolve({
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    items: [order('stale-b', 'payment-B-stale')],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(elements['[data-my-service-detail-modal-body]'].innerHTML, /payment-B-stale/);
});

test('my-services ignores stale services responses after switching bots', async () => {
  const servicesRequests = [];
  const { context, elements, documentListeners, fetchUrls, orderRequestsByService } = createContext({
    profiles: [
      { slug: 'alice-bot', name: 'Alice', avatar: { label: 'AL' }, isActive: false },
      { slug: 'bob-bot', name: 'Bob', avatar: { label: 'BO' }, isActive: true },
    ],
    fetchServicesPage: (url) => {
      const from = new URL(url, 'http://localhost').searchParams.get('from');
      const pending = deferred();
      servicesRequests.push({ from, pending });
      return pending.promise;
    },
  });
  vm.runInNewContext(buildMyServicesPageDefinition().script, context);

  await waitFor(() => servicesRequests.some((request) => request.from === 'bob-bot'), 'initial Bob services request');

  await clickBotOption(documentListeners, 'alice-bot');
  await waitFor(() => servicesRequests.some((request) => request.from === 'alice-bot'), 'Alice services request');

  servicesRequests.find((request) => request.from === 'alice-bot').pending.resolve({
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    items: [service('alice-service', 'Alice Service')],
  });
  await waitFor(() => orderRequestsByService.has('alice-service'), 'Alice order request');

  assert.match(elements['[data-services-bot-current]'].innerHTML, /Alice/);
  assert.match(elements['[data-my-services-list]'].innerHTML, /Alice Service/);
  assert.doesNotMatch(elements['[data-my-services-list]'].innerHTML, /Bob Service/);

  const aliceOrderUrl = fetchUrls.find((url) => url.startsWith('/api/services/owned/orders?') && new URL(url, 'http://localhost').searchParams.get('serviceId') === 'alice-service');
  assert.ok(aliceOrderUrl, 'expected Alice order request');
  assert.equal(new URL(aliceOrderUrl, 'http://localhost').searchParams.get('from'), 'alice-bot');

  servicesRequests.find((request) => request.from === 'bob-bot').pending.resolve({
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    items: [service('bob-service', 'Bob Service')],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(elements['[data-services-bot-current]'].innerHTML, /Alice/);
  assert.match(elements['[data-my-services-list]'].innerHTML, /Alice Service/);
  assert.doesNotMatch(elements['[data-my-services-list]'].innerHTML, /Bob Service/);
  assert.equal(orderRequestsByService.has('bob-service'), false);
  assert.equal(
    fetchUrls.some((url) => {
      if (!url.startsWith('/api/services/owned/orders?')) return false;
      const params = new URL(url, 'http://localhost').searchParams;
      return params.get('serviceId') === 'bob-service' && params.get('from') === 'alice-bot';
    }),
    false,
  );
});
