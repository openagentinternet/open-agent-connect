export = Base58;
/**
 * A Base58 object can encode/decoded Base 58, which is used primarily for
 * string-formatted Bitcoin addresses and private keys. Addresses and private
 * keys actually use an additional checksum, and so they actually use the
 * Base58Check class.
 *
 * @param {object} obj Can be a string or buffer.
 */
declare function Base58(obj: object): Base58;
declare class Base58 {
    /**
     * A Base58 object can encode/decoded Base 58, which is used primarily for
     * string-formatted Bitcoin addresses and private keys. Addresses and private
     * keys actually use an additional checksum, and so they actually use the
     * Base58Check class.
     *
     * @param {object} obj Can be a string or buffer.
     */
    constructor(obj: object);
    /**
     * Sets the buffer property from the given object.
     * @param {Object} obj - The object containing the buffer to set.
     * @param {Buffer} [obj.buf] - The buffer to assign. If not provided, retains current buffer or sets to undefined.
     * @returns {Base58} Returns the instance for chaining.
     */
    set(obj: {
        buf?: Buffer;
    }): Base58;
    buf: any;
    /**
     * Sets the internal buffer to the provided buffer and returns the instance for chaining.
     * @param {Buffer} buf - The buffer to set as the internal buffer.
     * @returns {Base58} The instance for method chaining.
     */
    fromBuffer(buf: Buffer): Base58;
    /**
     * Converts a Base58 encoded string to a buffer and stores it in the instance.
     * @param {string} str - The Base58 encoded string to decode.
     * @returns {Base58} The current instance for chaining.
     */
    fromString(str: string): Base58;
    /**
     * Returns the internal buffer containing the Base58 encoded data.
     * @returns {Buffer} The raw buffer representation of the Base58 data.
     */
    toBuffer(): Buffer;
    /**
     * Converts the Base58 encoded data to a hexadecimal string.
     * @returns {string} Hexadecimal representation of the Base58 data.
     */
    toHex(): string;
    /**
     * Converts the Base58 instance to its string representation.
     * @returns {string} The Base58 encoded string.
     */
    toString(): string;
}
declare namespace Base58 {
    /**
     * Checks if all characters in the input are valid Base58 characters.
     * @param {string|Buffer} chars - The input characters to validate (can be a string or Buffer).
     * @returns {boolean} True if all characters are valid Base58, false otherwise.
     * @static
     */
    function validCharacters(chars: string | Buffer): boolean;
    /**
     * Encode a buffer to Bsae 58.
     *
     * @param {Buffer} buf Any buffer to be encoded.
     * @returns {string} A Base 58 encoded string.
     * @throws {Error} If the input is not a buffer.
     * @static
     */
    function encode(buf: Buffer): string;
    /**
     * Decode a Base 58 string to a buffer.
     *
     * @param {string} str A Base 58 encoded string.
     * @returns {Buffer} The decoded buffer.
     * @throws {Error} If the input is not a string.
     * @static
     */
    function decode(str: string): Buffer;
    /**
     * Creates a Base58 encoded string from a buffer.
     * @param {Buffer} buf - The input buffer to encode.
     * @returns {Base58} A new Base58 instance containing the encoded string.
     * @static
     */
    function fromBuffer(buf: Buffer): Base58;
    /**
     * Converts a hex string to Base58 encoded string.
     * @param {string} hex - The hex string to convert.
     * @returns {string} The Base58 encoded string.
     * @static
     */
    function fromHex(hex: string): string;
    /**
     * Creates a Base58 instance from a string input.
     * @param {string} str - The string to convert to Base58.
     * @returns {Base58} A new Base58 instance containing the encoded string.
     * @static
     */
    function fromString(str: string): Base58;
}
