import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parseBrowserUri } = require('../../dist/core/browser/uri.js');

const MAP_PIN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';

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

test('parseBrowserUri accepts metafile and MAP schemes from ABC 0.3.1', () => {
  assert.deepEqual(parseBrowserUri(`metafile://${MAP_PIN_ID}.png`), {
    originalUri: `metafile://${MAP_PIN_ID}.png`,
    normalizedUri: `metafile://${MAP_PIN_ID}.png`,
    scheme: 'metafile',
    id: `${MAP_PIN_ID}.png`,
  });
  assert.deepEqual(parseBrowserUri(`map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`), {
    originalUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    normalizedUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    scheme: 'map',
    id: `simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
  });
});

test('parseBrowserUri rejects missing, empty, and unsupported schemes', () => {
  assert.throws(() => parseBrowserUri('idqABC'), /complete Agent Internet URI/i);
  assert.throws(() => parseBrowserUri('metaid://'), /empty resource id/i);
  assert.throws(() => parseBrowserUri('https://example.com'), /unsupported URI scheme/i);
});
