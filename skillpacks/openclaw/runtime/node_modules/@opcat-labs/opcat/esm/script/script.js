'use strict';

import Address from '../address.js';
import BufferWriter from '../encoding/bufferwriter.js';
import Hash from '../crypto/hash.js';
import Opcode from '../opcode.js';
import PublicKey from '../publickey.js';
import Signature from '../crypto/signature.js';
import Networks from '../networks.js';
import $ from '../util/preconditions.js';
import _ from '../util/_.js';
import errors from '../errors/index.js';
import JSUtil from '../util/js.js';
import decodeScriptChunks from '../encoding/decode-script-chunks.js';
import decodeASM from '../encoding/decode-asm.js';
import encodeHex from '../encoding/encode-hex.js';

// These WeakMap caches allow the objects themselves to maintain their immutability
const SCRIPT_TO_CHUNKS_CACHE = new WeakMap();

/**
 * A bitcoin transaction script. Each transaction's inputs and outputs
 * has a script that is evaluated to validate it's spending.
 *
 * See https://en.bitcoin.it/wiki/Script
 *
 * @constructor
 * @param {Object|string|Buffer} [from] optional data to populate script
 */
function Script(from) {
  if (!(this instanceof Script)) {
    return new Script(from);
  }
  this.buffer = Buffer.from([]);

  if (Buffer.isBuffer(from)) {
    return Script.fromBuffer(from);
  } else if (from instanceof Address) {
    return Script.fromAddress(from);
  } else if (from instanceof Script) {
    return Script.fromBuffer(from.toBuffer());
  } else if (_.isString(from)) {
    return Script.fromString(from);
  } else if (_.isObject(from) && _.isArray(from.chunks)) {
    return Script.fromChunks(from.chunks);
  } else if (_.isObject(from) && Buffer.isBuffer(from.buffer)) {
    return Script.fromBuffer(from.buffer);
  }
}

/**
 * Sets the script content from an object.
 * @param {Object} obj - The source object containing either chunks array or buffer.
 * @param {Array} [obj.chunks] - Optional array of chunks to create script from.
 * @param {Buffer} [obj.buffer] - Optional buffer containing script data.
 * @returns {Script} Returns the script instance for chaining.
 * @throws Will throw if argument is invalid (not object or missing required buffer).
 */
Script.prototype.set = function (obj) {
  $.checkArgument(_.isObject(obj));
  if (obj.chunks && _.isArray(obj.chunks)) {
    var s = Script.fromChunks(obj.chunks);
    this.buffer = s.buffer;
    return this;
  }

  $.checkArgument(Buffer.isBuffer(obj.buffer));
  this.buffer = obj.buffer;
  return this;
};

/**
 * Creates a Script instance from a Buffer.
 * @param {Buffer} buffer - The buffer containing the script data.
 * @returns {Script} A new Script instance with the provided buffer.
 * @throws {Error} Throws if the input is not a Buffer.
 */
Script.fromBuffer = function (buffer) {
  $.checkArgument(Buffer.isBuffer(buffer));
  var script = new Script();
  script.buffer = buffer;
  return script;
};

/**
 * Creates a Script instance from an array of opcode chunks.
 * Handles different pushdata opcodes (OP_PUSHDATA1, OP_PUSHDATA2, OP_PUSHDATA4)
 * by writing appropriate length prefixes before the buffer data.
 * @param {Array} chunks - Array of opcode chunks containing opcodenum and optional buf/len
 * @returns {Script} A new Script instance with compiled buffer
 */
Script.fromChunks = function (chunks) {
  var script = new Script();

  const bw = new BufferWriter();

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    bw.writeUInt8(chunk.opcodenum);
    if (chunk.buf) {
      if (chunk.opcodenum < Opcode.OP_PUSHDATA1) {
        bw.write(chunk.buf);
      } else if (chunk.opcodenum === Opcode.OP_PUSHDATA1) {
        bw.writeUInt8(chunk.len);
        bw.write(chunk.buf);
      } else if (chunk.opcodenum === Opcode.OP_PUSHDATA2) {
        bw.writeUInt16LE(chunk.len);
        bw.write(chunk.buf);
      } else if (chunk.opcodenum === Opcode.OP_PUSHDATA4) {
        bw.writeUInt32LE(chunk.len);
        bw.write(chunk.buf);
      }
    }
  }

  script.buffer = bw.toBuffer();
  return script;
};

/**
 * Returns the underlying buffer of the script.
 * @returns {Buffer} The script's buffer data.
 */
Script.prototype.toBuffer = function () {
  return this.buffer;
};

/**
 * Creates a Script instance from ASM (Assembly) formatted string.
 * @param {string} str - ASM formatted string to decode
 * @returns {Script} Script instance created from decoded ASM
 */
Script.fromASM = function (str) {
  return Script.fromBuffer(decodeASM(str));
};

/**
 * Creates a Script instance from a hex string.
 * @param {string} str - Hex string to convert to Script.
 * @returns {Script} New Script instance created from the hex string.
 */
Script.fromHex = function (str) {
  return new Script(Buffer.from(str, 'hex'));
};

/**
 * Converts a string representation of a script into a Script object.
 * Handles hex strings, empty strings, and space-separated opcode tokens.
 * For pushdata operations (OP_PUSHDATA1/2/4), validates format and length.
 * Throws errors for invalid script formats or data lengths.
 * @param {string} str - The script string to parse (hex or opcode tokens)
 * @returns {Script} The constructed Script object
 * @throws {Error} When script format is invalid or data lengths don't match
 */
Script.fromString = function (str) {
  if (JSUtil.isHexa(str) || str.length === 0) {
    return new Script(Buffer.from(str, 'hex'));
  }

  var chunks = [];

  var tokens = str.split(' ');
  var i = 0;
  while (i < tokens.length) {
    var token = tokens[i];
    var opcode = Opcode(token);
    var opcodenum = opcode.toNumber();

    if (_.isUndefined(opcodenum)) {
      opcodenum = parseInt(token);
      if (opcodenum > 0 && opcodenum < Opcode.OP_PUSHDATA1) {
        var buf = Buffer.from(tokens[i + 1].slice(2), 'hex');
        if (buf.length !== opcodenum) {
          throw new Error('Invalid script buf len: ' + JSON.stringify(str));
        }
        chunks.push({
          buf: Buffer.from(tokens[i + 1].slice(2), 'hex'),
          len: opcodenum,
          opcodenum: opcodenum,
        });
        i = i + 2;
      } else {
        throw new Error('Invalid script: ' + JSON.stringify(str));
      }
    } else if (
      opcodenum === Opcode.OP_PUSHDATA1 ||
      opcodenum === Opcode.OP_PUSHDATA2 ||
      opcodenum === Opcode.OP_PUSHDATA4
    ) {
      if (tokens[i + 2].slice(0, 2) !== '0x') {
        throw new Error('Pushdata data must start with 0x');
      }
      chunks.push({
        buf: Buffer.from(tokens[i + 2].slice(2), 'hex'),
        len: parseInt(tokens[i + 1]),
        opcodenum: opcodenum,
      });
      i = i + 3;
    } else {
      chunks.push({
        opcodenum: opcodenum,
      });
      i = i + 1;
    }
  }
  return Script.fromChunks(chunks);
};

/**
 * Gets a portion of the script's buffer as a new buffer.
 * @param {number} [start] - The beginning index of the specified portion of the buffer.
 * @param {number} [end] - The end index of the specified portion of the buffer.
 * @returns {Buffer} A new Buffer that contains the specified portion of the original buffer.
 */
Script.prototype.slice = function (start, end) {
  return this.buffer.slice(start, end);
};

/**
 * Gets the chunks associated with the Script instance.
 * @memberof Script.prototype
 * @name chunks
 * @type {Array}
 */
Object.defineProperty(Script.prototype, 'chunks', {
  get() {
    if (SCRIPT_TO_CHUNKS_CACHE.has(this)) return SCRIPT_TO_CHUNKS_CACHE.get(this);
    const chunks = decodeScriptChunks(this.buffer);
    SCRIPT_TO_CHUNKS_CACHE.set(this, chunks);
    return chunks;
  },
});

/**
 * Gets the length of the script in bytes.
 * @memberof Script.prototype
 * @name length
 * @type {number}
 */
Object.defineProperty(Script.prototype, 'length', {
  get() {
    return this.buffer.length;
  },
});

/**
 * Converts a script chunk to a string representation based on the given type.
 * Handles both data chunks and opcode chunks, with special formatting for ASM output.
 *
 * @param {Object} chunk - The script chunk to convert, containing opcodenum and optional buf/len
 * @param {string} type - The output type ('asm' or other)
 * @returns {string} The formatted string representation of the chunk
 * @private
 */
Script.prototype._chunkToString = function (chunk, type) {
  var opcodenum = chunk.opcodenum;
  var asm = type === 'asm';
  var str = '';
  if (!chunk.buf) {
    // no data chunk
    if (typeof Opcode.reverseMap[opcodenum] !== 'undefined') {
      if (asm) {
        // A few cases where the opcode name differs from reverseMap
        // aside from 1 to 16 data pushes.
        if (opcodenum === 0) {
          // OP_0 -> 0
          str = str + ' 0';
        } else if (opcodenum === 79) {
          // OP_1NEGATE -> 1
          str = str + ' -1';
        } else {
          str = str + ' ' + Opcode(opcodenum).toString();
        }
      } else {
        str = str + ' ' + Opcode(opcodenum).toString();
      }
    } else {
      var numstr = opcodenum.toString(16);
      if (numstr.length % 2 !== 0) {
        numstr = '0' + numstr;
      }
      if (asm) {
        str = str + ' ' + numstr;
      } else {
        str = str + ' ' + '0x' + numstr;
      }
    }
  } else {
    // data chunk
    if (
      !asm &&
      (opcodenum === Opcode.OP_PUSHDATA1 ||
        opcodenum === Opcode.OP_PUSHDATA2 ||
        opcodenum === Opcode.OP_PUSHDATA4)
    ) {
      str = str + ' ' + Opcode(opcodenum).toString();
    }
    if (chunk.len > 0) {
      if (asm) {
        str = str + ' ' + chunk.buf.toString('hex');
      } else {
        str = str + ' ' + chunk.len + ' ' + '0x' + chunk.buf.toString('hex');
      }
    }
  }
  return str;
};

/**
 * Converts the script chunks to ASM (Assembly) format string representation.
 * Iterates through each chunk and appends its ASM string representation.
 * @returns {string} The ASM formatted string (excluding the first character).
 */
Script.prototype.toASM = function () {
  var str = '';
  var chunks = this.chunks;
  for (var i = 0; i < chunks.length; i++) {
    var chunk = this.chunks[i];
    str += this._chunkToString(chunk, 'asm');
  }

  return str.substr(1);
};

/**
 * Converts the script's chunks to a string representation.
 * Iterates through each chunk and appends its string representation,
 * then removes the leading character from the result.
 * @returns {string} The concatenated string of all chunks.
 */
Script.prototype.toString = function () {
  var str = '';
  for (var i = 0; i < this.chunks.length; i++) {
    var chunk = this.chunks[i];
    str += this._chunkToString(chunk);
  }

  return str.substr(1);
};

/**
 * Converts the script's buffer to a hexadecimal string.
 * @returns {string} Hex-encoded representation of the script buffer.
 */
Script.prototype.toHex = function () {
  return encodeHex(this.buffer);
};

/**
 * Custom inspect method for Script instances.
 * @returns {string} String representation of the Script object in format '<Script: [content]>'.
 */
Script.prototype.inspect = function () {
  return '<Script: ' + this.toString() + '>';
};

// script classification methods

/**
 * Checks if the script is a standard public key hash output script (P2PKH).
 * @returns {boolean} True if the script matches the P2PKH pattern:
 * - OP_DUP
 * - OP_HASH160
 * - 20-byte hash
 * - OP_EQUALVERIFY
 * - OP_CHECKSIG
 */
Script.prototype.isPublicKeyHashOut = function () {
  return !!(
    this.chunks.length === 5 &&
    this.chunks[0].opcodenum === Opcode.OP_DUP &&
    this.chunks[1].opcodenum === Opcode.OP_HASH160 &&
    this.chunks[2].buf &&
    this.chunks[2].buf.length === 20 &&
    this.chunks[3].opcodenum === Opcode.OP_EQUALVERIFY &&
    this.chunks[4].opcodenum === Opcode.OP_CHECKSIG
  );
};

/**
 * Checks if the script contains a valid public key hash.
 * @returns {boolean} True if the script has exactly 2 chunks (signature and public key),
 *                   the signature starts with 0x30, and the public key has a valid version
 *                   and length (65 bytes for versions 0x04/0x06/0x07, 33 bytes for 0x02/0x03).
 */
Script.prototype.isPublicKeyHashIn = function () {
  if (this.chunks.length === 2) {
    var signatureBuf = this.chunks[0].buf;
    var pubkeyBuf = this.chunks[1].buf;
    if (
      signatureBuf &&
      signatureBuf.length &&
      signatureBuf[0] === 0x30 &&
      pubkeyBuf &&
      pubkeyBuf.length
    ) {
      var version = pubkeyBuf[0];
      if ((version === 0x04 || version === 0x06 || version === 0x07) && pubkeyBuf.length === 65) {
        return true;
      } else if ((version === 0x03 || version === 0x02) && pubkeyBuf.length === 33) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Gets the public key from a script output.
 * @returns {Buffer} The public key buffer.
 * @throws {Error} If the script is not a public key output.
 */
Script.prototype.getPublicKey = function () {
  $.checkState(this.isPublicKeyOut(), "Can't retrieve PublicKey from a non-PK output");
  return this.chunks[0].buf;
};

/**
 * Retrieves the PublicKeyHash from a script output.
 * @returns {Buffer} The PublicKeyHash buffer.
 * @throws {Error} If the script output is not a PublicKeyHash output.
 */
Script.prototype.getPublicKeyHash = function () {
  $.checkState(this.isPublicKeyHashOut(), "Can't retrieve PublicKeyHash from a non-PKH output");
  return this.chunks[2].buf;
};

/**
 * Checks if the script is a standard public key output script.
 * @returns {boolean} True if the script matches the standard public key output format:
 *                    - Contains exactly 2 chunks
 *                    - First chunk is a valid public key buffer (65 bytes for uncompressed, 33 bytes for compressed)
 *                    - Second chunk is OP_CHECKSIG opcode
 */
Script.prototype.isPublicKeyOut = function () {
  if (
    this.chunks.length === 2 &&
    this.chunks[0].buf &&
    this.chunks[0].buf.length &&
    this.chunks[1].opcodenum === Opcode.OP_CHECKSIG
  ) {
    var pubkeyBuf = this.chunks[0].buf;
    var version = pubkeyBuf[0];
    var isVersion = false;
    if ((version === 0x04 || version === 0x06 || version === 0x07) && pubkeyBuf.length === 65) {
      isVersion = true;
    } else if ((version === 0x03 || version === 0x02) && pubkeyBuf.length === 33) {
      isVersion = true;
    }
    if (isVersion) {
      return PublicKey.isValid(pubkeyBuf);
    }
  }
  return false;
};

/**
 * Checks if the script contains a valid public key signature.
 * @returns {boolean} True if the script has exactly one chunk that starts with 0x30 (DER signature marker), false otherwise.
 */
Script.prototype.isPublicKeyIn = function () {
  if (this.chunks.length === 1) {
    var signatureBuf = this.chunks[0].buf;
    if (signatureBuf && signatureBuf.length && signatureBuf[0] === 0x30) {
      return true;
    }
  }
  return false;
};

/**
 * Checks if the script is a multisig output script.
 * @returns {boolean} True if the script matches the multisig output pattern:
 * - Has more than 3 chunks
 * - First chunk is a small integer opcode
 * - Middle chunks are all buffers
 * - Second-to-last chunk is a small integer opcode
 * - Last chunk is OP_CHECKMULTISIG
 */
Script.prototype.isMultisigOut = function () {
  return (
    this.chunks.length > 3 &&
    Opcode.isSmallIntOp(this.chunks[0].opcodenum) &&
    this.chunks.slice(1, this.chunks.length - 2).every(function (obj) {
      return obj.buf && Buffer.isBuffer(obj.buf);
    }) &&
    Opcode.isSmallIntOp(this.chunks[this.chunks.length - 2].opcodenum) &&
    this.chunks[this.chunks.length - 1].opcodenum === Opcode.OP_CHECKMULTISIG
  );
};

/**
 * Decodes a multisig output script into its components.
 * @returns {Object} An object containing:
 *   - m {number} The required number of signatures (m-of-n)
 *   - n {number} The total number of public keys
 *   - pubkeys {Buffer[]} Array of public keys involved in the multisig
 */
Script.prototype.decodeMultisigOut = function () {
  $.checkState(this.isMultisigOut(), "Can't decode a non-multisig output script");
  const OP_INT_BASE = Opcode.OP_RESERVED; // OP_1 - 1
  const m = this.chunks[0].opcodenum - OP_INT_BASE;
  const n = this.chunks[0][this.chunks[0].length - 2] - OP_INT_BASE;
  const pubkeys = this.chunks.slice(1, -2).map((chunk) => chunk.buf);

  return {
    m,
    n,
    pubkeys,
  };
};

/**
 * Checks if the script is a multisig input script.
 * @returns {boolean} True if the script is a valid multisig input (starts with OP_0 and has valid DER signatures).
 */
Script.prototype.isMultisigIn = function () {
  return (
    this.chunks.length >= 2 &&
    this.chunks[0].opcodenum === 0 &&
    this.chunks.slice(1, this.chunks.length).every(function (obj) {
      return obj.buf && Buffer.isBuffer(obj.buf) && Signature.isTxDER(obj.buf);
    })
  );
};

/**
 * Checks if the script is a data-only output script (OP_RETURN followed by push-only data).
 * @returns {boolean} True if the script is a valid data-only output, false otherwise.
 */
Script.prototype.isDataOut = function () {
  var step1 = this.buffer.length >= 1 && this.buffer[0] === Opcode.OP_RETURN;
  if (!step1) return false;
  var buffer = this.buffer.slice(1);
  var script2 = new Script({ buffer: buffer });
  return script2.isPushOnly();
};

/**
 * Checks if the script is a safe data output script.
 * A safe data output script must start with OP_FALSE followed by a valid data output script.
 * @returns {boolean} True if the script is a safe data output, false otherwise.
 */
Script.prototype.isSafeDataOut = function () {
  if (this.buffer.length < 2) {
    return false;
  }
  if (this.buffer[0] !== Opcode.OP_FALSE) {
    return false;
  }
  var buffer = this.buffer.slice(1);
  var script2 = new Script({ buffer });
  return script2.isDataOut();
};

/**
 * Retrieve the associated data for this script.
 * In the case of a pay to public key hash, return the hash.
 * In the case of safe OP_RETURN data, return an array of buffers
 * In the case of a standard deprecated OP_RETURN, return the data
 * @returns {Buffer}
 */
Script.prototype.getData = function () {
  if (this.isSafeDataOut()) {
    var chunks = this.chunks.slice(2);
    var buffers = chunks.map((chunk) => chunk.buf);
    return buffers;
  }
  if (this.isDataOut()) {
    if (_.isUndefined(this.chunks[1])) {
      return Buffer.alloc(0);
    } else {
      return Buffer.from(this.chunks[1].buf);
    }
  }
  if (this.isPublicKeyHashOut()) {
    return Buffer.from(this.chunks[2].buf);
  }
  throw new Error('Unrecognized script type to get data from');
};

/**
 * Checks if the script consists only of push operations (OP_0 to OP_16) or data push operations (OP_PUSHDATA1/2/4).
 * @returns {boolean} True if all chunks are push operations, false otherwise.
 */
Script.prototype.isPushOnly = function () {
  return _.every(this.chunks, function (chunk) {
    return (
      chunk.opcodenum <= Opcode.OP_16 ||
      chunk.opcodenum === Opcode.OP_PUSHDATA1 ||
      chunk.opcodenum === Opcode.OP_PUSHDATA2 ||
      chunk.opcodenum === Opcode.OP_PUSHDATA4
    );
  });
};

/**
 * Registry for script types.
 * @namespace
 */
Script.types = {};
/**
 * Represents the 'Unknown' type constant for script types.
 * @type {string}
 */
Script.types.UNKNOWN = 'Unknown';
/**
 * Defines the display text for the public key output script type.
 * @type {string}
 */
Script.types.PUBKEY_OUT = 'Pay to public key';
/**
 * Script type constant for spending from a public key input.
 * @type {string}
 */
Script.types.PUBKEY_IN = 'Spend from public key';
/**
 * Script type constant for Pay to Public Key Hash (P2PKH) output.
 * @type {string}
 */
Script.types.PUBKEYHASH_OUT = 'Pay to public key hash';
/**
 * Constant defining the display string for public key hash input script type.
 * @type {string}
 */
Script.types.PUBKEYHASH_IN = 'Spend from public key hash';
/**
 * Script type constant for Pay to Script Hash (P2SH) output.
 * @type {string}
 */
Script.types.SCRIPTHASH_OUT = 'Pay to script hash';
/**
 * Constant defining the string representation for spending from a script hash input type.
 * @type {string}
 */
Script.types.SCRIPTHASH_IN = 'Spend from script hash';
/**
 * Multisig output script type identifier.
 * @type {string}
 */
Script.types.MULTISIG_OUT = 'Pay to multisig';
/**
 * Multisig input script type - represents spending from a multisig address.
 */
Script.types.MULTISIG_IN = 'Spend from multisig';
/**
 * Constant defining the type string for data output operations.
 * @type {string}
 */
Script.types.DATA_OUT = 'Data push';
/**
 * Constant defining the type string for safe data output operations.
 * @type {string}
 */
Script.types.SAFE_DATA_OUT = 'Safe data push';

/**
 * @returns {object} The Script type if it is a known form,
 * or Script.UNKNOWN if it isn't
 */
Script.prototype.classify = function () {
  if (this._isInput) {
    return this.classifyInput();
  } else if (this._isOutput) {
    return this.classifyOutput();
  } else {
    var outputType = this.classifyOutput();
    return outputType !== Script.types.UNKNOWN ? outputType : this.classifyInput();
  }
};

Script.outputIdentifiers = {};
Script.outputIdentifiers.PUBKEY_OUT = Script.prototype.isPublicKeyOut;
Script.outputIdentifiers.PUBKEYHASH_OUT = Script.prototype.isPublicKeyHashOut;
Script.outputIdentifiers.MULTISIG_OUT = Script.prototype.isMultisigOut;
Script.outputIdentifiers.DATA_OUT = Script.prototype.isDataOut;
Script.outputIdentifiers.SAFE_DATA_OUT = Script.prototype.isSafeDataOut;

/**
 * @returns {object} The Script type if it is a known form,
 * or Script.UNKNOWN if it isn't
 */
Script.prototype.classifyOutput = function () {
  for (var type in Script.outputIdentifiers) {
    if (Script.outputIdentifiers[type].bind(this)()) {
      return Script.types[type];
    }
  }
  return Script.types.UNKNOWN;
};

Script.inputIdentifiers = {};
Script.inputIdentifiers.PUBKEY_IN = Script.prototype.isPublicKeyIn;
Script.inputIdentifiers.PUBKEYHASH_IN = Script.prototype.isPublicKeyHashIn;
Script.inputIdentifiers.MULTISIG_IN = Script.prototype.isMultisigIn;

/**
 * @returns {object} The Script type if it is a known form,
 * or Script.UNKNOWN if it isn't
 */
Script.prototype.classifyInput = function () {
  for (var type in Script.inputIdentifiers) {
    if (Script.inputIdentifiers[type].bind(this)()) {
      return Script.types[type];
    }
  }
  return Script.types.UNKNOWN;
};

/**
 * @returns {boolean} if script is one of the known types
 */
Script.prototype.isStandard = function () {
  // TODO: Add BIP62 compliance
  return this.classify() !== Script.types.UNKNOWN;
};

// Script construction methods

/**
 * Adds a script element at the start of the script.
 * @param {*} obj a string, number, Opcode, Buffer, or object to add
 * @returns {Script} this script instance
 */
Script.prototype.prepend = function (obj) {
  this._addByType(obj, true);
  return this;
};

/**
 * Compares this script with another script for equality.
 * @param {Script} script - The script to compare with.
 * @returns {boolean} True if the scripts have identical buffer contents, false otherwise.
 * @throws {Error} If the provided argument is not a Script instance.
 */
Script.prototype.equals = function (script) {
  $.checkState(script instanceof Script, 'Must provide another script');
  if (this.buffer.length !== script.buffer.length) {
    return false;
  }
  var i;
  for (i = 0; i < this.buffer.length; i++) {
    if (this.buffer[i] !== script.buffer[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Adds a script element to the end of the script.
 * @param {Object} obj - The object to add.
 * @returns {Script} Returns the script instance for chaining.
 */
Script.prototype.add = function (obj) {
  this._addByType(obj, false);
  return this;
};

/**
 * Adds a script element to the script by type.
 * Handles strings, numbers, Opcode instances, Buffers, Script instances, or objects.
 * @param {string|number|Opcode|Buffer|Script|Object} obj - The element to add
 * @param {boolean} [prepend=false] - Whether to prepend (true) or append (false)
 * @throws {Error} If the input is an invalid script chunk
 * @private
 */
Script.prototype._addByType = function (obj, prepend) {
  if (typeof obj === 'string') {
    this._addOpcode(obj, prepend);
  } else if (typeof obj === 'number') {
    this._addOpcode(obj, prepend);
  } else if (obj instanceof Opcode) {
    this._addOpcode(obj, prepend);
  } else if (Buffer.isBuffer(obj)) {
    this._addBuffer(obj, prepend);
  } else if (obj instanceof Script) {
    this._insertAtPosition(obj.buffer, prepend);
  } else if (typeof obj === 'object') {
    var s = Script.fromChunks([obj]);
    this._insertAtPosition(s.toBuffer(), prepend);
  } else {
    throw new Error('Invalid script chunk');
  }
};

/**
 * Inserts a buffer at the specified position in the script's buffer.
 * @param {Buffer} buf - The buffer to insert.
 * @param {boolean} prepend - If true, inserts before the existing buffer; otherwise appends after.
 * @private
 */
Script.prototype._insertAtPosition = function (buf, prepend) {
  var bw = new BufferWriter();

  if (prepend) {
    bw.write(buf);
    bw.write(this.buffer);
  } else {
    bw.write(this.buffer);
    bw.write(buf);
  }
  this.buffer = bw.toBuffer();
};

/**
 * Adds an opcode to the script.
 * @param {number|Opcode|string} opcode - The opcode to add (can be a number, Opcode instance, or string).
 * @param {boolean} [prepend=false] - Whether to prepend the opcode (true) or append it (false).
 * @returns {Script} Returns the script instance for chaining.
 * @throws {errors.Script.InvalidOpcode} Throws if the opcode value exceeds 255.
 */
Script.prototype._addOpcode = function (opcode, prepend) {
  var op;
  if (typeof opcode === 'number') {
    op = opcode;
  } else if (opcode instanceof Opcode) {
    op = opcode.toNumber();
  } else {
    op = Opcode(opcode).toNumber();
  }

  // OP_INVALIDOPCODE
  if (op > 255) {
    throw new errors.Script.InvalidOpcode(op);
  }
  this._insertAtPosition(
    Script.fromChunks([
      {
        opcodenum: op,
      },
    ]).toBuffer(),
    prepend,
  );
  return this;
};

/**
 * Adds a buffer to the script with appropriate opcode based on buffer length.
 * Handles different buffer sizes by using corresponding pushdata opcodes.
 * @param {Buffer} buf - The buffer to add to the script
 * @param {boolean} [prepend] - Whether to prepend the buffer (default: append)
 * @returns {Script} Returns the script instance for chaining
 * @throws {Error} If buffer length exceeds maximum allowed size (2^32)
 */
Script.prototype._addBuffer = function (buf, prepend) {
  var bw = new BufferWriter();
  var opcodenum;
  var len = buf.length;
  if (len === 0) {
    opcodenum = 0;
    bw.writeUInt8(opcodenum);
  } else if (len > 0 && len < Opcode.OP_PUSHDATA1) {
    opcodenum = len;
    bw.writeUInt8(opcodenum);
    bw.write(buf);
  } else if (len < Math.pow(2, 8)) {
    opcodenum = Opcode.OP_PUSHDATA1;
    bw.writeUInt8(opcodenum);
    bw.writeUInt8(len);
    bw.write(buf);
  } else if (len < Math.pow(2, 16)) {
    opcodenum = Opcode.OP_PUSHDATA2;
    bw.writeUInt8(opcodenum);
    bw.writeUInt16LE(len);
    bw.write(buf);
  } else if (len < Math.pow(2, 32)) {
    opcodenum = Opcode.OP_PUSHDATA4;
    bw.writeUInt8(opcodenum);
    bw.writeUInt32LE(len);
    bw.write(buf);
  } else {
    throw new Error("You can't push that much data");
  }

  this._insertAtPosition(bw.toBuffer(), prepend);
  return this;
};

/**
 * Creates a shallow copy of the Script instance.
 * @returns {Script} A new Script instance with the same buffer content.
 */
Script.prototype.clone = function () {
  return Script.fromBuffer(this.buffer.slice());
};

/**
 * Removes all OP_CODESEPARATOR opcodes from the script chunks.
 * Updates the script buffer with the filtered chunks and clears the cache.
 * @returns {Script} The modified script instance for chaining.
 */
Script.prototype.removeCodeseparators = function () {
  var chunks = [];
  for (var i = 0; i < this.chunks.length; i++) {
    if (this.chunks[i].opcodenum !== Opcode.OP_CODESEPARATOR) {
      chunks.push(this.chunks[i]);
    }
  }
  SCRIPT_TO_CHUNKS_CACHE.delete(this);

  this.buffer = Script.fromChunks(chunks).toBuffer();
  return this;
};

/**
 * If the script does not contain any OP_CODESEPARATOR, Return all scripts
 * If the script contains any OP_CODESEPARATOR, the scriptCode is the script but removing everything up to and including the last executed OP_CODESEPARATOR before the signature checking opcode being executed
 * @param {n} The {n}th codeseparator in the script
 *
 * @returns {Script} Subset of script starting at the {n}th codeseparator
 */
Script.prototype.subScript = function (n) {
  var idx = 0;

  for (var i = 0; i < this.chunks.length; i++) {
    if (this.chunks[i].opcodenum === Opcode.OP_CODESEPARATOR) {
      if (idx === n) {
        return Script.fromChunks(this.chunks.slice(i + 1));
      } else {
        idx++;
      }
    }
  }

  return this;
};

/**
 * Builds a multisig output script from given public keys and threshold.
 * @param {Array} publicKeys - Array of public keys to include in the multisig
 * @param {number} threshold - Minimum number of signatures required
 * @param {Object} [opts] - Optional parameters
 * @param {boolean} [opts.noSorting] - If true, skips sorting of public keys
 * @returns {Script} The constructed multisig script
 */
Script.buildMultisigOut = function (publicKeys, threshold, opts) {
  $.checkArgument(
    threshold <= publicKeys.length,
    'Number of required signatures must be less than or equal to the number of public keys',
  );
  opts = opts || {};
  var script = new Script();
  script.add(Opcode.smallInt(threshold));
  publicKeys = _.map(publicKeys, PublicKey);
  var sorted = publicKeys;
  if (!opts.noSorting) {
    sorted = publicKeys
      .map((k) => k.toString('hex'))
      .sort()
      .map((k) => new PublicKey(k));
  }
  for (var i = 0; i < sorted.length; i++) {
    var publicKey = sorted[i];
    script.add(publicKey.toBuffer());
  }
  script.add(Opcode.smallInt(publicKeys.length));
  script.add(Opcode.OP_CHECKMULTISIG);
  return script;
};

/**
 * A new Multisig input script for the given public keys, requiring m of those public keys to spend
 *
 * @param {PublicKey[]} pubkeys list of all public keys controlling the output
 * @param {number} threshold amount of required signatures to spend the output
 * @param {Array} signatures and array of signature buffers to append to the script
 * @param {Object=} opts
 * @param {boolean=} opts.noSorting don't sort the given public keys before creating the script (false by default)
 * @param {Script=} opts.cachedMultisig don't recalculate the redeemScript
 *
 * @returns {Script}
 */
Script.buildMultisigIn = function (pubkeys, threshold, signatures, opts) {
  $.checkArgument(_.isArray(pubkeys));
  $.checkArgument(_.isNumber(threshold));
  $.checkArgument(_.isArray(signatures));
  opts = opts || {};
  var s = new Script();
  // Note: OP_0 is not needed for OPCAT multisig implementation
  // (removed the dummy OP_0 required by legacy Bitcoin CHECKMULTISIG)
  _.each(signatures, function (signature) {
    $.checkArgument(Buffer.isBuffer(signature), 'Signatures must be an array of Buffers');
    // TODO: allow signatures to be an array of Signature objects
    s.add(signature);
  });
  return s;
};

/**
 * Builds a standard P2PKH (Pay-to-Public-Key-Hash) script for a given recipient.
 * @param {PublicKey|Address|string} to - Recipient's public key, address, or address string
 * @returns {Script} A P2PKH script with the format: OP_DUP OP_HASH160 \<pubKeyHash\> OP_EQUALVERIFY OP_CHECKSIG
 * @throws {Error} If 'to' argument is undefined or invalid type
 */
Script.buildPublicKeyHashOut = function (to) {
  $.checkArgument(!_.isUndefined(to));
  $.checkArgument(to instanceof PublicKey || to instanceof Address || _.isString(to));
  if (to instanceof PublicKey) {
    to = to.toAddress();
  } else if (_.isString(to)) {
    to = new Address(to);
  }
  var s = new Script();
  s.add(Opcode.OP_DUP)
    .add(Opcode.OP_HASH160)
    .add(to.hashBuffer)
    .add(Opcode.OP_EQUALVERIFY)
    .add(Opcode.OP_CHECKSIG);
  s._network = to.network;
  return s;
};

/**
 * Builds a standard P2PK (Pay-to-Public-Key) script output.
 * @param {PublicKey} pubkey - The public key to create the script for
 * @returns {Script} A new script containing the public key and OP_CHECKSIG opcode
 */
Script.buildPublicKeyOut = function (pubkey) {
  $.checkArgument(pubkey instanceof PublicKey);
  var s = new Script();
  s.add(pubkey.toBuffer()).add(Opcode.OP_CHECKSIG);
  return s;
};

/**
 * @returns {Script} a new OP_RETURN script with data
 * @param {string|Buffer|Array} data - the data to embed in the output - it is a string, buffer, or array of strings or buffers
 * @param {string} encoding - the type of encoding of the string(s)
 */
Script.buildDataOut = function (data, encoding) {
  $.checkArgument(
    _.isUndefined(data) || _.isString(data) || _.isArray(data) || Buffer.isBuffer(data),
  );
  var datas = data;
  if (!_.isArray(datas)) {
    datas = [data];
  }
  var s = new Script();
  s.add(Opcode.OP_RETURN);
  for (let data of datas) {
    $.checkArgument(_.isUndefined(data) || _.isString(data) || Buffer.isBuffer(data));
    if (_.isString(data)) {
      data = Buffer.from(data, encoding);
    }
    if (!_.isUndefined(data)) {
      s.add(data);
    }
  }
  return s;
};

/**
 * @returns {Script} a new OP_RETURN script with data
 * @param {string|Buffer|Array} data - the data to embed in the output - it is a string, buffer, or array of strings or buffers
 * @param {string} encoding - the type of encoding of the string(s)
 */
Script.buildSafeDataOut = function (data, encoding) {
  var s2 = Script.buildDataOut(data, encoding);
  var s1 = new Script();
  s1.add(Opcode.OP_FALSE);
  s1.add(s2);
  return s1;
};

/**
 * Builds a scriptSig (a script for an input) that signs a public key output script.
 *
 * @param {Signature|Buffer} signature - a Signature object, or the signature in DER canonical encoding
 * @param {number} [sigtype] - the type of the signature (defaults to SIGHASH_ALL)
 */
Script.buildPublicKeyIn = function (signature, sigtype) {
  $.checkArgument(signature instanceof Signature || Buffer.isBuffer(signature));
  $.checkArgument(_.isUndefined(sigtype) || _.isNumber(sigtype));
  if (signature instanceof Signature) {
    signature = signature.toBuffer();
  }
  var script = new Script();
  script.add(Buffer.concat([signature, Buffer.from([(sigtype || Signature.SIGHASH_ALL) & 0xff])]));
  return script;
};

/**
 * Builds a scriptSig (a script for an input) that signs a public key hash
 * output script.
 *
 * @param {Buffer|string|PublicKey} publicKey
 * @param {Signature|Buffer} signature - a Signature object, or the signature in DER canonical encoding
 * @param {number} [sigtype] - the type of the signature (defaults to SIGHASH_ALL)
 */
Script.buildPublicKeyHashIn = function (publicKey, signature, sigtype) {
  $.checkArgument(signature instanceof Signature || Buffer.isBuffer(signature));
  $.checkArgument(_.isUndefined(sigtype) || _.isNumber(sigtype));
  if (signature instanceof Signature) {
    signature = signature.toBuffer();
  }
  var script = new Script()
    .add(Buffer.concat([signature, Buffer.from([(sigtype || Signature.SIGHASH_ALL) & 0xff])]))
    .add(new PublicKey(publicKey).toBuffer());
  return script;
};

/**
 * Creates and returns an empty Script instance.
 * @returns {Script} A new empty Script object.
 */
Script.empty = function () {
  return new Script();
};

/**
 * Creates a Script from an address.
 * @param {Address|string} address - The address to convert to a script.
 * @returns {Script} A Pay-to-PublicKeyHash (P2PKH) script for the given address.
 * @throws {errors.Script.UnrecognizedAddress} If the address type is not supported.
 */
Script.fromAddress = function (address) {
  address = Address(address);
  if (address.isPayToPublicKeyHash()) {
    return Script.buildPublicKeyHashOut(address);
  }
  throw new errors.Script.UnrecognizedAddress(address);
};

/**
 * Gets address information for the script.
 * For input scripts, returns input address info.
 * For output scripts, returns output address info.
 * For general scripts, tries output address info first, falls back to input if not available.
 * @returns {Object} Address information object
 */
Script.prototype.getAddressInfo = function () {
  if (this._isInput) {
    return this._getInputAddressInfo();
  } else if (this._isOutput) {
    return this._getOutputAddressInfo();
  } else {
    var info = this._getOutputAddressInfo();
    if (!info) {
      return this._getInputAddressInfo();
    }
    return info;
  }
};

/**
 * Gets the output address information from the script.
 * @returns {Object|boolean} An object containing the hash buffer and address type if the script is a public key hash output, otherwise false.
 * @property {Buffer} info.hashBuffer - The hash buffer of the address.
 * @property {number} info.type - The type of the address (Address.PayToPublicKeyHash).
 */
Script.prototype._getOutputAddressInfo = function () {
  var info = {};
  if (this.isPublicKeyHashOut()) {
    info.hashBuffer = this.getData();
    info.type = Address.PayToPublicKeyHash;
  } else {
    return false;
  }
  return info;
};

/**
 * Will return the associated input scriptSig address information object
 * @return {Address|boolean}
 * @private
 */
Script.prototype._getInputAddressInfo = function () {
  var info = {};
  if (this.isPublicKeyHashIn()) {
    // hash the publickey found in the scriptSig
    info.hashBuffer = Hash.sha256ripemd160(this.chunks[1].buf);
    info.type = Address.PayToPublicKeyHash;
  } else {
    return false;
  }
  return info;
};

/**
 * Converts the script to an Address object for the specified network.
 * @param {string|Network} [network] - optianal, the network name or identifier.
 * @returns {Address} The derived Address object.
 * @throws {errors.Script.CantDeriveAddress} If address information cannot be derived from the script.
 */
Script.prototype.toAddress = function (network) {
  var info = this.getAddressInfo();
  if (!info) {
    throw new errors.Script.CantDeriveAddress(this);
  }
  info.network = Networks.get(network) || this._network || Networks.defaultNetwork;
  return new Address(info);
};

/**
 * Finds and deletes a matching script chunk from the current script.
 * Analogous to bitcoind's FindAndDelete. Find and delete equivalent chunks,
 * typically used with push data chunks.  Note that this will find and delete
 * not just the same data, but the same data with the same push data op as
 * produced by default. i.e., if a pushdata in a tx does not use the minimal
 * pushdata op, then when you try to remove the data it is pushing, it will not
 * be removed, because they do not use the same pushdata op.
 * @param {Script} script - The script chunk to find and delete.
 * @returns {Script} The modified script instance after deletion.
 */
Script.prototype.findAndDelete = function (script) {
  var buf = script.toBuffer();
  var hex = buf.toString('hex');
  var chunks = this.chunks;
  for (var i = 0; i < chunks.length; i++) {
    var script2 = Script.fromChunks([chunks[i]]);
    var buf2 = script2.toBuffer();
    var hex2 = buf2.toString('hex');
    if (hex === hex2) {
      chunks.splice(i, 1);
      this.buffer = Script.fromChunks(chunks).toBuffer();
    }
  }
  return this;
};

/**
 * Checks if a script chunk uses the minimal push operation possible.
 *
 * @param {number} i - Index of the chunk to check
 * @returns {boolean} True if the chunk uses minimal push operation, false otherwise
 *
 * The function verifies if the chunk could have been represented with:
 * - OP_0 for empty buffer
 * - OP_1 to OP_16 for single-byte values 1-16
 * - OP_1NEGATE for 0x81
 * - Direct push for buffers ≤75 bytes
 * - OP_PUSHDATA1 for buffers ≤255 bytes
 * - OP_PUSHDATA2 for buffers ≤65535 bytes
 */
Script.prototype.checkMinimalPush = function (i) {
  var chunk = this.chunks[i];
  var buf = chunk.buf;
  var opcodenum = chunk.opcodenum;
  if (!buf) {
    return true;
  }
  if (buf.length === 0) {
    // Could have used OP_0.
    return opcodenum === Opcode.OP_0;
  } else if (buf.length === 1 && buf[0] >= 1 && buf[0] <= 16) {
    // Could have used OP_1 .. OP_16.
    return opcodenum === Opcode.OP_1 + (buf[0] - 1);
  } else if (buf.length === 1 && buf[0] === 0x81) {
    // Could have used OP_1NEGATE
    return opcodenum === Opcode.OP_1NEGATE;
  } else if (buf.length <= 75) {
    // Could have used a direct push (opcode indicating number of bytes pushed + those bytes).
    return opcodenum === buf.length;
  } else if (buf.length <= 255) {
    // Could have used OP_PUSHDATA.
    return opcodenum === Opcode.OP_PUSHDATA1;
  } else if (buf.length <= 65535) {
    // Could have used OP_PUSHDATA2.
    return opcodenum === Opcode.OP_PUSHDATA2;
  }
  return true;
};

/**
 * Comes from bitcoind's script DecodeOP_N function
 * @param {number} opcode
 * @returns {number} numeric value in range of 0 to 16
 * @private
 */
Script.prototype._decodeOP_N = function (opcode) {
  if (opcode === Opcode.OP_0) {
    return 0;
  } else if (opcode >= Opcode.OP_1 && opcode <= Opcode.OP_16) {
    return opcode - (Opcode.OP_1 - 1);
  } else {
    throw new Error('Invalid opcode: ' + JSON.stringify(opcode));
  }
};

/**
 * Counts the number of signature operations in the script.
 * @param {boolean} [accurate=true] - Whether to count accurately for OP_CHECKMULTISIG(VERIFY).
 * @returns {number} The total count of signature operations.
 */
Script.prototype.getSignatureOperationsCount = function (accurate) {
  accurate = _.isUndefined(accurate) ? true : accurate;
  var self = this;
  var n = 0;
  var lastOpcode = Opcode.OP_INVALIDOPCODE;
  _.each(self.chunks, function getChunk(chunk) {
    var opcode = chunk.opcodenum;
    if (opcode === Opcode.OP_CHECKSIG || opcode === Opcode.OP_CHECKSIGVERIFY) {
      n++;
    } else if (opcode === Opcode.OP_CHECKMULTISIG || opcode === Opcode.OP_CHECKMULTISIGVERIFY) {
      if (accurate && lastOpcode >= Opcode.OP_1 && lastOpcode <= Opcode.OP_16) {
        n += self._decodeOP_N(lastOpcode);
      } else {
        n += 20;
      }
    }
    lastOpcode = opcode;
  });
  return n;
};

export default Script;
