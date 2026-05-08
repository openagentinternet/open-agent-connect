export = JSUtil;
/**
 * Utility functions for JavaScript operations.
 * @constructor
 */
declare function JSUtil(): void;
declare class JSUtil {
}
declare namespace JSUtil {
    /**
     * Determines whether a string contains only hexadecimal values
     *
     * @name JSUtil.isHexa
     * @param {string} value
     * @return {boolean} true if the string is the hexa representation of a number
     */
    export function isHexa(value: string): boolean;
    import isHexaString = isHexa;
    export { isHexaString };
    /**
     * Checks that a value is a natural number, a positive integer or zero.
     *
     * @param {*} value
     * @return {Boolean}
     */
    export function isNaturalNumber(value: any): boolean;
    /**
    * Transform a 4-byte integer (unsigned value) into a Buffer of length 4 (Big Endian Byte Order)
    *
    * @param {number} integer
    * @return {Buffer}
    */
    export function integerAsBuffer(integer: number): Buffer;
    /**
     * Test if an argument is a valid JSON object. If it is, returns a truthy
     * value (the json object decoded), so no double JSON.parse call is necessary
     *
     * @param {string} arg
     * @return {Object|boolean} false if the argument is not a JSON string.
     */
    export function isValidJSON(arg: string): any;
    /**
       * Define immutable properties on a target object
       *
       * @param {Object} target - An object to be extended
       * @param {Object} values - An object of properties
       * @return {Object} The target object
       */
    export function defineImmutable(target: any, values: any): any;
}
