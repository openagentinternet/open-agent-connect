export = pbkdf2;
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
declare function pbkdf2(key: string | Buffer, salt: string | Buffer, iterations: number, dkLen: number): Buffer;
