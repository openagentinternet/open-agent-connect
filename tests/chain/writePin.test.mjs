import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { normalizeChainWriteRequest } = require('../../dist/core/chain/writePin.js');

test('normalizeChainWriteRequest rejects /info/avatar data URL payloads', () => {
  assert.throws(
    () => normalizeChainWriteRequest({
      path: '/info/avatar',
      payload: 'data:image/png;base64,ZmFrZQ==',
      contentType: 'image/png;binary',
      encoding: 'base64',
    }),
    /Avatar payload must be binary image bytes without a data URL prefix/u,
  );
});

test('normalizeChainWriteRequest rejects non-empty /info/avatar text writes', () => {
  assert.throws(
    () => normalizeChainWriteRequest({
      path: '/info/avatar',
      payload: 'ZmFrZQ==',
      contentType: 'text/plain',
      encoding: 'base64',
    }),
    /Avatar payload must be binary image bytes/u,
  );
});

test('normalizeChainWriteRequest rejects string /info/avatar image payloads', () => {
  assert.throws(
    () => normalizeChainWriteRequest({
      path: '/info/avatar',
      payload: 'ZmFrZQ==',
      contentType: 'image/png;binary',
      encoding: 'base64',
    }),
    /Avatar payload must be binary image bytes/u,
  );
});

test('normalizeChainWriteRequest accepts binary /info/avatar image writes', () => {
  const request = normalizeChainWriteRequest({
    path: '/info/avatar',
    payload: Buffer.from('fake'),
    contentType: 'image/png;binary',
    encoding: 'binary',
  });

  assert.equal(request.path, '/info/avatar');
  assert.equal(Buffer.isBuffer(request.payload), true);
  assert.equal(request.payload.toString('utf8'), 'fake');
  assert.equal(request.contentType, 'image/png;binary');
  assert.equal(request.encoding, 'binary');
});

test('normalizeChainWriteRequest accepts empty /info/avatar clears', () => {
  const request = normalizeChainWriteRequest({
    path: '/info/avatar',
    payload: '',
    contentType: 'text/plain',
    encoding: 'utf-8',
  });

  assert.equal(request.path, '/info/avatar');
  assert.equal(request.payload, '');
  assert.equal(request.contentType, 'text/plain');
  assert.equal(request.encoding, 'utf-8');
});
