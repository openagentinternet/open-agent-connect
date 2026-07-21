import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { renderTopbarSettingsScript } = require('../../dist/ui/topbarChrome.js');

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.placeholder = '';
    this.textContent = '';
    this.attrs = {};
    this.listeners = new Map();
    this.children = new Map();
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  querySelector(selector) {
    return this.children.get(selector) ?? null;
  }

  focus() {}
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createContext() {
  const modal = new FakeElement();
  modal.hidden = true;
  const trigger = new FakeElement();
  const form = new FakeElement();
  const status = new FakeElement();
  status.hidden = true;
  const save = new FakeElement();
  const close = new FakeElement();
  modal.children.set('[data-settings-close]', close);

  const inputs = Object.fromEntries([
    'metasoP2PBaseUrl',
    'metafileContentBaseUrl',
    'manApiBaseUrl',
  ].map((key) => [key, new FakeElement()]));
  for (const [key, input] of Object.entries(inputs)) {
    form.children.set(`[data-settings-field="${key}"]`, input);
  }

  const requests = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const elements = {
    '[data-settings-modal]': modal,
    '[data-settings-open]': trigger,
    '[data-settings-form]': form,
    '[data-settings-status]': status,
    '[data-settings-save]': save,
  };
  const settings = {
    browser: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://manapi.metaid.io',
    },
    effectiveBrowser: {},
    defaults: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://manapi.metaid.io',
    },
  };

  const context = {
    console,
    Error,
    JSON,
    Object,
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (options.method === 'PUT') {
        settings.browser = { ...settings.browser, ...JSON.parse(options.body).browser };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: settings }) };
    },
    document: {
      body: { classList: { add() {}, remove() {} } },
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: (selector) => selector === '[data-settings-close]' ? [close] : [],
      addEventListener: (name, handler) => documentListeners.set(name, handler),
    },
    window: {
      __oacLocalUiI18n: {
        t: (key, replacements = {}) => replacements.message ? `${key}: ${replacements.message}` : key,
      },
      addEventListener: (name, handler) => windowListeners.set(name, handler),
    },
  };

  return { context, modal, trigger, form, status, inputs, requests };
}

test('topbar settings modal loads and saves the three Browser base URLs', async () => {
  const state = createContext();
  vm.runInNewContext(renderTopbarSettingsScript(), state.context);

  await state.trigger.listeners.get('click')();

  assert.equal(state.modal.hidden, false);
  assert.equal(state.trigger.attrs['aria-expanded'], 'true');
  assert.equal(state.requests[0].url, '/api/browser/settings');
  assert.equal(state.inputs.metasoP2PBaseUrl.value, 'https://so.metaid.io');
  assert.equal(state.inputs.metafileContentBaseUrl.value, 'https://file.metaid.io/metafile-indexer');
  assert.equal(state.inputs.manApiBaseUrl.value, 'https://manapi.metaid.io');

  state.inputs.metasoP2PBaseUrl.value = 'https://so.example.test';
  await state.form.listeners.get('submit')({ preventDefault() {} });
  await tick();

  assert.equal(state.requests[1].url, '/api/browser/settings');
  assert.equal(state.requests[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(state.requests[1].options.body), {
    browser: {
      metasoP2PBaseUrl: 'https://so.example.test',
      metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
      manApiBaseUrl: 'https://manapi.metaid.io',
    },
  });
  assert.equal(state.status.textContent, 'settings.modal.saved');
});
