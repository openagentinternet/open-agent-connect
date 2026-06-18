import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildConversationsPageDefinition } = require('../../dist/ui/pages/conversations/app.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
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
    this.innerHTML = '';
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
    this.listeners = new Map();
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
  }
  get firstChild() {
    return null;
  }
  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }
  appendChild() {}
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
  scrollIntoView() {}
}

function createConversationsScriptContext({ locationHref, fetch }) {
  const location = new URL(locationHref);
  const elements = new Map();
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
