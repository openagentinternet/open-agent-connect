export = Base58Check;
/**
 * A Base58check object can encode/decodd Base 58, which is used primarily for
 * string-formatted Bitcoin addresses and private keys. This is the same as
 * Base58, except that it includes a checksum to prevent accidental mistypings.
 * @constructor
 * @param {Buffer|string} obj Can be a string or buffer.
 */
declare function Base58Check(obj: Buffer | string): Base58Check;
declare class Base58Check {
    /**
     * A Base58check object can encode/decodd Base 58, which is used primarily for
     * string-formatted Bitcoin addresses and private keys. This is the same as
     * Base58, except that it includes a checksum to prevent accidental mistypings.
     * @constructor
     * @param {Buffer|string} obj Can be a string or buffer.
     */
    constructor(obj: Buffer | string);
    /**
     * Sets the buffer property from the given object.
     * @param {Object} obj - The object containing the buffer to set.
     * @returns {Base58Check} Returns the instance for chaining.
     */
    set(obj: any): Base58Check;
    buf: any;
    /**
     * Sets the internal buffer to the provided Buffer object.
     * @param {Buffer} buf - The buffer to set as the internal state.
     * @returns {Base58Check} Returns the instance for chaining.
     */
    fromBuffer(buf: Buffer): Base58Check;
    /**
     * Converts a Base58Check encoded string to a buffer and stores it in the instance.
     * @param {string} str - The Base58Check encoded string to decode.
     * @returns {Base58Check} Returns the instance for chaining.
     */
    fromString(str: string): Base58Check;
    /**
     * Returns the internal buffer containing the Base58Check encoded data.
     * @returns {Buffer} The raw buffer representation of the Base58Check data.
     */
    toBuffer(): Buffer;
    /**
     * Converts the Base58Check encoded data to a hexadecimal string.
     * @returns {string} Hexadecimal representation of the data.
     */
    toHex(): string;
    /**
     * Converts the Base58Check instance to its string representation.
     * @returns {string} The Base58Check encoded string.
     */
    toString(): string;
}
declare namespace Base58Check {
    /**
     * Validates the checksum of Base58Check encoded data.
     * @param {Buffer|string} data - The data to validate, either as a Buffer or Base58 encoded string.
     * @param {Buffer|string} [checksum] - Optional checksum to validate against, either as a Buffer or Base58 encoded string.
     * If not provided, the last 4 bytes of the data will be used as checksum.
     * @returns {boolean} True if the computed checksum matches the provided/embedded checksum.
     * @static
     */
    function validChecksum(data: string | Buffer, checksum?: string | Buffer): boolean;
    /**
     * Decodes a Base58Check encoded string and verifies its checksum.
     * @param {string} s - The Base58Check encoded string to decode.
     * @returns {Buffer} The decoded data (excluding checksum).
     * @throws {Error} If input is not a string, too short, or checksum mismatch.
     * @static
     */
    function decode(s: string): Buffer;
    /**
     * Calculates the checksum for a given buffer using double SHA-256 hash.
     * The checksum is the first 4 bytes of the double-hashed result.
     * @param {Buffer} buffer - The input buffer to calculate checksum for
     * @returns {Buffer} The 4-byte checksum
     * @static
     */
    function checksum(buffer: Buffer): Buffer;
    /**
     * Encodes a buffer into Base58Check format.
     * @param {Buffer} buf - The input buffer to encode
     * @returns {string} The Base58Check encoded string
     * @throws {Error} If input is not a Buffer
     * @static
     */
    function encode(buf: Buffer): string;
    /**
     * Creates a Base58Check encoded string from a buffer.
     * @param {Buffer} buf - The input buffer to encode.
     * @returns {Base58Check} A new Base58Check instance containing the encoded data.
     */
    function fromBuffer(buf: Buffer): Base58Check;
    /**
     * Converts a hex string to a Base58Check encoded string.
     * @param {string} hex - The hex string to convert.
     * @returns {string} The Base58Check encoded string.
     */
    function fromHex(hex: string): string;
    /**
     * Converts a Base58Check-encoded string into a Base58 object.
     * @param {string} str - The Base58Check-encoded string to decode.
     * @returns {Base58} A new Base58 instance containing the decoded data.
     */
    function fromString(str: string): Base58;
}
import Base58 = require("./base58.cjs");
