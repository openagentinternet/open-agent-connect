import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('OAC can import published Agent Browser packages pinned for Phase 4', () => {
  const contract = require('@openagentinternet/agent-browser-host-contract');
  const core = require('@openagentinternet/agent-browser-core');
  const harness = require('@openagentinternet/agent-browser-test-harness');

  assert.equal(typeof contract.browserSuccess, 'function');
  assert.equal(typeof contract.browserFailure, 'function');
  assert.equal(typeof core.parseBrowserUri, 'function');
  assert.equal(typeof core.buildBotHomepageEnvelope, 'function');
  assert.equal(typeof core.BOT_HOMEPAGE_TEMPLATES.length, 'number');
  assert.equal(typeof harness.assertBrowserHostConformance, 'function');
});

test('OAC pins Agent Browser packages to the first published pre-1.0 version', () => {
  const rootPackage = require('../../package.json');

  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-contract'], '0.1.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-core'], '0.1.0');
  assert.equal(rootPackage.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.1.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-ui'], undefined);
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
});
