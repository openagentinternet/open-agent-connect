export = Opcode;
/**
 * Creates an Opcode instance from a number or string representation.
 * @constructor
 * @param {number|string} num - The numeric value or string name of the opcode
 * @throws {TypeError} If the input type is not recognized
 * @returns {Opcode} A new Opcode instance
 */
declare function Opcode(num: number | string): Opcode;
declare class Opcode {
    /**
     * Creates an Opcode instance from a number or string representation.
     * @constructor
     * @param {number|string} num - The numeric value or string name of the opcode
     * @throws {TypeError} If the input type is not recognized
     * @returns {Opcode} A new Opcode instance
     */
    constructor(num: number | string);
    /**
     * Converts the opcode number to its hexadecimal string representation.
     * @returns {string} Hexadecimal string of the opcode number.
     */
    toHex(): string;
    /**
     * Converts the opcode to a Buffer by first converting it to a hex string.
     * @returns {Buffer} The opcode represented as a Buffer.
     */
    toBuffer(): Buffer;
    /**
     * Gets the numeric value of the opcode.
     * @returns {number} The numeric representation of the opcode.
     */
    toNumber(): number;
    /**
     * Converts the opcode number to its string representation.
     * @throws {Error} If the opcode number has no corresponding string mapping.
     * @returns {string} The string representation of the opcode.
     */
    toString(): string;
    /**
     * Converts the opcode to a human-readable string representation.
     * If the opcode has a known mnemonic, returns that string.
     * Otherwise, returns the hexadecimal representation of the opcode.
     * @returns {string} The safe string representation of the opcode.
     */
    toSafeString(): string;
    /**
     * Will return a string formatted for the console
     *
     * @returns {string} Script opcode
     */
    inspect(): string;
}
declare namespace Opcode {
    /**
     * Creates an Opcode instance from a Buffer.
     * @param {Buffer} buf - The buffer containing the opcode data.
     * @returns {Opcode} The constructed Opcode instance.
     * @throws {Error} If the input is not a Buffer.
     */
    function fromBuffer(buf: Buffer): Opcode;
    /**
     * Creates an Opcode instance from a number.
     * @param {number} num - The numeric value to convert to an Opcode.
     * @returns {Opcode} A new Opcode instance.
     * @throws {Error} If the input is not a number.
     */
    function fromNumber(num: number): Opcode;
    /**
     * Creates an Opcode instance from a string representation.
     * @param {string} str - The string representation of the opcode.
     * @returns {Opcode} A new Opcode instance corresponding to the input string.
     * @throws {TypeError} If the input string is not a valid opcode representation.
     */
    function fromString(str: string): Opcode;
    /**
     * Converts a small integer (0-16) to its corresponding opcode.
     * @param {number} n - The integer to convert (must be between 0 and 16)
     * @returns {Opcode} The corresponding opcode (OP_0 for 0, OP_1+n-1 for 1-16)
     * @throws {Error} If n is not a number or outside valid range
     */
    function smallInt(n: number): Opcode;
    let map: {
        [x: string]: number;
    };
    let reverseMap: any[];
    /**
     * Checks if the given opcode is a small integer opcode (OP_0 to OP_16).
     * @param {number|Opcode} opcode - The opcode to check, either as a number or Opcode instance.
     * @returns {boolean} True if the opcode is a small integer opcode, false otherwise.
     */
    function isSmallIntOp(opcode: number | Opcode): boolean;
}
