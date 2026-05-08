'use strict';

import _ from '../util/_.js';
import bs58 from 'bs58';

/**
 * The alphabet for the Bitcoin-specific Base 58 encoding distinguishes between
 * lower case L and upper case i - neither of those characters are allowed to
 * prevent accidentaly miscopying of letters.
 */
var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.split('');

/**
 * A Base58 object can encode/decoded Base 58, which is used primarily for
 * string-formatted Bitcoin addresses and private keys. Addresses and private
 * keys actually use an additional checksum, and so they actually use the
 * Base58Check class.
 *
 * @param {object} obj Can be a string or buffer.
 */
function Base58(obj) {
  if (!(this instanceof Base58)) {
    return new Base58(obj);
  }
  if (Buffer.isBuffer(obj)) {
    var buf = obj;
    this.fromBuffer(buf);
  } else if (typeof obj === 'string') {
    var str = obj;
    this.fromString(str);
  }
}

/**
 * Checks if all characters in the input are valid Base58 characters.
 * @param {string|Buffer} chars - The input characters to validate (can be a string or Buffer).
 * @returns {boolean} True if all characters are valid Base58, false otherwise.
 * @static
 */
Base58.validCharacters = function validCharacters(chars) {
  if (Buffer.isBuffer(chars)) {
    chars = chars.toString();
  }
  return _.every(
    _.map(chars, function (char) {
      return _.includes(ALPHABET, char);
    }),
  );
};

/**
 * Sets the buffer property from the given object.
 * @param {Object} obj - The object containing the buffer to set.
 * @param {Buffer} [obj.buf] - The buffer to assign. If not provided, retains current buffer or sets to undefined.
 * @returns {Base58} Returns the instance for chaining.
 */
Base58.prototype.set = function (obj) {
  this.buf = obj.buf || this.buf || undefined;
  return this;
};

/**
 * Encode a buffer to Bsae 58.
 *
 * @param {Buffer} buf Any buffer to be encoded.
 * @returns {string} A Base 58 encoded string.
 * @throws {Error} If the input is not a buffer.
 * @static
 */
Base58.encode = function (buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Input should be a buffer');
  }
  return bs58.encode(buf);
};

/**
 * Decode a Base 58 string to a buffer.
 *
 * @param {string} str A Base 58 encoded string.
 * @returns {Buffer} The decoded buffer.
 * @throws {Error} If the input is not a string.
 * @static
 */
Base58.decode = function (str) {
  if (typeof str !== 'string') {
    throw new Error('Input should be a string');
  }
  return Buffer.from(bs58.decode(str));
};

/**
 * Sets the internal buffer to the provided buffer and returns the instance for chaining.
 * @param {Buffer} buf - The buffer to set as the internal buffer.
 * @returns {Base58} The instance for method chaining.
 */
Base58.prototype.fromBuffer = function (buf) {
  this.buf = buf;
  return this;
};

/**
 * Creates a Base58 encoded string from a buffer.
 * @param {Buffer} buf - The input buffer to encode.
 * @returns {Base58} A new Base58 instance containing the encoded string.
 * @static
 */
Base58.fromBuffer = function (buf) {
  return new Base58().fromBuffer(buf);
};

/**
 * Converts a hex string to Base58 encoded string.
 * @param {string} hex - The hex string to convert.
 * @returns {string} The Base58 encoded string.
 * @static
 */
Base58.fromHex = function (hex) {
  return Base58.fromBuffer(Buffer.from(hex, 'hex'));
};

/**
 * Converts a Base58 encoded string to a buffer and stores it in the instance.
 * @param {string} str - The Base58 encoded string to decode.
 * @returns {Base58} The current instance for chaining.
 */
Base58.prototype.fromString = function (str) {
  var buf = Base58.decode(str);
  this.buf = buf;
  return this;
};

/**
 * Creates a Base58 instance from a string input.
 * @param {string} str - The string to convert to Base58.
 * @returns {Base58} A new Base58 instance containing the encoded string.
 * @static
 */
Base58.fromString = function (str) {
  return new Base58().fromString(str);
};

/**
 * Returns the internal buffer containing the Base58 encoded data.
 * @returns {Buffer} The raw buffer representation of the Base58 data.
 */
Base58.prototype.toBuffer = function () {
  return this.buf;
};

/**
 * Converts the Base58 encoded data to a hexadecimal string.
 * @returns {string} Hexadecimal representation of the Base58 data.
 */
Base58.prototype.toHex = function () {
  return this.toBuffer().toString('hex');
};

/**
 * Converts the Base58 instance to its string representation.
 * @returns {string} The Base58 encoded string.
 */
Base58.prototype.toString = function () {
  return Base58.encode(this.buf);
};

export default Base58;
