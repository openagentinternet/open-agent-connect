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

function waitFor(condition, label, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
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

test('refresh keeps already loaded older messages and only appends newer thread messages', async () => {
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
              latestText: 'latest',
            }],
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?') && textUrl.includes('before=2000')) {
        return jsonResponse({
          ok: true,
          data: {
            messages: [{
              messageId: 'msg-1',
              direction: 'incoming',
              content: 'oldest',
              timestamp: 1000,
              sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Peer Bot' },
            }],
            pagination: {
              beforeCursor: 1000,
              afterCursor: 1000,
              hasMoreBefore: false,
            },
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?') && textUrl.includes('after=3000')) {
        return jsonResponse({
          ok: true,
          data: {
            messages: [{
              messageId: 'msg-4',
              direction: 'outgoing',
              content: 'newest',
              timestamp: 4000,
              sender: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot' },
            }],
            pagination: {
              beforeCursor: 4000,
              afterCursor: 4000,
              hasMoreBefore: false,
            },
          },
        });
      }
      if (textUrl.includes('/api/conversations/messages?')) {
        return jsonResponse({
          ok: true,
          data: {
            messages: [
              {
                messageId: 'msg-2',
                direction: 'outgoing',
                content: 'middle',
                timestamp: 2000,
                sender: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot' },
              },
              {
                messageId: 'msg-3',
                direction: 'incoming',
                content: 'latest',
                timestamp: 3000,
                sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Peer Bot' },
              },
            ],
            pagination: {
              beforeCursor: 2000,
              afterCursor: 3000,
              hasMoreBefore: true,
            },
          },
        });
      }
      return jsonResponse({ ok: true, data: {} });
    },
  });

  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  const messages = context.__elements.get('[data-conversation-messages]');
  const refresh = context.__elements.get('[data-conversations-refresh]');

  await waitFor(() => messages.innerHTML.includes('middle') && messages.innerHTML.includes('latest'), 'initial messages');
  await waitFor(() => messages.children.some((child) => child.className === 'btn btn-sm conversation-load-older'), 'load older button');
  const olderButton = messages.children.find((child) => child.className === 'btn btn-sm conversation-load-older');
  olderButton.listeners.get('click')();

  await waitFor(() => messages.innerHTML.includes('oldest'), 'older messages to stay visible');

  messages.scrollHeight = 500;
  messages.clientHeight = 100;
  messages.scrollTop = 0;
  refresh.listeners.get('click')();

  await waitFor(() => requests.some((url) => url.includes('after=3000')), 'newer-only refresh request');
  await waitFor(() => messages.innerHTML.includes('newest'), 'newer message appended');

  assert.ok(messages.innerHTML.includes('oldest'));
  assert.ok(messages.innerHTML.includes('middle'));
  assert.ok(messages.innerHTML.includes('latest'));
  assert.ok(messages.innerHTML.includes('newest'));
});

test('submits footer guidance, keeps a waiting status until the local message is visible, and then closes successfully', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  const requests = [];
  let messagePollCount = 0;
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
        messagePollCount += 1;
        return jsonResponse({
          ok: true,
          data: {
            messages: messagePollCount >= 4
              ? [
                  {
                    messageId: 'msg-1',
                    direction: 'incoming',
                    content: 'hello',
                    timestamp: 1776836184000,
                    sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Peer Bot' },
                  },
                  {
                    messageId: 'msg-2',
                    direction: 'outgoing',
                    content: 'guided reply',
                    timestamp: 1776836185000,
                    sender: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot' },
                  },
                ]
              : [{
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
  const status = context.__elements.get('[data-guidance-status]');

  await waitFor(() => typeof toggle.listeners.get('click') === 'function', 'guidance toggle click binding');
  toggle.listeners.get('click')();
  input.value = 'Ask for the exact delivery date.';

  const submitPromise = form.listeners.get('submit')({
    preventDefault() {},
  });
  assert.equal(form.hidden, true);
  assert.equal(toggle.disabled, true);
  assert.equal(send.disabled, true);
  assert.equal(status.textContent, 'Guiding the next local turn...');

  const guidanceRequest = requests.find((entry) => entry.url === '/api/conversations/guidance');
  assert.deepEqual(JSON.parse(guidanceRequest.body), {
    local: LOCAL_GLOBAL_META_ID,
    peer: PEER_GLOBAL_META_ID,
    guidance: 'Ask for the exact delivery date.',
  });

  guidanceResolve();
  await submitPromise;
  await waitFor(
    () => requests.filter((entry) => entry.url.includes('/api/conversations/messages?')).length >= 3,
    'message refresh after guidance acceptance',
  );

  assert.equal(input.value, '');
  assert.equal(form.hidden, true);
  assert.equal(toggle.disabled, true);
  assert.equal(send.disabled, true);
  assert.equal(status.textContent, 'Guidance accepted. Waiting for the local message...');

  await waitFor(
    () => status.textContent === 'Guidance applied. The local message is now visible.',
    'final guidance visibility status',
    3500,
  );

  assert.equal(toggle.disabled, false);
});

test('keeps refreshing the active thread during guided reply generation and closes the composer once a new local message appears', async () => {
  const requestedUrl = `http://127.0.0.1:24885/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`;
  let guidanceResolve;
  let messagePollCount = 0;
  const guidancePromise = new Promise((resolve) => {
    guidanceResolve = resolve;
  });
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
        messagePollCount += 1;
        return jsonResponse({
          ok: true,
          data: {
            messages: messagePollCount >= 2
              ? [
                  {
                    messageId: 'msg-1',
                    direction: 'incoming',
                    content: 'hello',
                    timestamp: 1776836184000,
                    sender: { globalMetaId: PEER_GLOBAL_META_ID, name: 'Peer Bot' },
                  },
                  {
                    messageId: 'msg-2',
                    direction: 'outgoing',
                    content: 'guided reply',
                    timestamp: 1776836185000,
                    sender: { globalMetaId: LOCAL_GLOBAL_META_ID, name: 'Local Bot' },
                  },
                ]
              : [{
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
  const form = context.__elements.get('[data-guidance-form]');
  const status = context.__elements.get('[data-guidance-status]');

  await waitFor(() => typeof toggle.listeners.get('click') === 'function', 'guidance toggle click binding');
  toggle.listeners.get('click')();
  input.value = 'Stay responsive while the guided reply is running.';

  const submitPromise = form.listeners.get('submit')({
    preventDefault() {},
  });

  await waitFor(
    () => status.textContent === 'Guidance applied. The local message is now visible.',
    'guided reply refresh before guidance request resolves',
    2500,
  );

  assert.equal(form.hidden, true);
  assert.equal(toggle.disabled, false);
  assert.equal(messagePollCount >= 2, true);

  guidanceResolve();
  await submitPromise;
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
