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
    this.children = [];
    this.listeners = new Map();
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
  }
  get firstChild() {
    return null;
  }
  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }
  appendChild(child) {
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
    '[data-conversation-guidance]',
    '[data-guidance-toggle]',
    '[data-guidance-form]',
    '[data-guidance-input]',
    '[data-guidance-send]',
    '[data-guidance-cancel]',
    '[data-guidance-status]',
    '[data-copy-toast]',
  ];
  selectors.forEach((selector) => elements.set(selector, new FakeElement()));
  const context = {
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
  context.__elements = elements;
  return context;
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

test('submits footer guidance for the selected conversation, disables send in flight, and refreshes the thread on success', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  const requests = [];
  let guidanceResolve;
  const guidancePromise = new Promise((resolve) => {
    guidanceResolve = resolve;
  });
  const context = createConversationsScriptContext({
    locationHref: requestedUrl,
    fetch: async (url, options) => {
      const textUrl = String(url);
      requests.push({
        url: textUrl,
        method: options?.method || 'GET',
        body: options?.body || '',
      });
      if (textUrl === '/api/bot/profiles') {
        return jsonResponse({
          ok: true,
          data: {
            profiles: [{ name: 'Local Bot', slug: 'local-bot', globalMetaId: LOCAL_GLOBAL_META_ID }],
          },
        });
      }
      if (textUrl.includes('/api/conversations?')) {
        return jsonResponse({
          ok: true,
          data: {
            conversations: [{
              localGlobalMetaId: LOCAL_GLOBAL_META_ID,
              peerGlobalMetaId: PEER_GLOBAL_META_ID,
              peerName: 'Peer Bot',
              latestText: 'ready',
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({
          ok: true,
          data: {
            messages: [{
              messageId: 'msg-1',
              direction: 'incoming',
              content: 'hello',
              timestamp: 1776836184000,
              sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Peer Bot' },
            }],
          },
        });
      }
      if (textUrl === '/api/conversations/guidance') {
        await guidancePromise;
        return jsonResponse({
          ok: true,
          data: {
            guidanceApplied: true,
            guidanceConsumed: true,
          },
        });
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  const toggle = context.__elements.get('[data-guidance-toggle]');
  const input = context.__elements.get('[data-guidance-input]');
  const send = context.__elements.get('[data-guidance-send]');
  const form = context.__elements.get('[data-guidance-form]');

  await waitFor(() => typeof toggle.listeners.get('click') === 'function', 'guidance toggle click binding');
  toggle.listeners.get('click')();
  input.value = 'Ask for the exact delivery date.';

  const submitPromise = form.listeners.get('submit')({
    preventDefault() {},
  });
  assert.equal(send.disabled, true);

  const guidanceRequest = requests.find((entry) => entry.url === '/api/conversations/guidance');
  assert.deepEqual(JSON.parse(guidanceRequest.body), {
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Ask for the exact delivery date.',
  });

  guidanceResolve();
  await submitPromise;
  await waitFor(
    () => requests.filter((entry) => entry.url.includes('/api/conversations/messages?')).length >= 2,
    'message refresh after guidance success',
  );

  assert.equal(input.value, '');
  assert.equal(form.hidden, true);
  const status = context.__elements.get('[data-guidance-status]');
  assert.equal(status.textContent, 'Guidance sent for the next local turn.');
});

test('keeps failed guidance visible and shows a local error status', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  const secondPeerGlobalMetaId = 'idq1z3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
  const context = createConversationsScriptContext({
    locationHref: requestedUrl,
    fetch: async (url, options) => {
      const textUrl = String(url);
      if (textUrl === '/api/bot/profiles') {
        return jsonResponse({
          ok: true,
          data: {
            profiles: [{ name: 'Local Bot', slug: 'local-bot', globalMetaId: LOCAL_GLOBAL_META_ID }],
          },
        });
      }
      if (textUrl.includes('/api/conversations?')) {
        return jsonResponse({
          ok: true,
          data: {
            conversations: [
              {
                localGlobalMetaId: LOCAL_GLOBAL_META_ID,
                peerGlobalMetaId: PEER_GLOBAL_META_ID,
                peerName: 'Peer Bot',
                latestText: 'first',
              },
              {
                localGlobalMetaId: LOCAL_GLOBAL_META_ID,
                peerGlobalMetaId: secondPeerGlobalMetaId,
                peerName: 'Second Peer',
                latestText: 'second',
              },
            ],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({ ok: true, data: { messages: [] } });
      }
      if (textUrl === '/api/conversations/guidance') {
        return {
          ok: true,
          json: async () => ({
            ok: false,
            code: 'conversation_guidance_failed',
            message: 'Guidance submit failed.',
          }),
        };
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  const toggle = context.__elements.get('[data-guidance-toggle]');
  const input = context.__elements.get('[data-guidance-input]');
  const form = context.__elements.get('[data-guidance-form]');
  const status = context.__elements.get('[data-guidance-status]');
  const list = context.__elements.get('[data-conversation-list]');

  await waitFor(() => typeof toggle.listeners.get('click') === 'function', 'guidance toggle click binding');
  toggle.listeners.get('click')();
  input.value = 'Stay visible on error.';
  await form.listeners.get('submit')({ preventDefault() {} });

  assert.equal(form.hidden, false);
  assert.equal(input.value, 'Stay visible on error.');
  assert.equal(status.textContent, 'Guidance failed.');

  await waitFor(
    () => list.children.some((child) => child.dataset.peerGlobalMetaId === secondPeerGlobalMetaId),
    'second peer row',
  );
  const secondRow = list.children.find((child) => child.dataset.peerGlobalMetaId === secondPeerGlobalMetaId);
  await secondRow.listeners.get('click')();

  assert.equal(form.hidden, true);
  assert.equal(input.value, '');
  assert.equal(status.textContent, '');
});
