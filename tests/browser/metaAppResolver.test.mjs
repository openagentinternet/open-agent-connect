import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildMetaAppResolveResult } = require('../../dist/core/browser/metaAppResolver.js');

function record(overrides = {}) {
  return {
    pinId: 'a'.repeat(64) + 'i0',
    firstPinId: 'b'.repeat(64) + 'i0',
    operation: 'create',
    title: 'Fixture MetaApp',
    appName: 'fixture-metaapp',
    version: '1.0.0',
    runtime: 'browser',
    indexFile: 'index.html',
    code: '',
    content: '',
    contentType: 'text/html',
    codeType: 'html',
    tags: [],
    ownerGlobalMetaId: 'idq1publisher',
    ownerAddress: '18Publisher',
    network: 'mvc',
    metawebUrl: 'https://metaweb.example/app',
    localUiUrl: '/api/metaapp/preview-assets/preview/index.html',
    updatedAt: 1780760000000,
    source: 'indexer',
    ...overrides,
  };
}

test('buildMetaAppResolveResult selects sandboxed html iframe renderer', () => {
  const result = buildMetaAppResolveResult({
    uri: 'metaapp://' + 'a'.repeat(64) + 'i0',
    normalizedUri: 'metaapp://' + 'a'.repeat(64) + 'i0',
    record: record(),
    fetchedAt: 1780760000001,
  });

  assert.equal(result.resourceType, 'metaapp');
  assert.equal(result.owner.kind, 'metaapp-publisher');
  assert.equal(result.owner.globalMetaId, 'idq1publisher');
  assert.equal(result.renderer.type, 'html-iframe');
  assert.equal(result.renderer.url, 'https://metaweb.example/app');
  assert.equal(result.actions.some((action) => action.kind === 'copy'), true);
  assert.equal(result.actions.some((action) => action.kind === 'proof'), true);
});

test('buildMetaAppResolveResult selects content-specific renderers', () => {
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'application/pdf', downloadUrl: 'https://files.example/a.pdf' }) }).renderer.type, 'pdf');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'image/png', downloadUrl: 'https://files.example/a.png' }) }).renderer.type, 'image');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'video/mp4', downloadUrl: 'https://files.example/a.mp4' }) }).renderer.type, 'video');
  assert.equal(buildMetaAppResolveResult({ uri: 'metaapp://pin', normalizedUri: 'metaapp://pin', record: record({ contentType: 'application/octet-stream', downloadUrl: 'https://files.example/a.bin' }) }).renderer.type, 'unsupported');
});
