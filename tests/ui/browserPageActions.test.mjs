import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBrowserPageDefinition } = require('../../dist/ui/pages/browser/app.js');

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.attrs = {};
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(eventName, handler) { this.listeners.set(eventName, handler); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] || ''; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
}

function elements() {
  return {
    '[data-browser-shell]': new FakeElement(),
    '[data-browser-uri-input]': new FakeElement(),
    '[data-browser-address-form]': new FakeElement(),
    '[data-browser-back]': new FakeElement(),
    '[data-browser-forward]': new FakeElement(),
    '[data-browser-reload]': new FakeElement(),
    '[data-browser-drawer-toggle]': new FakeElement(),
    '[data-browser-resource-chip]': new FakeElement(),
    '[data-browser-using-selector]': new FakeElement(),
    '[data-browser-viewport]': new FakeElement(),
    '[data-browser-status-state]': new FakeElement(),
    '[data-browser-status-proof]': new FakeElement(),
    '[data-browser-status-renderer]': new FakeElement(),
    '[data-browser-status-txid]': new FakeElement(),
    '[data-browser-drawer]': new FakeElement(),
    '[data-browser-inspector]': new FakeElement(),
    '[data-browser-modal-root]': new FakeElement(),
  };
}

function createContext(options = {}) {
  const nodes = elements();
  const requests = [];
  const clipboardWrites = [];
  const context = {
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    String,
    Error,
    JSON,
    setTimeout,
    clearTimeout,
    navigator: options.clipboard === false ? {} : {
      clipboard: {
        writeText: async (value) => clipboardWrites.push(value),
      },
    },
    window: { location: { search: '' }, history: { replaceState() {} } },
    document: {
      readyState: 'loading',
      querySelector: (selector) => nodes[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: async (url, fetchOptions = {}) => {
      requests.push({ url: String(url), body: fetchOptions.body ? JSON.parse(fetchOptions.body) : null });
      return { ok: true, json: async () => ({ ok: true, data: { accepted: true } }) };
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  context.bindElements();
  context.state.context = {
    defaultUsingIdentity: { slug: 'worker', name: 'Worker Bot', globalMetaId: 'idq1worker', isDefault: true },
  };
  context.state.usingSlug = 'worker';
  context.state.current = {
    uri: 'metaid://idq1target',
    normalizedUri: 'metaid://idq1target',
    resourceType: 'bot',
    title: 'Target Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1target', name: 'Target Bot', verificationState: 'partial' },
    renderer: {
      type: 'bot-page',
      contentType: 'application/vnd.oac.bot-homepage+json',
      data: {
        services: [{
          id: 'service-id',
          currentPinId: 'service-current-pin',
          providerGlobalMetaId: 'idq1provider',
          displayName: 'Fixture Service',
          price: '0',
          currency: 'SPACE',
        }],
      },
    },
    status: { state: 'resolved', verificationState: 'partial', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };
  return { context, nodes, requests, clipboardWrites };
}

test('copy-uri writes normalized URI to clipboard and falls back to status text', async () => {
  const withClipboard = createContext();
  await withClipboard.context.handleTrustedAction({ id: 'copy-uri', kind: 'copy', uri: 'metaid://idq1target' });
  assert.deepEqual(withClipboard.clipboardWrites, ['metaid://idq1target']);

  const withoutClipboard = createContext({ clipboard: false });
  await withoutClipboard.context.handleTrustedAction({ id: 'copy-uri', kind: 'copy', uri: 'metaid://idq1target' });
  assert.match(withoutClipboard.nodes['[data-browser-status-state]'].textContent, /copied/i);
});

test('private-chat sends only after modal confirmation with existing daemon contract', async () => {
  const { context, nodes, requests } = createContext();

  await context.handleTrustedAction({ id: 'message', kind: 'private-chat' });
  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-modal-root]'].hidden, false);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /Target Bot/);

  await context.confirmPrivateChat('Hello from Browser');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/chat/private');
  assert.deepEqual(requests[0].body, {
    from: 'worker',
    to: 'idq1target',
    content: 'Hello from Browser',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'peer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'message'), false);
});

test('service-call sends only after modal confirmation with existing daemon contract', async () => {
  const { context, nodes, requests } = createContext();

  await context.handleTrustedAction({ id: 'call', kind: 'service-call', serviceId: 'service-current-pin' });
  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-modal-root]'].hidden, false);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /Fixture Service/);

  await context.confirmServiceCall('Review this payload');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/services/call');
  assert.equal(requests[0].body.from, 'worker');
  assert.equal(requests[0].body.request.servicePinId, 'service-current-pin');
  assert.equal(requests[0].body.request.providerGlobalMetaId, 'idq1provider');
  assert.equal(requests[0].body.request.userTask, 'Review this payload');
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body.request, 'input'), false);
});

test('sandboxed iframe renderer does not expose side-effect helpers to content', () => {
  const { context } = createContext();
  const html = context.renderRenderer({
    renderer: { type: 'html-iframe', contentType: 'text/html', url: 'https://metaweb.example/app' },
    owner: {},
    status: {},
    source: {},
    actions: [],
  });

  assert.match(html, /<iframe class="browser-html-frame" sandbox="allow-scripts" src=/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /allow-top-navigation/);
  assert.doesNotMatch(html, /api\/chat\/private/);
  assert.doesNotMatch(html, /api\/services\/call/);
});
