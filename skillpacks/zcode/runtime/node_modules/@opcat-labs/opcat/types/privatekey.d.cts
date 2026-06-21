export = PrivateKey;
/**
 * Instantiate a PrivateKey from a BN, Buffer or WIF string.
 *
 * @param {string|BN|Buffer|Object} data - The encoded data in various formats
 * @param {Network|string} [network] - a {@link Network} object, or a string with the network name
 * @returns {PrivateKey} A new valid instance of an PrivateKey
 * @constructor
 */
declare function PrivateKey(data: string | BN | Buffer | any, network?: Network | string): PrivateKey;
declare class PrivateKey {
    /**
     * Instantiate a PrivateKey from a BN, Buffer or WIF string.
     *
     * @param {string|BN|Buffer|Object} data - The encoded data in various formats
     * @param {Network|string} [network] - a {@link Network} object, or a string with the network name
     * @returns {PrivateKey} A new valid instance of an PrivateKey
     * @constructor
     */
    constructor(data: string | BN | Buffer | any, network?: Network | string);
    get publicKey(): PublicKey;
    get network(): any;
    get compressed(): any;
    private _classifyArguments;
    /**
     * Will output the PrivateKey in WIF
     *
     * @returns {string}
     */
    toString(): string;
    /**
     * Will output the PrivateKey to a WIF string
     *
     * @returns {string} A WIP representation of the private key
     */
    toWIF(): string;
    /**
     * Will return the private key as a BN instance
     *
     * @returns {BN} A BN instance of the private key
     */
    toBigNumber(): BN;
    /**
     * Will return the private key as a BN buffer
     *
     * @returns {Buffer} A buffer of the private key
     */
    toBuffer(): Buffer;
    /**
     * Converts the private key to a hexadecimal string representation.
     * @returns {string} Hexadecimal string of the private key.
     */
    toHex(): string;
    /**
     * Will return the corresponding public key
     *
     * @returns {PublicKey} A public key generated from the private key
     */
    toPublicKey(): PublicKey;
    _pubkey: PublicKey;
    /**
     * Will return an address for the private key
     * @param {Network|string} [network] - optional parameter specifying
     * the desired network for the address
     *
     * @returns {Address} An address generated from the private key
     */
    toAddress(network?: Network | string): Address;
    /**
     * @returns {Object} A plain object representation
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Will return a string formatted for the console
     *
     * @returns {string} Private key
     */
    inspect(): string;
}
declare namespace PrivateKey {
    /**
     * Internal function to get a random Big Number (BN)
     *
     * @returns {BN} A new randomly generated BN
     * @private
     */
    function _getRandomBN(): BN;
    /**
     * Internal function to transform a WIF Buffer into a private key
     *
     * @param {Buffer} buf - An WIF string
     * @param {Network|string} [network] - a {@link Network} object, or a string with the network name
     * @returns {Object} An object with keys: bn, network and compressed
     * @private
     */
    function _transformBuffer(buf: Buffer, network?: any): any;
    /**
     * Internal function to transform a BN buffer into a private key
     *
     * @param {Buffer} buf
     * @param {Network|string=} network - a {@link Network} object, or a string with the network name
     * @returns {object} an Object with keys: bn, network, and compressed
     * @private
     */
    function _transformBNBuffer(buf: Buffer, network?: any): any;
    /**
     * Internal function to transform a WIF string into a private key
     *
     * @param {string} buf - An WIF string
     * @returns {Object} An object with keys: bn, network and compressed
     * @private
     */
    function _transformWIF(str: any, network: any): any;
    /**
     * Instantiate a PrivateKey from a Buffer with the DER or WIF representation
     *
     * @param {Buffer} buf
     * @param {Network} network
     * @return {PrivateKey}
     */
    function fromBuffer(buf: Buffer, network: Network): PrivateKey;
    /**
     * Creates a PrivateKey instance from a hexadecimal string.
     * @param {string} hex - The hexadecimal string representation of the private key.
     * @param {Network} network - The network associated with the private key.
     * @returns {PrivateKey} A PrivateKey instance.
     */
    function fromHex(hex: string, network: Network): PrivateKey;
    /**
     * Internal function to transform a JSON string on plain object into a private key
     * return this.
     *
     * @param {string} json - A JSON string or plain object
     * @returns {Object} An object with keys: bn, network and compressed
     * @private
     */
    function _transformObject(json: string): any;
    function fromString(str: string): PrivateKey;
    function fromWIF(str: string): PrivateKey;
    function fromObject(obj: any): PrivateKey;
    function fromJSON(obj: any): PrivateKey;
    /**
     * Instantiate a PrivateKey from random bytes
     *
     * @param {string|Network} [network] - Either "livenet" or "testnet"
     * @returns {PrivateKey} A new valid instance of PrivateKey
     */
    function fromRandom(network?: any): PrivateKey;
    /**
     * Check if there would be any errors when initializing a PrivateKey
     *
     * @param {string} data - The encoded data in various formats
     * @param {string|Network} [network] - Either "livenet" or "testnet"
     * @returns {null|Error} An error if exists
     */
    function getValidationError(data: string, network?: any): Error;
    /**
     * Check if the parameters are valid
     *
     * @param {string} data - The encoded data in various formats
     * @param {string|Network} [network] - Either "livenet" or "testnet"
     * @returns {Boolean} If the private key is would be valid
     */
    function isValid(data: string, network?: any): boolean;
}
import BN = require("./bn.cjs");
import PublicKey = require("./publickey.cjs");
import Address = require("./address.cjs");
