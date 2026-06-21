export = HashCache;
/**
 * A class representing a cache for transaction hash buffers.
 * Provides methods for serialization/deserialization between Buffer, JSON, and hex formats.
 *
 * @class
 * @property {Buffer} prevoutsHashBuf - Hash buffer for transaction prevouts
 * @property {Buffer} sequenceHashBuf - Hash buffer for transaction sequence
 * @property {Buffer} outputsHashBuf - Hash buffer for transaction outputs
 */
declare class HashCache {
    /**
     * Creates a HashCache instance from a buffer by parsing it as JSON.
     * @param {Buffer} buf - The input buffer containing JSON data.
     * @returns {HashCache} A new HashCache instance created from the parsed JSON.
     */
    static fromBuffer(buf: Buffer): HashCache;
    /**
     * Creates a HashCache instance from a JSON object.
     * @param {Object} json - The JSON object containing hash buffers in hex format.
     * @param {string} [json.prevoutsHashBuf] - Hex string for prevouts hash buffer.
     * @param {string} [json.sequenceHashBuf] - Hex string for sequence hash buffer.
     * @param {string} [json.outputsHashBuf] - Hex string for outputs hash buffer.
     * @returns {HashCache} A new HashCache instance with converted Buffer values.
     */
    static fromJSON(json: {
        prevoutsHashBuf?: string;
        sequenceHashBuf?: string;
        outputsHashBuf?: string;
    }): HashCache;
    /**
     * Creates a HashCache instance from a hex string.
     * @param {string} hex - The hex string to convert to a buffer.
     * @returns {HashCache} A HashCache instance created from the hex string buffer.
     */
    static fromHex(hex: string): HashCache;
    /**
     * Constructs a new hash cache instance with the provided hash buffers.
     * @param {Buffer} prevoutsHashBuf - Hash buffer for prevouts
     * @param {Buffer} sequenceHashBuf - Hash buffer for sequence
     * @param {Buffer} outputsHashBuf - Hash buffer for outputs
     */
    constructor(prevoutsHashBuf: Buffer, sequenceHashBuf: Buffer, outputsHashBuf: Buffer);
    prevoutsHashBuf: Buffer;
    sequenceHashBuf: Buffer;
    outputsHashBuf: Buffer;
    /**
     * Converts the object to a Buffer containing its JSON string representation.
     * @returns {Buffer} A Buffer containing the JSON string of the object.
     */
    toBuffer(): Buffer;
    /**
     * Converts the hash cache object to a JSON representation.
     * @returns {Object} An object containing hex string representations of the hash buffers:
     *                   - prevoutsHashBuf: Hex string of prevouts hash buffer (if exists)
     *                   - sequenceHashBuf: Hex string of sequence hash buffer (if exists)
     *                   - outputsHashBuf: Hex string of outputs hash buffer (if exists)
     */
    toJSON(): any;
    /**
     * Converts the object's buffer representation to a hexadecimal string.
     * @returns {string} Hexadecimal string representation of the buffer.
     */
    toHex(): string;
}
