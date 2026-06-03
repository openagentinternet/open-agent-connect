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
    /Avatar payload must be raw image base64 without a data URL prefix/u,
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
    /Avatar contentType must be a supported binary image type/u,
  );
});

test('normalizeChainWriteRequest rejects malformed /info/avatar base64 payloads', () => {
  assert.throws(
    () => normalizeChainWriteRequest({
      path: '/info/avatar',
      payload: 'not raw base64!',
      contentType: 'image/png;binary',
      encoding: 'base64',
    }),
    /Avatar payload must be raw image base64/u,
  );
});

test('normalizeChainWriteRequest accepts raw base64 /info/avatar image writes', () => {
  const request = normalizeChainWriteRequest({
    path: '/info/avatar',
    payload: 'ZmFrZQ==',
    contentType: 'image/png;binary',
    encoding: 'base64',
  });

  assert.equal(request.path, '/info/avatar');
  assert.equal(request.payload, 'ZmFrZQ==');
  assert.equal(request.contentType, 'image/png;binary');
  assert.equal(request.encoding, 'base64');
});
