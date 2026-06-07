import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { resolveBrowserConfig } = require('../../dist/core/browser/config.js');

test('config store normalizes Browser config with safe defaults', async () => {
  const homeDir = await createProfileHome('metabot-browser-config-');
  try {
    const store = createConfigStore(homeDir);
    const config = await store.read();

    assert.equal(config.browser.localMode, true);
    assert.equal(config.browser.defaultChainName, 'mvc');
    assert.equal(resolveBrowserConfig(config, {}).localMode, true);
  } finally {
    await cleanupProfileHome(homeDir);
  }
});

test('Browser config accepts env override over stored base URL', async () => {
  const resolved = resolveBrowserConfig({
    chain: { defaultWriteNetwork: 'mvc' },
    a2a: { simplemsgListenerEnabled: true },
    browser: {
      metasoP2PBaseUrl: '',
      localMode: true,
      defaultChainName: 'mvc',
    },
  }, {
    METABOT_BROWSER_METASO_P2P_BASE_URL: 'https://so.example.test/',
  });

  assert.equal(resolved.metasoP2PBaseUrl, 'https://so.example.test');
  assert.equal(resolved.defaultChainName, 'mvc');
});
