'use strict';

import crypto from 'crypto';

/**
 * PDKBF2: Derives a key using PBKDF2 (Password-Based Key Derivation Function 2) with HMAC-SHA512.
 * Credit to: https://github.com/stayradiated/pbkdf2-sha512
 *
 * @param {string|Buffer} key - The input key/password (as string or Buffer)
 * @param {string|Buffer} salt - The salt value (as string or Buffer)
 * @param {number} iterations - Number of iterations to perform
 * @param {number} dkLen - Desired length of the derived key in bytes
 * @returns {Buffer} Derived key as Buffer
 * @throws {TypeError} If key or salt are not strings or Buffers
 * @throws {Error} If requested key length is too long
 */
function pbkdf2(key, salt, iterations, dkLen) {
  var hLen = 64; // SHA512 Mac length
  if (dkLen > (Math.pow(2, 32) - 1) * hLen) {
    throw Error('Requested key length too long');
  }

  if (typeof key !== 'string' && !Buffer.isBuffer(key)) {
    throw new TypeError('key must a string or Buffer');
  }

  if (typeof salt !== 'string' && !Buffer.isBuffer(salt)) {
    throw new TypeError('salt must a string or Buffer');
  }

  if (typeof key === 'string') {
    key = Buffer.from(key);
  }

  if (typeof salt === 'string') {
    salt = Buffer.from(salt);
  }

  var DK = Buffer.alloc(dkLen);

  var U = Buffer.alloc(hLen);
  var T = Buffer.alloc(hLen);
  var block1 = Buffer.alloc(salt.length + 4);

  var l = Math.ceil(dkLen / hLen);
  var r = dkLen - (l - 1) * hLen;

  salt.copy(block1, 0, 0, salt.length);
  for (var i = 1; i <= l; i++) {
    block1[salt.length + 0] = (i >> 24) & 0xff;
    block1[salt.length + 1] = (i >> 16) & 0xff;
    block1[salt.length + 2] = (i >> 8) & 0xff;
    block1[salt.length + 3] = (i >> 0) & 0xff;

    U = crypto.createHmac('sha512', key).update(block1).digest();

    U.copy(T, 0, 0, hLen);

    for (var j = 1; j < iterations; j++) {
      U = crypto.createHmac('sha512', key).update(U).digest();

      for (var k = 0; k < hLen; k++) {
        T[k] ^= U[k];
      }
    }

    var destPos = (i - 1) * hLen;
    var len = i === l ? r : hLen;
    T.copy(DK, destPos, 0, len);
  }

  return DK;
}

export default pbkdf2;
