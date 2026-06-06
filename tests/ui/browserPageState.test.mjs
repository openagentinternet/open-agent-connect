import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBrowserPageDefinition } = require('../../dist/ui/pages/browser/app.js');

class FakeElement {
  constructor(value = '') {
    this.value = value;
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this.attrs = {};
    this.classList = {
      add: (...names) => {
        for (const name of names) this.attrs[`class:${name}`] = true;
      },
      remove: (...names) => {
        for (const name of names) delete this.attrs[`class:${name}`];
      },
      toggle: (name, force) => {
        const next = force === undefined ? !this.attrs[`class:${name}`] : Boolean(force);
        if (next) this.attrs[`class:${name}`] = true;
        else delete this.attrs[`class:${name}`];
      },
    };
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

  click() {
    this.listeners.get('click')?.({ preventDefault() {} });
  }

  submit() {
    this.listeners.get('submit')?.({ preventDefault() {} });
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

function createElements() {
  return {
    '[data-browser-uri-input]': new FakeElement(),
    '[data-browser-address-form]': new FakeElement(),
    '[data-browser-back]': new FakeElement(),
    '[data-browser-forward]': new FakeElement(),
    '[data-browser-reload]': new FakeElement(),
    '[data-browser-drawer-toggle]': new FakeElement(),
    '[data-browser-resource-chip]': new FakeElement(),
    '[data-browser-using-selector]': new FakeElement(),
    '[data-browser-viewport]': new FakeElement(),
    '[data-browser-status-strip]': new FakeElement(),
    '[data-browser-status-state]': new FakeElement(),
    '[data-browser-status-proof]': new FakeElement(),
    '[data-browser-status-renderer]': new FakeElement(),
    '[data-browser-status-txid]': new FakeElement(),
    '[data-browser-drawer]': new FakeElement(),
    '[data-browser-inspector]': new FakeElement(),
    '[data-browser-modal-root]': new FakeElement(),
  };
}

function resolvedBot(uri, name = 'Alice Bot') {
  return {
    ok: true,
    data: {
      uri,
      normalizedUri: uri.toLowerCase(),
      resourceType: 'bot',
      title: name,
      owner: { kind: 'bot', globalMetaId: 'idq1alice', name, verificationState: 'verified' },
      renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: { profile: { name } } },
      status: { state: 'resolved', verificationState: 'verified', message: '' },
      source: { resolver: 'test' },
      actions: [],
    },
  };
}

function createBrowserContext(options = {}) {
  const elements = createElements();
  const fetchCalls = [];
  const contextResponse = options.contextResponse ?? {
    ok: true,
    data: {
      usingIdentities: [{ slug: 'worker', name: 'Worker Bot', globalMetaId: 'idq1worker', isDefault: true }],
      defaultUsingIdentity: { slug: 'worker', name: 'Worker Bot', globalMetaId: 'idq1worker', isDefault: true },
      defaultUri: 'metaid://idq1worker',
    },
  };
  const resolveResponse = options.resolveResponse ?? ((uri) => resolvedBot(uri));
  const context = {
    console,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    String,
    Error,
    setTimeout,
    clearTimeout,
    window: {
      location: { search: options.search || '' },
      history: { replaceState() {} },
    },
    document: {
      readyState: 'complete',
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).startsWith('/api/browser/context')) {
        return { ok: true, json: async () => contextResponse };
      }
      if (String(url).startsWith('/api/browser/resolve')) {
        const uri = new URLSearchParams(String(url).split('?')[1] || '').get('uri') || '';
        const payload = typeof resolveResponse === 'function' ? resolveResponse(uri) : resolveResponse;
        return { ok: true, json: async () => payload };
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  return { context, elements, fetchCalls };
}

test('Browser query URI is decoded into the address bar and resolved', async () => {
  const { elements, fetchCalls } = createBrowserContext({ search: '?uri=metaid%3A%2F%2Fidq1alice' });

  await waitFor(() => fetchCalls.length === 2, 'context and initial resolve');

  assert.equal(elements['[data-browser-uri-input]'].value, 'metaid://idq1alice');
  assert.equal(fetchCalls[0], '/api/browser/context');
  assert.equal(fetchCalls[1], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&from=worker');
});

test('Browser loads context and resolves default URI when no query URI is present', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'context and default resolve');

  assert.equal(fetchCalls[0], '/api/browser/context');
  assert.equal(fetchCalls[1], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1worker&from=worker');
  assert.equal(context.state.usingSlug, 'worker');
  assert.equal(elements['[data-browser-uri-input]'].value, 'metaid://idq1worker');
});

test('Browser renders current resource identity separately from using identity', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    resolveResponse: (uri) => resolvedBot(uri, 'Alice Resource'),
  });

  await waitFor(() => fetchCalls.length === 2, 'resource render');

  assert.equal(elements['[data-browser-resource-chip]'].textContent, 'Alice Resource');
  assert.equal(elements['[data-browser-using-selector]'].textContent, 'Using: Worker Bot');
});

test('Browser resource chip prefers MetaApp title over publisher identity', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    resolveResponse: (uri) => ({
      ok: true,
      data: {
        uri,
        normalizedUri: uri.toLowerCase(),
        resourceType: 'metaapp',
        title: 'Fixture MetaApp',
        owner: { kind: 'metaapp-publisher', globalMetaId: 'idq1publisher', name: 'idq1publisher', verificationState: 'partial' },
        renderer: { type: 'unsupported', contentType: 'application/zip', error: 'Unsupported MetaApp content type.' },
        status: { state: 'resolved', verificationState: 'partial', message: '' },
        source: { resolver: 'test' },
        actions: [],
      },
    }),
  });

  await waitFor(() => fetchCalls.length === 2, 'MetaApp resource render');

  assert.equal(elements['[data-browser-resource-chip]'].textContent, 'Fixture MetaApp');
});

test('Browser using identity selector switches identity and reloads current URI without history entry', async () => {
  const { context, elements, fetchCalls } = createBrowserContext({
    contextResponse: {
      ok: true,
      data: {
        usingIdentities: [
          { slug: 'worker', name: 'Worker Bot', globalMetaId: 'idq1worker', isDefault: true },
          { slug: 'reviewer', name: 'Reviewer Bot', globalMetaId: 'idq1reviewer', isDefault: false },
        ],
        defaultUsingIdentity: { slug: 'worker', name: 'Worker Bot', globalMetaId: 'idq1worker', isDefault: true },
        defaultUri: 'metaid://idq1worker',
      },
    },
  });

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  elements['[data-browser-using-selector]'].click();

  assert.equal(elements['[data-browser-modal-root]'].hidden, false);
  assert.equal(elements['[data-browser-using-selector]'].getAttribute('aria-expanded'), 'true');
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Worker Bot/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Reviewer Bot/);

  await context.selectUsingIdentity('reviewer');
  await waitFor(() => fetchCalls.length === 3, 'selected identity reload');

  assert.equal(context.state.context.defaultUsingIdentity.slug, 'reviewer');
  assert.equal(context.state.usingSlug, 'reviewer');
  assert.equal(elements['[data-browser-using-selector]'].textContent, 'Using: Reviewer Bot');
  assert.equal(elements['[data-browser-modal-root]'].hidden, true);
  assert.equal(elements['[data-browser-using-selector]'].getAttribute('aria-expanded'), 'false');
  assert.equal(fetchCalls[2], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1worker&from=reviewer');
  assert.deepEqual(Array.from(context.state.history), ['metaid://idq1worker']);
  assert.equal(context.state.historyIndex, 0);
});

test('Browser history controls navigate without replacing Browser chrome', async () => {
  const { context, elements, fetchCalls } = createBrowserContext({ search: '?uri=metaid%3A%2F%2Fidq1one' });
  const topbar = elements['[data-browser-address-form]'];
  await waitFor(() => fetchCalls.length === 2, 'first resolve');

  elements['[data-browser-uri-input]'].value = 'metaid://idq1two';
  elements['[data-browser-address-form]'].submit();
  await waitFor(() => context.state.history.length === 2, 'second history entry');

  elements['[data-browser-back]'].click();
  await waitFor(() => fetchCalls.length === 4, 'back resolve');

  elements['[data-browser-forward]'].click();
  await waitFor(() => fetchCalls.length === 5, 'forward resolve');

  elements['[data-browser-reload]'].click();
  await waitFor(() => fetchCalls.length === 6, 'reload resolve');

  assert.deepEqual(Array.from(context.state.history), ['metaid://idq1one', 'metaid://idq1two']);
  assert.equal(context.state.historyIndex, 1);
  assert.equal(elements['[data-browser-address-form]'], topbar);
});

test('Browser renders a no-local-Bot empty state when context has no default identity', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    contextResponse: {
      ok: true,
      data: { usingIdentities: [], defaultUsingIdentity: null, defaultUri: null },
    },
  });

  await waitFor(() => elements['[data-browser-viewport]'].innerHTML.includes('No local Bot'), 'no local Bot render');

  assert.match(elements['[data-browser-viewport]'].innerHTML, /No local Bot/);
  assert.match(elements['[data-browser-viewport]'].innerHTML, /href="\/ui\/bot"/);
});
