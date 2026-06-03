import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildAvatarChainWriteRequest,
  validateAvatarDataUrl,
} = require('../../dist/core/identity/avatarChainWrite.js');

test('buildAvatarChainWriteRequest strips data URL prefix and writes binary image metadata', () => {
  const request = buildAvatarChainWriteRequest({
    operation: 'modify',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
    network: 'mvc',
  });

  assert.deepEqual(request, {
    operation: 'modify',
    path: '/info/avatar',
    encryption: '0',
    version: '1.0',
    contentType: 'image/png;binary',
    payload: 'ZmFrZQ==',
    encoding: 'base64',
    network: 'mvc',
  });
});

test('buildAvatarChainWriteRequest preserves empty avatar clears without allowing data URL text writes', () => {
  const request = buildAvatarChainWriteRequest({
    operation: 'modify',
    avatarDataUrl: '',
  });

  assert.equal(request.path, '/info/avatar');
  assert.equal(request.payload, '');
  assert.equal(request.contentType, 'text/plain');
  assert.equal(request.encoding, 'utf-8');
});

test('validateAvatarDataUrl rejects text data URLs and accepts supported image data URLs', () => {
  assert.deepEqual(validateAvatarDataUrl('data:text/plain;base64,SGVsbG8=', 200_000), {
    valid: false,
    error: 'Avatar must be a PNG, JPEG, WebP, or GIF data URL.',
  });
  assert.equal(validateAvatarDataUrl('data:image/webp;base64,ZmFrZQ==', 200_000).valid, true);
});
