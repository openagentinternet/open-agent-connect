export = BufferReader;
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
declare function BufferReader(buf: Buffer | string | any): BufferReader;
declare class BufferReader {
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
    constructor(buf: Buffer | string | any);
    /**
     * Updates the buffer and position from the given object.
     * @param {Object} obj - The object containing buffer and position to set.
     * @param {Buffer} [obj.buf] - The buffer to set (optional, keeps current if not provided).
     * @param {number} [obj.pos] - The position to set (optional, keeps current if not provided).
     * @returns {BufferReader} Returns the instance for chaining.
     */
    set(obj: {
        buf?: Buffer;
        pos?: number;
    }): BufferReader;
    buf: any;
    pos: any;
    /**
     * Checks if the reader has reached the end of the buffer.
     * @returns {boolean} True if the current position is at or beyond the buffer length, false otherwise.
     */
    eof(): boolean;
    /**
     * Alias for `eof` method - checks if the buffer reader has reached the end of data.
     * @name BufferReader.prototype.finished
     * @memberof BufferReader
     * @instance
     */
    finished: any;
    /**
     * Reads a specified number of bytes from the buffer and advances the position.
     * @param {number} len - The number of bytes to read.
     * @returns {Buffer} The read bytes as a Buffer.
     * @throws {Error} If the length is undefined.
     */
    read(len: number): Buffer;
    /**
     * Reads and returns all remaining bytes from the buffer, advancing the position to the end.
     * @returns {Buffer} The remaining bytes in the buffer.
     */
    readAll(): Buffer;
    /**
     * Reads an unsigned 8-bit integer from the buffer at the current position.
     * @returns {number} The unsigned 8-bit integer value read.
     * @this {BufferReader}
     */
    readUInt8(this: BufferReader): number;
    /**
     * Reads an unsigned 16-bit integer from the buffer in big-endian format.
     * Advances the position by 2 bytes.
     * @returns {number} The read unsigned 16-bit integer value.
     */
    readUInt16BE(): number;
    /**
     * Reads a 16-bit unsigned integer from the buffer in little-endian format
     * and advances the position by 2 bytes.
     * @returns {number} The read unsigned 16-bit integer value
     */
    readUInt16LE(): number;
    /**
     * Reads an unsigned 32-bit integer from the buffer in big-endian format.
     * Advances the position by 4 bytes.
     * @returns {number} The read unsigned 32-bit integer value.
     */
    readUInt32BE(): number;
    /**
     * Reads an unsigned 32-bit integer from the buffer in little-endian format.
     * Advances the position by 4 bytes.
     * @returns {number} The read unsigned 32-bit integer value.
     */
    readUInt32LE(): number;
    /**
     * Reads a 32-bit signed integer from the buffer in little-endian format.
     * Advances the position by 4 bytes.
     * @returns {number} The read 32-bit signed integer.
     */
    readInt32LE(): number;
    /**
     * Reads an unsigned 64-bit integer in big-endian byte order from the buffer
     * and returns it as a BN (BigNumber) object.
     * Advances the position by 8 bytes.
     * @returns {BN} The parsed 64-bit unsigned integer as a BigNumber
     */
    readUInt64BEBN(): BN;
    /**
     * Reads an unsigned 64-bit integer in little-endian byte order from the buffer and returns it as a BN (BigNumber).
     * Optimizes for numbers <= 52 bits by using numeric constructor, falls back to buffer slice for larger numbers.
     * Advances the buffer position by 8 bytes.
     * @returns {BN} The parsed 64-bit unsigned integer as a BN instance.
     */
    readUInt64LEBN(): BN;
    /**
     * Reads a variable-length integer (varint) from the buffer and returns it as a number.
     * Supports varints up to 53 bits (JavaScript's safe integer limit).
     * For larger numbers, throws an error suggesting to use `readVarintBN` instead.
     * @returns {number} The decoded integer value
     * @throws {Error} If the number exceeds 53-bit precision
     */
    readVarintNum(): number;
    /**
     * Reads a variable-length buffer from the current position.
     * First reads a varint to determine the length, then reads the buffer of that size.
     * @returns {Buffer} The read buffer.
     * @throws {Error} If the actual read length doesn't match the expected length.
     */
    readVarLengthBuffer(): Buffer;
    /**
     * Reads a variable-length integer (varint) from the buffer.
     * The first byte determines the length of the varint:
     * - 0xfd: 2-byte varint (plus 1 byte for the prefix)
     * - 0xfe: 4-byte varint (plus 1 byte for the prefix)
     * - 0xff: 8-byte varint (plus 1 byte for the prefix)
     * - Otherwise: 1-byte varint (no prefix)
     * @returns {Buffer} The varint bytes including the prefix (if any)
     */
    readVarintBuf(): Buffer;
    /**
     * Reads a variable-length integer (varint) from the buffer and returns it as a BN (BigNumber).
     * Handles different varint sizes (1, 2, 4, or 8 bytes) based on the first byte's value:
     * - 0xfd: reads next 2 bytes as uint16
     * - 0xfe: reads next 4 bytes as uint32
     * - 0xff: reads next 8 bytes as uint64
     * - default: treats first byte as uint8
     * @returns {BN} The parsed varint as a BigNumber
     */
    readVarintBN(): BN;
    /**
     * Reverses the order of bytes in the internal buffer and returns the instance.
     * @returns {BufferReader} The modified BufferReader instance for chaining.
     */
    reverse(): BufferReader;
    /**
     * Reads a specified number of bytes from the buffer in reverse order.
     * @param {number} [len] - The number of bytes to read. If omitted, reads the entire buffer.
     * @returns {Buffer} The reversed buffer segment.
     */
    readReverse(len?: number): Buffer;
    /**
     * Gets the number of bytes remaining to be read in the buffer.
     * @returns {number} The remaining bytes count.
     */
    remaining(): number;
}
import BN = require("../bn.cjs");
