import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('OAC can import published Agent Browser packages pinned to 0.3.0', () => {
  const contract = require('@openagentinternet/agent-browser-host-contract');
  const core = require('@openagentinternet/agent-browser-core');
  const ui = require('@openagentinternet/agent-browser-ui/browser');
  const harness = require('@openagentinternet/agent-browser-test-harness');

  assert.equal(typeof contract.browserSuccess, 'function');
  assert.equal(typeof contract.browserWaiting, 'function');
  assert.equal(typeof contract.browserManualActionRequired, 'function');
  assert.equal(typeof core.parseBrowserUri, 'function');
  assert.equal(typeof core.normalizeResourceSections, 'function');
  assert.equal(typeof ui.buildBrowserPageDefinition, 'function');
  assert.equal(typeof ui.renderBrowserPageHtml, 'function');
  assert.equal(typeof harness.assertBrowserHostConformance, 'function');
  assert.equal(typeof harness.assertBrowserCommandResultShape, 'function');
});

test('OAC pins consumed Agent Browser packages to 0.3.0', () => {
  const rootPackage = require('../../package.json');

  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-contract'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-core'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-ui'], '0.3.0');
  assert.equal(rootPackage.devDependencies['@openagentinternet/agent-browser-test-harness'], '0.3.0');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
});
