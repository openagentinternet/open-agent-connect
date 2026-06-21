'use strict';

var _ = require('../util/_.cjs');
var Base58 = require('./base58.cjs');
var Hash = require('../crypto/hash.cjs');

/**
 * A Base58check object can encode/decodd Base 58, which is used primarily for
 * string-formatted Bitcoin addresses and private keys. This is the same as
 * Base58, except that it includes a checksum to prevent accidental mistypings.
 * @constructor
 * @param {Buffer|string} obj Can be a string or buffer.
 */
function Base58Check(obj) {
  if (!(this instanceof Base58Check)) {
    return new Base58Check(obj);
  }
  if (Buffer.isBuffer(obj)) {
    var buf = obj;
    this.fromBuffer(buf);
  } else if (typeof obj === 'string') {
    var str = obj;
    this.fromString(str);
  }
};

/**
 * Sets the buffer property from the given object.
 * @param {Object} obj - The object containing the buffer to set.
 * @returns {Base58Check} Returns the instance for chaining.
 */
Base58Check.prototype.set = function (obj) {
  this.buf = obj.buf || this.buf || undefined;
  return this;
};

/**
 * Validates the checksum of Base58Check encoded data.
 * @param {Buffer|string} data - The data to validate, either as a Buffer or Base58 encoded string.
 * @param {Buffer|string} [checksum] - Optional checksum to validate against, either as a Buffer or Base58 encoded string.
 * If not provided, the last 4 bytes of the data will be used as checksum.
 * @returns {boolean} True if the computed checksum matches the provided/embedded checksum.
 * @static
 */
Base58Check.validChecksum = function validChecksum(data, checksum) {
  if (_.isString(data)) {
    data = Buffer.from(Base58.decode(data));
  }
  if (_.isString(checksum)) {
    checksum = Buffer.from(Base58.decode(checksum));
  }
  if (!checksum) {
    checksum = data.slice(-4);
    data = data.slice(0, -4);
  }
  return Base58Check.checksum(data).toString('hex') === checksum.toString('hex');
};

/**
 * Decodes a Base58Check encoded string and verifies its checksum.
 * @param {string} s - The Base58Check encoded string to decode.
 * @returns {Buffer} The decoded data (excluding checksum).
 * @throws {Error} If input is not a string, too short, or checksum mismatch.
 * @static
 */
Base58Check.decode = function (s) {
  if (typeof s !== 'string') {
    throw new Error('Input must be a string');
  }

  var buf = Buffer.from(Base58.decode(s));

  if (buf.length < 4) {
    throw new Error('Input string too short');
  }

  var data = buf.slice(0, -4);
  var csum = buf.slice(-4);

  var hash = Hash.sha256sha256(data);
  var hash4 = hash.slice(0, 4);

  if (csum.toString('hex') !== hash4.toString('hex')) {
    throw new Error('Checksum mismatch');
  }

  return data;
};

/**
 * Calculates the checksum for a given buffer using double SHA-256 hash.
 * The checksum is the first 4 bytes of the double-hashed result.
 * @param {Buffer} buffer - The input buffer to calculate checksum for
 * @returns {Buffer} The 4-byte checksum
 * @static
 */
Base58Check.checksum = function (buffer) {
  return Hash.sha256sha256(buffer).slice(0, 4);
};

/**
 * Encodes a buffer into Base58Check format.
 * @param {Buffer} buf - The input buffer to encode
 * @returns {string} The Base58Check encoded string
 * @throws {Error} If input is not a Buffer
 * @static
 */
Base58Check.encode = function (buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Input must be a buffer');
  }
  var checkedBuf = Buffer.alloc(buf.length + 4);
  var hash = Base58Check.checksum(buf);
  buf.copy(checkedBuf);
  hash.copy(checkedBuf, buf.length);
  return Base58.encode(checkedBuf);
};

/**
 * Sets the internal buffer to the provided Buffer object.
 * @param {Buffer} buf - The buffer to set as the internal state.
 * @returns {Base58Check} Returns the instance for chaining.
 */
Base58Check.prototype.fromBuffer = function (buf) {
  this.buf = buf;
  return this;
};

/**
 * Creates a Base58Check encoded string from a buffer.
 * @param {Buffer} buf - The input buffer to encode.
 * @returns {Base58Check} A new Base58Check instance containing the encoded data.
 */
Base58Check.fromBuffer = function (buf) {
  return new Base58Check().fromBuffer(buf);
};

/**
 * Converts a hex string to a Base58Check encoded string.
 * @param {string} hex - The hex string to convert.
 * @returns {string} The Base58Check encoded string.
 */
Base58Check.fromHex = function (hex) {
  return Base58Check.fromBuffer(Buffer.from(hex, 'hex'));
};

/**
 * Converts a Base58Check encoded string to a buffer and stores it in the instance.
 * @param {string} str - The Base58Check encoded string to decode.
 * @returns {Base58Check} Returns the instance for chaining.
 */
Base58Check.prototype.fromString = function (str) {
  var buf = Base58Check.decode(str);
  this.buf = buf;
  return this;
};

/**
 * Converts a Base58Check-encoded string into a Base58 object.
 * @param {string} str - The Base58Check-encoded string to decode.
 * @returns {Base58} A new Base58 instance containing the decoded data.
 */
Base58Check.fromString = function (str) {
  var buf = Base58Check.decode(str);
  return new Base58(buf);
};

/**
 * Returns the internal buffer containing the Base58Check encoded data.
 * @returns {Buffer} The raw buffer representation of the Base58Check data.
 */
Base58Check.prototype.toBuffer = function () {
  return this.buf;
};

/**
 * Converts the Base58Check encoded data to a hexadecimal string.
 * @returns {string} Hexadecimal representation of the data.
 */
Base58Check.prototype.toHex = function () {
  return this.toBuffer().toString('hex');
};

/**
 * Converts the Base58Check instance to its string representation.
 * @returns {string} The Base58Check encoded string.
 */
Base58Check.prototype.toString = function () {
  return Base58Check.encode(this.buf);
};

module.exports = Base58Check;
