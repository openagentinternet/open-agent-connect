export = Output;
/**
 * Represents a transaction output in the Bitcoin protocol.
 * @constructor
 * @param {Object} args - The arguments to create an Output.
 * @param {number} args.satoshis - The amount in satoshis.
 * @param {Buffer|string|Script} args.script - The output script (either as Buffer or hex string).
 * @param {Buffer|string} [args.data] - Additional data associated with the output.
 * @throws {TypeError} If arguments are invalid or unrecognized.
 */
declare function Output(args: {
    satoshis: number;
    script: Buffer | string | Script;
    data?: Buffer | string;
}): Output;
declare class Output {
    /**
     * Represents a transaction output in the Bitcoin protocol.
     * @constructor
     * @param {Object} args - The arguments to create an Output.
     * @param {number} args.satoshis - The amount in satoshis.
     * @param {Buffer|string|Script} args.script - The output script (either as Buffer or hex string).
     * @param {Buffer|string} [args.data] - Additional data associated with the output.
     * @throws {TypeError} If arguments are invalid or unrecognized.
     */
    constructor(args: {
        satoshis: number;
        script: Buffer | string | Script;
        data?: Buffer | string;
    });
    satoshis: number;
    get script(): Script;
    get data(): Buffer;
    /**
     * Checks if the satoshis value in this output is invalid.
     * @returns {string|boolean} Returns an error message string if invalid (satoshis exceed max safe integer,
     *                           corrupted value, or negative), otherwise returns false.
     */
    invalidSatoshis(): string | boolean;
    set satoshisBN(value: any);
    get satoshisBN(): any;
    /**
     * Converts the Output instance to a plain object representation.
     * The resulting object includes satoshis, script (as hex string), and data (as hex string).
     * @returns {Object} - An object with satoshis, script, and data properties.
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Sets the output data.
     * @param {Buffer|string} data - The data to set. Can be a Buffer or hex string.
     * @throws {TypeError} If data is not a Buffer or valid hex string.
     */
    setData(data: Buffer | string): void;
    _data: Buffer;
    /**
     * Sets the script for this output from a buffer.
     * @param {Buffer} buffer - The buffer containing the script data.
     * @throws {errors.Script.InvalidBuffer} If the buffer is invalid.
     */
    setScriptFromBuffer(buffer: Buffer): void;
    _script: Script;
    /**
     * Sets the script for this output.
     * @param {Script|string|Buffer} script - The script to set, which can be a Script instance, hex string, or Buffer.
     * @returns {Output} Returns the output instance for chaining.
     * @throws {TypeError} Throws if the script type is invalid.
     */
    setScript(script: Script | string | Buffer): Output;
    /**
     * Returns a human-readable string representation of the Output object.
     * Format: '<Output (satoshis sats) scriptString>'
     * @returns {string} Formatted string showing satoshis and script inspection result
     */
    inspect(): string;
    /**
     * Converts the Output instance to a buffer writer format.
     * @param {boolean} hashScriptPubkey - If true, hashes script and data with SHA256; otherwise writes them directly.
     * @param {BufferWriter} [writer] - Optional BufferWriter instance. If not provided, a new one is created.
     * @returns {BufferWriter} The buffer writer containing the serialized output data.
     */
    toBufferWriter(hashScriptPubkey: boolean, writer?: BufferWriter): BufferWriter;
    /**
     * Calculates the total size of the output in bytes.
     * Includes the script size, data size, and their respective varint sizes,
     * plus a fixed 8-byte overhead.
     * 8    value
     * ???  script+data size (VARINT)
     * script size
     * data size
     * @returns {number} The total output size in bytes.
     */
    getSize(): number;
    /**
     * Creates a shallow clone of the Output instance.
     * @returns {Output} A new Output instance with the same properties as the original.
     */
    clone(): Output;
}
declare namespace Output {
    /**
     * Creates an Output instance from a plain JavaScript object.
     * @param {Object} data - The input object to convert to an Output
     * @returns {Output} A new Output instance
     * @static
     */
    function fromObject(data: any): Output;
    /**
     * Creates an Output instance from a BufferReader.
     * @param {BufferReader} br - The buffer reader containing output data
     * @returns {Output} A new Output instance
     * @throws {TypeError} If the buffer contains unrecognized output format
     * @static
     */
    function fromBufferReader(br: BufferReader): Output;
}
import Script = require("../script/script.cjs");
import BufferWriter = require("../encoding/bufferwriter.cjs");
