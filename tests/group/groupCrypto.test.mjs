import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  encryptGroupMessage,
  decryptGroupMessage,
  groupIdToSecretKey,
} = require('../../dist/core/group/groupCrypto.js');

/**
 * Cross-implementation vectors produced by an INDEPENDENT openssl
 * implementation (openssl enc -aes-128-cbc, key = first 16 chars of the
 * group id as UTF-8 hex, IV = 16 x '0' UTF-8 bytes, PKCS7, hex output).
 * The implementation must match these byte for byte — never the reverse.
 */
const VECTORS = [
  {
    name: 'vec1 ascii plaintext, full-length hex group id',
    groupId: '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0',
    plaintext: 'hello group',
    expectedHex: '62c543cdbbf7ec3115c55b20cc4ebdfe',
  },
  {
    name: 'vec2 UTF-8 multibyte plaintext',
    groupId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
    plaintext: '你好，群聊加密向量',
    expectedHex: '167ea6012673b44ff823e3c591caf1909c44b7939475188eb87666f9a3b979e7',
  },
  {
    name: 'vec3 short group id, zero-padded key branch',
    groupId: 'shortgid',
    plaintext: 'pad case',
    expectedHex: 'dd547c05506e6e0b1ed4d454f83c28c2',
  },
];

for (const vector of VECTORS) {
  test(`encryptGroupMessage ${vector.name} matches the openssl vector byte for byte`, () => {
    const actual = encryptGroupMessage(vector.plaintext, vector.groupId);
    assert.equal(actual, vector.expectedHex);
  });

  test(`decryptGroupMessage ${vector.name} round-trips the openssl ciphertext`, () => {
    const plaintext = decryptGroupMessage(vector.expectedHex, vector.groupId);
    assert.equal(plaintext, vector.plaintext);
  });
}

test('groupIdToSecretKey takes the first 16 characters, zero-pads shorter ids', () => {
  assert.equal(
    groupIdToSecretKey('4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0'),
    '4ffab5a801234567',
  );
  assert.equal(groupIdToSecretKey('shortgid'), 'shortgid00000000');
  assert.equal(groupIdToSecretKey('  padded  '), 'padded0000000000');
  assert.equal(groupIdToSecretKey(''), '0000000000000000');
});

test('ciphertext wire shape is lowercase hex in whole 16-byte blocks', () => {
  for (const vector of VECTORS) {
    const hex = encryptGroupMessage(vector.plaintext, vector.groupId);
    assert.match(hex, /^[0-9a-f]+$/);
    assert.equal(hex.length % 32, 0);
  }
});

test('encrypt/decrypt round-trip for an empty message', () => {
  const groupId = '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0';
  const hex = encryptGroupMessage('', groupId);
  // One full PKCS7 block for the empty message.
  assert.equal(hex.length, 32);
  assert.equal(decryptGroupMessage(hex, groupId), '');
});
