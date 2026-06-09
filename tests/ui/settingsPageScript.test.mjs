import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSettingsPageDefinition } = require('../../dist/ui/pages/settings/app.js');

function makeElement() {
  return {
    textContent: '',
    addEventListener() {},
  };
}

function waitForMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('settings page keeps failed load status when language changes', async () => {
  const elements = {
    '[data-settings-status]': makeElement(),
    '[data-settings-refresh]': makeElement(),
    '[data-settings-config-status]': makeElement(),
    '[data-settings-llm-status]': makeElement(),
    '[data-settings-network-status]': makeElement(),
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
