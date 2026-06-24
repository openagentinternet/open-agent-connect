import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBrowserPageDefinition } = require('../../dist/ui/pages/browser/app.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';

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
    '[data-browser-owner-panel]': new FakeElement(),
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
      globalMetaId: LOCAL_GLOBAL_META_ID,
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'message-view', 'template-settings'],
    }],
    defaultActor: {
      id: 'worker',
      label: 'Worker Bot',
      kind: 'oac-bot',
      globalMetaId: LOCAL_GLOBAL_META_ID,
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'message-view', 'template-settings'],
    },
    defaultUri: `metaid://${LOCAL_GLOBAL_META_ID}`,
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

function ownerPanelActionTarget(action) {
  return {
    parentElement: null,
    disabled: false,
    getAttribute: (name) => (name === 'data-browser-owner-panel-action' ? action : ''),
    hasAttribute: (name) => name === 'data-browser-owner-panel-action',
  };
}

function ownerPanelCopyTarget(value) {
  return {
    parentElement: null,
    getAttribute: (name) => (name === 'data-browser-owner-copy-meta' ? value : ''),
    hasAttribute: (name) => name === 'data-browser-owner-copy-meta',
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

test('browser renders the no-Bot state and owner panel launch chrome in Simplified Chinese', () => {
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
  owner.context.state.current.owner.globalMetaId = LOCAL_GLOBAL_META_ID;
  owner.context.state.current.owner.name = 'Worker Bot';
  owner.context.state.current.title = 'Worker Bot';

  owner.context.renderCurrent();
  owner.context.toggleOwnerPanel();

  assert.equal(owner.nodes['[data-browser-owner-panel]'].hidden, false);
  assert.match(owner.nodes['[data-browser-owner-panel]'].innerHTML, /Worker Bot/);
  assert.match(owner.nodes['[data-browser-owner-panel]'].innerHTML, /访问主页/);
  assert.match(owner.nodes['[data-browser-owner-panel]'].innerHTML, /发送信息/);
  assert.match(owner.nodes['[data-browser-owner-panel]'].innerHTML, /关注该 Bot/);
  assert.match(owner.nodes['[data-browser-owner-panel]'].innerHTML, /复制 GlobalMetaId/);
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

test('open-conversation posts payload and follows safe conversation href', async () => {
  const { context, requests } = createContext({
    actionResponse: {
      ok: true,
      data: {
        kind: 'open-conversation',
        handled: true,
        data: {
          href: `/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`,
        },
      },
    },
  });

  await context.handleTrustedAction({
    id: 'message',
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/browser/actions?actorId=worker');
  assert.deepEqual(requests[0].body, {
    resourceUri: 'metaid://idq1target',
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
    },
  });
  assert.equal(context.window.location.href, `/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`);
});

test('open-conversation blocks unsafe returned href', async () => {
  const initialHref = 'http://127.0.0.1:3000/ui/browser';
  const { context, requests } = createContext({
    actionResponse: {
      ok: true,
      data: {
        kind: 'open-conversation',
        handled: true,
        data: {
          href: 'https://attacker.example/ui/conversations?local=x&peer=y',
        },
      },
    },
  });

  await context.handleTrustedAction({
    id: 'message',
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(context.window.location.href, initialHref);
  assert.equal(context.state.status, 'error');
});

test('owner panel visit-home navigates through Browser resolution without Browser action side effects', async () => {
  const { context, nodes, requests } = createContext();

  await context.initialize();
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
  context.renderCurrent();
  context.toggleOwnerPanel();

  nodes['[data-browser-owner-panel]'].listeners.get('click')({ stopPropagation() {}, target: ownerPanelActionTarget('visit-home') });
  await waitFor(() => context.state.history.at(-1) === 'metaid://idq1alice', 'owner visit-home navigation');

  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-owner-panel]'].hidden, true);
  assert.equal(nodes['[data-browser-uri-input]'].value, 'metaid://idq1alice');
});

test('owner panel copy writes GlobalMetaId locally without calling Browser actions', async () => {
  const { context, nodes, requests, clipboardWrites } = createContext();

  await context.initialize();
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
  context.renderCurrent();
  context.toggleOwnerPanel();

  nodes['[data-browser-owner-panel]'].listeners.get('click')({ stopPropagation() {}, target: ownerPanelCopyTarget('idq1alice') });
  await waitFor(() => clipboardWrites.length === 1, 'owner copy action');

  assert.deepEqual(clipboardWrites, ['idq1alice']);
  assert.equal(requests.length, 0);
  assert.match(nodes['[data-browser-toast]'].textContent, /Copied/);
});

test('owner panel disabled actions do not call Browser action endpoints', async () => {
  const { context, nodes, requests } = createContext();

  await context.initialize();
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
  context.renderCurrent();
  context.toggleOwnerPanel();

  nodes['[data-browser-owner-panel]'].listeners.get('click')({
    stopPropagation() {},
    target: { ...ownerPanelActionTarget('send-message'), disabled: true },
  });
  await Promise.resolve();

  assert.equal(requests.length, 0);
  assert.equal(nodes['[data-browser-owner-panel]'].hidden, false);
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
