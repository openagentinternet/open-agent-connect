import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBrowserPageDefinition } = require('../../dist/ui/pages/browser/app.js');

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.hidden = false;
    this.attrs = {};
    this.listeners = new Map();
    this.children = [];
    this.firstElementChild = null;
    this.nextElementSibling = null;
    this.parentElement = null;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get innerHTML() {
    return this._innerHTML + this.children.map((child) => child.innerHTML).join('');
  }
  set innerHTML(value) { this._innerHTML = String(value); }
  addEventListener(eventName, handler) { this.listeners.set(eventName, handler); }
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
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] || ''; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  removeAttribute(name) { delete this.attrs[name]; }
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

function runWithResolve(resolvePayload) {
  const nodes = elements();
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
      createElement: () => new FakeElement(),
      addEventListener: () => {},
    },
    fetch: async (url) => {
      if (String(url).startsWith('/api/browser/resolve')) {
        return { ok: true, json: async () => ({ ok: true, data: resolvePayload }) };
      }
      return { ok: true, json: async () => ({ ok: true, data: {} }) };
    },
  };
  vm.runInNewContext(buildBrowserPageDefinition().script, context);
  return { context, nodes };
}

function result(renderer, overrides = {}) {
  return {
    uri: 'metaapp://pin',
    normalizedUri: 'metaapp://pin',
    resourceType: 'metaapp',
    title: 'Fixture',
    owner: { kind: 'metaapp-publisher', globalMetaId: 'idq1publisher', name: 'Publisher', verificationState: 'partial' },
    renderer,
    status: { state: 'resolved', verificationState: 'partial', message: '' },
    proof: { txid: 'txid-1', pinId: 'pin-1', verificationState: 'partial' },
    source: { resolver: 'test', raw: { kept: true } },
    actions: [],
    ...overrides,
  };
}

test('bot-page renderer shows profile, services, and trusted buttons from homepage JSON', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const { nodes } = runWithResolve(result({
    type: 'bot-page',
    contentType: 'application/vnd.oac.bot-homepage+json',
    data: fixture,
  }, {
    resourceType: 'bot',
    title: 'Fixture Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1fixturebot', name: 'Fixture Bot', avatar: fixture.profile.avatar, verificationState: 'partial' },
    actions: fixture.actions,
  }));

  await waitFor(() => nodes['[data-browser-viewport]'].innerHTML.includes('Fixture Review'), 'bot page render');
  const html = nodes['[data-browser-viewport]'].innerHTML;
  assert.match(html, /Fixture Bot/);
  assert.match(html, /idq1fixturebot/);
  assert.match(html, /Builds OAC browser fixtures/);
  assert.match(html, /Overview/);
  assert.match(html, /Recent Activity/);
  assert.match(html, /Fixture Review/);
  assert.match(html, /data-browser-action="private-chat"/);
  assert.match(html, /data-browser-action="service-call"/);
  assert.doesNotMatch(html, /data-browser-action="service-list"/);
  assert.match(html, /https:\/\/so\.example\.test\/content\/avatar-pin/);
});

test('bot-page renderer uses compact-list template with normalized future lists', async () => {
  const homepage = {
    globalMetaId: 'idq1compactbot',
    profile: {
      name: 'Compact Bot',
      avatar: 'https://so.example.test/content/compact-avatar',
      bio: 'Runs compact Browser fixtures.',
    },
    homepage: {
      summary: 'Compact summary.',
    },
    services: [
      {
        id: 'svc-review',
        currentPinId: 'service-pin-1',
        displayName: 'Review Service',
        description: 'Reviews Browser templates.',
      },
    ],
    skills: [
      {
        name: 'Template Authoring',
        description: 'Creates Bot homepage layouts.',
      },
    ],
    buzz: [
      {
        title: 'Template update',
        description: 'Published a compact renderer.',
      },
    ],
  };
  const { nodes } = runWithResolve(result({
    type: 'bot-page',
    contentType: 'application/vnd.oac.bot-homepage+json',
    templateId: 'compact-list',
    data: homepage,
  }, {
    resourceType: 'bot',
    title: 'Compact Bot',
    owner: { kind: 'bot', globalMetaId: 'idq1compactbot', name: 'Compact Bot', verificationState: 'verified' },
    actions: [],
  }));

  await waitFor(() => nodes['[data-browser-viewport]'].innerHTML.includes('browser-bot-template-compact-list'), 'compact template render');
  const html = nodes['[data-browser-viewport]'].innerHTML;
  assert.match(html, /Compact Bot/);
  assert.match(html, /Review Service/);
  assert.match(html, /data-browser-action="service-call"/);
  assert.match(html, /Template Authoring/);
  assert.match(html, /Template update/);
  assert.match(html, /Compact summary/);
});

test('html-iframe renderer is sandboxed without privileged permissions', async () => {
  const { nodes } = runWithResolve(result({
    type: 'html-iframe',
    contentType: 'text/html',
    url: 'https://metaweb.example/app',
  }));

  await waitFor(() => nodes['[data-browser-viewport]'].innerHTML.includes('browser-html-frame'), 'iframe render');
  const html = nodes['[data-browser-viewport]'].innerHTML;
  assert.match(html, /<iframe class="browser-html-frame" sandbox="allow-scripts allow-downloads" src="https:\/\/metaweb\.example\/app"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /allow-top-navigation/);
  assert.doesNotMatch(html, /wallet|payment|signing/i);
});

test('pdf, image, and video render with content-specific elements', async () => {
  const pdf = runWithResolve(result({ type: 'pdf', contentType: 'application/pdf', url: 'https://files.example/a.pdf' }));
  await waitFor(() => pdf.nodes['[data-browser-viewport]'].innerHTML.includes('browser-pdf'), 'pdf render');
  assert.match(pdf.nodes['[data-browser-viewport]'].innerHTML, /<iframe class="browser-pdf" sandbox="" src="https:\/\/files\.example\/a\.pdf"/);

  const image = runWithResolve(result({ type: 'image', contentType: 'image/png', url: 'https://files.example/a.png' }));
  await waitFor(() => image.nodes['[data-browser-viewport]'].innerHTML.includes('browser-image'), 'image render');
  assert.match(image.nodes['[data-browser-viewport]'].innerHTML, /<img class="browser-image" src="https:\/\/files\.example\/a\.png" alt=""/);

  const video = runWithResolve(result({ type: 'video', contentType: 'video/mp4', url: 'https://files.example/a.mp4' }));
  await waitFor(() => video.nodes['[data-browser-viewport]'].innerHTML.includes('data-browser-video-preview'), 'video preview render');
  assert.match(video.nodes['[data-browser-viewport]'].innerHTML, /class="browser-pin-media-preview browser-pin-media-preview-video"/);
  assert.match(video.nodes['[data-browser-viewport]'].innerHTML, /Loading video/);
});

test('unsupported renderer keeps source details available for Inspector', async () => {
  const payload = result({
    type: 'unsupported',
    contentType: 'application/octet-stream',
    error: 'Unsupported MetaApp content type.',
  });
  const { context, nodes } = runWithResolve(payload);

  await waitFor(() => nodes['[data-browser-viewport]'].innerHTML.includes('Unsupported renderer'), 'unsupported render');
  assert.match(nodes['[data-browser-viewport]'].innerHTML, /Unsupported MetaApp content type/);
  assert.deepEqual(context.state.current.source.raw, { kept: true });
});

test('renderer URLs pass through safeUrl and reject unsafe schemes', async () => {
  const { nodes } = runWithResolve(result({
    type: 'html-iframe',
    contentType: 'text/html',
    url: 'javascript:alert(1)',
  }));

  await waitFor(() => nodes['[data-browser-viewport]'].innerHTML.includes('Renderer URL blocked'), 'unsafe render');
  assert.doesNotMatch(nodes['[data-browser-viewport]'].innerHTML, /javascript:alert/);
});
