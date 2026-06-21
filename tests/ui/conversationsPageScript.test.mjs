import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildConversationsPageDefinition } = require('../../dist/ui/pages/conversations/app.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const FIRST_PEER_GLOBAL_META_ID = 'idq1a3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const FORGED_LOCAL_GLOBAL_META_ID = 'idq1y3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
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

class FakeElement {
  constructor() {
    this._innerHTML = '';
    this._pendingHtmlFragment = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.value = '';
    this.type = '';
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this._pendingHtmlFragment = this._innerHTML;
    this.children = [];
  }
  get firstChild() {
    if (this._pendingHtmlFragment) {
      return { __htmlFragment: this._pendingHtmlFragment, __source: this };
    }
    return this.children[0] ?? null;
  }
  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }
  appendChild(child) {
    if (child && typeof child.__htmlFragment === 'string') {
      this._innerHTML += child.__htmlFragment;
      if (child.__source) child.__source._pendingHtmlFragment = '';
      return child;
    }
    this.children.push(child);
    return child;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  setAttribute(name, value) {
    this[name] = String(value);
  }
  getAttribute(name) {
    return this[name] ?? null;
  }
  contains() {
    return false;
  }
  click(event = {}) {
    return this.listeners.get('click')?.(event);
  }
  scrollIntoView() {}
}

function createConversationsScriptContext({ locationHref, fetch }) {
  const location = new URL(locationHref);
  const elements = new Map();
  const windowOpenCalls = [];
  const selectors = [
    '[data-conversations-status]',
    '[data-conversations-refresh]',
    '[data-local-bot-picker]',
    '[data-local-bot-trigger]',
    '[data-local-bot-current]',
    '[data-local-bot-menu]',
    '[data-conversation-list]',
    '[data-conversation-detail-header]',
    '[data-conversation-messages]',
    '[data-copy-toast]',
  ];
  selectors.forEach((selector) => elements.set(selector, new FakeElement()));
  return {
    URL,
    URLSearchParams,
    Element: FakeElement,
    EventSource: undefined,
    document: {
      body: new FakeElement(),
      querySelector: (selector) => elements.get(selector) ?? null,
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
      addEventListener: () => {},
    },
    fetch,
    navigator: { clipboard: { writeText: async () => {} } },
    window: {
      location,
      open: (...args) => {
        windowOpenCalls.push(args);
        return null;
      },
      history: {
        replaceState: (_state, _title, nextUrl) => {
          const next = new URL(nextUrl, location.origin);
          location.href = next.href;
          location.pathname = next.pathname;
          location.search = next.search;
          location.hash = next.hash;
        },
      },
      addEventListener: () => {},
      __oacLocalUiI18n: { t: (_key, _replacements) => '' },
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    setTimeout,
    clearTimeout,
    __elements: elements,
    __windowOpenCalls: windowOpenCalls,
  };
}

test('keeps peer query when list is empty or unrelated', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  const requests = [];
  const context = createConversationsScriptContext({
    locationHref: requestedUrl,
    fetch: async (url) => {
      const textUrl = String(url);
      requests.push(textUrl);
      if (textUrl === '/api/bot/profiles') {
        return jsonResponse({
          ok: true,
          data: {
            profiles: [{
              name: 'Local Bot',
              slug: 'local-bot',
              globalMetaId: LOCAL_GLOBAL_META_ID,
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations?')) {
        return jsonResponse({
          ok: true,
          data: {
            conversations: [{
              localGlobalMetaId: LOCAL_GLOBAL_META_ID,
              peerGlobalMetaId: FORGED_LOCAL_GLOBAL_META_ID,
              latestText: 'unrelated',
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({ ok: true, data: { messages: [] } });
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  await waitFor(
    () => requests.some((url) => url.includes(`peer=${encodeURIComponent(PEER_GLOBAL_META_ID)}`)),
    'message request for explicit peer',
  );
  assert.ok(requests.every((url) => !url.includes(`peer=${encodeURIComponent(FORGED_LOCAL_GLOBAL_META_ID)}`)));
  assert.equal(context.window.location.search, `?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`);
});

test('conversation row avatar opens the remote Bot Page in a new Browser window without switching threads', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}`;
  const requests = [];
  const context = createConversationsScriptContext({
    locationHref: requestedUrl,
    fetch: async (url) => {
      const textUrl = String(url);
      requests.push(textUrl);
      if (textUrl === '/api/bot/profiles') {
        return jsonResponse({
          ok: true,
          data: {
            profiles: [{
              name: 'Local Bot',
              slug: 'local-bot',
              globalMetaId: LOCAL_GLOBAL_META_ID,
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations?')) {
        return jsonResponse({
          ok: true,
          data: {
            conversations: [
              {
                conversationId: 'conv-first',
                localGlobalMetaId: LOCAL_GLOBAL_META_ID,
                peerGlobalMetaId: FIRST_PEER_GLOBAL_META_ID,
                peerName: 'First Remote Bot',
                latestText: 'first',
              },
              {
                conversationId: 'conv-second',
                localGlobalMetaId: LOCAL_GLOBAL_META_ID,
                peerGlobalMetaId: PEER_GLOBAL_META_ID,
                peerName: 'Second Remote Bot',
                latestText: 'second',
              },
            ],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({ ok: true, data: { messages: [] } });
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  const list = context.__elements.get('[data-conversation-list]');
  await waitFor(() => list.children.length === 2, 'conversation rows');
  const secondRow = list.children[1];
  secondRow.click({
    preventDefault() {},
    stopPropagation() {},
    target: {
      closest: (selector) => (selector === '[data-bot-browser-open]'
        ? {
            getAttribute: (name) => (name === 'data-bot-browser-open' ? PEER_GLOBAL_META_ID : ''),
          }
        : null),
    },
  });

  assert.deepEqual(context.__windowOpenCalls, [[
    `/browser/metaid/${encodeURIComponent(PEER_GLOBAL_META_ID)}`,
    '_blank',
    'noopener,noreferrer',
  ]]);
  assert.equal(
    context.window.location.search,
    `?local=${LOCAL_GLOBAL_META_ID}&peer=${FIRST_PEER_GLOBAL_META_ID}`,
  );
  assert.ok(requests.some((url) => url.includes(`peer=${encodeURIComponent(FIRST_PEER_GLOBAL_META_ID)}`)));
  assert.ok(requests.every((url) => !url.includes(`peer=${encodeURIComponent(PEER_GLOBAL_META_ID)}`)));
});

test('conversation detail links only remote Bot avatars to Browser Bot Pages in a new window', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  const context = createConversationsScriptContext({
    locationHref: requestedUrl,
    fetch: async (url) => {
      const textUrl = String(url);
      if (textUrl === '/api/bot/profiles') {
        return jsonResponse({
          ok: true,
          data: {
            profiles: [{
              name: 'Local Bot',
              slug: 'local-bot',
              globalMetaId: LOCAL_GLOBAL_META_ID,
              avatarDataUrl: 'data:image/png;base64,local',
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations?')) {
        return jsonResponse({
          ok: true,
          data: {
            conversations: [{
              conversationId: 'conv-remote',
              localGlobalMetaId: LOCAL_GLOBAL_META_ID,
              localBotName: 'Local Bot',
              localAvatar: 'data:image/png;base64,local',
              peerGlobalMetaId: PEER_GLOBAL_META_ID,
              peerName: 'Remote Bot',
              peerAvatar: 'https://example.test/remote.png',
              latestText: 'hello',
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({
          ok: true,
          data: {
            messages: [
              {
                messageId: 'msg-in',
                direction: 'incoming',
                kind: 'private_chat',
                sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Remote Bot', avatar: 'https://example.test/remote.png' },
                recipient: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot', avatar: 'data:image/png;base64,local' },
                content: 'Hello',
                contentType: 'text/plain',
                timestamp: 1_777_000_000_000,
              },
              {
                messageId: 'msg-out',
                direction: 'outgoing',
                kind: 'private_chat',
                sender: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot', avatar: 'data:image/png;base64,local' },
                recipient: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Remote Bot', avatar: 'https://example.test/remote.png' },
                content: 'Hi',
                contentType: 'text/plain',
                timestamp: 1_777_000_001_000,
              },
            ],
          },
        });
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  const detailHeader = context.__elements.get('[data-conversation-detail-header]');
  const messages = context.__elements.get('[data-conversation-messages]');
  await waitFor(() => /Remote Bot/.test(detailHeader.innerHTML) && /msg-row/.test(messages.innerHTML), 'conversation detail render');

  const peerHref = `/browser/metaid/${encodeURIComponent(PEER_GLOBAL_META_ID)}`;
  assert.match(detailHeader.innerHTML, new RegExp(`href="${peerHref}"[^>]*target="_blank"`));
  assert.match(messages.innerHTML, new RegExp(`href="${peerHref}"[^>]*target="_blank"`));
  assert.doesNotMatch(detailHeader.innerHTML, new RegExp(`/browser/metaid/${encodeURIComponent(LOCAL_GLOBAL_META_ID)}`));
  assert.doesNotMatch(messages.innerHTML, new RegExp(`/browser/metaid/${encodeURIComponent(LOCAL_GLOBAL_META_ID)}`));
});
