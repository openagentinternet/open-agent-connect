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
  click() { this.listeners.get('click')?.({ preventDefault() {} }); }
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - startedAt > 1000) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(check, 5);
    };
    check();
  });
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

function browserResult(uri, overrides = {}) {
  return {
    uri,
    normalizedUri: uri.toLowerCase(),
    resourceType: 'bot',
    title: 'Fixture Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1fixturebot', name: 'Fixture Bot', verificationState: 'partial' },
    renderer: { type: 'unsupported', contentType: 'application/octet-stream', error: 'Unsupported MetaApp content type.' },
    status: { state: 'resolved', verificationState: 'partial', message: '' },
    proof: {
      txid: 'txid-fixture',
      pinId: 'pin-fixture',
      protocolPath: '/info/bio',
      contentHash: 'sha256:bio',
      publisherGlobalMetaId: 'idq1fixturebot',
      explorerUrl: 'https://explorer.example/txid-fixture',
      verificationState: 'partial',
    },
    source: { resolver: 'test-resolver', url: 'https://resolver.example', raw: { ok: true } },
    actions: [],
    ...overrides,
  };
}

function createContext() {
  const nodes = elements();
  const responses = new Map([
    ['metaid://idq1fixturebot', browserResult('metaid://idq1fixturebot')],
    ['metaapp://pin', browserResult('metaapp://pin', {
      resourceType: 'metaapp',
      title: 'Fixture MetaApp',
      owner: { kind: 'metaapp-publisher', globalMetaId: 'idq1publisher', name: 'Publisher', verificationState: 'partial' },
    })],
  ]);
  const context = {
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    String,
    Error,
    setTimeout,
    clearTimeout,
    window: { location: { search: '?uri=metaid%3A%2F%2Fidq1fixturebot' }, history: { replaceState() {} } },
    document: {
      readyState: 'complete',
      querySelector: (selector) => nodes[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: async (url) => {
      const uri = new URLSearchParams(String(url).split('?')[1] || '').get('uri') || '';
      return { ok: true, json: async () => ({ ok: true, data: responses.get(uri) || browserResult(uri) }) };
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  return { context, nodes };
}

test('Browser drawer and Inspector are hidden by default in the shell', () => {
  const definition = buildBrowserPageDefinition();
  assert.match(definition.contentHtml, /data-browser-drawer hidden/);
  assert.match(definition.contentHtml, /data-browser-inspector hidden/);
});

test('Browser chrome uses icon-only toolbar controls and avoids prototype labels', () => {
  const definition = buildBrowserPageDefinition();
  const html = definition.contentHtml;
  assert.match(html, /aria-label="Back"/);
  assert.match(html, /aria-label="Forward"/);
  assert.match(html, /aria-label="Reload"/);
  assert.match(html, /aria-label="Bookmarks and history"/);
  assert.doesNotMatch(html, />Back</);
  assert.doesNotMatch(html, />Forward</);
  assert.doesNotMatch(html, />Reload</);
  assert.doesNotMatch(html, />Bookmarks</);
  assert.doesNotMatch(html, />Open</);
  assert.doesNotMatch(html, /Browser-owned controls/);
});

test('Drawer opens from drawer button and shows bookmarks, recents, and visit history', async () => {
  const { context, nodes } = createContext();
  await waitFor(() => context.state.current, 'initial resource');
  await context.navigateTo('metaapp://pin');

  nodes['[data-browser-drawer-toggle]'].click();

  assert.equal(nodes['[data-browser-drawer]'].hidden, false);
  const html = nodes['[data-browser-drawer]'].innerHTML;
  assert.match(html, /Bookmarks/);
  assert.match(html, /Recent Bots/);
  assert.match(html, /Fixture Bot/);
  assert.match(html, /Fixture MetaApp/);
  assert.match(html, /History/);
  assert.match(html, /metaid:\/\/idq1fixturebot/);
});

test('Inspector opens from resource, proof, and TXID controls with scoped section labels', async () => {
  const { context, nodes } = createContext();
  await waitFor(() => context.state.current, 'initial resource');

  nodes['[data-browser-resource-chip]'].click();
  assert.equal(nodes['[data-browser-inspector]'].hidden, false);
  assert.match(nodes['[data-browser-inspector]'].innerHTML, /<h3>Identity<\/h3>/);
  assert.match(nodes['[data-browser-inspector]'].innerHTML, /<h3>Proof<\/h3>/);
  assert.match(nodes['[data-browser-inspector]'].innerHTML, /<h3>Source<\/h3>/);

  nodes['[data-browser-inspector]'].innerHTML = '';
  nodes['[data-browser-status-proof]'].click();
  assert.match(nodes['[data-browser-inspector]'].innerHTML, /<h3>Proof<\/h3>/);

  nodes['[data-browser-inspector]'].innerHTML = '';
  nodes['[data-browser-status-txid]'].click();
  assert.match(nodes['[data-browser-inspector]'].innerHTML, /txid-fixture/);

  const defaultHtml = buildBrowserPageDefinition().contentHtml;
  assert.doesNotMatch(defaultHtml, />Identity</);
  assert.doesNotMatch(defaultHtml, />Proof</);
  assert.doesNotMatch(defaultHtml, />Source</);
});

test('Inspector proof labels use TXID and include proof details', async () => {
  const { context, nodes } = createContext();
  await waitFor(() => context.state.current, 'initial resource');

  nodes['[data-browser-status-txid]'].click();
  const html = nodes['[data-browser-inspector]'].innerHTML;

  assert.match(nodes['[data-browser-status-txid]'].textContent, /TXID/);
  assert.doesNotMatch(nodes['[data-browser-status-txid]'].textContent, /TSID/);
  assert.match(html, /TXID/);
  assert.doesNotMatch(html, /TSID/);
  assert.match(html, /pin id/);
  assert.match(html, /protocol path/);
  assert.match(html, /content hash/);
  assert.match(html, /publisher GlobalMetaId/);
  assert.match(html, /block explorer action/);
  assert.match(html, /View on Block Explorer/);
});
