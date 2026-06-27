import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildAppsPageDefinition } = require('../../dist/ui/pages/apps/app.js');

const PIN = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

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
    this.ownerDocument = null;
    this.parentElement = null;
    this.classList = {
      values: new Set(),
      add: (...tokens) => {
        for (const token of tokens) this.classList.values.add(token);
      },
      remove: (...tokens) => {
        for (const token of tokens) this.classList.values.delete(token);
      },
      contains: (token) => this.classList.values.has(token),
    };
  }

  addEventListener(eventName, handler) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(handler);
    this.listeners.set(eventName, listeners);
  }

  async dispatchEvent(eventName, event = {}) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      await handler({ target: this, currentTarget: this, preventDefault() {}, ...event });
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

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function appsPayload(overrides = {}) {
  return {
    ok: true,
    state: 'success',
    data: {
      records: [],
      nextCursor: '',
      total: 0,
      ...overrides,
    },
  };
}

function profilesPayload(profiles = [
  {
    slug: 'alice',
    name: 'Alice',
    globalMetaId: 'idq1alice',
    avatar: null,
    homeDir: '/tmp/alice',
    isActive: true,
  },
]) {
  return {
    ok: true,
    state: 'success',
    data: {
      activeSlug: 'alice',
      profiles,
    },
  };
}

function createAppsPageContext(options = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const locationUrl = new URL(options.url ?? 'http://localhost/ui/apps');
  const body = new FakeElement();
  const elements = {
    '[data-apps-shell]': new FakeElement({ 'data-apps-shell': '' }),
    '[data-apps-notice]': new FakeElement({ 'data-apps-notice': '' }),
    '[data-apps-grid]': new FakeElement({ 'data-apps-grid': '' }),
    '[data-apps-grid-count]': new FakeElement({ 'data-apps-grid-count': '' }),
    '[data-apps-refresh]': new FakeElement({ 'data-apps-refresh': '' }),
    '[data-apps-page-prev]': new FakeElement({ 'data-apps-page-prev': '' }),
    '[data-apps-page-next]': new FakeElement({ 'data-apps-page-next': '' }),
    '[data-apps-page-label]': new FakeElement({ 'data-apps-page-label': '' }),
    '[data-apps-bot-picker]': new FakeElement({ 'data-apps-bot-picker': '' }),
    '[data-apps-publish-open]': new FakeElement({ 'data-apps-publish-open': '' }),
  };
  const document = {
    body,
    activeElement: body,
    querySelector: (selector) => elements[selector] ?? null,
    addEventListener: (eventName, handler) => {
      const listeners = documentListeners.get(eventName) ?? [];
      listeners.push(handler);
      documentListeners.set(eventName, listeners);
    },
  };
  for (const element of [body, ...Object.values(elements)]) {
    element.ownerDocument = document;
  }

  const fetchUrls = [];
  const clipboardWrites = [];
  const context = {
    Element: FakeElement,
    URL,
    URLSearchParams,
    document,
    fetch: (url) => {
      fetchUrls.push(String(url));
      if (String(url) === '/api/bot/profiles') {
        return Promise.resolve(response(options.profiles ?? profilesPayload()));
      }
      if (String(url).startsWith('/api/apps?')) {
        if (typeof options.fetchApps === 'function') {
          return Promise.resolve(options.fetchApps(String(url))).then((payload) => response(payload));
        }
        return Promise.resolve(response(options.apps ?? appsPayload()));
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
    navigator: {
      clipboard: {
        writeText: async (value) => {
          clipboardWrites.push(value);
        },
      },
    },
    addEventListener: (eventName, handler) => {
      const listeners = windowListeners.get(eventName) ?? [];
      listeners.push(handler);
      windowListeners.set(eventName, listeners);
    },
    dispatchEvent: (event) => {
      for (const handler of windowListeners.get(event.type) ?? []) {
        handler(event);
      }
    },
    setTimeout,
    clearTimeout,
  };
  context.window = context;

  const dispatchDocumentEvent = async (eventName, event) => {
    for (const listener of documentListeners.get(eventName) ?? []) {
      await listener(event);
    }
  };

  return {
    context,
    elements,
    fetchUrls,
    clipboardWrites,
    locationUrl,
    waitFor: (condition, label) => waitFor(condition, label),
    run: () => vm.runInNewContext(buildAppsPageDefinition().script, context),
    dispatchWindowEvent: (eventName) => {
      context.dispatchEvent({ type: eventName });
    },
    clickElement: async (selector) => {
      const element = elements[selector];
      await element.dispatchEvent('click', { target: element });
      await dispatchDocumentEvent('click', { target: element });
    },
    clickFake: (attributes) => dispatchDocumentEvent('click', { target: new FakeElement(attributes) }),
  };
}

test('apps page loads active Bot and requests first Apps page with page size 12', async () => {
  const context = createAppsPageContext({
    profiles: profilesPayload([{
      slug: 'alice',
      name: 'Alice',
      globalMetaId: 'idq1alice',
      avatar: null,
      homeDir: '/tmp/alice',
      isActive: true,
    }]),
    apps: appsPayload(),
  });

  context.run();

  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/apps?')), 'apps request');
  const url = new URL(context.fetchUrls.find((item) => item.startsWith('/api/apps?')), 'http://localhost');
  assert.equal(url.searchParams.get('from'), 'alice');
  assert.equal(url.searchParams.get('size'), '12');
});

test('apps page renders records and disables Run for disabled apps', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Disabled App',
        appName: 'Disabled App',
        runtime: 'browser',
        version: 'v1',
        intro: 'Disabled',
        tags: ['tool'],
        disabled: true,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Disabled App'), 'render disabled app');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Disabled/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /data-apps-run/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /disabled/);
});

test('apps page copy pin action writes the pin id to clipboard', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Copyable App',
        appName: 'Copyable App',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes(PIN), 'render pin');
  await context.clickFake({ 'data-apps-copy-pin': PIN });

  assert.deepEqual(context.clipboardWrites, [PIN]);
});

test('apps page next pagination requests the next cursor', async () => {
  const context = createAppsPageContext({
    fetchApps: (url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      return cursor === 'cursor-2'
        ? appsPayload({ records: [], nextCursor: '', total: 12 })
        : appsPayload({ records: [], nextCursor: 'cursor-2', total: 24 });
    },
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-page-next]'].hidden === false, 'next button visible');
  await context.clickElement('[data-apps-page-next]');

  await context.waitFor(
    () => context.fetchUrls.some((url) => url.startsWith('/api/apps?') && new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2'),
    'next cursor request',
  );
});

test('apps page changing Bot reloads first Apps page for the new Bot', async () => {
  const context = createAppsPageContext({
    profiles: profilesPayload([
      { slug: 'alice', name: 'Alice', globalMetaId: 'idq1alice', avatar: null, isActive: true },
      { slug: 'bob', name: 'Bob', globalMetaId: 'idq1bob', avatar: null, isActive: false },
    ]),
    apps: appsPayload({ nextCursor: 'cursor-2' }),
  });

  context.run();

  await context.waitFor(() => context.fetchUrls.some((url) => url.startsWith('/api/apps?')), 'initial apps request');
  await context.clickFake({ 'data-apps-bot-option': 'bob' });

  await context.waitFor(
    () => context.fetchUrls.filter((url) => url.startsWith('/api/apps?') && new URL(url, 'http://localhost').searchParams.get('from') === 'bob').length === 1,
    'bob apps reload',
  );

  const bobUrl = context.fetchUrls.findLast((url) => url.startsWith('/api/apps?'));
  const params = new URL(bobUrl, 'http://localhost').searchParams;
  assert.equal(params.get('from'), 'bob');
  assert.equal(params.get('size'), '12');
  assert.equal(params.get('cursor'), null);
});

test('apps page ignores rapid duplicate Next clicks and Previous returns to the first page', async () => {
  const pageTwo = deferred();
  const context = createAppsPageContext({
    fetchApps: (url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      if (cursor === 'cursor-2') {
        return pageTwo.promise;
      }
      return appsPayload({
        records: [{
          pinId: PIN,
          title: 'Page One',
          appName: 'Page One',
          disabled: false,
        }],
        nextCursor: 'cursor-2',
        total: 24,
      });
    },
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-page-next]'].hidden === false, 'next button visible');
  const firstNext = context.clickElement('[data-apps-page-next]');
  const secondNext = context.clickElement('[data-apps-page-next]');

  await context.waitFor(
    () => context.fetchUrls.filter((url) => new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2').length >= 1,
    'first next-cursor request',
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    context.fetchUrls.filter((url) => new URL(url, 'http://localhost').searchParams.get('cursor') === 'cursor-2').length,
    1,
  );

  pageTwo.resolve(appsPayload({
    records: [{
      pinId: PIN,
      title: 'Page Two',
      appName: 'Page Two',
      disabled: false,
    }],
    nextCursor: '',
    total: 24,
  }));
  await Promise.all([firstNext, secondNext]);
  await context.waitFor(() => context.elements['[data-apps-page-prev]'].hidden === false, 'previous button visible');

  const requestCountBeforePrevious = context.fetchUrls.filter((url) => url.startsWith('/api/apps?')).length;
  await context.clickElement('[data-apps-page-prev]');

  await context.waitFor(
    () => context.fetchUrls.filter((url) => url.startsWith('/api/apps?')).length > requestCountBeforePrevious,
    'previous page request',
  );
  const previousUrl = context.fetchUrls.findLast((url) => url.startsWith('/api/apps?'));
  assert.equal(new URL(previousUrl, 'http://localhost').searchParams.get('cursor'), null);
});

test('apps page re-renders dynamic labels after local UI language changes', async () => {
  const context = createAppsPageContext({
    apps: appsPayload({
      records: [{
        pinId: PIN,
        title: 'Dynamic Labels',
        appName: 'Dynamic Labels',
        disabled: false,
      }],
      total: 1,
    }),
  });

  context.run();

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Dynamic Labels'), 'render app card');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Runnable/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, />Run</);

  context.context.__oacLocalUiI18n = {
    t: (key) => ({
      'apps.runnable': 'Runnable translated',
      'apps.run': 'Run translated',
      'apps.share': 'Share translated',
      'apps.details': 'Details translated',
      'apps.copyPinId': 'Copy translated',
      'apps.pageSizeLabel': 'Size translated',
    })[key] || key,
  };
  context.dispatchWindowEvent('oac:i18n-changed');

  await context.waitFor(() => context.elements['[data-apps-grid]'].innerHTML.includes('Run translated'), 'rerender translated run label');
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Runnable translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Copy translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Share translated/);
  assert.match(context.elements['[data-apps-grid]'].innerHTML, /Details translated/);
  assert.equal(context.elements['[data-apps-page-label]'].textContent, 'Size translated');
});
