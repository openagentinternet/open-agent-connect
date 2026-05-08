'use strict';
var crypto = require('crypto');

/**
 * A utility class for generating random values.
 */
function Random() { }

/**
 * Generates a cryptographically secure random buffer of the specified size.
 * @param {number} size - The number of bytes to generate.
 * @returns {Buffer} A buffer filled with cryptographically secure random bytes.
 */
Random.getRandomBuffer = function (size) {
    return crypto.randomBytes(size);
};

module.exports = Random;
