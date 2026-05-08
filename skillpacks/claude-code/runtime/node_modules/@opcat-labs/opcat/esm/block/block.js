'use strict';

import _ from '../util/_.js';
import BlockHeader from './blockheader.js';
import MerkleBlock from './merkleblock.js';
import BN from '../crypto/bn.js';
import BufferReader from '../encoding/bufferreader.js';
import BufferWriter from '../encoding/bufferwriter.js';
import Hash from '../crypto/hash.js';
import Transaction from '../transaction/index.js';
import $ from '../util/preconditions.js';

/**
 * Instantiate a Block from a Buffer, JSON object, or Object with
 * the properties of the Block
 *
 * @param {*} - A Buffer, JSON string, or Object
 * @returns {Block}
 * @constructor
 */
function Block(arg) {
  if (!(this instanceof Block)) {
    return new Block(arg);
  }
  _.extend(this, Block._from(arg));
  return this;
}

/**
 * The maximum allowed size (in bytes) for a block.
 * @type {number}
 */
Block.MAX_BLOCK_SIZE = 128000000;


/**
 * Creates a Block instance from the given argument.
 * @param {*} arg - The input to convert into a Block.
 * @returns {Block} A new Block instance.
 * @throws {TypeError} - If the argument was not recognized
 * @private
 */
Block._from = function _from(arg) {
  var info = {};
  if (Buffer.isBuffer(arg)) {
    info = Block._fromBufferReader(BufferReader(arg));
  } else if (_.isObject(arg)) {
    info = Block._fromObject(arg);
  } else {
    throw new TypeError('Unrecognized argument for Block');
  }
  return info;
};


/**
 * Creates a Block instance from a plain object.
 * @param {Object} data - The plain object containing block data.
 * @returns {Block} The created Block instance.
 * @private
 */
Block._fromObject = function _fromObject(data) {
  var transactions = [];
  data.transactions.forEach(function (tx) {
    if (tx instanceof Transaction) {
      transactions.push(tx);
    } else {
      transactions.push(Transaction().fromObject(tx));
    }
  });
  var info = {
    header: BlockHeader.fromObject(data.header),
    transactions: transactions,
  };
  return info;
};


/**
 * Creates a Block instance from a plain JavaScript object.
 * @param {Object} obj - The source object to convert to a Block.
 * @returns {Block} A new Block instance.
 */
Block.fromObject = function fromObject(obj) {
  var info = Block._fromObject(obj);
  return new Block(info);
};


/**
 * Creates a Block instance from a BufferReader.
 * @private
 * @param {BufferReader} br - The buffer reader containing block data
 * @returns {Block} The parsed Block instance
 */
Block._fromBufferReader = function _fromBufferReader(br) {
  var info = {};
  $.checkState(!br.finished(), 'No block data received');
  info.header = BlockHeader.fromBufferReader(br);
  var transactions = br.readVarintNum();
  info.transactions = [];
  for (var i = 0; i < transactions; i++) {
    info.transactions.push(Transaction().fromBufferReader(br));
  }
  return info;
};


/**
 * Creates a Block instance from a BufferReader.
 * @param {BufferReader} br - The buffer reader containing block data.
 * @returns {Block} The parsed Block instance.
 */
Block.fromBufferReader = function fromBufferReader(br) {
  $.checkArgument(br, 'br is required');
  var info = Block._fromBufferReader(br);
  return new Block(info);
};


/**
 * Creates a Block instance from a buffer.
 * @param {Buffer} buf - The input buffer to create the block from.
 * @returns {Block} The created Block instance.
 */
Block.fromBuffer = function fromBuffer(buf) {
  return Block.fromBufferReader(new BufferReader(buf));
};


/**
 * Creates a Block instance from a string representation.
 * @param {string} str - The string to parse into a Block.
 * @returns {Block} The parsed Block instance.
 */
Block.fromString = function fromString(str) {
  var buf = Buffer.from(str, 'hex');
  return Block.fromBuffer(buf);
};


/**
 * Creates a Block instance from raw block data.
 * @param {Object} data - The raw block data to convert.
 * @returns {Block} A new Block instance.
 */
Block.fromRawBlock = function fromRawBlock(data) {
  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data, 'binary');
  }
  var br = BufferReader(data);
  br.pos = Block.Values.START_OF_BLOCK;
  var info = Block._fromBufferReader(br);
  return new Block(info);
};


/**
 * Converts the Block instance to a plain object (also aliased as toJSON).
 * @returns {Object} The plain object representation of the Block.
 */
Block.prototype.toObject = Block.prototype.toJSON = function toObject() {
  var transactions = [];
  this.transactions.forEach(function (tx) {
    transactions.push(tx.toObject());
  });
  return {
    header: this.header.toObject(),
    transactions: transactions,
  };
};


/**
 * Converts the block to a buffer representation.
 * @returns {Buffer} The buffer containing the block data.
 */
Block.prototype.toBuffer = function toBuffer() {
  return this.toBufferWriter().concat();
};

/**
 * Returns the string representation of the Block instance.
 * @returns {string} - A hex encoded string of the block
 */
Block.prototype.toString = function toString() {
  return this.toBuffer().toString('hex');
};

/**
 * @param {BufferWriter} - An existing instance of BufferWriter
 * @returns {BufferWriter} - An instance of BufferWriter representation of the Block
 */
Block.prototype.toBufferWriter = function toBufferWriter(bw) {
  if (!bw) {
    bw = new BufferWriter();
  }
  bw.write(this.header.toBuffer());
  bw.writeVarintNum(this.transactions.length);
  for (var i = 0; i < this.transactions.length; i++) {
    this.transactions[i].toBufferWriter(false, bw);
  }
  return bw;
};

/**
 * Will iterate through each transaction and return an array of hashes
 * @returns {Array} - An array with transaction hashes
 */
Block.prototype.getTransactionHashes = function getTransactionHashes() {
  var hashes = [];
  if (this.transactions.length === 0) {
    return [Block.Values.NULL_HASH];
  }
  for (var t = 0; t < this.transactions.length; t++) {
    hashes.push(this.transactions[t]._getHash());
  }
  return hashes;
};

/**
 * Will build a merkle tree of all the transactions, ultimately arriving at
 * a single point, the merkle root.
 * @link https://en.bitcoin.it/wiki/Protocol_specification#Merkle_Trees
 * @returns {Array} - An array with each level of the tree after the other.
 */
Block.prototype.getMerkleTree = function getMerkleTree() {
  var tree = this.getTransactionHashes();

  var j = 0;
  for (var size = this.transactions.length; size > 1; size = Math.floor((size + 1) / 2)) {
    for (var i = 0; i < size; i += 2) {
      var i2 = Math.min(i + 1, size - 1);
      var buf = Buffer.concat([tree[j + i], tree[j + i2]]);
      tree.push(Hash.sha256sha256(buf));
    }
    j += size;
  }

  return tree;
};

/**
 * Calculates the merkleRoot from the transactions.
 * @returns {Buffer} - A buffer of the merkle root hash
 */
Block.prototype.getMerkleRoot = function getMerkleRoot() {
  var tree = this.getMerkleTree();
  return tree[tree.length - 1];
};

/**
 * Verifies that the transactions in the block match the header merkle root
 * @returns {Boolean} - If the merkle roots match
 */
Block.prototype.validMerkleRoot = function validMerkleRoot() {
  var h = new BN(this.header.merkleRoot.toString('hex'), 'hex');
  var c = new BN(this.getMerkleRoot().toString('hex'), 'hex');

  if (h.cmp(c) !== 0) {
    return false;
  }

  return true;
};

/**
 * @returns {Buffer} - The little endian hash buffer of the header
 */
Block.prototype._getHash = function () {
  return this.header._getHash();
};

var idProperty = {
  configurable: false,
  enumerable: true,
  /**
   * @returns {string} - The big endian hash buffer of the header
   */
  get: function () {
    if (!this._id) {
      this._id = this.header.id;
    }
    return this._id;
  },
  set: _.noop,
};
/**
 * Defines the `id` property on the Block prototype using the provided `idProperty` descriptor.
 * @memberof Block.prototype
 * @name id
 */
Object.defineProperty(Block.prototype, 'id', idProperty);
/**
 * Defines a property 'hash' on Block.prototype using idProperty as the descriptor.
 * @memberof Block.prototype
 * @name hash
 */
Object.defineProperty(Block.prototype, 'hash', idProperty);

/**
 * @returns {string} - A string formatted for the console
 */
Block.prototype.inspect = function inspect() {
  return '<Block ' + this.id + '>';
};

/**
 * Object containing constant values used by the Block module.
 * @namespace Block.Values
 */
Block.Values = {
  START_OF_BLOCK: 8, // Start of block in raw block data
  NULL_HASH: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
};


/**
 * Assigns the BlockHeader class to the Block namespace.
 * @memberof Block
 * @name BlockHeader
 */
Block.BlockHeader = BlockHeader;

/**
 * Assigns the MerkleBlock class to the Block namespace.
 * @memberof Block
 * @name MerkleBlock
 */
Block.MerkleBlock = MerkleBlock;

export default Block;
