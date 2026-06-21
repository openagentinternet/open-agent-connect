export = HDPrivateKey;
/**
 * Creates a new HDPrivateKey instance from various input formats.
 * More info on https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
 * @constructor
 * @param {HDPrivateKey|string|Buffer|Object} arg - Input can be:
 *   - Existing HDPrivateKey instance (returns same instance)
 *   - Network name (generates random key for that network)
 *   - Serialized string/Buffer (base58 encoded)
 *   - JSON string
 *   - Object with key properties
 * @throws {hdErrors.UnrecognizedArgument} If input format is not recognized
 * @throws {Error} If serialized input is invalid
 */
declare function HDPrivateKey(arg: HDPrivateKey | string | Buffer | any): HDPrivateKey;
declare class HDPrivateKey {
    /**
     * Creates a new HDPrivateKey instance from various input formats.
     * More info on https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
     * @constructor
     * @param {HDPrivateKey|string|Buffer|Object} arg - Input can be:
     *   - Existing HDPrivateKey instance (returns same instance)
     *   - Network name (generates random key for that network)
     *   - Serialized string/Buffer (base58 encoded)
     *   - JSON string
     *   - Object with key properties
     * @throws {hdErrors.UnrecognizedArgument} If input format is not recognized
     * @throws {Error} If serialized input is invalid
     */
    constructor(arg: HDPrivateKey | string | Buffer | any);
    get hdPublicKey(): HDPublicKey;
    get xpubkey(): any;
    /**
     * WARNING: This method will not be officially supported until v1.0.0.
     *
     *
     * Get a derived child based on a string or number.
     *
     * If the first argument is a string, it's parsed as the full path of
     * derivation. Valid values for this argument include "m" (which returns the
     * same private key), "m/0/1/40/2'/1000", where the ' quote means a hardened
     * derivation.
     *
     * If the first argument is a number, the child with that index will be
     * derived. If the second argument is truthy, the hardened version will be
     * derived. See the example usage for clarification.
     *
     * WARNING: The `nonCompliant` option should NOT be used, except for older implementation
     * that used a derivation strategy that used a non-zero padded private key.
     *
     * @example
     * ```javascript
     * var parent = new HDPrivateKey('xprv...');
     * var child_0_1_2h = parent.deriveChild(0).deriveChild(1).deriveChild(2, true);
     * var copy_of_child_0_1_2h = parent.deriveChild("m/0/1/2'");
     * assert(child_0_1_2h.xprivkey === copy_of_child_0_1_2h);
     * ```
     *
     * @param {string|number} arg
     * @param {boolean} [hardened]
     */
    deriveChild(arg: string | number, hardened?: boolean): HDPrivateKey;
    /**
     * WARNING: This method will not be officially supported until v1.0.0
     *
     *
     * WARNING: If this is a new implementation you should NOT use this method, you should be using
     * `derive` instead.
     *
     * This method is explicitly for use and compatibility with an implementation that
     * was not compliant with BIP32 regarding the derivation algorithm. The private key
     * must be 32 bytes hashing, and this implementation will use the non-zero padded
     * serialization of a private key, such that it's still possible to derive the privateKey
     * to recover those funds.
     *
     * @param {number|string} arg - Either a child index number or derivation path string
     * @param {boolean} [hardened] - Whether to create hardened derivation (only used with number arg)
     * @returns {HDPrivateKey} The derived child private key
     * @throws {hdErrors.InvalidDerivationArgument} If argument type is invalid
     */
    deriveNonCompliantChild(arg: number | string, hardened?: boolean): HDPrivateKey;
    private _deriveWithNumber;
    private _deriveFromString;
    private _buildFromJSON;
    private _buildFromObject;
    private _buildFromSerialized;
    private _generateRandomly;
    private _calcHDPublicKey;
    _hdPublicKey: HDPublicKey;
    /**
     * Converts the HDPrivateKey instance to its corresponding HDPublicKey.
     * @returns {HDPublicKey} The derived HD public key.
     */
    toHDPublicKey(): HDPublicKey;
    /**
     * Returns the private key associated with this HD private key.
     * @returns {PrivateKey} The private key instance.
     */
    toPrivateKey(): PrivateKey;
    private _buildFromBuffers;
    /**
     * Returns the extended private key string representation of this HDPrivateKey.
     *  (a string starting with "xprv...")
     * @returns {string} The extended private key in base58 string format.
     */
    toString(): string;
    /**
     * Returns the console representation of this extended private key.
     * @return string
     */
    inspect(): string;
    /**
     * Returns a plain object with a representation of this private key.
     *
     * Fields include:
     * <ul>
     * <li> network: either 'livenet' or 'testnet' </li>
     * <li> depth: a number ranging from 0 to 255 </li>
     * <li> fingerPrint: a number ranging from 0 to 2^32-1, taken from the hash of the associated public key </li>
     * <li> parentFingerPrint: a number ranging from 0 to 2^32-1, taken from the hash of this parent's associated public key or zero. </li>
     * <li> childIndex: the index from which this child was derived (or zero) </li>
     * <li> chainCode: an hexa string representing a number used in the derivation </li>
     * <li> privateKey: the private key associated, in hexa representation </li>
     * <li> xprivkey: the representation of this extended private key in checksum base58 format </li>
     * <li> checksum: the base58 checksum of xprivkey </li>
     * </ul>
     *  @return {Object}
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Returns a buffer representation of the HDPrivateKey
     *
     * @return {string}
     */
    toBuffer(): string;
    /**
     * Returns a hex string representation of the HDPrivateKey
     *
     * @return {string}
     */
    toHex(): string;
}
declare namespace HDPrivateKey {
    /**
     * Creates a new HDPrivateKey instance with random values.
     * @returns {HDPrivateKey} A new HDPrivateKey object with randomly generated properties.
     */
    export function fromRandom(): HDPrivateKey;
    /**
     * Verifies that a given path is valid.
     *
     * @param {string|number} arg
     * @param {boolean} [hardened]
     * @return {boolean}
     */
    export function isValidPath(arg: string | number, hardened?: boolean): boolean;
    /**
     * Verifies that a given serialized private key in base58 with checksum format
     * is valid.
     *
     * @param {string|Buffer} data - the serialized private key
     * @param {string|Network} network - optional, if present, checks that the
     *     network provided matches the network serialized.
     * @return {boolean}
     */
    export function isValidSerialized(data: string | Buffer, network: any): boolean;
    /**
     * Checks what's the error that causes the validation of a serialized private key
     * in base58 with checksum to fail.
     *
     * @param {string|Buffer} data - the serialized private key
     * @param {string|Network} network - optional, if present, checks that the
     *     network provided matches the network serialized.
     * @return {errors.InvalidArgument|null}
     */
    export function getSerializedError(data: string | Buffer, network: any): any;
    /**
     * Validates if the provided data matches the expected network's extended private key version.
     * @param {Buffer} data - The data buffer to validate (must include version bytes).
     * @param {string|Network} networkArg - Network identifier or Network object to validate against.
     * @returns {Error|null} Returns error if validation fails, otherwise null.
     * @private
     */
    export function _validateNetwork(data: Buffer, networkArg: any): Error;
    /**
     * Creates an HDPrivateKey instance from a string representation.
     * @param {string} arg - The string to convert to an HDPrivateKey
     * @returns {HDPrivateKey} A new HDPrivateKey instance
     * @throws {Error} If the input is not a valid string
     */
    export function fromString(arg: string): HDPrivateKey;
    /**
     * Creates an HDPrivateKey instance from a plain object.
     * @param {Object} arg - The object containing HDPrivateKey properties.
     * @throws {Error} Throws if argument is not a valid object.
     * @returns {HDPrivateKey} A new HDPrivateKey instance.
     */
    export function fromObject(arg: any): HDPrivateKey;
    /**
     * Generate a private key from a seed, as described in BIP32
     *
     * @param {string|Buffer} hexa
     * @param {Network} [network]
     * @return HDPrivateKey
     * @static
     */
    export function fromSeed(hexa: string | Buffer, network?: Network): HDPrivateKey;
    /**
     * Validates buffer arguments for HDPrivateKey.
     * Checks that each required buffer field exists and has the correct size.
     * @private
     * @param {Object} arg - Object containing buffer fields to validate
     * @param {Buffer} arg.version - Version buffer
     * @param {Buffer} arg.depth - Depth buffer
     * @param {Buffer} arg.parentFingerPrint - Parent fingerprint buffer
     * @param {Buffer} arg.childIndex - Child index buffer
     * @param {Buffer} arg.chainCode - Chain code buffer
     * @param {Buffer} arg.privateKey - Private key buffer
     * @param {Buffer} [arg.checksum] - Optional checksum buffer
     */
    export function _validateBufferArguments(arg: {
        version: Buffer;
        depth: Buffer;
        parentFingerPrint: Buffer;
        childIndex: Buffer;
        chainCode: Buffer;
        privateKey: Buffer;
        checksum?: Buffer;
    }): void;
    /**
     * Build a HDPrivateKey from a buffer
     *
     * @param {Buffer} arg
     * @return {HDPrivateKey}
     */
    export function fromBuffer(buf: any): HDPrivateKey;
    /**
     * Build a HDPrivateKey from a hex string
     *
     * @param {string} hex
     * @return {HDPrivateKey}
     */
    export function fromHex(hex: string): HDPrivateKey;
    export let DefaultDepth: number;
    export let DefaultFingerprint: number;
    export let DefaultChildIndex: number;
    export let Hardened: number;
    export let MaxIndex: number;
    export let RootElementAlias: string;
    export let VersionSize: number;
    export let DepthSize: number;
    export let ParentFingerPrintSize: number;
    export let ChildIndexSize: number;
    export let ChainCodeSize: number;
    export let PrivateKeySize: number;
    export let CheckSumSize: number;
    export let DataLength: number;
    export let SerializedByteSize: number;
    export let VersionStart: number;
    export let VersionEnd: number;
    import DepthStart = VersionEnd;
    export { DepthStart };
    export let DepthEnd: number;
    import ParentFingerPrintStart = DepthEnd;
    export { ParentFingerPrintStart };
    export let ParentFingerPrintEnd: number;
    import ChildIndexStart = ParentFingerPrintEnd;
    export { ChildIndexStart };
    export let ChildIndexEnd: number;
    import ChainCodeStart = ChildIndexEnd;
    export { ChainCodeStart };
    export let ChainCodeEnd: number;
    export let PrivateKeyStart: number;
    export let PrivateKeyEnd: number;
    import ChecksumStart = PrivateKeyEnd;
    export { ChecksumStart };
    export let ChecksumEnd: number;
}
import HDPublicKey = require("./hdpublickey.cjs");
import PrivateKey = require("./privatekey.cjs");
