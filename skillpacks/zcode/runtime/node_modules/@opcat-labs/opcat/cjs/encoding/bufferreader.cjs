'use strict';

var _ = require('../util/_.cjs');
var $ = require('../util/preconditions.cjs');
var BN = require('../crypto/bn.cjs');

/**
 * Creates a BufferReader instance to read from various input types.
 * @constructor
 * @param {Buffer|string|Object} buf - Input source (Buffer, hex string, or object with buffer properties)
 * @throws {TypeError} If input is invalid hex string or unrecognized type
 * @example
 * new BufferReader(Buffer.from('abc')) // from Buffer
 * new BufferReader('616263')          // from hex string
 * new BufferReader({buf: buffer})      // from object
 */
function BufferReader(buf) {
  if (!(this instanceof BufferReader)) {
    return new BufferReader(buf);
  }
  if (_.isUndefined(buf)) {
    return;
  }
  if (Buffer.isBuffer(buf)) {
    this.set({
      buf: buf,
    });
  } else if (_.isString(buf)) {
    var b = Buffer.from(buf, 'hex');
    if (b.length * 2 !== buf.length) {
      throw new TypeError('Invalid hex string');
    }

    this.set({
      buf: b,
    });
  } else if (_.isObject(buf)) {
    var obj = buf;
    this.set(obj);
  } else {
    throw new TypeError('Unrecognized argument for BufferReader');
  }
};

/**
 * Updates the buffer and position from the given object.
 * @param {Object} obj - The object containing buffer and position to set.
 * @param {Buffer} [obj.buf] - The buffer to set (optional, keeps current if not provided).
 * @param {number} [obj.pos] - The position to set (optional, keeps current if not provided).
 * @returns {BufferReader} Returns the instance for chaining.
 */
BufferReader.prototype.set = function (obj) {
  this.buf = obj.buf || this.buf || undefined;
  this.pos = obj.pos || this.pos || 0;
  return this;
};

/**
 * Checks if the reader has reached the end of the buffer.
 * @returns {boolean} True if the current position is at or beyond the buffer length, false otherwise.
 */
BufferReader.prototype.eof = function () {
  return this.pos >= this.buf.length;
};

/**
 * Alias for `eof` method - checks if the buffer reader has reached the end of data.
 * @name BufferReader.prototype.finished
 * @memberof BufferReader
 * @instance
 */
BufferReader.prototype.finished = BufferReader.prototype.eof;

/**
 * Reads a specified number of bytes from the buffer and advances the position.
 * @param {number} len - The number of bytes to read.
 * @returns {Buffer} The read bytes as a Buffer.
 * @throws {Error} If the length is undefined.
 */
BufferReader.prototype.read = function (len) {
  $.checkArgument(!_.isUndefined(len), 'Must specify a length');
  var buf = this.buf.slice(this.pos, this.pos + len);
  this.pos = this.pos + len;
  return buf;
};

/**
 * Reads and returns all remaining bytes from the buffer, advancing the position to the end.
 * @returns {Buffer} The remaining bytes in the buffer.
 */
BufferReader.prototype.readAll = function () {
  var buf = this.buf.slice(this.pos, this.buf.length);
  this.pos = this.buf.length;
  return buf;
};

/**
 * Reads an unsigned 8-bit integer from the buffer at the current position.
 * @returns {number} The unsigned 8-bit integer value read.
 * @this {BufferReader}
 */
BufferReader.prototype.readUInt8 = function () {
  var val = this.buf.readUInt8(this.pos);
  this.pos = this.pos + 1;
  return val;
};

/**
 * Reads an unsigned 16-bit integer from the buffer in big-endian format.
 * Advances the position by 2 bytes.
 * @returns {number} The read unsigned 16-bit integer value.
 */
BufferReader.prototype.readUInt16BE = function () {
  var val = this.buf.readUInt16BE(this.pos);
  this.pos = this.pos + 2;
  return val;
};

/**
 * Reads a 16-bit unsigned integer from the buffer in little-endian format
 * and advances the position by 2 bytes.
 * @returns {number} The read unsigned 16-bit integer value
 */
BufferReader.prototype.readUInt16LE = function () {
  var val = this.buf.readUInt16LE(this.pos);
  this.pos = this.pos + 2;
  return val;
};

/**
 * Reads an unsigned 32-bit integer from the buffer in big-endian format.
 * Advances the position by 4 bytes.
 * @returns {number} The read unsigned 32-bit integer value.
 */
BufferReader.prototype.readUInt32BE = function () {
  var val = this.buf.readUInt32BE(this.pos);
  this.pos = this.pos + 4;
  return val;
};

/**
 * Reads an unsigned 32-bit integer from the buffer in little-endian format.
 * Advances the position by 4 bytes.
 * @returns {number} The read unsigned 32-bit integer value.
 */
BufferReader.prototype.readUInt32LE = function () {
  var val = this.buf.readUInt32LE(this.pos);
  this.pos = this.pos + 4;
  return val;
};

/**
 * Reads a 32-bit signed integer from the buffer in little-endian format.
 * Advances the position by 4 bytes.
 * @returns {number} The read 32-bit signed integer.
 */
BufferReader.prototype.readInt32LE = function () {
  var val = this.buf.readInt32LE(this.pos);
  this.pos = this.pos + 4;
  return val;
};

/**
 * Reads an unsigned 64-bit integer in big-endian byte order from the buffer
 * and returns it as a BN (BigNumber) object.
 * Advances the position by 8 bytes.
 * @returns {BN} The parsed 64-bit unsigned integer as a BigNumber
 */
BufferReader.prototype.readUInt64BEBN = function () {
  var buf = this.buf.slice(this.pos, this.pos + 8);
  var bn = BN.fromBuffer(buf);
  this.pos = this.pos + 8;
  return bn;
};

/**
 * Reads an unsigned 64-bit integer in little-endian byte order from the buffer and returns it as a BN (BigNumber).
 * Optimizes for numbers <= 52 bits by using numeric constructor, falls back to buffer slice for larger numbers.
 * Advances the buffer position by 8 bytes.
 * @returns {BN} The parsed 64-bit unsigned integer as a BN instance.
 */
BufferReader.prototype.readUInt64LEBN = function () {
  var second = this.buf.readUInt32LE(this.pos);
  var first = this.buf.readUInt32LE(this.pos + 4);
  var combined = first * 0x100000000 + second;
  // Instantiating an instance of BN with a number is faster than with an
  // array or string. However, the maximum safe number for a double precision
  // floating point is 2 ^ 52 - 1 (0x1fffffffffffff), thus we can safely use
  // non-floating point numbers less than this amount (52 bits). And in the case
  // that the number is larger, we can instatiate an instance of BN by passing
  // an array from the buffer (slower) and specifying the endianness.
  var bn;
  if (combined <= 0x1fffffffffffff) {
    bn = new BN(combined);
  } else {
    var data = Array.prototype.slice.call(this.buf, this.pos, this.pos + 8);
    bn = new BN(data, 10, 'le');
  }
  this.pos = this.pos + 8;
  return bn;
};

/**
 * Reads a variable-length integer (varint) from the buffer and returns it as a number.
 * Supports varints up to 53 bits (JavaScript's safe integer limit).
 * For larger numbers, throws an error suggesting to use `readVarintBN` instead.
 * @returns {number} The decoded integer value
 * @throws {Error} If the number exceeds 53-bit precision
 */
BufferReader.prototype.readVarintNum = function () {
  var first = this.readUInt8();
  switch (first) {
    case 0xfd:
      return this.readUInt16LE();
    case 0xfe:
      return this.readUInt32LE();
    case 0xff:
      var bn = this.readUInt64LEBN();
      var n = bn.toNumber();
      if (n <= Math.pow(2, 53)) {
        return n;
      } else {
        throw new Error('number too large to retain precision - use readVarintBN');
      }
    // break // unreachable
    default:
      return first;
  }
};


/**
 * Reads a variable-length buffer from the current position.
 * First reads a varint to determine the length, then reads the buffer of that size.
 * @returns {Buffer} The read buffer.
 * @throws {Error} If the actual read length doesn't match the expected length.
 */
BufferReader.prototype.readVarLengthBuffer = function () {
  var len = this.readVarintNum();
  var buf = this.read(len);
  $.checkState(
    buf.length === len,
    'Invalid length while reading varlength buffer. ' +
      'Expected to read: ' +
      len +
      ' and read ' +
      buf.length,
  );
  return buf;
};

/**
 * Reads a variable-length integer (varint) from the buffer.
 * The first byte determines the length of the varint:
 * - 0xfd: 2-byte varint (plus 1 byte for the prefix)
 * - 0xfe: 4-byte varint (plus 1 byte for the prefix)
 * - 0xff: 8-byte varint (plus 1 byte for the prefix)
 * - Otherwise: 1-byte varint (no prefix)
 * @returns {Buffer} The varint bytes including the prefix (if any)
 */
BufferReader.prototype.readVarintBuf = function () {
  var first = this.buf.readUInt8(this.pos);
  switch (first) {
    case 0xfd:
      return this.read(1 + 2);
    case 0xfe:
      return this.read(1 + 4);
    case 0xff:
      return this.read(1 + 8);
    default:
      return this.read(1);
  }
};

/**
 * Reads a variable-length integer (varint) from the buffer and returns it as a BN (BigNumber).
 * Handles different varint sizes (1, 2, 4, or 8 bytes) based on the first byte's value:
 * - 0xfd: reads next 2 bytes as uint16
 * - 0xfe: reads next 4 bytes as uint32
 * - 0xff: reads next 8 bytes as uint64
 * - default: treats first byte as uint8
 * @returns {BN} The parsed varint as a BigNumber
 */
BufferReader.prototype.readVarintBN = function () {
  var first = this.readUInt8();
  switch (first) {
    case 0xfd:
      return new BN(this.readUInt16LE());
    case 0xfe:
      return new BN(this.readUInt32LE());
    case 0xff:
      return this.readUInt64LEBN();
    default:
      return new BN(first);
  }
};

/**
 * Reverses the order of bytes in the internal buffer and returns the instance.
 * @returns {BufferReader} The modified BufferReader instance for chaining.
 */
BufferReader.prototype.reverse = function () {
  var buf = Buffer.alloc(this.buf.length);
  for (var i = 0; i < buf.length; i++) {
    buf[i] = this.buf[this.buf.length - 1 - i];
  }
  this.buf = buf;
  return this;
};

/**
 * Reads a specified number of bytes from the buffer in reverse order.
 * @param {number} [len] - The number of bytes to read. If omitted, reads the entire buffer.
 * @returns {Buffer} The reversed buffer segment.
 */
BufferReader.prototype.readReverse = function (len) {
  if (_.isUndefined(len)) {
    len = this.buf.length;
  }
  var buf = this.buf.slice(this.pos, this.pos + len);
  this.pos = this.pos + len;
  return Buffer.from(buf).reverse();
};

/**
 * Gets the number of bytes remaining to be read in the buffer.
 * @returns {number} The remaining bytes count.
 */
BufferReader.prototype.remaining = function () {
  return this.buf.length - this.pos;
};

module.exports = BufferReader;
