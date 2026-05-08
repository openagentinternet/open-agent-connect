export = BufferWriter;
/**
 * BufferWriter is a utility class for efficiently writing and concatenating buffers.
 * It provides methods for writing various numeric types in both little-endian and big-endian formats,
 * as well as variable-length integers (varints). The class maintains an internal array of buffers
 * and can efficiently concatenate them into a single buffer when needed.
 *
 * @class
 * @example
 * const writer = new BufferWriter();
 * writer.writeUInt32LE(1234).writeUInt16BE(5678);
 * const result = writer.toBuffer();
 */
declare class BufferWriter {
    /**
     * Converts a number to a varint-encoded Buffer.
     * @param {number} n - The number to encode.
     * @returns {Buffer} The varint-encoded Buffer.
     */
    static varintBufNum(n: number): Buffer;
    /**
     * Initializes a new BufferWriter instance.
     * @param {Object} [obj] - Optional object to set initial buffer content. If not provided,
     *                         creates an empty buffer writer with empty buffers array and length 0.
     */
    constructor(obj?: any);
    buffers: any[];
    length: number;
    /**
     * Appends a buffer to the internal buffers array and updates the total length.
     * @param {Buffer} buffer - The buffer to append.
     * @returns {this} Returns the instance for chaining.
     */
    write(buffer: Buffer): this;
    /**
     * Sets the internal buffers and calculates total length.
     * @param {Object} obj - Object containing buffers (either `buffers` or `bufs` property)
     * @returns {Object} Returns the instance for chaining
     */
    set(obj: any): any;
    /**
     * Returns the buffer by concatenating all written data.
     * @returns {Buffer} The concatenated buffer.
     */
    concat(): Buffer;
    /**
     * Converts the internal buffer chunks into a single Buffer.
     * If there's only one chunk, returns it directly. Otherwise,
     * concatenates all chunks into a new Buffer.
     * @returns {Buffer} The combined buffer
     */
    toBuffer(): Buffer;
    /**
     * Writes a buffer in reverse order to the current buffer.
     * @param {Buffer} buf - The buffer to be written in reverse.
     * @returns {this} Returns the instance for chaining.
     */
    writeReverse(buf: Buffer): this;
    /**
     * Writes a 16-bit unsigned integer in little-endian format.
     * @param {number} n - The number to write.
     * @returns {this} Returns the instance for chaining.
     */
    writeUInt16LE(n: number): this;
    /**
     * Writes a 16-bit unsigned integer in big-endian byte order.
     * Internally converts the value to little-endian and reverses the bytes.
     * @param {number} n - The number to write (0-65535).
     * @returns {BufferWriter} Returns the BufferWriter instance for chaining.
     */
    writeUInt16BE(n: number): BufferWriter;
    /**
     * Writes a 32-bit unsigned integer in little-endian format.
     * @param {number} n - The number to write.
     * @returns {this} Returns the instance for chaining.
     */
    writeUInt32LE(n: number): this;
    /**
     * Writes a 32-bit unsigned integer in big-endian format.
     * @param {number} n - The number to write.
     * @returns {BufferWriter} Returns the BufferWriter instance for chaining.
     */
    writeUInt32BE(n: number): BufferWriter;
    /**
     * Writes an unsigned 8-bit integer to the buffer in little-endian format.
     * @param {number} n - The number to write (0-255)
     * @returns {this} Returns the BufferWriter instance for chaining
     */
    writeUInt8(n: number): this;
    /**
     * Writes a 64-bit unsigned integer in little-endian byte order from a BigNumber.
     * @param {Object} bn - The BigNumber to write.
     * @returns {this} Returns the BufferWriter instance for chaining.
     */
    writeUInt64LEBN(bn: any): this;
    /**
     * Writes a 64-bit unsigned integer in big-endian byte order (as BN.js instance).
     * Internally converts to little-endian and writes reversed for big-endian output.
     * @param {BN} bn - The BigNumber to write as 64-bit big-endian
     * @returns {BufferWriter} Returns this instance for chaining
     */
    writeUInt64BEBN(bn: BN): BufferWriter;
    /**
     * Writes a variable-length integer (varint) to the buffer.
     * @param {number} n - The number to write as varint
     * @returns {this} Returns the BufferWriter instance for chaining
     */
    writeVarintNum(n: number): this;
    /**
     * Writes a 32-bit signed integer in little-endian format to the buffer.
     * @param {number} n - The integer to write.
     * @returns {this} Returns the BufferWriter instance for chaining.
     */
    writeInt32LE(n: number): this;
    /**
     * Writes a variable-length integer (varint) to the buffer using BigNumber.
     * Handles numbers of different sizes with appropriate encoding:
     * - Numbers < 253: 1 byte
     * - Numbers < 0x10000: 1 byte prefix (253) + 2 bytes
     * - Numbers < 0x100000000: 1 byte prefix (254) + 4 bytes
     * - Larger numbers: 1 byte prefix (255) + 8 bytes
     * @param {BN} bn - BigNumber to write as varint
     * @returns {BufferWriter} Returns this for chaining
     */
    writeVarintBN(bn: BN): BufferWriter;
}
