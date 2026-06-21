export = PublicKey;
/**
 * Instantiate a PublicKey from a {@link PrivateKey}, {@link Point}, `string`, or `Buffer`.
 *
 * There are two internal properties, `network` and `compressed`, that deal with importing
 * a PublicKey from a PrivateKey in WIF format. More details described on {@link PrivateKey}
 *
 * @example
 * ```javascript
 * // instantiate from a private key
 * var key = PublicKey(privateKey, true);
 *
 * // export to as a DER hex encoded string
 * var exported = key.toString();
 *
 * // import the public key
 * var imported = PublicKey.fromString(exported);
 * ```
 *
 * @param {string} data - The encoded data in various formats
 * @param {Object} extra - additional options
 * @param {Network} extra.network - Which network should the address for this public key be for
 * @param {String=} extra.compressed - If the public key is compressed
 * @returns {PublicKey} A new valid instance of an PublicKey
 * @constructor
 */
declare function PublicKey(data: string, extra: {
    network: Network;
    compressed?: string | undefined;
}): PublicKey;
declare class PublicKey {
    /**
     * Instantiate a PublicKey from a {@link PrivateKey}, {@link Point}, `string`, or `Buffer`.
     *
     * There are two internal properties, `network` and `compressed`, that deal with importing
     * a PublicKey from a PrivateKey in WIF format. More details described on {@link PrivateKey}
     *
     * @example
     * ```javascript
     * // instantiate from a private key
     * var key = PublicKey(privateKey, true);
     *
     * // export to as a DER hex encoded string
     * var exported = key.toString();
     *
     * // import the public key
     * var imported = PublicKey.fromString(exported);
     * ```
     *
     * @param {string} data - The encoded data in various formats
     * @param {Object} extra - additional options
     * @param {Network} extra.network - Which network should the address for this public key be for
     * @param {String=} extra.compressed - If the public key is compressed
     * @returns {PublicKey} A new valid instance of an PublicKey
     * @constructor
     */
    constructor(data: string, extra: {
        network: Network;
        compressed?: string | undefined;
    });
    /**
     * Internal function to differentiate between arguments passed to the constructor
     * @param {*} data
     * @param {Object} extra
     */
    _classifyArgs(data: any, extra: any): {
        compressed: any;
    };
    /**
     * @returns {Object} A plain object of the PublicKey
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Will output the PublicKey to a DER Buffer
     *
     * @returns {Buffer} A DER hex encoded buffer
     */
    toBuffer: () => Buffer;
    toDER(): Buffer;
    /**
     * Will return a sha256 + ripemd160 hash of the serialized public key
     * @see https://github.com/bitcoin/bitcoin/blob/master/src/pubkey.h#L141
     * @returns {Buffer}
     */
    _getID(): Buffer;
    /**
     * Will return an address for the public key
     *
     * @param {string|Network} [network] - Which network should the address be for
     * @returns {Address} An address generated from the public key
     */
    toAddress(network?: string | Network): Address;
    /**
     * Will output the PublicKey to a DER encoded hex string
     *
     * @returns {string} A DER hex encoded string
     */
    toString: () => string;
    toHex(): string;
    /**
     * Will return a string formatted for the console
     *
     * @returns {string} Public key
     */
    inspect(): string;
}
declare namespace PublicKey {
    /**
     * Internal function to detect if an object is a {@link PrivateKey}
     *
     * @param {*} param - object to test
     * @returns {boolean}
     * @private
     */
    function _isPrivateKey(param: any): boolean;
    /**
     * Internal function to detect if an object is a Buffer
     *
     * @param {*} param - object to test
     * @returns {boolean}
     * @private
     */
    function _isBuffer(param: any): boolean;
    /**
     * Internal function to transform a private key into a public key point
     *
     * @param {PrivateKey} privkey - An instance of PrivateKey
     * @returns {Object} An object with keys: point and compressed
     * @private
     */
    function _transformPrivateKey(privkey: PrivateKey): any;
    /**
     * Internal function to transform DER into a public key point
     *
     * @param {Buffer} buf - An DER buffer
     * @param {bool=} strict - if set to false, will loosen some conditions
     * @returns {Object} An object with keys: point and compressed
     * @private
     */
    function _transformDER(buf: Buffer, strict?: bool): any;
    /**
     * Internal function to transform X into a public key point
     *
     * @param {Boolean} odd - If the point is above or below the x axis
     * @param {Point} x - The x point
     * @returns {Object} An object with keys: point and compressed
     * @private
     */
    function _transformX(odd: boolean, x: Point): any;
    /**
     * Internal function to transform a JSON into a public key point
     *
     * @param {String|Object} json - a JSON string or plain object
     * @returns {Object} An object with keys: point and compressed
     * @private
     */
    function _transformObject(json: any): any;
    /**
     * Instantiate a PublicKey from a PrivateKey
     *
     * @param {PrivateKey} privkey - An instance of PrivateKey
     * @returns {PublicKey} A new valid instance of PublicKey
     */
    function fromPrivateKey(privkey: PrivateKey): PublicKey;
    function fromDER(buf: Buffer, strict?: bool): PublicKey;
    function fromBuffer(buf: Buffer, strict?: bool): PublicKey;
    /**
     * Instantiate a PublicKey from a Point
     *
     * @param {Point} point - A Point instance
     * @param {boolean=} compressed - whether to store this public key as compressed format
     * @returns {PublicKey} A new valid instance of PublicKey
     */
    function fromPoint(point: Point, compressed?: boolean): PublicKey;
    function fromHex(str: string, encoding?: string): PublicKey;
    function fromString(str: string, encoding?: string): PublicKey;
    /**
     * Instantiate a PublicKey from an X Point
     *
     * @param {Boolean} odd - If the point is above or below the x axis
     * @param {Point} x - The x point
     * @returns {PublicKey} A new valid instance of PublicKey
     */
    function fromX(odd: boolean, x: Point): PublicKey;
    /**
     * Check if there would be any errors when initializing a PublicKey
     *
     * @param {string} data - The encoded data in various formats
     * @returns {null|Error} An error if exists
     */
    function getValidationError(data: string): Error;
    /**
     * Check if the parameters are valid
     *
     * @param {string} data - The encoded data in various formats
     * @returns {Boolean} If the public key would be valid
     */
    function isValid(data: string): boolean;
}
import Address = require("./address.cjs");
import Point = require("./crypto/point.cjs");
