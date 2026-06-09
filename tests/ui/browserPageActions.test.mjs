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
    '[data-browser-owner-toolbar]': new FakeElement(),
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
    window: { location: { search: '', origin: 'http://127.0.0.1:3000', href: 'http://127.0.0.1:3000/ui/browser' }, history: { replaceState() {} } },
    document: {
      documentElement: { lang: options.language || 'en' },
      readyState: 'loading',
      querySelector: (selector) => nodes[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: async (url, fetchOptions = {}) => {
      if (String(url).startsWith('/api/browser/actions')) {
        requests.push({ url: String(url), body: fetchOptions.body ? JSON.parse(fetchOptions.body) : null });
        return {
          ok: true,
          json: async () => options.actionResponse || ({ ok: true, data: { accepted: true } }),
        };
      }
      if (String(url).startsWith('/api/browser/runtime')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: context.state.runtime,
          }),
        };
      }
      if (String(url).startsWith('/api/browser/resolve')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: context.state.current,
          }),
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  context.bindElements();
  context.state.runtime = {
    host: { kind: 'oac', name: 'Open Agent Connect', localMode: true },
    actors: [{
      id: 'worker',
      label: 'Worker Bot',
      kind: 'oac-bot',
      globalMetaId: 'idq1worker',
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'template-settings'],
    }],
    defaultActor: {
      id: 'worker',
      label: 'Worker Bot',
      kind: 'oac-bot',
      globalMetaId: 'idq1worker',
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'template-settings'],
    },
    defaultUri: 'metaid://idq1worker',
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
  };
  context.state.actorId = 'worker';
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

function ownerActionTarget(action) {
  return {
    parentElement: null,
    getAttribute: (name) => (name === 'data-browser-owner-action' ? action : ''),
    hasAttribute: (name) => name === 'data-browser-owner-action',
  };
}

function modalShareCopyTarget(value) {
  return {
    parentElement: null,
    getAttribute: (name) => (name === 'data-browser-share-copy' ? value : ''),
    hasAttribute: (name) => name === 'data-browser-share-copy',
  };
}

function modalConfirmTarget(action = '') {
  return {
    parentElement: null,
    getAttribute: (name) => (name === 'data-browser-modal-action' ? action : ''),
    hasAttribute: (name) => name === 'data-browser-modal-action',
  };
}

test('copy-uri writes normalized URI to clipboard and falls back to status text', async () => {
  const withClipboard = createContext();
  await withClipboard.context.handleTrustedAction({ id: 'copy-uri', kind: 'copy', uri: 'metaid://idq1target' });
  assert.deepEqual(withClipboard.clipboardWrites, ['metaid://idq1target']);

  const withoutClipboard = createContext({ clipboard: false });
  await withoutClipboard.context.handleTrustedAction({ id: 'copy-uri', kind: 'copy', uri: 'metaid://idq1target' });
  assert.match(withoutClipboard.nodes['[data-browser-status-state]'].textContent, /copied/i);
});

test('private-chat sends only after modal confirmation with Browser action contract', async () => {
  const { context, nodes, requests } = createContext();

  await context.handleTrustedAction({ id: 'message', kind: 'private-chat' });
  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-modal-root]'].hidden, false);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /Target Bot/);

  await context.confirmPrivateChat('Hello from Browser');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/browser/actions?actorId=worker');
  assert.deepEqual(requests[0].body, {
    resourceUri: 'metaid://idq1target',
    kind: 'private-chat',
    payload: {
      to: 'idq1target',
      content: 'Hello from Browser',
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body.payload, 'peer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body.payload, 'message'), false);
});

test('browser renders the no-Bot and owner toolbar launch chrome in Simplified Chinese', () => {
  const empty = createContext({ language: 'zh-CN' });
  empty.context.state.runtime = {
    host: { kind: 'oac', name: 'Open Agent Connect', localMode: true },
    actors: [],
    defaultActor: null,
    defaultUri: null,
    features: {
      privateChat: true,
      serviceCall: true,
      cacheManagement: true,
      templateSettings: true,
      walletLogin: false,
    },
    labels: {
      actorChip: 'Using',
      noActorTitle: 'Create your first Bot',
      noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
      noActorAction: { label: 'Create Bot', href: '/ui/bot?mode=create' },
    },
  };

  empty.context.renderNoLocalBot();

  assert.match(empty.nodes['[data-browser-viewport]'].innerHTML, /创建你的第一个 Bot/);
  assert.match(empty.nodes['[data-browser-viewport]'].innerHTML, /本地 Agent 需要先拥有一个 Bot 身份/);
  assert.match(empty.nodes['[data-browser-viewport]'].innerHTML, /创建 Bot/);

  const owner = createContext({ language: 'zh-CN' });
  owner.context.state.current.owner.globalMetaId = 'idq1worker';
  owner.context.state.current.title = 'Worker Bot';

  owner.context.renderOwnerToolbar();

  assert.equal(owner.nodes['[data-browser-owner-toolbar]'].hidden, false);
  assert.match(owner.nodes['[data-browser-owner-toolbar]'].innerHTML, /本地 Bot：Worker Bot/);
  assert.match(owner.nodes['[data-browser-owner-toolbar]'].innerHTML, /编辑主页/);
  assert.match(owner.nodes['[data-browser-owner-toolbar]'].innerHTML, /配置聊天/);
  assert.match(owner.nodes['[data-browser-owner-toolbar]'].innerHTML, /查看消息/);
  assert.match(owner.nodes['[data-browser-owner-toolbar]'].innerHTML, /分享主页/);
});

test('service-call sends only after modal confirmation with Browser action contract', async () => {
  const { context, nodes, requests } = createContext();

  await context.handleTrustedAction({ id: 'call', kind: 'service-call', serviceId: 'service-current-pin' });
  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-modal-root]'].hidden, false);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /Fixture Service/);

  await context.confirmServiceCall('Review this payload');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/browser/actions?actorId=worker');
  assert.deepEqual(requests[0].body, {
    resourceUri: 'metaid://idq1target',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-current-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Review this payload',
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body.payload, 'input'), false);
});

test('owner toolbar actions send Browser owner action payloads and follow returned href', async () => {
  const { context, nodes, requests } = createContext({
    actionResponse: {
      ok: true,
      data: {
        kind: 'edit-profile',
        handled: true,
        data: { href: '/ui/bot?profile=alice&tab=info&focus=profile' },
      },
    },
  });

  await context.initialize();
  context.state.runtime.actors = [
    { id: 'worker', label: 'Worker Bot', kind: 'oac-bot', globalMetaId: 'idq1worker', isDefault: true, capabilities: [] },
    { id: 'alice', label: 'Alice Bot', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: false, capabilities: [] },
  ];
  context.state.current = {
    uri: 'metaid://idq1alice',
    normalizedUri: 'metaid://idq1alice',
    resourceType: 'bot',
    title: 'Alice Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
    renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
    status: { state: 'resolved', verificationState: 'verified', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };

  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('edit-profile') });
  await waitFor(() => requests.length === 1, 'owner edit profile action');
  await waitFor(
    () => context.window.location.href === '/ui/bot?profile=alice&tab=info&focus=profile',
    'owner action href navigation',
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/browser/actions?actorId=worker');
  assert.deepEqual(requests[0].body, {
    resourceUri: 'metaid://idq1alice',
    kind: 'edit-profile',
    payload: {
      ownerActorId: 'alice',
      ownerGlobalMetaId: 'idq1alice',
      currentUri: 'metaid://idq1alice',
    },
  });
  assert.equal(context.window.location.href, '/ui/bot?profile=alice&tab=info&focus=profile');
});

test('owner toolbar rejects unsafe javascript action hrefs', async () => {
  const initialHref = 'http://127.0.0.1:3000/ui/browser';
  const { context, nodes, requests } = createContext({
    actionResponse: {
      ok: true,
      data: {
        kind: 'edit-profile',
        handled: true,
        data: { href: 'javascript:alert(1)' },
      },
    },
  });

  await context.initialize();
  context.state.runtime.actors = [
    { id: 'worker', label: 'Worker Bot', kind: 'oac-bot', globalMetaId: 'idq1worker', isDefault: true, capabilities: [] },
    { id: 'alice', label: 'Alice Bot', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: false, capabilities: [] },
  ];
  context.state.current = {
    uri: 'metaid://idq1alice',
    normalizedUri: 'metaid://idq1alice',
    resourceType: 'bot',
    title: 'Alice Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
    renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
    status: { state: 'resolved', verificationState: 'verified', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };

  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('edit-profile') });
  await waitFor(
    () => requests.length === 1 && (context.window.location.href !== initialHref || context.state.status === 'error'),
    'unsafe javascript href handling',
  );

  assert.equal(context.window.location.href, initialHref);
  assert.equal(context.state.status, 'error');
});

test('owner toolbar rejects cross-origin action hrefs', async () => {
  const initialHref = 'http://127.0.0.1:3000/ui/browser';
  const { context, nodes, requests } = createContext({
    actionResponse: {
      ok: true,
      data: {
        kind: 'edit-profile',
        handled: true,
        data: { href: 'https://evil.example/ui/bot?profile=alice&tab=info&focus=profile' },
      },
    },
  });

  await context.initialize();
  context.state.runtime.actors = [
    { id: 'worker', label: 'Worker Bot', kind: 'oac-bot', globalMetaId: 'idq1worker', isDefault: true, capabilities: [] },
    { id: 'alice', label: 'Alice Bot', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: false, capabilities: [] },
  ];
  context.state.current = {
    uri: 'metaid://idq1alice',
    normalizedUri: 'metaid://idq1alice',
    resourceType: 'bot',
    title: 'Alice Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
    renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
    status: { state: 'resolved', verificationState: 'verified', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };

  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('edit-profile') });
  await waitFor(
    () => requests.length === 1 && (context.window.location.href !== initialHref || context.state.status === 'error'),
    'unsafe cross-origin href handling',
  );

  assert.equal(context.window.location.href, initialHref);
  assert.equal(context.state.status, 'error');
});

test('owner toolbar sends configure chat and view messages action kinds', async () => {
  const { context, nodes, requests } = createContext();

  await context.initialize();
  context.state.runtime.actors = [
    { id: 'worker', label: 'Worker Bot', kind: 'oac-bot', globalMetaId: 'idq1worker', isDefault: true, capabilities: [] },
    { id: 'alice', label: 'Alice Bot', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: false, capabilities: [] },
  ];
  context.state.current = {
    uri: 'metaid://idq1alice',
    normalizedUri: 'metaid://idq1alice',
    resourceType: 'bot',
    title: 'Alice Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
    renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
    status: { state: 'resolved', verificationState: 'verified', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };

  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('configure-chat') });
  await waitFor(() => requests.length === 1, 'owner configure chat action');
  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('view-messages') });
  await waitFor(() => requests.length === 2, 'owner view messages action');

  assert.deepEqual(requests.map((request) => request.body.kind), ['configure-chat', 'view-messages']);
  assert.deepEqual(requests.map((request) => request.body.payload), [
    {
      ownerActorId: 'alice',
      ownerGlobalMetaId: 'idq1alice',
      currentUri: 'metaid://idq1alice',
    },
    {
      ownerActorId: 'alice',
      ownerGlobalMetaId: 'idq1alice',
      currentUri: 'metaid://idq1alice',
    },
  ]);
});

test('share bot page opens a local modal without calling Browser actions', async () => {
  const { context, nodes, requests, clipboardWrites } = createContext();

  await context.initialize();
  context.state.runtime.host.publicBaseUrl = 'https://browser.example.test';
  context.state.runtime.actors = [
    { id: 'alice', label: 'Alice Bot', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
  ];
  context.state.current = {
    uri: 'metaid://idq1alice',
    normalizedUri: 'metaid://idq1alice',
    resourceType: 'bot',
    title: 'Alice Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1alice', name: 'Alice Bot', verificationState: 'verified' },
    renderer: { type: 'bot-page', contentType: 'application/vnd.oac.bot-homepage+json', data: {} },
    status: { state: 'resolved', verificationState: 'verified', message: '' },
    source: { resolver: 'test' },
    actions: [],
  };

  nodes['[data-browser-owner-toolbar]'].listeners.get('click')({ target: ownerActionTarget('share') });
  await Promise.resolve();

  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-modal-root]'].hidden, false);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /Share Bot Page/);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /metaid:\/\/idq1alice/);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /\/browser\/metaid\/idq1alice/);
  assert.match(nodes['[data-browser-modal-root]'].innerHTML, /https:\/\/browser\.example\.test\/browser\/metaid\/idq1alice/);

  nodes['[data-browser-modal-root]'].listeners.get('click')({
    target: modalShareCopyTarget('metaid://idq1alice'),
  });
  await waitFor(() => clipboardWrites.length === 1, 'share copy action');

  assert.deepEqual(clipboardWrites, ['metaid://idq1alice']);

  nodes['[data-browser-modal-root]'].listeners.get('click')({
    target: modalConfirmTarget(),
  });
  assert.equal(nodes['[data-browser-modal-root]'].hidden, true);
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
