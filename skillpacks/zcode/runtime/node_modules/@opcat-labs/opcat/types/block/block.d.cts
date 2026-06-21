export = Block;
/**
 * Instantiate a Block from a Buffer, JSON object, or Object with
 * the properties of the Block
 *
 * @param {*} - A Buffer, JSON string, or Object
 * @returns {Block}
 * @constructor
 */
declare function Block(arg: any): Block;
declare class Block {
    /**
     * Instantiate a Block from a Buffer, JSON object, or Object with
     * the properties of the Block
     *
     * @param {*} - A Buffer, JSON string, or Object
     * @returns {Block}
     * @constructor
     */
    constructor(arg: any);
    transactions: any[];
    /**
     * Converts the Block instance to a plain object (also aliased as toJSON).
     * @returns {Object} The plain object representation of the Block.
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Converts the block to a buffer representation.
     * @returns {Buffer} The buffer containing the block data.
     */
    toBuffer(): Buffer;
    /**
     * Returns the string representation of the Block instance.
     * @returns {string} - A hex encoded string of the block
     */
    toString(): string;
    /**
     * @param {BufferWriter} - An existing instance of BufferWriter
     * @returns {BufferWriter} - An instance of BufferWriter representation of the Block
     */
    toBufferWriter(bw: any): BufferWriter;
    /**
     * Will iterate through each transaction and return an array of hashes
     * @returns {Array} - An array with transaction hashes
     */
    getTransactionHashes(): any[];
    /**
     * Will build a merkle tree of all the transactions, ultimately arriving at
     * a single point, the merkle root.
     * @link https://en.bitcoin.it/wiki/Protocol_specification#Merkle_Trees
     * @returns {Array} - An array with each level of the tree after the other.
     */
    getMerkleTree(): any[];
    /**
     * Calculates the merkleRoot from the transactions.
     * @returns {Buffer} - A buffer of the merkle root hash
     */
    getMerkleRoot(): Buffer;
    /**
     * Verifies that the transactions in the block match the header merkle root
     * @returns {Boolean} - If the merkle roots match
     */
    validMerkleRoot(): boolean;
    /**
     * @returns {Buffer} - The little endian hash buffer of the header
     */
    _getHash(): Buffer;
    id: any;
    hash: any;
    /**
     * @returns {string} - A string formatted for the console
     */
    inspect(): string;
}
declare namespace Block {
    export let MAX_BLOCK_SIZE: number;
    /**
     * Creates a Block instance from the given argument.
     * @param {*} arg - The input to convert into a Block.
     * @returns {Block} A new Block instance.
     * @throws {TypeError} - If the argument was not recognized
     * @private
     */
    export function _from(arg: any): Block;
    /**
     * Creates a Block instance from a plain object.
     * @param {Object} data - The plain object containing block data.
     * @returns {Block} The created Block instance.
     * @private
     */
    export function _fromObject(data: any): Block;
    /**
     * Creates a Block instance from a plain JavaScript object.
     * @param {Object} obj - The source object to convert to a Block.
     * @returns {Block} A new Block instance.
     */
    export function fromObject(obj: any): Block;
    /**
     * Creates a Block instance from a BufferReader.
     * @private
     * @param {BufferReader} br - The buffer reader containing block data
     * @returns {Block} The parsed Block instance
     */
    export function _fromBufferReader(br: BufferReader): Block;
    /**
     * Creates a Block instance from a BufferReader.
     * @param {BufferReader} br - The buffer reader containing block data.
     * @returns {Block} The parsed Block instance.
     */
    export function fromBufferReader(br: BufferReader): Block;
    /**
     * Creates a Block instance from a buffer.
     * @param {Buffer} buf - The input buffer to create the block from.
     * @returns {Block} The created Block instance.
     */
    export function fromBuffer(buf: Buffer): Block;
    /**
     * Creates a Block instance from a string representation.
     * @param {string} str - The string to parse into a Block.
     * @returns {Block} The parsed Block instance.
     */
    export function fromString(str: string): Block;
    /**
     * Creates a Block instance from raw block data.
     * @param {Object} data - The raw block data to convert.
     * @returns {Block} A new Block instance.
     */
    export function fromRawBlock(data: any): Block;
    export namespace Values {
        let START_OF_BLOCK: number;
        let NULL_HASH: Buffer;
    }
    export { BlockHeader };
    export { MerkleBlock };
}
import BufferWriter = require("../encoding/bufferwriter.cjs");
import BufferReader = require("../encoding/bufferreader.cjs");
import BlockHeader = require("./blockheader.cjs");
import MerkleBlock = require("./merkleblock.cjs");
