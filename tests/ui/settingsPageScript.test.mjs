import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSettingsPageDefinition } = require('../../dist/ui/pages/settings/app.js');
const { translate } = require('../../dist/ui/i18n.js');

function makeElement(tag = 'div') {
  const listeners = new Map();
  const children = new Map();
  return {
    tagName: tag,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    className: '',
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
    querySelector: (selector) => {
      if (!children.has(selector)) children.set(selector, makeElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(fetchImpl) {
  const elements = {
    '[data-settings-status]': makeElement(),
    '[data-settings-refresh]': makeElement(),
    '[data-user-live]': makeElement(),
    '[data-onboarding-live]': makeElement(),
    '[data-infra-form]': makeElement('form'),
    '[data-infra-status]': makeElement('p'),
    '[data-infra-save]': makeElement('button'),
  };
  const calls = [];
  const listeners = new Map();
  const context = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
    document: {
      querySelector: (selector) => elements[selector] ?? null,
    },
    window: {
      __oacLocalUiI18n: {
        t: (key, replacements = {}) => translate('en', key, replacements),
      },
      addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    },
  };
  return { elements, calls, context, listeners };
}

const jsonResponse = (payload) => ({ json: async () => payload });

const identityPayload = {
  ok: true,
  state: 'success',
  data: {
    identity: {
      version: 1,
      name: 'Alice',
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pk',
      chatPublicKey: 'cpk',
      mvcAddress: 'mvc-alice',
      metaId: 'metaid-alice',
      globalMetaId: 'gm-alice',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z',
    },
  },
};

test('settings page keeps failed load status when language changes', async () => {
  const elements = {
    '[data-settings-status]': {
      textContent: '',
      addEventListener() {},
    },
  };
  const listeners = new Map();
  const context = {
    document: {
      querySelector: (selector) => elements[selector] ?? null,
    },
    fetch: async () => {
      throw new Error('network down');
    },
    window: {
      __oacLocalUiI18n: {
        t: (key, replacements = {}) => {
          if (key === 'settings.status.loaded') return 'Settings snapshot loaded.';
          if (key === 'settings.status.loading') return 'Loading local runtime settings...';
          if (key === 'settings.status.failed') return 'Settings snapshot failed to load.';
          return replacements.count ? `${key}:${replacements.count}` : key;
        },
      },
      addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    },
  };

  vm.runInNewContext(buildSettingsPageDefinition().script, context);
  await waitForMicrotasks();

  assert.equal(elements['[data-settings-status]'].textContent, 'network down');
  listeners.get('oac:i18n-changed')();
  assert.equal(elements['[data-settings-status]'].textContent, 'network down');
});

test('settings user section invites action when no identity exists, then creates one', async () => {
  const calls = [];
  let identity = null;
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/user/who') return jsonResponse({ ok: true, state: 'success', data: { identity } });
    if (url === '/api/user/create') {
      const body = JSON.parse(options.body);
      identity = identityPayload.data.identity;
      return jsonResponse({
        ok: true,
        state: 'success',
        data: { identity, mnemonic: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu' },
      });
    }
    if (url === '/api/config') return jsonResponse({ ok: true, state: 'success', data: {} });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSettingsPageDefinition().script, h.context);
  await waitForMicrotasks();
  await waitForMicrotasks();

  const live = h.elements['[data-user-live]'];
  assert.match(live.innerHTML, /No owner identity on this machine yet/);

  // Create with a display name.
  live.querySelector('[data-user-create-name]').value = 'Alice';
  await live.querySelector('[data-user-create-form]').listener('submit')({ preventDefault() {} });
  await waitForMicrotasks();

  const createCall = h.calls.find((call) => call.url === '/api/user/create');
  assert.ok(createCall, 'create endpoint should be called');
  assert.deepEqual(JSON.parse(createCall.options.body), { name: 'Alice' });
  assert.match(live.innerHTML, /gm-alice/);
  assert.match(live.innerHTML, /Owner identity created\. Back up the mnemonic now/);
  // The fresh mnemonic is masked by default.
  assert.match(live.innerHTML, /••• •••/);
  assert.doesNotMatch(live.innerHTML, /alpha beta gamma/);

  // Toggling shows the words.
  live.querySelector('[data-user-mnemonic-toggle]').listener('click')();
  assert.match(live.innerHTML, /alpha beta gamma/);
});

test('settings user section guards the reveal, rename, and delete actions', async () => {
  let identity = identityPayload.data.identity;
  let mnemonic = null;
  const h = createHarness(async (url, options = {}) => {
    if (url === '/api/user/who') return jsonResponse({ ok: true, state: 'success', data: { identity } });
    if (url === '/api/user/reveal') {
      mnemonic = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
      return jsonResponse({ ok: true, state: 'success', data: { mnemonic } });
    }
    if (url === '/api/user/rename') {
      identity = { ...identity, name: JSON.parse(options.body).name };
      return jsonResponse({ ok: true, state: 'success', data: { identity } });
    }
    if (url === '/api/user/delete') {
      identity = null;
      return jsonResponse({ ok: true, state: 'success', data: { deleted: true } });
    }
    if (url === '/api/config') return jsonResponse({ ok: true, state: 'success', data: {} });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSettingsPageDefinition().script, h.context);
  await waitForMicrotasks();
  await waitForMicrotasks();

  const live = h.elements['[data-user-live]'];
  assert.match(live.innerHTML, /gm-alice/);
  assert.doesNotMatch(live.innerHTML, /alpha beta gamma/, 'mnemonic stays masked until revealed');

  // Reveal is a two-step guard and lands masked.
  assert.ok(live.querySelector('[data-user-reveal]').listener('click'), 'reveal button bound');
  live.querySelector('[data-user-reveal]').listener('click')();
  assert.match(live.innerHTML, /Click again to view/);
  assert.ok(!h.calls.some((call) => call.url === '/api/user/reveal'), 'first click only arms the guard');
  live.querySelector('[data-user-reveal-confirm]').listener('click')();
  await waitForMicrotasks();
  assert.match(live.innerHTML, /••• •••/);
  live.querySelector('[data-user-revealed-toggle]').listener('click')();
  assert.match(live.innerHTML, /alpha beta gamma/);

  // Rename via the inline form.
  live.querySelector('[data-user-rename]').listener('click')();
  live.querySelector('[data-user-rename-input]').value = 'Alice II';
  await live.querySelector('[data-user-rename-form]').listener('submit')({ preventDefault() {} });
  await waitForMicrotasks();
  const renameCall = h.calls.find((call) => call.url === '/api/user/rename');
  assert.deepEqual(JSON.parse(renameCall.options.body), { name: 'Alice II' });
  assert.match(live.innerHTML, /Alice II/);

  // Delete is a two-step guard that returns to the empty state.
  live.querySelector('[data-user-delete]').listener('click')();
  assert.match(live.innerHTML, /Click again to confirm/);
  live.querySelector('[data-user-delete-confirm]').listener('click')();
  await waitForMicrotasks();
  assert.match(live.innerHTML, /No owner identity on this machine yet/);
});

test('settings user section surfaces server errors with a fix hint', async () => {
  const h = createHarness(async (url) => {
    if (url === '/api/user/who') return jsonResponse({ ok: true, state: 'success', data: { identity: null } });
    if (url === '/api/user/create') {
      return jsonResponse({
        ok: false,
        state: 'failed',
        code: 'owner_exists',
        message: 'An owner identity already exists on this machine.',
      });
    }
    if (url === '/api/config') return jsonResponse({ ok: true, state: 'success', data: {} });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSettingsPageDefinition().script, h.context);
  await waitForMicrotasks();
  await waitForMicrotasks();

  const live = h.elements['[data-user-live]'];
  await live.querySelector('[data-user-create-form]').listener('submit')({ preventDefault() {} });
  await waitForMicrotasks();
  assert.match(
    live.innerHTML,
    /An owner identity already exists on this machine\..*delete it first/,
  );
});

test('settings General tab loads and saves the browser infrastructure base URLs', async () => {
  const settings = {
    browser: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://manapi.metaid.io',
    },
    effectiveBrowser: {},
    defaults: {
      metasoP2PBaseUrl: 'https://default-so.metaid.io',
      metafileContentBaseUrl: 'https://default-file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://default-manapi.metaid.io',
    },
  };
  const h = createHarness(async (url, options = {}) => {
    if (url === '/api/user/who') return jsonResponse({ ok: true, state: 'success', data: { identity: identityPayload.data.identity } });
    if (url === '/api/user/onboarding') return jsonResponse({ ok: true, state: 'success', data: { onboarding: null, identityPresent: true } });
    if (url === '/api/config') return jsonResponse({ ok: true, state: 'success', data: {} });
    if (url === '/api/browser/settings') {
      if (options.method === 'PUT') {
        settings.browser = { ...settings.browser, ...JSON.parse(options.body).browser };
      }
      // The save path reads the native Response ok/status fields.
      return { ok: true, status: 200, json: async () => ({ ok: true, state: 'success', data: settings }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSettingsPageDefinition().script, h.context);
  await waitForMicrotasks();
  await waitForMicrotasks();

  const form = h.elements['[data-infra-form]'];
  // The saved browser value wins; defaults become placeholders.
  assert.equal(form.querySelector('[data-settings-field="metasoP2PBaseUrl"]').value, 'https://so.metaid.io');
  assert.equal(form.querySelector('[data-settings-field="metafileContentBaseUrl"]').value, 'https://file.metaid.io/metafile-indexer');
  assert.equal(form.querySelector('[data-settings-field="manApiBaseUrl"]').value, 'https://manapi.metaid.io');
  assert.equal(form.querySelector('[data-settings-field="manApiBaseUrl"]').placeholder, 'https://default-manapi.metaid.io');

  form.querySelector('[data-settings-field="metasoP2PBaseUrl"]').value = 'https://so.example.test';
  await form.listener('submit')({ preventDefault() {} });
  await waitForMicrotasks();

  const saveCall = h.calls.find((call) => call.url === '/api/browser/settings' && call.options && call.options.method === 'PUT');
  assert.ok(saveCall, 'infrastructure save should PUT /api/browser/settings');
  assert.deepEqual(JSON.parse(saveCall.options.body), {
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://manapi.metaid.io',
    },
  });
  const status = h.elements['[data-infra-status]'];
  assert.match(status.textContent, /Base URLs saved\./);
  assert.equal(form.querySelector('[data-settings-field="metasoP2PBaseUrl"]').value, 'https://so.example.test');
});
