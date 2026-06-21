export = HDPublicKey;
/**
 * The representation of an hierarchically derived public key.
 *
 * See https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
 *
 * @constructor
 * @param {Object|string|Buffer} arg
 */
declare function HDPublicKey(arg: any | string | Buffer): HDPublicKey;
declare class HDPublicKey {
    /**
     * The representation of an hierarchically derived public key.
     *
     * See https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
     *
     * @constructor
     * @param {Object|string|Buffer} arg
     */
    constructor(arg: any | string | Buffer);
    /**
     * WARNING: This method will not be officially supported until v1.0.0.
     *
     *
     * Get a derivated child based on a string or number.
     *
     * If the first argument is a string, it's parsed as the full path of
     * derivation. Valid values for this argument include "m" (which returns the
     * same public key), "m/0/1/40/2/1000".
     *
     * Note that hardened keys can't be derived from a public extended key.
     *
     * If the first argument is a number, the child with that index will be
     * derived. See the example usage for clarification.
     *
     * @example
     * ```javascript
     * var parent = new HDPublicKey('xpub...');
     * var child_0_1_2 = parent.deriveChild(0).deriveChild(1).deriveChild(2);
     * var copy_of_child_0_1_2 = parent.deriveChild("m/0/1/2");
     * assert(child_0_1_2.xprivkey === copy_of_child_0_1_2);
     * ```
     *
     * @param {string|number} arg - The index or path to derive
     * @param {boolean} [hardened=false] - Whether to use hardened derivation
     * @returns {HDPublicKey} The derived child public key
     */
    deriveChild(arg: string | number, hardened?: boolean): HDPublicKey;
    private _deriveWithNumber;
    private _deriveFromString;
    private _buildFromObject;
    private _buildFromSerialized;
    private _buildFromBuffers;
    /**
     * Returns the base58 checked representation of the public key
     * @return {string} a string starting with "xpub..." in livenet
     */
    toString(): string;
    /**
     * Returns the console representation of this extended public key.
     * @return string
     */
    inspect(): string;
    /**
     * Returns a plain JavaScript object with information to reconstruct a key.
     *
     * Fields are:
     * <ul>
     *  <li> network: 'livenet' or 'testnet' </li>
     *  <li> depth: a number from 0 to 255, the depth to the master extended key </li>
     *  <li> fingerPrint: a number of 32 bits taken from the hash of the public key </li>
     *  <li> fingerPrint: a number of 32 bits taken from the hash of this key's parent's public key </li>
     *  <li> childIndex: index with which this key was derived </li>
     *  <li> chainCode: string in hexa encoding used for derivation </li>
     *  <li> publicKey: string, hexa encoded, in compressed key format </li>
     *  <li> checksum: this._buffers.checksum.readUInt32BE(0) </li>
     *  <li> xpubkey: the string with the base58 representation of this extended key </li>
     *  <li> checksum: the base58 checksum of xpubkey </li>
     * </ul>
     */
    toObject: () => {
        network: any;
        depth: any;
        fingerPrint: any;
        parentFingerPrint: any;
        childIndex: any;
        chainCode: any;
        publicKey: any;
        checksum: any;
        xpubkey: any;
    };
    toJSON(): {
        network: any;
        depth: any;
        fingerPrint: any;
        parentFingerPrint: any;
        childIndex: any;
        chainCode: any;
        publicKey: any;
        checksum: any;
        xpubkey: any;
    };
    /**
     * Return a buffer representation of the xpubkey
     *
     * @return {Buffer}
     */
    toBuffer(): Buffer;
    /**
     * Return a hex string representation of the xpubkey
     *
     * @return {Buffer}
     */
    toHex(): Buffer;
}
declare namespace HDPublicKey {
    /**
     * Converts an HDPrivateKey to an HDPublicKey.
     * @param {HDPrivateKey} hdPrivateKey - The HD private key to convert.
     * @returns {HDPublicKey} The corresponding HD public key.
     */
    export function fromHDPrivateKey(hdPrivateKey: HDPrivateKey): HDPublicKey;
    /**
     * Checks if a given argument is a valid HD public key derivation path.
     * @param {string|number} arg - The path to validate (either as string like "m/0/1" or as a single index number).
     * @returns {boolean} True if the path is valid, false otherwise.
     * @description Validates both string paths (e.g., "m/0/1") and individual derivation indexes.
     * String paths must contain valid indexes separated by '/', and each index must be a non-negative number less than HDPublicKey.Hardened.
     */
    export function isValidPath(arg: string | number): boolean;
    /**
     * Verifies that a given serialized public key in base58 with checksum format
     * is valid.
     *
     * @param {string|Buffer} data - the serialized public key
     * @param {string|Network} [network]  - optional, if present, checks that the
     *     network provided matches the network serialized.
     * @return {boolean}
     */
    export function isValidSerialized(data: string | Buffer, network?: any): boolean;
    /**
     * Checks what's the error that causes the validation of a serialized public key
     * in base58 with checksum to fail.
     *
     * @param {string|Buffer} data - the serialized public key
     * @param {string|Network} [network] - optional, if present, checks that the
     *     network provided matches the network serialized.
     * @return {Error|null}
     */
    export function getSerializedError(data: string | Buffer, network?: any): Error;
    /**
     * Validates if the provided data matches the expected network version.
     * @param {Buffer} data - The data containing the version to validate.
     * @param {string|Network} networkArg - The network or network identifier to validate against.
     * @returns {InvalidNetworkArgument|InvalidNetwork|null} Returns an error if validation fails, otherwise null.
     * @private
     */
    export function _validateNetwork(data: Buffer, networkArg: any): any;
    /**
     * Validates buffer arguments for HDPublicKey.
     * @private
     * @param {Object} arg - The argument object containing buffer fields to validate
     * @param {Buffer} arg.version - Version buffer (must be HDPublicKey.VersionSize bytes)
     * @param {Buffer} arg.depth - Depth buffer (must be HDPublicKey.DepthSize bytes)
     * @param {Buffer} arg.parentFingerPrint - Parent fingerprint buffer (must be HDPublicKey.ParentFingerPrintSize bytes)
     * @param {Buffer} arg.childIndex - Child index buffer (must be HDPublicKey.ChildIndexSize bytes)
     * @param {Buffer} arg.chainCode - Chain code buffer (must be HDPublicKey.ChainCodeSize bytes)
     * @param {Buffer} arg.publicKey - Public key buffer (must be HDPublicKey.PublicKeySize bytes)
     * @param {Buffer} [arg.checksum] - Optional checksum buffer (must be HDPublicKey.CheckSumSize bytes if provided)
     * @throws {Error} If any buffer is invalid or has incorrect size
     */
    export function _validateBufferArguments(arg: {
        version: Buffer;
        depth: Buffer;
        parentFingerPrint: Buffer;
        childIndex: Buffer;
        chainCode: Buffer;
        publicKey: Buffer;
        checksum?: Buffer;
    }): void;
    /**
     * Creates an HDPublicKey instance from a string representation.
     * @param {string} arg - The string to convert to an HDPublicKey.
     * @returns {HDPublicKey} A new HDPublicKey instance.
     * @throws {Error} Throws if the input is not a valid string.
     */
    export function fromString(arg: string): HDPublicKey;
    /**
     * Creates an HDPublicKey instance from an object.
     * @param {Object} arg - The object containing public key data
     * @returns {HDPublicKey} A new HDPublicKey instance
     * @throws {Error} Will throw if no valid object argument is provided
     */
    export function fromObject(arg: any): HDPublicKey;
    /**
     * Create a HDPublicKey from a buffer argument
     *
     * @param {Buffer} arg
     * @return {HDPublicKey}
     */
    export function fromBuffer(arg: Buffer): HDPublicKey;
    /**
     * Create a HDPublicKey from a hex string argument
     *
     * @param {Buffer} arg
     * @return {HDPublicKey}
     */
    export function fromHex(hex: any): HDPublicKey;
    export let Hardened: number;
    export let RootElementAlias: string[];
    export let VersionSize: number;
    export let DepthSize: number;
    export let ParentFingerPrintSize: number;
    export let ChildIndexSize: number;
    export let ChainCodeSize: number;
    export let PublicKeySize: number;
    export let CheckSumSize: number;
    export let DataSize: number;
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
    import PublicKeyStart = ChainCodeEnd;
    export { PublicKeyStart };
    export let PublicKeyEnd: number;
    import ChecksumStart = PublicKeyEnd;
    export { ChecksumStart };
    export let ChecksumEnd: number;
}
