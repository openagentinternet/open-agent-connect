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
    this._innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this.attrs = {};
    this.children = [];
    this.firstElementChild = null;
    this.nextElementSibling = null;
    this.parentElement = null;
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

  get innerHTML() {
    return this._innerHTML + this.children.map((child) => child.innerHTML).join('');
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.textContent = this._innerHTML.replace(/<[^>]*>/g, '');
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  appendChild(child) {
    const previous = this.children.at(-1);
    if (previous) previous.nextElementSibling = child;
    child.parentElement = this;
    child.nextElementSibling = null;
    this.children.push(child);
    this.firstElementChild = this.children[0];
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) return child;
    this.children.splice(index, 1);
    const previous = this.children[index - 1];
    if (previous) previous.nextElementSibling = this.children[index] || null;
    child.parentElement = null;
    child.nextElementSibling = null;
    this.firstElementChild = this.children[0] || null;
    return child;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return this.attrs[name] || '';
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  click() {
    this.listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} });
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
  const ownerPanel = new FakeElement();
  ownerPanel.hidden = true;
  return {
    '[data-browser-shell]': new FakeElement(),
    '[data-browser-uri-input]': new FakeElement(),
    '[data-browser-address-form]': new FakeElement(),
    '[data-browser-back]': new FakeElement(),
    '[data-browser-forward]': new FakeElement(),
    '[data-browser-reload]': new FakeElement(),
    '[data-browser-drawer-toggle]': new FakeElement(),
    '[data-browser-resource-chip]': new FakeElement(),
    '[data-browser-owner-panel]': ownerPanel,
    '[data-browser-using-selector]': new FakeElement(),
    '[data-browser-menu-trigger]': new FakeElement(),
    '[data-browser-menu]': new FakeElement(),
    '[data-browser-viewport]': new FakeElement(),
    '[data-browser-status-strip]': new FakeElement(),
    '[data-browser-status-state]': new FakeElement(),
    '[data-browser-status-proof]': new FakeElement(),
    '[data-browser-status-renderer]': new FakeElement(),
    '[data-browser-status-txid]': new FakeElement(),
    '[data-browser-drawer]': new FakeElement(),
    '[data-browser-inspector]': new FakeElement(),
    '[data-browser-modal-root]': new FakeElement(),
    '[data-browser-bookmark-star]': new FakeElement(),
    '[data-browser-toast]': new FakeElement(),
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
      renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', templateId: 'document', data: { profile: { name } } },
      status: { state: 'resolved', verificationState: 'verified', message: '' },
      source: { resolver: 'test' },
      actions: [],
    },
  };
}

const defaultActor = {
  id: 'worker',
  label: 'Worker Bot',
  kind: 'oac-bot',
  globalMetaId: 'idq1worker',
  isDefault: true,
  capabilities: ['private-chat', 'service-call', 'template-settings'],
};

function runtimePayload(overrides = {}) {
  const actor = overrides.defaultActor === undefined ? defaultActor : overrides.defaultActor;
  return {
    ok: true,
    data: {
      host: { kind: 'oac', name: 'Open Agent Connect', localMode: true },
      actors: [defaultActor],
      defaultActor: actor,
      defaultUri: actor && actor.globalMetaId ? `metaid://${actor.globalMetaId}` : null,
      features: {
        privateChat: true,
        serviceCall: true,
        cacheManagement: true,
        templateSettings: true,
        walletLogin: false,
      },
      labels: {
        actorChip: 'Using',
        noActorTitle: 'No Bot',
        noActorBody: 'Create a local Bot before using Browser actions.',
        noActorAction: { label: 'Create Bot', href: '/ui/bot' },
      },
      ...overrides,
    },
  };
}

function createBrowserContext(options = {}) {
  const elements = createElements();
  const fetchCalls = [];
  const runtimeResponse = options.runtimeResponse ?? runtimePayload();
  const resolveResponse = options.resolveResponse ?? ((uri) => resolvedBot(uri));
  const settingsData = options.settingsData ?? {
    browser: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://so.metaid.io/content',
      manApiBaseUrl: 'https://manapi.metaid.io',
      blockExplorerBaseUrl: 'https://www.mvcscan.com/tx',
      botHomepageTemplateId: 'document',
      defaultChainName: 'mvc',
      localMode: true,
    },
    effectiveBrowser: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://so.metaid.io/content',
      manApiBaseUrl: 'https://manapi.metaid.io',
      blockExplorerBaseUrl: 'https://www.mvcscan.com/tx',
      botHomepageTemplateId: 'document',
      defaultChainName: 'mvc',
      localMode: true,
    },
    defaults: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://so.metaid.io/content',
      manApiBaseUrl: 'https://manapi.metaid.io',
      blockExplorerBaseUrl: 'https://www.mvcscan.com/tx',
      botHomepageTemplateId: 'document',
      defaultChainName: 'mvc',
      localMode: true,
    },
  };
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
      location: { pathname: options.pathname || '/ui/browser', search: options.search || '' },
      history: { replaceState() {} },
    },
    document: {
      readyState: 'complete',
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
      addEventListener: () => {},
    },
    fetch: async (url, fetchOptions = {}) => {
      fetchCalls.push(String(url));
      if (String(url).startsWith('/api/browser/runtime')) {
        return { ok: true, json: async () => runtimeResponse };
      }
      if (String(url).startsWith('/api/browser/resolve')) {
        const uri = new URLSearchParams(String(url).split('?')[1] || '').get('uri') || '';
        const payload = typeof resolveResponse === 'function' ? resolveResponse(uri) : resolveResponse;
        return { ok: true, json: async () => payload };
      }
      if (String(url).startsWith('/api/browser/settings')) {
        if (fetchOptions.method === 'PUT') {
          const body = JSON.parse(fetchOptions.body || '{}');
          if (body.browser && typeof body.browser === 'object') {
            settingsData.browser = { ...settingsData.browser, ...body.browser };
            settingsData.effectiveBrowser = { ...settingsData.effectiveBrowser, ...body.browser };
          }
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: JSON.parse(JSON.stringify(settingsData)),
          }),
        };
      }
      if (String(url).startsWith('/api/browser/cache')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              cacheRoot: '/tmp/.metabot/cache/metaapps',
              artifactCount: 2,
              pinRecordCount: 1,
              totalBytes: 2048,
              artifacts: [],
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  return { context, elements, fetchCalls };
}

test('Browser query URI is decoded into the address bar and resolved', async () => {
  const { elements, fetchCalls } = createBrowserContext({ search: '?uri=metaid%3A%2F%2Fidq1alice' });

  await waitFor(() => fetchCalls.length === 2, 'runtime and initial resolve');

  assert.equal(elements['[data-browser-uri-input]'].value, 'metaid://idq1alice');
  assert.equal(fetchCalls[0], '/api/browser/runtime');
  assert.equal(fetchCalls[1], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&actorId=worker');
});

test('Browser MetaID deep link path is decoded into the address bar and resolved', async () => {
  const { elements, fetchCalls } = createBrowserContext({ pathname: '/browser/metaid/idq1alice' });

  await waitFor(() => fetchCalls.length === 2, 'runtime and deep link resolve');

  assert.equal(elements['[data-browser-uri-input]'].value, 'metaid://idq1alice');
  assert.equal(fetchCalls[1], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&actorId=worker');
});

test('Browser MetaApp deep link path is decoded into the address bar and resolved', async () => {
  const pinId = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
  const { elements, fetchCalls } = createBrowserContext({ pathname: `/browser/metaapp/${pinId}` });

  await waitFor(() => fetchCalls.length === 2, 'runtime and deep link resolve');

  assert.equal(elements['[data-browser-uri-input]'].value, `metaapp://${pinId}`);
  assert.equal(fetchCalls[1], `/api/browser/resolve?uri=metaapp%3A%2F%2F${pinId}&actorId=worker`);
});

test('Browser loads runtime and resolves default URI when no query URI is present', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'runtime and default resolve');

  assert.equal(fetchCalls[0], '/api/browser/runtime');
  assert.equal(fetchCalls[1], '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1worker&actorId=worker');
  assert.equal(context.state.actorId, 'worker');
  assert.equal(elements['[data-browser-uri-input]'].value, 'metaid://idq1worker');
});

test('Browser renders current resource identity separately from using identity', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    resolveResponse: (uri) => resolvedBot(uri, 'Alice Resource'),
  });

  await waitFor(() => fetchCalls.length === 2, 'resource render');

  assert.match(elements['[data-browser-resource-chip]'].innerHTML, /AR/);
  assert.equal(elements['[data-browser-resource-chip]'].getAttribute('title'), 'Alice Resource');
  assert.match(elements['[data-browser-using-selector]'].innerHTML, /Using: Worker Bot/);

  elements['[data-browser-resource-chip]'].click();
  assert.equal(elements['[data-browser-owner-panel]'].hidden, false);
  assert.match(elements['[data-browser-owner-panel]'].innerHTML, /Alice Resource/);
  assert.match(elements['[data-browser-owner-panel]'].innerHTML, /idq1alice/);
});

test('Browser owner panel renders current Bot owner actions from ABC contract', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.textContent, /Alice/);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-panel-action="visit-home"/);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-panel-action="send-message"/);
  assert.doesNotMatch(ownerPanel.innerHTML, /data-browser-owner-panel-action="send-message" disabled/);
  assert.doesNotMatch(ownerPanel.innerHTML, /data-browser-owner-panel-action="follow"/);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-copy-meta="idq1alice"/);
});

test('Browser owner panel is available for remote Bot Page owner', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1remote',
    title: 'Remote',
    owner: { globalMetaId: 'idq1remote', name: 'Remote' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.textContent, /Remote/);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-copy-meta="idq1remote"/);
});

test('Browser owner panel stays bound to resource owner when Using actor differs', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: false, capabilities: [] },
      { id: 'worker', label: 'Worker Bot', kind: 'oac-bot', globalMetaId: 'idq1worker', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.actorId = 'worker';
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  assert.match(elements['[data-browser-owner-panel]'].textContent, /Alice/);
  assert.match(elements['[data-browser-owner-panel]'].innerHTML, /data-browser-owner-copy-meta="idq1alice"/);
  assert.match(elements['[data-browser-using-selector]'].innerHTML, /Using: Worker Bot/);
});

test('Browser owner panel escapes owner labels', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice <script>alert(1)</script>', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice <script>alert(1)</script>',
    owner: { globalMetaId: 'idq1alice', name: 'Alice <script>alert(1)</script>' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.innerHTML, /Alice &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(ownerPanel.innerHTML, /<script>/);
});

test('Browser owner panel uses exact resource owner id independent of local actor matching', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'IDQ1ALICE', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-copy-meta="idq1alice"/);
  assert.doesNotMatch(ownerPanel.innerHTML, /IDQ1ALICE/);
});

test('Browser owner panel does not render removed local-owner toolbar actions', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.textContent, /Alice/);
  assert.doesNotMatch(ownerPanel.textContent, /Edit Profile/i);
  assert.doesNotMatch(ownerPanel.textContent, /Configure Chat/i);
  assert.doesNotMatch(ownerPanel.textContent, /View Messages/i);
  assert.doesNotMatch(ownerPanel.textContent, /Share Bot Page/i);
  assert.doesNotMatch(ownerPanel.textContent, /Switch to/i);
});

test('Browser owner panel renders MetaApp publisher owner', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'metaapp',
    normalizedUri: 'metaapp://fixture',
    title: 'Fixture MetaApp',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'unsupported' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  context.toggleOwnerPanel();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, false);
  assert.match(ownerPanel.textContent, /Alice/);
  assert.match(ownerPanel.innerHTML, /data-browser-owner-copy-meta="idq1alice"/);
});

test('Browser resolve errors clear the current resource state', async () => {
  const { context, elements, fetchCalls } = createBrowserContext({
    resolveResponse: (uri) => {
      if (uri === 'metaid://missing') {
        return { ok: false, message: 'Resolve failed.' };
      }
      return resolvedBot(uri, 'Alice');
    },
  });

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  context.state.runtime = {
    actors: [
      { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
    ],
    labels: { actorChip: 'Using' },
  };
  context.state.current = {
    resourceType: 'bot',
    normalizedUri: 'metaid://idq1alice',
    title: 'Alice',
    owner: { globalMetaId: 'idq1alice', name: 'Alice' },
    renderer: { type: 'bot-page' },
    status: { verificationState: 'verified' },
  };
  context.renderCurrent();

  const ownerPanel = elements['[data-browser-owner-panel]'];
  assert.equal(ownerPanel.hidden, true);

  await context.resolveUri('metaid://missing', { record: false });

  assert.equal(context.state.current, null);
  assert.match(elements['[data-browser-viewport]'].innerHTML, /Resolve failed/);
  assert.equal(ownerPanel.hidden, true);
});

test('Browser resource chip uses MetaApp publisher identity from ABC UI contract', async () => {
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

  assert.equal(elements['[data-browser-resource-chip]'].getAttribute('title'), 'idq1publisher');
  assert.doesNotMatch(elements['[data-browser-resource-chip]'].textContent, /Fixture MetaApp/);
  elements['[data-browser-resource-chip]'].click();
  assert.equal(elements['[data-browser-owner-panel]'].hidden, false);
  assert.match(elements['[data-browser-owner-panel]'].innerHTML, /idq1publisher/);
});

test('Browser using identity selector switches identity without reloading current URI', async () => {
  const reviewerActor = {
    id: 'reviewer',
    label: 'Reviewer Bot',
    kind: 'oac-bot',
    globalMetaId: 'idq1reviewer',
    isDefault: false,
    capabilities: ['private-chat', 'service-call', 'template-settings'],
  };
  const { context, elements, fetchCalls } = createBrowserContext({
    runtimeResponse: runtimePayload({
      actors: [defaultActor, reviewerActor],
      defaultActor,
      defaultUri: 'metaid://idq1worker',
    }),
  });

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  elements['[data-browser-using-selector]'].click();

  assert.equal(elements['[data-browser-modal-root]'].hidden, false);
  assert.equal(elements['[data-browser-using-selector]'].getAttribute('aria-expanded'), 'true');
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Worker Bot/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Reviewer Bot/);

  await context.selectUsingIdentity('reviewer');
  await Promise.resolve();

  assert.equal(context.state.runtime.defaultActor.id, 'reviewer');
  assert.equal(context.state.actorId, 'reviewer');
  assert.match(elements['[data-browser-using-selector]'].innerHTML, /Using: Reviewer Bot/);
  assert.equal(elements['[data-browser-modal-root]'].hidden, true);
  assert.equal(elements['[data-browser-using-selector]'].getAttribute('aria-expanded'), 'false');
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(Array.from(context.state.history), ['metaid://idq1worker']);
  assert.equal(context.state.historyIndex, 0);
});

test('Browser menu is data-driven and opens cache management settings', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  assert.ok(Array.isArray(context.browserMenuSections));
  const mainMenu = context.browserMenuSections.find((section) => section.id === 'main');
  assert.deepEqual(
    Array.from(mainMenu?.items ?? [], (item) => item.id),
    ['settings', 'name-resolution', 'templates', 'cache'],
  );

  elements['[data-browser-menu-trigger]'].click();
  assert.equal(elements['[data-browser-menu]'].hidden, false);
  assert.equal(elements['[data-browser-menu-trigger]'].getAttribute('aria-expanded'), 'true');
  assert.match(elements['[data-browser-menu]'].innerHTML, /Settings/);
  assert.match(elements['[data-browser-menu]'].innerHTML, /Name Resolution/);
  assert.match(elements['[data-browser-menu]'].innerHTML, /Bot Page Templates/);
  assert.match(elements['[data-browser-menu]'].innerHTML, /Cache Management/);

  await context.handleBrowserMenuAction('cache');

  assert.equal(elements['[data-browser-modal-root]'].hidden, false);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Base URLs/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Name Resolution/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Templates/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Cache/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /\/tmp\/\.metabot\/cache\/metaapps/);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /2 artifacts/);
  assert.equal(fetchCalls.at(-2), '/api/browser/settings?actorId=worker');
  assert.equal(fetchCalls.at(-1), '/api/browser/cache?actorId=worker');
});

test('Browser template settings expose the default Bot homepage template', async () => {
  const { context, elements, fetchCalls } = createBrowserContext();

  await waitFor(() => fetchCalls.length === 2, 'initial Browser load');

  assert.ok(Array.isArray(context.browserBotHomepageTemplates));
  assert.equal(context.browserBotHomepageTemplates.map((template) => template.id).join(','), 'document');

  await context.handleBrowserMenuAction('templates');

  assert.equal(elements['[data-browser-modal-root]'].hidden, false);
  assert.match(elements['[data-browser-modal-root]'].innerHTML, /Document/);
  assert.doesNotMatch(elements['[data-browser-modal-root]'].innerHTML, /Compact List/);
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

test('Browser renders no-actor empty state from runtime labels when runtime has no default actor', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    runtimeResponse: runtimePayload({
      actors: [],
      defaultActor: null,
      defaultUri: null,
      labels: {
        actorChip: 'Wallet',
        noActorTitle: 'Sign in with Wallet',
        noActorBody: 'Use Metalet to activate Browser actions.',
        noActorAction: { label: 'Open Wallet Login', href: '/ui/wallet' },
      },
    }),
  });

  await waitFor(() => elements['[data-browser-viewport]'].innerHTML.includes('Sign in with Wallet'), 'no actor render');

  assert.equal(fetchCalls[0], '/api/browser/runtime');
  assert.match(elements['[data-browser-viewport]'].innerHTML, /Use Metalet to activate Browser actions\./);
  assert.match(elements['[data-browser-viewport]'].innerHTML, /href="\/ui\/wallet"/);
});

test('Browser no-local-Bot empty state renders Bot creation activation entry', async () => {
  const { elements, fetchCalls } = createBrowserContext({
    runtimeResponse: runtimePayload({
      actors: [],
      defaultActor: null,
      defaultUri: null,
      labels: {
        actorChip: 'Using',
        noActorTitle: 'Create your first Bot',
        noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
        noActorAction: { label: 'Create Bot', href: '/ui/bot?mode=create' },
      },
    }),
  });

  await waitFor(() => elements['[data-browser-viewport]'].innerHTML.includes('Create your first Bot'), 'Bot creation empty state');

  assert.equal(fetchCalls[0], '/api/browser/runtime');
  assert.match(elements['[data-browser-viewport]'].innerHTML, /Your local Agent needs a Bot identity before it can appear on the Agent Internet\./);
  assert.match(elements['[data-browser-viewport]'].innerHTML, /href="\/ui\/bot\?mode=create"/);
  assert.match(elements['[data-browser-viewport]'].innerHTML, />Create Bot<\/a>/);

  assert.equal(elements['[data-browser-owner-panel]'].hidden, true);
});
