import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const AGENT_BROWSER_RUNTIME_PACKAGES = [
  '@openagentinternet/agent-browser-host-contract',
  '@openagentinternet/agent-browser-core',
  '@openagentinternet/agent-browser-name-resolvers',
  '@openagentinternet/agent-browser-ui',
];
const AGENT_BROWSER_DEV_PACKAGES = ['@openagentinternet/agent-browser-test-harness'];
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function assertExactSharedBrowserPins(rootPackage) {
  const versions = [];
  for (const packageName of AGENT_BROWSER_RUNTIME_PACKAGES) {
    const version = rootPackage.dependencies[packageName];
    assert.match(version, EXACT_SEMVER_RE, `${packageName} must be an exact package version`);
    versions.push(version);
  }
  for (const packageName of AGENT_BROWSER_DEV_PACKAGES) {
    const version = rootPackage.devDependencies[packageName];
    assert.match(version, EXACT_SEMVER_RE, `${packageName} must be an exact package version`);
    versions.push(version);
  }

  assert.deepEqual([...new Set(versions)], [versions[0]], 'Agent Browser packages must share one version');
  assert.equal(rootPackage.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
}

test('OAC can import published Agent Browser packages', () => {
  const contract = require('@openagentinternet/agent-browser-host-contract');
  const core = require('@openagentinternet/agent-browser-core');
  const resolvers = require('@openagentinternet/agent-browser-name-resolvers');
  const ui = require('@openagentinternet/agent-browser-ui/browser');
  const harness = require('@openagentinternet/agent-browser-test-harness');

  assert.equal(typeof contract.browserSuccess, 'function');
  assert.equal(typeof contract.browserWaiting, 'function');
  assert.equal(typeof contract.browserManualActionRequired, 'function');
  assert.equal(typeof core.parseBrowserUri, 'function');
  assert.equal(typeof core.normalizeResourceSections, 'function');
  assert.equal(typeof resolvers.createBrowserNameAliasProviders, 'function');
  assert.equal(typeof ui.buildBrowserPageDefinition, 'function');
  assert.equal(typeof ui.renderBrowserPageHtml, 'function');
  assert.equal(typeof harness.assertBrowserHostConformance, 'function');
  assert.equal(typeof harness.assertBrowserCommandResultShape, 'function');
});

test('OAC pins consumed Agent Browser packages to one exact shared version', () => {
  const rootPackage = require('../../package.json');
  assertExactSharedBrowserPins(rootPackage);
});

test('OAC build output does not include a local browser core mirror', () => {
  const distBrowserCoreDir = path.join(process.cwd(), 'dist', 'core', 'browser');
  assert.equal(existsSync(distBrowserCoreDir), false, 'dist/core/browser should not exist after build');
});
