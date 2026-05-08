export = MerkleBlock;
/**
 * Instantiate a MerkleBlock from a Buffer, JSON object, or Object with
 * the properties of the Block
 *
 * @param {*} - A Buffer, JSON string, or Object representing a MerkleBlock
 * @returns {MerkleBlock}
 * @constructor
 */
declare function MerkleBlock(arg: any): MerkleBlock;
declare class MerkleBlock {
    /**
     * Instantiate a MerkleBlock from a Buffer, JSON object, or Object with
     * the properties of the Block
     *
     * @param {*} - A Buffer, JSON string, or Object representing a MerkleBlock
     * @returns {MerkleBlock}
     * @constructor
     */
    constructor(arg: any);
    _flagBitsUsed: number;
    _hashesUsed: number;
    /**
     * @returns {Buffer} - A buffer of the block
     */
    toBuffer(): Buffer;
    /**
     * @param {BufferWriter} [bw] - An existing instance of BufferWriter
     * @returns {BufferWriter} - An instance of BufferWriter representation of the MerkleBlock
     */
    toBufferWriter(bw?: BufferWriter): BufferWriter;
    /**
     * @returns {Object} - A plain object with the MerkleBlock properties
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Verify that the MerkleBlock is valid
     * @returns {Boolean} - True/False whether this MerkleBlock is Valid
     */
    validMerkleTree(): boolean;
    /**
     * WARNING: This method is deprecated. Use filteredTxsHash instead.
     *
     * Return a list of all the txs hash that match the filter
     * @returns {Array} - txs hash that match the filter
     */
    filterdTxsHash(): any[];
    /**
     * Return a list of all the txs hash that match the filter
     * @returns {Array} - txs hash that match the filter
     */
    filteredTxsHash(): any[];
    private _traverseMerkleTree;
    private _calcTreeWidth;
    private _calcTreeHeight;
    /**
     * @param {Transaction|String} tx - Transaction or Transaction ID Hash
     * @returns {Boolean} - return true/false if this MerkleBlock has the TX or not
     */
    hasTransaction(tx: Transaction | string): boolean;
}
declare namespace MerkleBlock {
    /**
     * @param {Buffer} - MerkleBlock data in a Buffer object
     * @returns {MerkleBlock} - A MerkleBlock object
     */
    function fromBuffer(buf: any): MerkleBlock;
    /**
     * @param {BufferReader} - MerkleBlock data in a BufferReader object
     * @returns {MerkleBlock} - A MerkleBlock object
     */
    function fromBufferReader(br: any): MerkleBlock;
    /**
     * Parses a MerkleBlock from a buffer reader.
     * @private
     * @param {BufferReader} br - The buffer reader containing the MerkleBlock data
     * @returns {Object} An object containing:
     *   - header {BlockHeader} - The block header
     *   - numTransactions {number} - Number of transactions in the block
     *   - hashes {string[]} - Array of transaction hashes as hex strings
     *   - flags {number[]} - Array of flag bytes
     * @throws {Error} If no merkleblock data is received
     */
    function _fromBufferReader(br: BufferReader): any;
    /**
     * Creates a MerkleBlock instance from a plain object.
     * @param {Object} obj - The plain object containing MerkleBlock data.
     * @returns {MerkleBlock} A new MerkleBlock instance.
     */
    function fromObject(obj: any): MerkleBlock;
}
import BufferWriter = require("../encoding/bufferwriter.cjs");
import Transaction = require("../transaction/transaction.cjs");
import BufferReader = require("../encoding/bufferreader.cjs");
