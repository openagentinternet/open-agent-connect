export = BlockHeader;
/**
 * Instantiate a BlockHeader from a Buffer, JSON object, or Object with
 * the properties of the BlockHeader
 *
 * @param {*} - A Buffer, JSON string, or Object
 * @returns {BlockHeader} - An instance of block header
 * @constructor
 */
declare function BlockHeader(arg: any): BlockHeader;
declare class BlockHeader {
    /**
     * Instantiate a BlockHeader from a Buffer, JSON object, or Object with
     * the properties of the BlockHeader
     *
     * @param {*} - A Buffer, JSON string, or Object
     * @returns {BlockHeader} - An instance of block header
     * @constructor
     */
    constructor(arg: any);
    version: any;
    prevHash: any;
    merkleRoot: any;
    time: any;
    timestamp: any;
    bits: any;
    nonce: any;
    /**
     * @returns {Object} - A plain object of the BlockHeader
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * @returns {Buffer} - A Buffer of the BlockHeader
     */
    toBuffer(): Buffer;
    /**
     * @returns {string} - A hex encoded string of the BlockHeader
     */
    toString(): string;
    /**
     * @param {BufferWriter} - An existing instance BufferWriter
     * @returns {BufferWriter} - An instance of BufferWriter representation of the BlockHeader
     */
    toBufferWriter(bw: any): BufferWriter;
    /**
     * Returns the target difficulty for this block
     * @param {Number} bits
     * @returns {BN} An instance of BN with the decoded difficulty bits
     */
    getTargetDifficulty(bits: number): BN;
    /**
     * @link https://en.bitcoin.it/wiki/Difficulty
     * @return {Number}
     */
    getDifficulty(): number;
    private _getHash;
    id: any;
    hash: any;
    /**
     * @returns {Boolean} - If timestamp is not too far in the future
     */
    validTimestamp(): boolean;
    /**
     * @returns {Boolean} - If the proof-of-work hash satisfies the target difficulty
     */
    validProofOfWork(): boolean;
    /**
     * @returns {string} - A string formatted for the console
     */
    inspect(): string;
}
declare namespace BlockHeader {
    /**
     * @param {*} - A Buffer, JSON string or Object
     * @returns {Object} - An object representing block header data
     * @throws {TypeError} - If the argument was not recognized
     * @private
     */
    function _from(arg: any): any;
    /**
     * @param {Object} - A JSON string
     * @returns {Object} - An object representing block header data
     * @private
     */
    function _fromObject(data: any): any;
    /**
     * @param {Object} - A plain JavaScript object
     * @returns {BlockHeader} - An instance of block header
     */
    function fromObject(obj: any): BlockHeader;
    /**
     * @param {Binary} - Raw block binary data or buffer
     * @returns {BlockHeader} - An instance of block header
     */
    function fromRawBlock(data: any): BlockHeader;
    /**
     * @param {Buffer} - A buffer of the block header
     * @returns {BlockHeader} - An instance of block header
     */
    function fromBuffer(buf: any): BlockHeader;
    /**
     * @param {string} - A hex encoded buffer of the block header
     * @returns {BlockHeader} - An instance of block header
     */
    function fromString(str: any): BlockHeader;
    /**
     * @param {BufferReader} - A BufferReader of the block header
     * @returns {Object} - An object representing block header data
     * @private
     */
    function _fromBufferReader(br: any): any;
    /**
     * @param {BufferReader} - A BufferReader of the block header
     * @returns {BlockHeader} - An instance of block header
     */
    function fromBufferReader(br: any): BlockHeader;
    namespace Constants {
        let START_OF_HEADER: number;
        let MAX_TIME_OFFSET: number;
        let LARGEST_HASH: BN;
    }
}
import BufferWriter = require("../encoding/bufferwriter.cjs");
import BN = require("../bn.cjs");
