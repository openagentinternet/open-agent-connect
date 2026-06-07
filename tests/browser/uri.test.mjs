import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parseBrowserUri } = require('../../dist/core/browser/uri.js');

test('parseBrowserUri normalizes metaid and metaapp schemes', () => {
  assert.deepEqual(parseBrowserUri('  METAID://idqABC  '), {
    originalUri: 'METAID://idqABC',
    normalizedUri: 'metaid://idqABC',
    scheme: 'metaid',
    id: 'idqABC',
  });
  assert.deepEqual(parseBrowserUri('metaapp://abcdef123i0'), {
    originalUri: 'metaapp://abcdef123i0',
    normalizedUri: 'metaapp://abcdef123i0',
    scheme: 'metaapp',
    id: 'abcdef123i0',
  });
});

test('parseBrowserUri rejects missing, empty, and unsupported schemes', () => {
  assert.throws(() => parseBrowserUri('idqABC'), /complete Agent Internet URI/i);
  assert.throws(() => parseBrowserUri('metaid://'), /empty resource id/i);
  assert.throws(() => parseBrowserUri('https://example.com'), /unsupported URI scheme/i);
});
